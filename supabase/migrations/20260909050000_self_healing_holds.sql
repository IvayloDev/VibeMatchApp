-- Give stale holds a way back without depending on a scheduler.
--
-- THE PROBLEM
--
-- charge_scan takes the credit before the work, and settle_scan or refund_scan
-- gives the outcome afterwards. If the isolate is killed in between (a deploy,
-- a timeout, an OOM), the row stays 'held' for ever: the user paid and got
-- nothing. sweep_stale_holds was written for exactly this and then called by
-- nothing at all, which is worse than not having it, because it reads like the
-- case is handled.
--
-- WHY NOT JUST ADD A CRON JOB
--
-- A cron job is added below when pg_cron is available, but the fix cannot
-- depend on it: enabling that extension is a project setting, the job would
-- run in a database the migration cannot assume, and a sweeper that silently
-- is not scheduled is the same failure again one layer up.
--
-- So the primary mechanism is self-healing and needs no infrastructure:
-- charge_scan refunds the caller's OWN stale holds before it does anything
-- else. The user who lost a credit to a killed isolate gets it back the next
-- time they try to scan, which is the moment they care and the moment they
-- would otherwise notice the balance was wrong. It is indexed by user, bounded,
-- and costs one statement on a path that is already doing a write.

begin;

create index if not exists match_charges_user_held
  on public.match_charges (user_id, created_at) where status = 'held';

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
  v_stale    record;
begin
  if p_user is null or p_scan_id is null or p_request_hash is null then
    raise exception 'charge_scan requires a user, a scan id and a request hash';
  end if;

  perform pg_advisory_xact_lock(hashtext('tunematch_credit:' || p_user::text));

  -- Anything this user is still holding from a scan that never came back. The
  -- window is deliberately generous: a slow model call is not an abandoned one,
  -- and refunding a scan that is still running would hand back a credit for
  -- work about to be delivered.
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
grant execute on function public.charge_scan(uuid, uuid, text) to service_role;

-- Belt and braces: a global sweep for users who never come back, so an
-- abandoned hold does not sit for ever in the ledger. Best effort, because
-- pg_cron may not be enabled and this migration must not fail over it.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.unschedule('tunematch-sweep-stale-holds')
        where exists (select 1 from cron.job where jobname = 'tunematch-sweep-stale-holds');
      perform cron.schedule(
        'tunematch-sweep-stale-holds',
        '*/15 * * * *',
        $cron$ select public.sweep_stale_holds('15 minutes'::interval); $cron$
      );
      raise notice 'stale-hold sweeper scheduled every 15 minutes via pg_cron';
    exception when others then
      raise notice 'pg_cron present but could not schedule (%). The per-user sweep in charge_scan still covers anyone who returns.', sqlerrm;
    end;
  else
    raise notice 'pg_cron not available. The per-user sweep in charge_scan covers anyone who returns; abandoned holds will linger.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Prove a stranded credit comes back on the next charge.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid   uuid;
  v_stale uuid := '00000000-0000-4000-8000-0000000000d1';
  v_new   uuid := '00000000-0000-4000-8000-0000000000d2';
  r       record;
  v_after integer;
begin
  select user_id into v_uid from public.user_profiles order by created_at limit 1;
  if v_uid is null then
    raise notice 'stale hold verify SKIPPED: no profile rows';
    return;
  end if;

  update public.user_profiles set credits = 5 where user_id = v_uid;

  -- A scan that took the credit and never came back.
  select * into r from public.charge_scan(v_uid, v_stale, 'hash-stale');
  if r.outcome <> 'charged' or r.balance <> 4 then
    raise exception 'FAILED: setup charge returned %/%', r.outcome, r.balance;
  end if;
  update public.match_charges
     set created_at = now() - interval '1 hour'
   where scan_id = v_stale;

  -- The next scan should hand the stranded credit back before charging.
  select * into r from public.charge_scan(v_uid, v_new, 'hash-new');
  if r.outcome <> 'charged' then
    raise exception 'FAILED: the follow-up charge returned %', r.outcome;
  end if;
  if r.balance <> 4 then
    raise exception 'FAILED: balance is % after sweeping one stale hold and charging one scan, expected 4 (5 - 1 + 1 - 1)', r.balance;
  end if;

  select count(*) into v_after from public.match_charges
   where scan_id = v_stale and status = 'refunded';
  if v_after <> 1 then
    raise exception 'FAILED: the stale hold was not marked refunded';
  end if;

  raise notice 'stale hold verify PASSED: a credit stranded by a killed scan is returned on the next charge';
  raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
exception
  when others then
    if sqlerrm <> 'ROLLBACK_SENTINEL' then
      raise;
    end if;
end;
$$;

commit;
