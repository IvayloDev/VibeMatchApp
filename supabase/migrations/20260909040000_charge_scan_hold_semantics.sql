-- Fix three ways the scan ledger mishandles a repeated scan id.
--
-- None of this is reachable today: recommend-songs only calls charge_scan for
-- requests carrying contract 2, and nothing in the field sends it. All three
-- would have started biting the moment the new client shipped.
--
-- 1. A REFUNDED SCAN BECAME PERMANENTLY UNMATCHABLE.
--    refund_scan wrote {refund_reason} into `response`, the same column a
--    delivered payload lives in. charge_scan replayed refunded rows on
--    purpose, so recommend-songs saw outcome 'replay' with a truthy response
--    and returned HTTP 200 carrying {refund_reason} and NO SONGS. The client
--    reads that as a failure, and every retry with the same scan id did it
--    again, for ever. The photo could never be matched.
--
--    The original reasoning was sound as far as it went: re-running a refunded
--    scan would charge a second time. What it missed is that the credit was
--    already given back, so charging again is exactly right, and refusing to
--    is what strands the user.
--
-- 2. A HELD SCAN RAN THE MODEL AGAIN, FREE.
--    A held row replayed with response NULL, and recommend-songs' guard is
--    `outcome === 'replay' && charge.response`, so it fell through and ran
--    OpenAI again. Two requests on one scan id meant two paid model runs on
--    one credit, and if a refund of the first landed after the second settled,
--    the user kept both the match and the credit.
--
-- 3. `response` NOW ONLY EVER HOLDS A DELIVERED PAYLOAD.
--    Refund reasons move to their own column, so "is there a response" is once
--    again the same question as "was anything delivered".

begin;

alter table public.match_charges add column if not exists refund_reason text;

