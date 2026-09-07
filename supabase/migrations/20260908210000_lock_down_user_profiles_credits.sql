-- Server-authoritative credits, step 1.
--
-- Today any signed-in user can PATCH user_profiles.credits to any number with
-- the anon key that ships in the app binary, and update_user_credits() is a
-- second door that accepts any value. This closes both WITHOUT an app release,
-- so the build already on the App Store keeps working while it runs.
--
-- The enforcement is a BEFORE trigger on the one column that matters, not a
-- policy. Two reasons, both load-bearing. A policy cannot compare NEW to OLD,
-- which is the entire rule here. And the live policy set on this project does
-- not match this directory: an anon SELECT on user_profiles returns 200 with
-- zero rows, which the committed FOR ALL USING (true) policy would not do, so
-- anything that depends on a policy's current definition is guesswork. A
-- trigger holds regardless of which policies exist. The policies are fixed
-- anyway, below, but as a known-good end state rather than an edit to an
-- unknown one.
--
-- No balance changes. Not one row's credits value is touched.

begin;

-- Do not queue behind a long-running transaction while waiting for ACCESS
-- EXCLUSIVE on the balance table: that would block every purchase for the
-- duration. Better to fail and retry.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The second door.
--
-- update_user_credits(uuid, integer) is SECURITY DEFINER, GRANTed to
-- authenticated, and accepts any value for new_credits. Nothing in the app
-- calls it: `grep -rn "\.rpc(" app lib` returns zero hits and the client writes
-- through PostgREST UPDATE/UPSERT instead. Dropping it cannot break a build in
-- any state, old or new.
-- ---------------------------------------------------------------------------
drop function if exists public.update_user_credits(uuid, integer);

-- ---------------------------------------------------------------------------
-- 2. Policies, restated as a known-good set.
--
-- "Service role can manage profiles" is FOR ALL USING (true) with no TO clause.
-- A policy without TO applies to PUBLIC, which includes anon and authenticated,
-- and permissive policies are OR'd, so it supersedes both narrow policies. Same
-- defect this repo fixed for the Spotify tables in 20260906120000. It is dropped
-- and not replaced: service_role has BYPASSRLS in Supabase and never needed a
-- policy in the first place.
-- ---------------------------------------------------------------------------
drop policy if exists "Users can view their own profile"   on public.user_profiles;
drop policy if exists "Users can update their own profile" on public.user_profiles;
drop policy if exists "Service role can manage profiles"   on public.user_profiles;

create policy "Users read own profile"
  on public.user_profiles for select to authenticated
  using (auth.uid() = user_id);

-- The trigger below decides what VALUES may be written. This decides which ROW.
-- WITH CHECK is spelled out rather than left implicit: when it is omitted
-- Postgres reuses USING as the check, and adding one later silently REPLACES
-- that implicit check instead of adding to it.
create policy "Users update own profile"
  on public.user_profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- getUserCredits() creates the profile row on first read (lib/credits.ts:318).
-- Until now that was permitted only by the over-broad policy just dropped, so
-- without this every build in the wild would get a permanent 0 balance and an
-- error on every read. Migration B makes it redundant for new accounts; this
-- keeps the shipped client working either way.
create policy "Users insert own profile"
  on public.user_profiles for insert to authenticated
  with check (auth.uid() = user_id);

-- Deliberately NO delete policy for users. The app deletes accounts through
-- smooth-handler, which uses the service role. Leaving DELETE closed also means
-- a client cannot drop its own profile row to reset the grant ration below.

-- Same missing-TO defect on purchases: any caller with the anon key can INSERT
-- a row with a chosen transaction_id, and validate-purchase then short-circuits
-- on it and returns alreadyProcessed. A forged row permanently blocks a real
-- buyer's grant. Denial of grant against a paying customer rather than a
-- self-grant, but it costs money either way.
drop policy if exists "Service role can insert purchases" on public.purchases;

