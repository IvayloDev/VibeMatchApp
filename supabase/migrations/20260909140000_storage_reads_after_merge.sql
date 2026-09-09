-- Storage reads after the identity merge: close the legacy prefix, and stop
-- Apple/Google sign-in from blanking the Vault it just rescued.
--
-- ============================================================================
-- FINDING A: every install can read every legacy guest photo.
--
-- 20260814000000 left one policy alive on purpose:
--
--   images: TEMP authenticated can read legacy anonymous prefix
--     for select to authenticated
--     using (bucket_id = 'images' and (storage.foldername(name))[1] = 'anonymous')
--
-- It has no ownership test in it, because when it was written there was no way
-- to tell whose photo was whose. Its risk note priced that as "someone who
-- REGISTERS an account can enumerate the ~1500 legacy photos", which was a real
-- but narrow exposure: it cost an attacker an email address.
--
-- That precondition is now met by opening the app once. Anonymous sign-in is
-- on, every install mints an anonymous auth.users row on first launch, and a
-- Supabase anonymous user carries the role `authenticated` exactly like a
-- registered one. The migration that enabled it did not revisit this policy.
-- So the price of enumerating ~1500 strangers' personal photos went from "make
-- an account" to "install the app", with the app's own anon key doing the
-- sign-in. That is a GDPR Art.32 exposure and it is dropped below.
--
-- The reason this can be dropped NOW and could not be dropped in August is
-- scripts/migrate-legacy-anonymous-photos.mjs, which is phase 2 step 1: every
-- object under `anonymous/` that a history row claims has been copied to
-- `<owner-uid>/` and the row repointed. The first do-block refuses to deploy if
-- that is not actually true of this database, because dropping the policy while
-- a single owned row still points into the prefix blanks a real user's Vault.
--
-- ============================================================================
-- FINDING B: signing in with Apple or Google blanks the guest's whole Vault.
--
-- merge_anonymous_identity (20260909090000) moves history, purchases, grants
-- and the balance from the anonymous uid to the new account. It cannot move the
-- photos: storage.objects is not ours to write from SQL, and the objects stay
-- under `<old-anon-uid>/<ts>.jpg` with history.image_url still pointing there.
--
-- The read policy from 20260814000000 is
--
--   (storage.foldername(name))[1] = auth.uid()::text
--
-- and auth.uid() is now the NEW uid. First segment is the OLD one. So every
-- thumbnail the merge just carried over fails to sign, forever, and the user's
-- reward for signing in is an empty Vault. Nothing recovers on its own: the
-- path never changes and neither does the uid.
--
-- SQL cannot move storage objects, so this does not try. It adds a second,
-- narrow SELECT policy that answers the other half of the ownership question:
-- "is this folder an identity that merged INTO me". public.identity_merges is
-- already the authoritative record of that (from_user is its primary key, which
-- is what makes a replayed merge a no-op), so no new state is introduced.
--
-- This is also why dropping A costs nothing going forward. The legitimate need
-- for the `anonymous/` prefix was always "a guest's photos are not under the
-- uid they now sign in as", and that need is now served precisely, per folder
-- and per owner, instead of by handing out the whole prefix to everybody.
--
-- ============================================================================
-- WHY A SECURITY DEFINER HELPER AND NOT A SUBQUERY IN THE POLICY
--
-- An RLS policy expression is evaluated as the QUERYING role. 20260909090000
-- does `revoke all on public.identity_merges from anon, authenticated` and
-- enables RLS on it with no policies, both on purpose: a client that can read
-- that table can map every guest identity to the account it became, and a
-- client that can delete from it can replay a merge for a second payout. So a
-- plain `exists (select 1 from public.identity_merges ...)` inside the policy
-- would raise "permission denied for table identity_merges" on every storage
-- read. The helper below is the minimum hole in that wall: it takes a folder
-- name, answers one boolean about the CALLER's own absorptions, and is granted
-- to nothing except the role the policy runs as.
--
-- ----------------------------------------------------------------------------
-- HOW TO APPLY - the storage half of this file cannot be run by `postgres`.
--
-- storage.objects is owned by `supabase_storage_admin`, and on this project
-- `postgres` is not a member of it, so adding or dropping a storage policy from
-- the CLI or the Dashboard SQL editor fails with
--
--     ERROR: 42501: must be owner of table objects
--
-- Section 2 detects that instead of dying on it: it checks whether the policies
-- are ALREADY in the target shape (which is what a Dashboard application looks
-- like from here) and passes quietly if so, and otherwise raises a plain
-- English exception containing the exact statements to paste into Dashboard ->
-- Storage -> Policies, which runs as the storage admin. Sections 1 and 3 are
-- ordinary public-schema work and run fine as `postgres`.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to deploy if the TEMP policy is still load-bearing.
--
-- This is the check that turns "drop the temporary policy" from a hopeful
-- statement into a safe one. If any Vault row still resolves into the shared
-- prefix, its owner loses the thumbnail the moment the policy goes, and the
-- only way back is to restore a policy this file exists to remove.
-- ---------------------------------------------------------------------------
do $$
declare
  v_stranded integer;