-- Refunds stop writing into the payload column.
create or replace function public.refund_scan(
  p_user    uuid,
  p_scan_id uuid,
  p_reason  text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meter   text;
  v_status  text;
  v_balance integer;
begin
  perform pg_advisory_xact_lock(hashtext('tunematch_credit:' || p_user::text));

  select meter, status into v_meter, v_status
    from public.match_charges
   where scan_id = p_scan_id and user_id = p_user;

  select credits into v_balance from public.user_profiles where user_id = p_user;

  if not found or v_status is distinct from 'held' then
    return coalesce(v_balance, 0);
  end if;

  if v_meter = 'credits' then
    update public.user_profiles
       set credits = credits + 1, updated_at = now()
     where user_id = p_user
     returning credits into v_balance;
  end if;

  update public.match_charges
     set status = 'refunded', refunded_at = now(), refund_reason = p_reason
   where scan_id = p_scan_id;

  return coalesce(v_balance, 0);
end;
$$;

-- charge_scan learns the difference between "already delivered", "still
-- running" and "failed and was refunded".
create or replace function public.charge_scan(
  p_user         uuid,
  p_scan_id      uuid,
  p_request_hash text
)
returns table (outcome text, balance integer, meter text, response jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.match_charges%rowtype;
  v_balance  integer;
  v_is_pro   boolean;
begin
  if p_user is null or p_scan_id is null or p_request_hash is null then
    raise exception 'charge_scan requires a user, a scan id and a request hash';
  end if;

  perform pg_advisory_xact_lock(hashtext('tunematch_credit:' || p_user::text));

  select * into v_existing from public.match_charges where scan_id = p_scan_id;

  if found then
    -- Someone else's scan id, or the same id carrying different work.
    if v_existing.user_id <> p_user or v_existing.request_hash <> p_request_hash then
      select up.credits into v_balance from public.user_profiles up where up.user_id = p_user;
      return query select 'conflict'::text, coalesce(v_balance, 0), v_existing.meter, null::jsonb;
      return;
    end if;

    -- Delivered. Hand back the same answer and charge nothing.
    if v_existing.status = 'final' and v_existing.response is not null then
      select up.credits into v_balance from public.user_profiles up where up.user_id = p_user;
      return query select 'replay'::text, coalesce(v_balance, 0), v_existing.meter, v_existing.response;
      return;
    end if;

    -- Still running. The caller must NOT start a second model run: it would be
    -- a second paid call against one credit, and whichever finished last would
    -- decide what the user sees.
    if v_existing.status = 'held' then
      select up.credits into v_balance from public.user_profiles up where up.user_id = p_user;
      return query select 'in_flight'::text, coalesce(v_balance, 0), v_existing.meter, null::jsonb;
      return;
    end if;

    -- Refunded: the attempt failed and the credit is already back. A retry is
    -- a genuine new attempt and must be charged like one, so drop the spent
    -- row and fall through rather than replaying a failure for ever.
    delete from public.match_charges where scan_id = p_scan_id;
  end if;

  select (e.status = 'active' and (e.expires_at is null or e.expires_at > now()))
    into v_is_pro
    from public.entitlements e
   where e.user_id = p_user;

  if coalesce(v_is_pro, false) then
    insert into public.match_charges (scan_id, user_id, meter, request_hash, status)
    values (p_scan_id, p_user, 'pro', p_request_hash, 'held');
    select up.credits into v_balance from public.user_profiles up where up.user_id = p_user;
    return query select 'pro'::text, coalesce(v_balance, 0), 'pro'::text, null::jsonb;
    return;
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

revoke all on function public.charge_scan(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.refund_scan(uuid, uuid, text)  from public, anon, authenticated;
grant execute on function public.charge_scan(uuid, uuid, text) to service_role;
grant execute on function public.refund_scan(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Prove each of the three states behaves, then roll everything back.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid    uuid;
  v_before integer;
  v_scan   uuid := '00000000-0000-4000-8000-0000000000c1';
  r        record;
begin
  select user_id, credits into v_uid, v_before
    from public.user_profiles order by created_at limit 1;
  if v_uid is null then
    raise notice 'hold semantics verify SKIPPED: no profile rows';
    return;
  end if;

  update public.user_profiles set credits = 5 where user_id = v_uid;

  -- 1. Charge, then the same scan again while still held.
  select * into r from public.charge_scan(v_uid, v_scan, 'hash-x');
  if r.outcome <> 'charged' or r.balance <> 4 then
    raise exception 'FAILED: first charge was %/%', r.outcome, r.balance;
  end if;

  select * into r from public.charge_scan(v_uid, v_scan, 'hash-x');
  if r.outcome <> 'in_flight' then
    raise exception 'FAILED: a held scan returned %, expected in_flight. A second model run would be paid for out of one credit.', r.outcome;
  end if;
  if r.balance <> 4 then
    raise exception 'FAILED: an in-flight repeat moved the balance to %', r.balance;
  end if;

  -- 2. Refund, then retry: a genuine new attempt, charged again.
  perform public.refund_scan(v_uid, v_scan, 'spotify down');
  select credits into v_before from public.user_profiles where user_id = v_uid;
  if v_before <> 5 then
    raise exception 'FAILED: refund left the balance at %, expected 5', v_before;
  end if;

  select * into r from public.charge_scan(v_uid, v_scan, 'hash-x');
  if r.outcome <> 'charged' or r.balance <> 4 then
    raise exception 'FAILED: retrying a refunded scan returned %/%, expected charged/4. The photo would be permanently unmatchable.', r.outcome, r.balance;
  end if;

  -- 3. Settle, then replay: the delivered payload, and nothing else.
  perform public.settle_scan(v_uid, v_scan, '{"songs":[{"title":"t"}]}'::jsonb);
  select * into r from public.charge_scan(v_uid, v_scan, 'hash-x');
  if r.outcome <> 'replay' then
    raise exception 'FAILED: a settled scan returned %, expected replay', r.outcome;
  end if;
  if r.response is null or (r.response ? 'refund_reason') then
    raise exception 'FAILED: the replayed payload is missing or carries a refund reason: %', r.response;
  end if;
  if r.balance <> 4 then
    raise exception 'FAILED: a replay moved the balance to %', r.balance;
  end if;

  raise notice 'hold semantics verify PASSED: held is in_flight, refunded recharges, settled replays the real payload';
  raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
exception
  when others then
    if sqlerrm <> 'ROLLBACK_SENTINEL' then
      raise;
    end if;
end;
$$;

commit;
