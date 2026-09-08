-- Cap the Pro meter server-side, the way the client already does.
--
-- charge_scan touches no balance when the meter is 'pro', with no cap at all.
-- Handing the charge to the server without carrying the client's rule over
-- would do two bad things at once: uncap the tier against the OpenAI bill, and
-- make a subscriber's PURCHASED credits unspendable for as long as they
-- subscribe, because every scan would take the free path.
--
-- The client's rule (lib/proQuota.ts) is 10 matches per match-day, and the
-- match day rolls over at 09:00 LOCAL. The server cannot derive a timezone
-- from a request, so charge_scan now accepts the client's UTC offset and uses
-- it to find the most recent 09:00 local. When it is absent - an older caller,
-- or a client that chooses not to say - it falls back to a rolling 24 hours,
-- which needs no timezone and can never be more generous than the calendar
-- rule it approximates.
--
-- Past the cap the call falls through to the credits branch rather than
-- refusing, which is exactly what AnalyzingScreen does today: "a pro user at
-- the daily cap with leftover credits falls through to the credit path -
-- balances stay usable forever."
--
-- The old three-argument charge_scan is DROPPED rather than left beside this
-- one. A defaulted fourth argument alongside it would leave every existing
-- three-argument call binding to the old uncapped function, and the cap would
-- look installed while doing nothing.

begin;

drop function if exists public.charge_scan(uuid, uuid, text);

create or replace function public.charge_scan(
  p_user              uuid,
  p_scan_id           uuid,
  p_request_hash      text,
  p_tz_offset_minutes integer default null
)
returns table (outcome text, balance integer, meter text, response jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing  public.match_charges%rowtype;
  v_balance   integer;
  v_is_pro    boolean;
  v_stale     record;
  v_since     timestamptz;
  v_pro_today integer;
  v_local     timestamptz;
begin
  if p_user is null or p_scan_id is null or p_request_hash is null then
    raise exception 'charge_scan requires a user, a scan id and a request hash';
  end if;

  perform pg_advisory_xact_lock(hashtext('tunematch_credit:' || p_user::text));

  -- Hand back anything stranded by a scan that never came back.
  for v_stale in
    select scan_id from public.match_charges
     where user_id = p_user
       and status = 'held'
       and scan_id <> p_scan_id
       and created_at < now() - interval '15 minutes'
     limit 20
  loop
    perform public.refund_scan(p_user, v_stale.scan_id, 'stale hold, swept at next charge');
  end loop;

  select * into v_existing from public.match_charges where scan_id = p_scan_id;

  if found then
    if v_existing.user_id <> p_user or v_existing.request_hash <> p_request_hash then
      select up.credits into v_balance from public.user_profiles up where up.user_id = p_user;
      return query select 'conflict'::text, coalesce(v_balance, 0), v_existing.meter, null::jsonb;
      return;
    end if;

    if v_existing.status = 'final' and v_existing.response is not null then
      select up.credits into v_balance from public.user_profiles up where up.user_id = p_user;
      return query select 'replay'::text, coalesce(v_balance, 0), v_existing.meter, v_existing.response;
      return;
    end if;

    if v_existing.status = 'held' then
      select up.credits into v_balance from public.user_profiles up where up.user_id = p_user;
      return query select 'in_flight'::text, coalesce(v_balance, 0), v_existing.meter, null::jsonb;
      return;
    end if;

    delete from public.match_charges where scan_id = p_scan_id;
  end if;

  select (e.status = 'active' and (e.expires_at is null or e.expires_at > now()))
    into v_is_pro
    from public.entitlements e
   where e.user_id = p_user;

  if coalesce(v_is_pro, false) then
    -- Where today began for this user.
    if p_tz_offset_minutes is null then
      v_since := now() - interval '24 hours';
    else
      v_local := now() + make_interval(mins => p_tz_offset_minutes);
      -- The most recent 09:00 local, converted back to UTC.
      v_since := (date_trunc('day', v_local - interval '9 hours') + interval '9 hours')
                 - make_interval(mins => p_tz_offset_minutes);
    end if;

    select count(*) into v_pro_today
      from public.match_charges
     where user_id = p_user
       and meter = 'pro'
       and status <> 'refunded'
       and created_at >= v_since;

    if v_pro_today < 10 then
      insert into public.match_charges (scan_id, user_id, meter, request_hash, status)
      values (p_scan_id, p_user, 'pro', p_request_hash, 'held');
      select up.credits into v_balance from public.user_profiles up where up.user_id = p_user;
      return query select 'pro'::text, coalesce(v_balance, 0), 'pro'::text, null::jsonb;
      return;
    end if;
    -- At the cap: fall through and spend a credit if they have one, rather
    -- than refusing a paying subscriber who also holds a balance.
  end if;

  update public.user_profiles
     set credits = credits - 1, updated_at = now()
   where user_id = p_user and credits > 0
   returning credits into v_balance;

  if v_balance is null then
    select up.credits into v_balance from public.user_profiles up where up.user_id = p_user;
    return query select 'insufficient'::text, coalesce(v_balance, 0), 'credits'::text, null::jsonb;
    return;
  end if;

  insert into public.match_charges (scan_id, user_id, meter, request_hash, status)
  values (p_scan_id, p_user, 'credits', p_request_hash, 'held');

  return query select 'charged'::text, v_balance, 'credits'::text, null::jsonb;
end;
$$;

revoke all on function public.charge_scan(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.charge_scan(uuid, uuid, text, integer) to service_role;

create index if not exists match_charges_pro_recent
  on public.match_charges (user_id, created_at) where meter = 'pro';

-- ---------------------------------------------------------------------------
-- Prove the cap holds, and that hitting it does not strand a paying user.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid uuid;
  r     record;
  i     integer;
begin
  select user_id into v_uid from public.user_profiles order by created_at limit 1;
  if v_uid is null then
    raise notice 'pro cap verify SKIPPED: no profile rows';
    return;
  end if;

  update public.user_profiles set credits = 3 where user_id = v_uid;
  delete from public.match_charges where user_id = v_uid;
  insert into public.entitlements (user_id, product_id, status, expires_at, source)
  values (v_uid, 'test_pro', 'active', now() + interval '30 days', 'selftest')
  on conflict (user_id) do update set status = 'active', expires_at = now() + interval '30 days';

  -- Ten free Pro matches, none of which touch the balance.
  for i in 1..10 loop
    select * into r from public.charge_scan(
      v_uid, gen_random_uuid(), 'hash-' || i::text, 0);
    if r.outcome <> 'pro' then
      raise exception 'FAILED: Pro scan % returned %, expected pro', i, r.outcome;
    end if;
    if r.balance <> 3 then
      raise exception 'FAILED: a Pro scan moved the balance to %, expected 3', r.balance;
    end if;
  end loop;

  -- The eleventh falls through to credits rather than refusing.
  select * into r from public.charge_scan(v_uid, gen_random_uuid(), 'hash-11', 0);
  if r.outcome <> 'charged' then
    raise exception 'FAILED: the 11th Pro scan returned %, expected charged. Either the tier is uncapped or a subscriber cannot spend credits they bought.', r.outcome;
  end if;
  if r.balance <> 2 then
    raise exception 'FAILED: balance is % after falling through to credits, expected 2', r.balance;
  end if;

  raise notice 'pro cap verify PASSED: 10 free Pro matches per day, then credits, never a refusal while a balance exists';
  raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
exception
  when others then
    if sqlerrm <> 'ROLLBACK_SENTINEL' then
      raise;
    end if;
end;
$$;

commit;
