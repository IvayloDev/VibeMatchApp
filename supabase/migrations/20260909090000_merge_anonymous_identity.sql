-- Carry an anonymous identity's everything onto the account it becomes.
--
-- Apple and Google sign-in go through signInWithIdToken, which mints a NEW
-- auth.users row and replaces the session. The anonymous user holding the
-- balance, the purchases, the Vault and the taste profile is abandoned, and
-- nothing carries it over: the old client-side merge was deleted when credits
-- moved server-side, and claim_device_starter will not re-grant because the
-- DEVICE has already claimed. So a guest who bought a pack and then signed in
-- with Apple lost the pack.
--
-- Email signup avoids this by calling updateUser on the anonymous session,
-- which keeps the same uid. The native OAuth paths have no equivalent:
-- linkIdentity in auth-js 2.71.1 is a browser redirect with no id_token
-- variant. So the move has to happen server-side, after the fact.
--
-- WHY A LEDGER ROW AND NOT JUST A FLAG
--
-- identity_merges is the record that a given anonymous user has been consumed.
-- Without it, replaying the same merge would add the old balance again every
-- time - the anonymous access token is held by the client and a retry loop is
-- exactly the situation this runs in. The primary key on from_user is what
-- makes a replay a no-op rather than a second payout.

begin;

create table if not exists public.identity_merges (
  from_user  uuid primary key references auth.users(id) on delete cascade,
  to_user    uuid not null references auth.users(id) on delete cascade,
  credits    integer not null default 0,
  merged_at  timestamptz not null default now()
);

alter table public.identity_merges enable row level security;
revoke all on public.identity_merges from anon, authenticated;

create or replace function public.merge_anonymous_identity(
  p_old uuid,
  p_new uuid
)
returns table (merged boolean, credits_moved integer, balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_credits integer;
  v_balance     integer;
  v_is_anon     boolean;
begin
  if p_old is null or p_new is null or p_old = p_new then
    raise exception 'merge_anonymous_identity needs two different users';
  end if;

  -- Only an ANONYMOUS identity may be consumed. Without this the function is a
  -- way to drain any account whose token you can obtain.
  select coalesce(u.is_anonymous, false) into v_is_anon from auth.users u where u.id = p_old;
  if not found then
    raise exception 'merge_anonymous_identity: source user does not exist';
  end if;
  if not v_is_anon then
    raise exception 'merge_anonymous_identity: refusing to consume a registered account';
  end if;

  perform pg_advisory_xact_lock(hashtext('tunematch_merge:' || p_old::text));

  -- Already done. Report what it was rather than doing it again.
  if exists (select 1 from public.identity_merges m where m.from_user = p_old) then
    select up.credits into v_balance from public.user_profiles up where up.user_id = p_new;
    return query
      select false, (select m.credits from public.identity_merges m where m.from_user = p_old),
             coalesce(v_balance, 0);
    return;
  end if;

  insert into public.user_profiles (user_id, credits) values (p_new, 0)
    on conflict (user_id) do nothing;

  select coalesce(up.credits, 0) into v_old_credits
    from public.user_profiles up where up.user_id = p_old;
  v_old_credits := coalesce(v_old_credits, 0);

  -- Money first, and by addition rather than by writing a total, so a
  -- concurrent grant on the destination cannot be overwritten.
  update public.user_profiles set credits = credits + v_old_credits, updated_at = now()
   where user_id = p_new
   returning credits into v_balance;

  update public.user_profiles set credits = 0, updated_at = now() where user_id = p_old;

  -- Everything that points at the old identity. purchases moving is what makes
  -- a pack survive: grant_purchase_credits can never re-grant a transaction id
  -- it has already seen, so the row IS the entitlement to those credits.
  update public.purchases     set user_id = p_new where user_id = p_old;
  update public.history       set user_id = p_new where user_id = p_old;
  update public.match_charges set user_id = p_new where user_id = p_old;
  update public.device_grants set user_id = p_new where user_id = p_old;

  -- The grant ration moves too. They have already had their starter and today's
  -- free match; the new account must not hand out a second set.
  update public.credit_grants set user_id = p_new
   where user_id = p_old
     and not exists (
       select 1 from public.credit_grants c2
        where c2.user_id = p_new and c2.kind = public.credit_grants.kind
     );
  delete from public.credit_grants where user_id = p_old;

  -- Spotify and taste only when the destination has none, so signing in to an
  -- account that already has a profile does not have it replaced by a guest's.
  update public.spotify_connections set user_id = p_new
   where user_id = p_old
     and not exists (select 1 from public.spotify_connections s where s.user_id = p_new);
  update public.spotify_taste_profiles set user_id = p_new
   where user_id = p_old
     and not exists (select 1 from public.spotify_taste_profiles s where s.user_id = p_new);

  -- An entitlement follows the receipt, so it moves only if the account has none.
  update public.entitlements set user_id = p_new
   where user_id = p_old
     and not exists (select 1 from public.entitlements e where e.user_id = p_new);

  insert into public.identity_merges (from_user, to_user, credits)
  values (p_old, p_new, v_old_credits);

  return query select true, v_old_credits, coalesce(v_balance, 0);
end;
$$;

revoke all on function public.merge_anonymous_identity(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_anonymous_identity(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Prove the refusals. The happy path needs two real users and is covered by
-- the device test; these are the cases where being wrong loses somebody's
-- account rather than merely failing.
-- ---------------------------------------------------------------------------
do $$
declare
  v_registered uuid;
  v_other      uuid;
  v_raised     boolean;
begin
  if has_function_privilege('authenticated', 'public.merge_anonymous_identity(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.merge_anonymous_identity(uuid,uuid)', 'execute') then
    raise exception 'FATAL: a client can execute merge_anonymous_identity and could drain another account. Not deploying.';
  end if;
  if has_table_privilege('authenticated', 'public.identity_merges', 'DELETE') then
    raise exception 'FATAL: authenticated can delete identity_merges rows, which would make a merge replayable. Not deploying.';
  end if;

  select u.id into v_registered from auth.users u
   where not coalesce(u.is_anonymous, false) limit 1;
  select u.id into v_other from auth.users u
   where u.id is distinct from v_registered limit 1;

  if v_registered is null or v_other is null then
    raise notice 'merge verify SKIPPED: needs at least two users';
    return;
  end if;

  -- A registered account must never be consumable.
  v_raised := false;
  begin
    perform public.merge_anonymous_identity(v_registered, v_other);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FATAL: merging consumed a REGISTERED account. Anyone holding a token could drain it. Not deploying.';
  end if;

  -- Same user both sides is a bug, not a no-op.
  v_raised := false;
  begin
    perform public.merge_anonymous_identity(v_registered, v_registered);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FATAL: merging a user into itself was permitted. Not deploying.';
  end if;

  raise notice 'merge verify PASSED: registered accounts and self-merges refused, clients cannot call it';
end;
$$;

commit;
