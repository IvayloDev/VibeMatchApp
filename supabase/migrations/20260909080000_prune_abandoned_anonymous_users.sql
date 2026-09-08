-- Delete anonymous identities that were never used, and nothing else.
--
-- WHY, AND WHY NOT A CAPTCHA
--
-- Every install now mints an anonymous auth.users row, so the table grows with
-- launches rather than with sign-ups, and those rows count toward monthly
-- active users. Supabase suggests a captcha for this. That defends against
-- somebody scripting identities to farm free credits, and there is nothing
-- here to farm: the starter grant is rationed per DEVICE via
-- claim_device_starter, keyed on a Keychain id that survives reinstalls, so a
-- scripted identity is granted zero. Putting a challenge in front of every
-- real user's first launch to solve a billing problem is the wrong trade.
--
-- THE ONE THING THAT WOULD MAKE THIS DANGEROUS, AND WHY IT IS NOT
--
-- If deleting the user also released the device's starter ration, this job
-- would BE the refill loop the ration exists to prevent: mint, get 2, get
-- deleted, mint again. It does not, by construction. device_grants.user_id is
-- `on delete set null`, so the row survives with a null user and
-- claim_device_starter tests for the ROW, not for the user. A pruned device
-- still cannot claim twice.
--
-- WHO IS NEVER TOUCHED
--
-- Anyone who paid, matched, holds a balance, or has an entitlement. An
-- abandoned identity is one with no purchases, no history, no credits, no
-- entitlement, and no sign-in for the retention window. Deleting a person's
-- account because a query was slightly wrong is not recoverable, so the
-- predicate is deliberately conservative and the delete is capped per run.

begin;

create or replace function public.abandoned_anonymous_users(
  p_older_than interval default '30 days',
  p_limit      integer  default 500
)
returns table (user_id uuid)
language sql
security definer
set search_path = public
as $$
  select u.id
    from auth.users u
   where coalesce(u.is_anonymous, false)
     and coalesce(u.last_sign_in_at, u.created_at) < now() - p_older_than
     and not exists (select 1 from public.purchases p     where p.user_id = u.id)
     and not exists (select 1 from public.history h       where h.user_id = u.id)
     and not exists (select 1 from public.entitlements e  where e.user_id = u.id)
     and not exists (select 1 from public.match_charges m where m.user_id = u.id)
     and coalesce((select up.credits from public.user_profiles up where up.user_id = u.id), 0) = 0
   order by u.created_at
   limit p_limit;
$$;

create or replace function public.prune_anonymous_users(
  p_older_than interval default '30 days',
  p_limit      integer  default 500
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with doomed as (
    select user_id from public.abandoned_anonymous_users(p_older_than, p_limit)
  )
  delete from auth.users u using doomed d where u.id = d.user_id;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    raise notice 'pruned % abandoned anonymous identities', v_count;
  end if;
  return v_count;
end;
$$;

revoke all on function public.abandoned_anonymous_users(interval, integer) from public, anon, authenticated;
revoke all on function public.prune_anonymous_users(interval, integer)     from public, anon, authenticated;
grant execute on function public.abandoned_anonymous_users(interval, integer) to service_role;
grant execute on function public.prune_anonymous_users(interval, integer)     to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.unschedule('tunematch-prune-anonymous')
        where exists (select 1 from cron.job where jobname = 'tunematch-prune-anonymous');
      -- Weekly, not nightly. Nothing here is urgent, and a rarely-run job that
      -- deletes accounts is easier to reason about than a frequent one.
      perform cron.schedule(
        'tunematch-prune-anonymous',
        '30 4 * * 0',
        $cron$ select public.prune_anonymous_users(); $cron$
      );
      raise notice 'anonymous prune scheduled weekly via pg_cron';
    exception when others then
      raise notice 'pg_cron present but could not schedule (%). Run prune_anonymous_users() by hand.', sqlerrm;
    end;
  else
    raise notice 'pg_cron not available. Run prune_anonymous_users() by hand when the user table needs it.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Prove the selection can never name somebody who matters, against live data.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad integer;
  v_now integer;
begin
  select count(*) into v_bad
    from public.abandoned_anonymous_users('30 days'::interval, 100000) a
   where exists (select 1 from public.purchases p     where p.user_id = a.user_id)
      or exists (select 1 from public.history h       where h.user_id = a.user_id)
      or exists (select 1 from public.entitlements e  where e.user_id = a.user_id)
      or coalesce((select up.credits from public.user_profiles up where up.user_id = a.user_id), 0) <> 0;
  if v_bad > 0 then
    raise exception 'FATAL: the prune would delete % identities that have purchases, history, entitlements or a balance. Not deploying.', v_bad;
  end if;

  -- And it must never name a registered account, whatever else is true.
  select count(*) into v_bad
    from public.abandoned_anonymous_users('30 days'::interval, 100000) a
    join auth.users u on u.id = a.user_id
   where not coalesce(u.is_anonymous, false);
  if v_bad > 0 then
    raise exception 'FATAL: the prune would delete % REGISTERED accounts. Not deploying.', v_bad;
  end if;

  select count(*) into v_now from public.abandoned_anonymous_users('30 days'::interval, 100000);
  raise notice 'anonymous prune verify PASSED: % identities currently eligible, none with purchases, history, entitlements or a balance', v_now;
end;
$$;

commit;