-- ---------------------------------------------------------------------------
-- 3. The free-grant ration.
--
-- The build in the wild hands out its two free credits by writing an absolute
-- balance from the client: the signup credit (lib/utils/freeCredits.ts) and the
-- daily free match (lib/dailyCredit.ts). Both write exactly 1 over a balance of
-- 0. Those must keep working or every live user loses their daily match and
-- every new account lands on zero credits and cannot scan at all.
--
-- So a client-role +1 is permitted, but rationed HERE, by the server, not
-- allowed on sight. Without this table a permitted +1 is an unlimited faucet:
-- PATCH credits=0, PATCH credits=1, repeat, two requests per free match.
--
-- Clients can neither read nor write this table: RLS is on and there are no
-- policies, so only service_role (BYPASSRLS) and the SECURITY DEFINER function
-- below can touch it.
-- ---------------------------------------------------------------------------
create table if not exists public.credit_grants (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('signup', 'daily')),
  granted_at timestamptz not null default now()
);

create unique index if not exists credit_grants_signup_once
  on public.credit_grants (user_id) where kind = 'signup';
create index if not exists credit_grants_user_recent
  on public.credit_grants (user_id, granted_at desc);

alter table public.credit_grants enable row level security;

-- The ration itself.
--
-- SECURITY DEFINER because it writes a table clients cannot reach. It takes no
-- arguments and resolves the user from auth.uid(), so a caller can only ever
-- consume their OWN allowance: there is no user id to point at somebody else.
create or replace function public.consume_free_grant_for_self()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_last timestamptz;
begin
  if v_uid is null then
    return false;
  end if;

  -- Dashboard mount, app foreground and the scan gate can all fire inside the
  -- same second, and two devices on one account can race. Serialize per user so
  -- the check and the insert cannot interleave. Released at end of transaction.
  perform pg_advisory_xact_lock(hashtext('tunematch_free_grant:' || v_uid::text));

  -- The signup credit: once per account, ever.
  if not exists (
    select 1 from public.credit_grants where user_id = v_uid and kind = 'signup'
  ) then
    insert into public.credit_grants (user_id, kind) values (v_uid, 'signup');
    return true;
  end if;

  select max(granted_at) into v_last
    from public.credit_grants
   where user_id = v_uid and kind = 'daily';

  -- 8 hours, not a calendar day. The app's free match rolls over at 09:00 in
  -- the USER'S timezone, which the server cannot derive from the request:
  -- old builds send no offset. Any time-based floor therefore has a boundary
  -- case, so this is tuned to never deny a real user rather than to be tight.
  -- The worst it can pay out is 3 free credits a day per account, which is less
  -- than the 3 starter credits every fresh install already gets. The point is
  -- that it is O(1) per day instead of unbounded. Phase 2 replaces this with
  -- the client's own match-day key.
  if v_last is null or v_last <= now() - interval '8 hours' then
    insert into public.credit_grants (user_id, kind) values (v_uid, 'daily');
    return true;
  end if;

  return false;
end;
$$;

-- Only the guard trigger needs to call this. A client that calls it directly
-- over PostgREST can burn its own allowance and receives no credits for it,
-- which is self-harm, not profit.
revoke all on function public.consume_free_grant_for_self() from public;
grant execute on function public.consume_free_grant_for_self() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The invariant.
--
-- SECURITY INVOKER on purpose, and this is the subtlest line in the file:
-- current_user inside a SECURITY DEFINER function is the function OWNER, which
-- would make the role test below always true and silently disable the entire
-- guard while it still looks installed. The one write it needs into a
-- client-unreachable table is delegated to the definer helper above.
-- ---------------------------------------------------------------------------
create or replace function public.guard_user_profile_credits()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- PostgREST does SET LOCAL ROLE, so current_user is 'authenticated' or 'anon'
  -- for anything driven by the key in the app binary. service_role
  -- (validate-purchase, smooth-handler) and the SQL editor run as themselves
  -- and are deliberately unconstrained. Section 6 proves this live before the
  -- transaction is allowed to commit.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- The only client insert that has ever existed is getUserCredits() creating
    -- an empty profile.
    --
    -- RAISE, never coerce to 0. updateUserCredits falls back to an upsert on any
    -- UPDATE error and returns true without verifying, and Postgres reflects
    -- BEFORE INSERT trigger changes in EXCLUDED, so a coerced 0 would arrive as
    -- ON CONFLICT DO UPDATE SET credits = 0, wiping a real balance while the
    -- client reports success and then deletes the guest's local keys.
    if new.credits is distinct from 0 then
      raise exception 'credits: a client may only create a profile with 0 credits'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Nothing else on the row is the client's to write. The old UPDATE policy had
  -- no column list, so every column was writable.
  new.id         := old.id;
  new.user_id    := old.user_id;
  new.created_at := old.created_at;

  -- No-op, or an updated_at touch.
  if new.credits = old.credits then
    return new;
  end if;

  -- The spend. deductCredits writes exactly OLD - 1.
  --
  -- Only -1, never an arbitrary decrease. A larger drop is always one of three
  -- live bugs where getUserCredits returning 0 on a failed read becomes an
  -- absolute write: the sign-in merge writing 0+merged over a real balance, the
  -- daily claim writing 1 over a 120-credit balance (on every Dashboard mount
  -- and every foreground), and the deduct retry re-sending a stale value over a
  -- purchase that landed inside its 500ms verify window. All three destroy
  -- credits and report success today. From here they raise and the balance
  -- survives.
  if new.credits = old.credits - 1 then
    return new;
  end if;

  -- The two free grants, rationed above.
  if new.credits = old.credits + 1 and public.consume_free_grant_for_self() then
    return new;
  end if;

  raise exception 'credits: % -> % is not a permitted client write', old.credits, new.credits
    using errcode = '42501';