begin
  -- Deliberately over-inclusive: the column normally holds a bare storage path
  -- like `anonymous/<uuid>/<uuid>.jpg`, but a handful of very old rows stored a
  -- whole signed URL. Matching the substring catches both. A false positive
  -- here costs a re-run of the mover script; a false negative costs somebody
  -- their photos.
  select count(*) into v_stranded
    from public.history h
   where h.user_id is not null
     and h.image_url like '%anonymous/%';

  -- Stranded rows no longer block the deploy, because section 1b below gives
  -- each owner a read of exactly the objects their OWN Vault references.
  --
  -- The first version of this refused outright and told the operator to run
  -- the mover script. That was right when the only alternative was the blanket
  -- prefix policy: one stranded row versus roughly 1500 photos readable by
  -- anyone who opens the app is not a trade worth making, so somebody had to
  -- move the object first. But it made the security fix wait on a data
  -- migration that has already failed once (one object returns an HTML gateway
  -- error and has resisted every retry since 2026-09-08), and it needs the
  -- service role key, which the operator has to fetch by hand.
  --
  -- A per-owner policy removes the choice. The enumeration hole closes now,
  -- the stranded owners keep their thumbnails, and moving the objects becomes
  -- housekeeping rather than a prerequisite. Left as a loud notice so the
  -- backlog stays visible.
  if v_stranded > 0 then
    raise notice
      'NOTE: % owned Vault rows still point into anonymous/. They stay readable through the per-owner policy in section 1b, NOT through the dropped blanket policy. Tidy them up when convenient with: SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-legacy-anonymous-photos.mjs --apply',
      v_stranded;
  else
    raise notice 'legacy prefix is no longer load-bearing: 0 owned Vault rows point into anonymous/';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. The one question the storage policy needs answered.
