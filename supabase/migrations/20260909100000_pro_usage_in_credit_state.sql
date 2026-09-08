-- Report Pro usage from the server, so the app stops displaying a counter it
-- no longer increments.
--
-- The client used to count its own Pro scans in AsyncStorage and show
-- "N of 10 matches left". When charging moved server-side the increment went
-- with it, so the local number froze at 10 while the server, correctly, kept
-- counting in match_charges. The enforcement was right; the display lied.
-- The fix is not to resurrect the local counter - a tamperable number that
-- nothing enforces - but to show the server's.

begin;

drop function if exists public.get_credit_state();

create or replace function public.get_credit_state()
returns table (
  balance         integer,
  is_pro          boolean,
  next_free_at    timestamptz,
  pro_used_today  integer,
  pro_daily_limit integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_last  timestamptz;
  v_tz    integer;
  v_since timestamptz;
begin
  if v_uid is null then
    return;
  end if;

  select up.tz_offset_minutes into v_tz
    from public.user_profiles up where up.user_id = v_uid;

  select max(cg.granted_at) into v_last
    from public.credit_grants cg where cg.user_id = v_uid and cg.kind = 'daily';

  -- Same day boundary charge_scan uses for the cap: the most recent 09:00 in
  -- the user's timezone, or a rolling 24 hours when none is known.
  if v_tz is null then
    v_since := now() - interval '24 hours';
  else
    v_since := (date_trunc('day', (now() + make_interval(mins => v_tz)) - interval '9 hours')
                + interval '9 hours') - make_interval(mins => v_tz);
  end if;

  return query
  select
    coalesce((select up.credits from public.user_profiles up where up.user_id = v_uid), 0),
    coalesce((select e.status = 'active' and (e.expires_at is null or e.expires_at > now())
                from public.entitlements e where e.user_id = v_uid), false),
    case
      when v_last is null then now()
      when v_tz is null then v_last + interval '8 hours'
      else
        (date_trunc('day', (now() + make_interval(mins => v_tz)) - interval '9 hours')
           + interval '9 hours' + interval '1 day') - make_interval(mins => v_tz)
    end,
    (select count(*)::integer from public.match_charges mc
      where mc.user_id = v_uid and mc.meter = 'pro'
        and mc.status <> 'refunded' and mc.created_at >= v_since),
    10;
end;
$$;

revoke all on function public.get_credit_state() from public;
grant execute on function public.get_credit_state() to authenticated, service_role;

-- Proof: the count agrees with what charge_scan would enforce.
do $$
declare
  v_uid  uuid;
  v_used integer;
  r      record;
begin
  select user_id into v_uid from public.user_profiles order by created_at limit 1;
  if v_uid is null then
    raise notice 'pro usage verify SKIPPED: no profile rows';
    return;
  end if;

  delete from public.match_charges where user_id = v_uid;
  insert into public.entitlements (user_id, product_id, status, expires_at, source)
  values (v_uid, 'test_pro', 'active', now() + interval '30 days', 'selftest')
  on conflict (user_id) do update set status = 'active', expires_at = now() + interval '30 days';
  update public.user_profiles set credits = 0, tz_offset_minutes = 0 where user_id = v_uid;

  perform public.charge_scan(v_uid, gen_random_uuid(), 'a', 0);
  perform public.charge_scan(v_uid, gen_random_uuid(), 'b', 0);
  perform public.charge_scan(v_uid, gen_random_uuid(), 'c', 0);

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  select * into r from public.get_credit_state();
  if r.pro_used_today <> 3 or r.pro_daily_limit <> 10 or not r.is_pro then
    raise exception 'FAILED: get_credit_state reports used=%, limit=%, pro=% after 3 Pro scans',
      r.pro_used_today, r.pro_daily_limit, r.is_pro;
  end if;

  raise notice 'pro usage verify PASSED: 3 Pro scans read back as 3 of 10';
  raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
exception
  when others then
    if sqlerrm <> 'ROLLBACK_SENTINEL' then
      raise;
    end if;
end;
$$;

commit;