end;
$$;

drop trigger if exists guard_user_profile_credits on public.user_profiles;
create trigger guard_user_profile_credits
  before insert or update on public.user_profiles
  for each row execute function public.guard_user_profile_credits();

-- Fires before update_user_profiles_updated_at (triggers run in name order,
-- g < u), which is what we want: the guard pins the row, then updated_at is set.

-- ---------------------------------------------------------------------------
-- 5. The silent third grant.
--
-- credits INTEGER NOT NULL DEFAULT 3 means any INSERT that omits the column
-- creates a 3-credit profile. The client passes 0 explicitly, but the RPC just
-- dropped did not, and neither would a future server insert written in a hurry.
-- ---------------------------------------------------------------------------
alter table public.user_profiles alter column credits set default 0;

-- ---------------------------------------------------------------------------
-- 6. Prove the guard actually bites, before committing any of the above.
--
-- The failure this defends against is the one that leaves no trace: if
-- 'anon'/'authenticated' are not the role names PostgREST assumes on this
-- project, section 4 installs cleanly, looks correct in every introspection
-- query, and permits everything. A security control that silently does nothing
-- is worse than none, because it stops anyone looking.
--
-- So impersonate a real signed-in user the way PostgREST does (SET ROLE plus
-- request.jwt.claims, which is what auth.uid() reads) and attempt a write the
-- guard must refuse. If it succeeds, the whole migration aborts and nothing
-- here is applied.
--
-- The attempted write can never land: either the guard raises, which rolls the
-- inner block back, or it does not and we raise ourselves, which rolls the
-- entire transaction back. The balance is re-read afterwards to prove it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid    uuid;
  v_before integer;
  v_after  integer;
begin
  select user_id, credits into v_uid, v_before
    from public.user_profiles
   order by created_at
   limit 1;

  if v_uid is null then
    raise notice 'guard self-test SKIPPED: no user_profiles rows to test against';
    return;
  end if;

  begin
    -- is_local = true, so an abort of this inner block reverts both settings
    -- and there is no way to leave the session impersonating a user.
    perform set_config('role', 'authenticated', true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text,
      true
    );

    update public.user_profiles
       set credits = credits + 1000
     where user_id = v_uid;

    -- Only reachable when the guard did not fire.
    raise exception
      'GUARD INERT: an authenticated-role +1000 write was permitted. The role test in guard_user_profile_credits() does not match this project, so nothing has been applied. Find the role PostgREST actually uses and fix section 4.'
      using errcode = 'P0001';
  exception
    when insufficient_privilege then
      -- The guard raised 42501. This is the pass condition.
      null;
  end;

  select credits into v_after from public.user_profiles where user_id = v_uid;
  if v_after is distinct from v_before then
    raise exception 'GUARD SELF-TEST CHANGED A BALANCE (% -> %), aborting', v_before, v_after;
  end if;

  raise notice 'guard self-test PASSED: authenticated +1000 was refused, balance intact';
end;
$$;

commit;