-- ---------------------------------------------------------------------------
create or replace function public.storage_folder_merged_into_caller(p_folder text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  -- SECURITY DEFINER changes the ROLE this runs as, not the request. auth.uid()
  -- reads the request.jwt.claims GUC, which the definer rights cannot touch, so
  -- this is still the caller's own uid. That is the entire basis of the
  -- ownership test at the bottom: if it were derivable from the function owner,
  -- the function would be a way to read anybody's folder.
  if v_caller is null then
    return false;
  end if;

  -- Anything that is not a bare uuid cannot be an absorbed identity's folder.
  -- Tested BEFORE the cast on purpose. This runs inside an RLS policy, once per
  -- candidate row, and a failing `::uuid` cast RAISES rather than simply not
  -- matching. A raise aborts the whole storage query, so a single object still
  -- sitting at `anonymous/...` would blank every thumbnail on the screen
  -- instead of just its own. Case-insensitive because a folder that fails to
  -- match is a blank thumbnail, and there is no reason to be brittle about it.
  if p_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  -- ONE HOP, DELIBERATELY. from_user is a primary key, so merges form chains,
  -- and a chain A -> B -> C would leave C unable to read A's folder. That
  -- cannot arise from the only caller: claim-anonymous-identity merges into
  -- whoever holds the Authorization header and is invoked only straight after
  -- an Apple or Google sign-in, so the destination is always a registered
  -- account, and a registered account is never a valid source (the merge
  -- function refuses one). MANY sources pointing at ONE destination is the
  -- normal case - sign out, get a fresh anonymous identity, sign back in - and
  -- that is a set of single hops, which this already handles. If a merge with
  -- an anonymous destination ever becomes possible, this needs a DEPTH-CAPPED
  -- walk up the chain; an uncapped recursive one is a hang inside an RLS
  -- policy, which is a total outage of every image in the app.
  --
  -- to_user is pinned to the caller, so this answers exactly one question:
  -- "did this folder's identity become ME". It can never report on, or grant
  -- anything from, a merge between two other people. That also makes the
  -- function safe to expose over PostgREST: the only fact a client can learn
  -- from it is one it already has.
  return exists (
    select 1
      from public.identity_merges m
     where m.from_user = p_folder::uuid
       and m.to_user   = v_caller
  );
end;
$$;

-- The policy expression is evaluated as the querying role, so `authenticated`
-- must be able to call this or every Vault read fails with permission denied.
-- `anon` must not: the bare key that ships in the app binary has no SELECT on
-- the images bucket at all any more, and this is the shape of the grant that
-- would start walking that back.
revoke all on function public.storage_folder_merged_into_caller(text)
  from public, anon, authenticated;
grant execute on function public.storage_folder_merged_into_caller(text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 1b. The second question: is this object one the caller's own Vault points at?
--
-- The merge answer above covers photos taken as a guest and then carried onto
-- an account. It does NOT cover the objects still sitting in the shared
-- anonymous/ prefix from before per-user folders existed. Those belong to
-- people who never merged anything; the blanket prefix policy is what has been
-- serving them, and that policy is the hole this migration closes.
--
-- Rather than make the security fix wait on a data migration that has already
-- failed on at least one object since 2026-09-08, ask the question the blanket
-- policy should have asked all along: not "is this in the legacy prefix", which
-- is true for everyone's photos, but "is this in the legacy prefix AND does
-- this caller's own history reference it", which is true only for their own.
--
-- history is RLS-protected and scoped to auth.uid(), but a storage policy runs
-- as the querying role and the planner will not apply one table's RLS inside
-- another's policy expression in a way worth relying on, so the ownership test
-- is written explicitly against v_caller here and the function is definer.
create or replace function public.storage_path_in_callers_history(p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null or p_path is null or p_path = '' then
    return false;
  end if;

  -- Suffix comparison rather than LIKE. Most rows store the bare storage path,
  -- but some very old ones stored a whole signed URL, so an equality test alone
  -- misses them. LIKE would work too and is what the deploy check above uses on
  -- a constant, but here the pattern would come from an object NAME: a filename
  -- containing % or _ would silently widen the match into other people's rows.
  -- right() has no wildcard semantics and cannot be widened by a filename.
  return exists (
    select 1
      from public.history h
     where h.user_id = v_caller
       and (
         h.image_url = p_path
         or right(h.image_url, length(p_path) + 1) = '/' || p_path
       )
  );
end;
$$;

revoke all on function public.storage_path_in_callers_history(text)
  from public, anon, authenticated;
grant execute on function public.storage_path_in_callers_history(text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The storage policies themselves.
--
-- Written as a discovery loop rather than as two named DROP statements because
-- the Dashboard renames what it creates: it caps policy names at 50 characters
-- and appends a unique suffix, so the policy this repo wrote as
--   "images: TEMP authenticated can read legacy anonymous prefix"
-- is live as
--   "images: TEMP read legacy anonymous prefix 1ffg0oo_0".
-- Dropping by the name in the file would report success and leave the hole
-- open, which is the worst possible outcome for a security fix. Matching on
-- what the policy DOES cannot miss a renamed copy.
--
-- The match is narrow on purpose: only policies whose USING expression compares
-- against the literal 'anonymous'. The guest INSERT policy also mentions that
-- string, but it lives in WITH CHECK and its cmd is INSERT, so it is not
-- touched. It must not be: it is the only way a pre-release build can still
-- upload.
--
-- `ALL` is matched alongside `SELECT` because an ALL policy grants reads too.
-- There is no such policy today, but a sweep that only looked for cmd =
-- 'SELECT' would report the hole closed while an ALL policy held it open,
-- which is the one failure mode a security check must not have.
-- ---------------------------------------------------------------------------
do $$
declare
  r            record;
  -- `name`, not text: pg_has_role below resolves to (name, name, text) and
  -- there is no implicit text -> name cast, so a text variable makes the call
  -- fail to resolve at runtime.
  v_owner      name;
  v_can_ddl    boolean;
  v_temp_left  integer;
  v_temp_names text;
  v_new_there  integer;
  v_hist_there integer;
  v_new_sql    constant text :=
    'create policy "images: owner can read absorbed folders"'
    || ' on storage.objects for select to authenticated'
    || ' using (bucket_id = ''images'''
    || ' and public.storage_folder_merged_into_caller((storage.foldername(name))[1]))';
  -- The replacement for the blanket prefix policy. Same prefix, one extra
  -- clause, and that clause is the whole difference between "any install can
  -- read 1500 strangers' photos" and "you can read the ones your own Vault
  -- points at".
  v_hist_sql   constant text :=
    'create policy "images: owner can read own legacy objects"'
    || ' on storage.objects for select to authenticated'
    || ' using (bucket_id = ''images'''
    || ' and public.storage_path_in_callers_history(name))';
begin
  select count(*), coalesce(string_agg(format('drop policy %I on storage.objects;', policyname), ' '), '')
    into v_temp_left, v_temp_names
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('SELECT', 'ALL') and qual like '%''anonymous''%';

  select count(*) into v_new_there
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd = 'SELECT' and qual like '%storage_folder_merged_into_caller%';

  select count(*) into v_hist_there
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd = 'SELECT' and qual like '%storage_path_in_callers_history%';

  -- Already applied through the Dashboard. Re-running the migration has to be a
  -- no-op rather than an error, or the file can never pass on this project.
  if v_temp_left = 0 and v_new_there > 0 and v_hist_there > 0 then
    raise notice 'storage read policies are already in the target shape, nothing to change';
    return;
  end if;

  select pg_catalog.pg_get_userbyid(c.relowner) into v_owner
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'storage' and c.relname = 'objects';

  v_can_ddl := coalesce(pg_has_role(current_user, v_owner, 'USAGE'), false)
               or coalesce(current_setting('is_superuser', true), 'off') = 'on';

  if not v_can_ddl then
    -- WARNING, not an exception, and the difference matters on this project.
    --
    -- storage.objects is owned by supabase_storage_admin here and the
    -- migration role is postgres, which is not a member. That is not a
    -- transient condition to retry past: it is how this Supabase project is
    -- shaped, so an exception here would fail this migration on every future
    -- `db push` and wedge every LATER migration behind it. The two helper
    -- functions above live in public and DO apply, so raising would also throw
    -- away the half of this file that works.
    --
    -- The trade is that this migration can no longer abort a build with the
    -- hole open. It is made as loud as SQL allows instead, and the exact
    -- statements are printed so the operator can paste them. Section 3 below
    -- re-checks the live policy state on every subsequent run and keeps
    -- shouting until they have been applied.
    raise warning E'\n\n================ ACTION REQUIRED, NOT APPLIED ================\nstorage.objects is owned by "%" and this connection ("%") is not a member of it, so this file cannot add or drop storage policies.\nTHE ENUMERATION HOLE IS STILL OPEN: every install can still read the whole legacy anonymous/ prefix.\nThe two helper functions DID apply. Paste these three statements into the Supabase SQL editor to finish:\n\n%\n%;\n%;\n\n==============================================================\n',
      v_owner, current_user, v_temp_names, v_new_sql, v_hist_sql;
    return;
  end if;

  for r in
    select policyname
      from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and cmd in ('SELECT', 'ALL') and qual like '%''anonymous''%'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
    raise notice 'dropped blanket legacy-prefix read policy: %', r.policyname;
  end loop;

  -- Additive. The per-owner policy from 20260814000000 stays exactly as it is;
  -- permissive policies OR together, so a user reads their own folder through
  -- that one and their absorbed folders through this one.
  if v_new_there = 0 then
    execute v_new_sql;
    raise notice 'created "images: owner can read absorbed folders"';
  end if;

  -- Created AFTER the blanket policy is dropped, in the same transaction, so
  -- there is never a moment where neither serves the legacy objects and never
  -- one where both do.
  if v_hist_there = 0 then
    execute v_hist_sql;
    raise notice 'created "images: owner can read own legacy objects"';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Prove it, and abort the deploy if any of it is wrong.
--
-- Three separate assertions because the three failures are different: the hole
-- still being open, the fix being absent, and the fix being wider than
-- intended. The last one is the one worth the most care, since a policy that is
-- too generous looks identical to a working one from the app.
-- ---------------------------------------------------------------------------

-- 3a. The hole is closed.
do $$
declare
  v_left  integer;
  v_names text;
  v_owned boolean;
begin
  -- Whether section 2 was ABLE to act. On this project it is not, because
  -- storage.objects belongs to supabase_storage_admin, so the assertions below
  -- have to distinguish "the fix was applied and is wrong" from "the fix could
  -- not be applied from here at all". Only the first is a reason to abort;
  -- turning the second into an abort wedges every later migration behind a
  -- condition no re-run can change.
  select coalesce(pg_has_role(current_user,
           pg_catalog.pg_get_userbyid(c.relowner), 'USAGE'), false)
    into v_owned
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'storage' and c.relname = 'objects';

  select count(*), coalesce(string_agg(policyname, ', '), '')
    into v_left, v_names
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('SELECT', 'ALL') and qual like '%''anonymous''%';

  if v_left > 0 and coalesce(v_owned, false) then
    raise exception
      'NOT FIXED: % storage read policy/policies still hand out the whole anonymous/ prefix (%). Anyone who opens the app once holds the authenticated role and can enumerate roughly 1500 strangers'' photos. Not deploying.',
      v_left, v_names;
  end if;

  if v_left > 0 then
    raise warning
      'STILL OPEN: % storage read policy/policies hand out the whole anonymous/ prefix (%). This connection cannot drop them; paste the statements printed above into the SQL editor.',
      v_left, v_names;
    return;
  end if;

  raise notice 'verify PASSED: no policy grants the anonymous/ prefix any more';
end;
$$;

-- 3b. The replacement exists, and is no wider than intended.
do $$
declare
  r       record;
  v_count integer;
begin
  select count(*) into v_count
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd = 'SELECT' and qual like '%storage_folder_merged_into_caller%';

  if v_count = 0 then
    -- Not created because section 2 could not act on this project. Everything
    -- below inspects a policy that does not exist yet, so there is nothing to
    -- assert. Warn and stop rather than abort: see the note in 3a.
    raise warning
      'STILL OPEN: the absorbed-folder read policy does not exist. Until it does, a user who signs in with Apple or Google sees an empty Vault. Paste the statements printed above into the SQL editor.';
    return;
  end if;

  if v_count <> 1 then
    raise exception
      'NOT FIXED: expected exactly one SELECT policy on storage.objects backed by storage_folder_merged_into_caller, found %. More than one means a duplicate was created with different bounds, and the widest one wins. Not deploying.',
      v_count;
  end if;

  select * into r
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd = 'SELECT' and qual like '%storage_folder_merged_into_caller%';

  -- A RESTRICTIVE policy ANDs with the others instead of ORing, so it would
  -- grant nothing and additionally break reads of a user's own folder.
  if r.permissive is distinct from 'PERMISSIVE' then
    raise exception
      'BROKEN: the absorbed-folder read policy is % rather than PERMISSIVE, so it grants nothing and narrows the owner policy as well. Not deploying.',
      r.permissive;
  end if;

  if r.roles::text[] is distinct from array['authenticated'] then
    raise exception
      'TOO WIDE: the absorbed-folder read policy applies to roles %, not to authenticated alone. Handing this to anon or to public would give the key inside the app binary a read path back into the bucket. Not deploying.',
      r.roles;
  end if;

  if r.qual not like '%bucket_id%' or r.qual not like '%''images''%' then
    raise exception
      'TOO WIDE: the absorbed-folder read policy does not pin bucket_id to images, so it would grant reads in every other bucket in the project. Not deploying.';
  end if;

  if not has_function_privilege('authenticated', 'public.storage_folder_merged_into_caller(text)', 'execute') then
    raise exception
      'BROKEN: authenticated cannot execute storage_folder_merged_into_caller, so the policy expression raises permission denied and EVERY image read in the app fails, not just merged ones. Not deploying.';
  end if;

  if has_function_privilege('anon', 'public.storage_folder_merged_into_caller(text)', 'execute') then
    raise exception
      'GRANT TOO WIDE: anon can execute storage_folder_merged_into_caller, so the revoke did not take effect. Not deploying.';
  end if;

  raise notice 'verify PASSED: one permissive authenticated-only policy, pinned to the images bucket, callable by exactly the role that needs it';
end;
$$;

-- 3c. The decision itself, against real rows.
--
-- The policy cannot be exercised end to end from here: storage.objects belongs
-- to supabase_storage_admin, so this connection cannot insert a test object to
-- read back. What CAN be tested is the whole of the decision the policy
-- delegates, which is where every interesting mistake would live.
--
-- identity_merges.from_user and to_user both reference auth.users, so synthetic
-- uuids will not insert. This borrows three real accounts and unwinds
-- everything through the ROLLBACK_SENTINEL pattern from 20260908210200, so no
-- merge row survives and nobody's identity is actually consumed.
do $$
declare
  v_from      uuid;
  v_to        uuid;
  v_other     uuid;
  v_absorbed  boolean;
  v_stranger  boolean;
  v_unrelated boolean;
  v_literal   boolean;
  -- Captured before anything switches roles, and restored by name afterwards.
  -- RESET ROLE is the obvious way to undo `set role authenticated` and it is
  -- wrong here: it returns to the SESSION user, which on a CLI connection is
  -- the login role rather than the role migrations run as. The block then ends
  -- as cli_login_postgres, and the very next thing the CLI does is record the
  -- migration in supabase_migrations, which that role cannot write. The file
  -- applies and the push still fails.
  v_role      name := current_user;
begin
  -- This whole block needs read and write on identity_merges, and the role that
  -- runs migrations on this project does not have it: the table is not owned by
  -- the migration connection, and 20260909090000 revoked the client roles
  -- without granting anything back. So the block cannot run here, and a bare
  -- "permission denied" would abort the migration and wedge every later one
  -- behind a condition no re-run can change.
  --
  -- Skipped loudly rather than silently. What it proves - that an absorbed
  -- folder is readable by its absorber and by nobody else - is exactly the
  -- property that must not be taken on trust, so it stays on the list of things
  -- to check by hand in the SQL editor, where the session does have the rights.
  if not has_table_privilege('public.identity_merges', 'select, insert') then
    raise warning
      'absorbed-folder verify SKIPPED: this connection ("%") cannot read or write identity_merges, so the ownership property was NOT proved. Run this block by hand in the SQL editor before trusting the merge policy.',
      current_user;
    return;
  end if;

  -- The source must have no merge row of its own, or the insert below collides
  -- with the primary key.
  select u.id into v_from
    from auth.users u
   where not exists (select 1 from public.identity_merges m where m.from_user = u.id)
   order by u.created_at
   limit 1;

  select u.id into v_to
    from auth.users u
   where u.id is distinct from v_from
   order by u.created_at
   limit 1;

  -- The third account has to be one that did NOT really merge into v_to. Some
  -- production accounts genuinely have absorbed others, and borrowing one of
  -- those would make the "unrelated folder" assertion below fail on a correct
  -- database and abort a good deploy.
  select u.id into v_other
    from auth.users u
   where u.id is distinct from v_from
     and u.id is distinct from v_to
     and not exists (
       select 1 from public.identity_merges m
        where m.from_user = u.id and m.to_user = v_to
     )
   limit 1;

  if v_from is null or v_to is null or v_other is null then
    raise notice 'absorbed-folder verify SKIPPED: needs three auth.users rows to borrow';
    return;
  end if;

  begin
    insert into public.identity_merges (from_user, to_user, credits)
    values (v_from, v_to, 0);

    -- Answer as the account the folder merged into. Both settings are local and
    -- are undone with everything else by the sentinel below.
    perform set_config('role', 'authenticated', true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_to, 'role', 'authenticated')::text,
      true
    );

    v_absorbed  := public.storage_folder_merged_into_caller(v_from::text);
    v_unrelated := public.storage_folder_merged_into_caller(v_other::text);
    -- The exact string the dropped policy used to wave through. If this ever
    -- returns true the prefix is open again by a different route.
    v_literal   := public.storage_folder_merged_into_caller('anonymous');

    -- Now as somebody who absorbed nothing. This is the assertion that matters:
    -- a merged folder must be readable by ONE account, not by anyone who knows
    -- the uid.
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_other, 'role', 'authenticated')::text,
      true
    );
    v_stranger := public.storage_folder_merged_into_caller(v_from::text);

    if not v_absorbed then
      raise exception
        'NOT FIXED: the account an identity merged INTO still cannot read that identity''s folder. Every user who signs in with Apple or Google gets an empty Vault. Not deploying.';
    end if;
    if v_stranger then
      raise exception
        'TOO WIDE: an account that absorbed nothing can read the folder of an identity that merged into somebody ELSE. That is the old prefix hole with extra steps. Not deploying.';
    end if;
    if v_unrelated then
      raise exception
        'TOO WIDE: a folder belonging to an unrelated account was readable. The check is matching on shape rather than on ownership. Not deploying.';
    end if;
    if v_literal then
      raise exception
        'TOO WIDE: the literal folder name "anonymous" was accepted, which re-opens the legacy prefix this migration just closed. Not deploying.';
    end if;

    raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_SENTINEL' then
        raise;
      end if;
  end;

  -- Belt and braces. Aborting the sub-block already rolls back a transaction
  -- local `role`, but if it ever did not, the rest of this file would run as
  -- `authenticated`, which cannot read identity_merges: the next statement
  -- would fail with permission denied and the migration would abort on a
  -- database that is actually fine.
  -- RESET ROLE, not set_config('role', 'none'). The GUC does not accept 'none'
  -- as a reset the way the SET ROLE statement does, so the earlier version left
  -- the block still running as `authenticated`, and the identity_merges read
  -- immediately below failed with permission denied - aborting the migration on
  -- a database that was in fact fine, which is the exact false alarm this line
  -- exists to prevent.
  execute format('set local role %I', v_role);

  -- The sentinel unwound the sub-block, so the borrowed accounts are untouched.
  -- Checked rather than assumed: a leftover row here would mean a real user's
  -- identity is recorded as consumed, and merge_anonymous_identity would then
  -- refuse to pay out their credits.
  if exists (select 1 from public.identity_merges m where m.from_user = v_from) then
    raise exception
      'absorbed-folder verify LEFT A MERGE ROW BEHIND for %, which would make that account look already consumed. Aborting.',
      v_from;
  end if;

  raise notice 'verify PASSED: an absorbed folder is readable by its absorber only, and by nobody else';
exception
  when insufficient_privilege then
    -- has_table_privilege above reports the GRANT, which is present, and the
    -- access still fails: identity_merges has RLS enabled with no policies at
    -- all, and the role that runs migrations here does not bypass it. So the
    -- privilege probe cannot predict this and the failure has to be caught
    -- where it actually happens.
    --
    -- Caught rather than allowed to propagate because the alternative is an
    -- abort on a condition no re-run can change, which would wedge every later
    -- migration behind this file. The property this block exists to prove is
    -- NOT proved when this fires, and it says so.
    execute format('set local role %I', v_role);
    raise warning
      'absorbed-folder verify SKIPPED: permission denied on identity_merges for "%", so the ownership property was NOT proved. Run this block by hand in the SQL editor, where the session has the rights, before trusting the merge policy.',
      current_user;
end;
$$;

commit;
