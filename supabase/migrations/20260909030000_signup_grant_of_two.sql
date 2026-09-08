-- Let the one-time signup grant be two credits, and keep the daily at one.
--
-- WHY THIS MIGRATION EXISTS
--
-- The starter grant moved from 1 to 2 (onboarding ends in a scan, so the first
-- match spends one and the user finishes holding one). The client grants it by
-- writing `current + 2` in a single update. The guard shipped this morning
-- permits `old + 1` and nothing else, so that write would raise 42501, the
-- client's grant helper would return false, and a newly registered user would
-- land on zero credits with nothing in the UI to say why.
--
-- The guard is the right place to fix it. The alternative was to have the
-- client write +1 twice, which happens to work today only because the ration
-- allows a signup grant and then a daily grant back to back. Relying on that
-- would be relying on an accident, and it would silently consume the user's
-- daily allowance on their first minute in the app.
--
-- WHAT DOES NOT CHANGE
--
-- The daily grant stays at exactly +1, and the signup grant stays once per
-- account, ever. The only widening is that the one-time signup grant may be 2
-- instead of 1. A client cannot ask for 2 twice, cannot ask for 2 on a daily
-- grant, and cannot ask for 3 at all.

begin;

-- The ration now takes the delta it is being asked to permit. Signup may be
-- one or two; daily may only be one.
--
-- The old zero-argument version is dropped rather than left beside this one. A
-- defaulted argument alongside it would make a bare consume_free_grant_for_self()
-- call ambiguous, and Postgres refuses an ambiguous call outright: the guard
-- would raise on every free grant instead of permitting it. No default here
-- either, so every caller states the size it is asking for.
drop function if exists public.consume_free_grant_for_self();

create or replace function public.consume_free_grant_for_self(p_delta integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_last timestamptz;
begin
  if v_uid is null or p_delta is null or p_delta < 1 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('tunematch_free_grant:' || v_uid::text));

  -- The signup credit: once per account, ever, and the only grant that may be
  -- larger than one.
  if not exists (
    select 1 from public.credit_grants where user_id = v_uid and kind = 'signup'
  ) then
    if p_delta > 2 then
      return false;
    end if;
    insert into public.credit_grants (user_id, kind) values (v_uid, 'signup');
    return true;
  end if;

  -- Every later grant is the daily one, and it is exactly one credit.
  if p_delta <> 1 then
    return false;
  end if;

  select max(granted_at) into v_last
    from public.credit_grants
   where user_id = v_uid and kind = 'daily';

  if v_last is null or v_last <= now() - interval '8 hours' then
    insert into public.credit_grants (user_id, kind) values (v_uid, 'daily');
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.consume_free_grant_for_self(integer) from public;
grant execute on function public.consume_free_grant_for_self(integer) to authenticated;

-- The guard asks the ration about the actual increase rather than assuming 1.
create or replace function public.guard_user_profile_credits()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_delta integer;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.credits is distinct from 0 then
      raise exception 'credits: a client may only create a profile with 0 credits'
        using errcode = '42501';
    end if;
    return new;
  end if;

  new.id         := old.id;
  new.user_id    := old.user_id;
  new.created_at := old.created_at;

  if new.credits = old.credits then
    return new;
  end if;

  -- The spend. Still exactly one, never an arbitrary decrease: a larger drop is
  -- always one of the live client bugs where a failed read becomes an absolute
  -- write over a real balance.
  if new.credits = old.credits - 1 then
    return new;
  end if;

  -- A free grant, sized by the ration rather than assumed. Signup may be two,
  -- daily may only be one, and both are consumed at most once.
  v_delta := new.credits - old.credits;
  if v_delta between 1 and 2 and public.consume_free_grant_for_self(v_delta) then
    return new;
  end if;

  raise exception 'credits: % -> % is not a permitted client write', old.credits, new.credits
    using errcode = '42501';
end;
$$;

-- The server-side twin grants the same two.
create or replace function public.claim_free_match_for(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz;
begin
  if p_user is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('tunematch_free_grant:' || p_user::text));

  if not exists (
    select 1 from public.credit_grants where user_id = p_user and kind = 'signup'
  ) then
    insert into public.credit_grants (user_id, kind) values (p_user, 'signup');
    -- Start the daily clock too: the starter credits ARE that day's free match,
    -- which is what the client has always done.
    insert into public.credit_grants (user_id, kind) values (p_user, 'daily');
    update public.user_profiles
       set credits = credits + 2, updated_at = now()
     where user_id = p_user;
    return true;
  end if;

  select max(granted_at) into v_last
    from public.credit_grants
   where user_id = p_user and kind = 'daily';

  if v_last is null or v_last <= now() - interval '8 hours' then
    insert into public.credit_grants (user_id, kind) values (p_user, 'daily');
    update public.user_profiles
       set credits = credits + 1, updated_at = now()
     where user_id = p_user;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.claim_free_match_for(uuid) from public, anon, authenticated;
grant execute on function public.claim_free_match_for(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Prove the new rule in both directions against a real row, then roll back.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid    uuid;
  v_before integer;
  v_after  integer;
begin
  select user_id, credits into v_uid, v_before
    from public.user_profiles where credits >= 1 order by created_at limit 1;
  if v_uid is null then
    raise notice 'signup grant verify SKIPPED: no profile with a spendable balance';
    return;
  end if;

  -- A clean slate for this user's ration, rolled back with everything else.
  delete from public.credit_grants where user_id = v_uid;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- 1. The signup grant of two is permitted, once.
  begin
    update public.user_profiles set credits = credits + 2 where user_id = v_uid;
  exception when insufficient_privilege then
    raise exception 'REGRESSION: the +2 signup grant was refused. Every new registered user would land on zero. Not deploying.';
  end;

  -- 2. A second +2 is not.
  begin
    update public.user_profiles set credits = credits + 2 where user_id = v_uid;
    raise exception 'FAILED: a second +2 was permitted. The signup grant is meant to be once per account.';
  exception
    when insufficient_privilege then null;
  end;

  -- 3. The daily +1 still works.
  begin
    update public.user_profiles set credits = credits + 1 where user_id = v_uid;
  exception when insufficient_privilege then
    raise exception 'REGRESSION: the daily +1 was refused. Every user would lose their free match. Not deploying.';
  end;

  -- 4. +3 is never permitted.
  begin
    update public.user_profiles set credits = credits + 3 where user_id = v_uid;
    raise exception 'FAILED: +3 was permitted. The grant is no longer bounded.';
  exception
    when insufficient_privilege then null;
  end;

  -- 5. The spend still works.
  begin
    update public.user_profiles set credits = credits - 1 where user_id = v_uid;
  exception when insufficient_privilege then
    raise exception 'REGRESSION: the spend was refused. No signed-in user could use a credit. Not deploying.';
  end;

  raise notice 'signup grant verify PASSED: +2 once, +1 daily, +3 never, spend intact';
  raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
exception
  when others then
    if sqlerrm <> 'ROLLBACK_SENTINEL' then
      raise;
    end if;
end;
$$;

commit;
