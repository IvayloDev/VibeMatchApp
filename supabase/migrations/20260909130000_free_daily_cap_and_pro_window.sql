-- Put a floor under the free tier, and stop the Pro cap being re-anchored at will.
--
-- Three changes, all of them about the same thing: a limit is only a limit if
-- the number it counts cannot be chosen by the person being limited.
--
-- A. THE FREE TIER IS UNBOUNDED. The daily grant renews for ever, so a user who
--    never pays receives one free match a day, indefinitely. That is not a
--    trial, it is a product. The owner's rule: 30 free daily matches, lifetime,
--    and then the paywall. The 2 starter credits are separate and are not part
--    of the 30.
--
-- B. get_credit_state MUST SAY SO. The app renders next_free_at as a countdown.
--    If the server stops granting but the state still names an hour, the app
--    promises a match that will never arrive and the user waits instead of
--    seeing the offer. So next_free_at goes NULL at the cap, and the two new
--    columns let the UI say how much of the allowance is left before it does.
--
-- C. THE PRO DAILY CAP IS BYPASSABLE TODAY. charge_scan computes the Pro
--    window from p_tz_offset_minutes, taken straight from the request body and
--    accepted anywhere in +/- 840 minutes. That range spans 28 hours, more than
--    a whole day, so for ANY wall-clock moment there is an in-range offset that
--    puts pretend-local time just past 09:00 and makes the count zero. A
--    subscriber can move the day boundary on every single request and take
--    unlimited matches, and every one of them is an OpenAI bill.
--
--    The fix is to pin the offset on user_profiles and let a request replace it
--    only while the current window holds no Pro scan. A real traveller still
--    gets a correct day; nobody can move the boundary out from under scans they
--    have already taken.

begin;

-- Two ACCESS EXCLUSIVE locks are taken below (a column on credit_grants, a
-- trigger on user_profiles). Do not queue behind a long transaction holding
-- either: that would stall every scan and every purchase for the duration.
-- Better to fail and retry.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. paid_out: which 'daily' rows actually moved a credit.
--
-- claim_free_match_for writes a 'daily' row in three situations and only ONE of
-- them pays anything out:
--   - the signup branch seeds one to start the clock (the starter credits ARE
--     that day's match),
--   - the "day is spoken for" branch writes one when the user already holds a
--     credit, so free matches cannot stack,
--   - the real grant writes one after adding the credit.
-- claim_device_starter seeds one for the same reason as the first.
--
-- Counting rows without this distinction would charge users for days they were
-- never given: a fresh install would arrive with one of its 30 already spent,
-- and a user who kept a purchased balance topped up would burn the whole
-- allowance without ever receiving a free match.
--
-- Default true rather than false so the column reads as "this row represents a
-- credit" and any future insert that forgets about it is counted rather than
-- silently free. Fast default, no table rewrite.
-- ---------------------------------------------------------------------------
alter table public.credit_grants
  add column if not exists paid_out boolean not null default true;

-- Existing rows keep the default, which slightly OVERCOUNTS for the handful of
-- accounts that already hold seed or spoken-for rows. That is acceptable: daily
-- grants only began on 2026-09-08, so nobody can be carrying more than a couple
-- of days of them, and the error is at most two matches against an allowance of
-- thirty. Backfilling correctly is impossible anyway - the rows do not record
-- which branch wrote them, which is the entire reason this column exists.

-- The cap is read on every grant attempt and on every credit-state read.
create index if not exists credit_grants_daily_paid
  on public.credit_grants (user_id) where kind = 'daily' and paid_out;

-- ---------------------------------------------------------------------------
-- 2. The two shared constants, as functions.
--
-- Three call sites have to agree about the free cap (the server grant path, the
-- legacy client ration, and the state the app renders) and two have to agree
-- about where a Pro day begins (charge_scan's enforcement and get_credit_state's
-- display). Every previous disagreement in this system showed up as a number in
-- the UI that nothing enforced, so both live in one place.
--
-- Neither is SECURITY DEFINER and neither carries `set search_path`: they
-- reference no schema objects at all, so there is nothing for a search path to
-- point at, and leaving the SET off keeps them inlinable inside the queries
-- below.
-- ---------------------------------------------------------------------------
create or replace function public.free_daily_limit()
returns integer
language sql
immutable
as $$ select 30 $$;

revoke all on function public.free_daily_limit() from public, anon, authenticated;
grant execute on function public.free_daily_limit() to service_role;

-- Where the caller's current Pro day started: the most recent 09:00 in their
-- own timezone, which is the rule lib/proQuota.ts has always used. A null
-- offset means nobody has told us, and falls back to a rolling 24 hours, which
-- needs no timezone and can never be more generous than the calendar rule it
-- stands in for.
create or replace function public.pro_window_start(p_tz_offset_minutes integer)
returns timestamptz
language sql
stable
as $$
  select case
    when p_tz_offset_minutes is null then now() - interval '24 hours'
    else (date_trunc('day', (now() + make_interval(mins => p_tz_offset_minutes)) - interval '9 hours')
          + interval '9 hours') - make_interval(mins => p_tz_offset_minutes)
  end
$$;

revoke all on function public.pro_window_start(integer) from public, anon, authenticated;
grant execute on function public.pro_window_start(integer) to service_role;

-- How much of the lifetime allowance this user has actually been paid.
--
-- SECURITY DEFINER because credit_grants is unreachable by clients: RLS is on
-- with no policies and the privileges are revoked. Counting it from the state
-- function and from the grant paths through one definition is what stops the
-- displayed number and the enforced number drifting apart.
create or replace function public.free_daily_used_for(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.credit_grants
   where user_id = p_user
     and kind = 'daily'
     and paid_out
$$;

revoke all on function public.free_daily_used_for(uuid) from public, anon, authenticated;
grant execute on function public.free_daily_used_for(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The cap, on the server grant path.
--
-- Body is 20260909070000's, with two changes: the seed and spoken-for inserts
-- are marked paid_out = false, and the lifetime cap is checked once the signup
-- branch has been ruled out.
-- ---------------------------------------------------------------------------
create or replace function public.claim_free_match_for(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last    timestamptz;
  v_credits integer;
  v_rows    integer;
begin
  if p_user is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('tunematch_free_grant:' || p_user::text));

  insert into public.user_profiles (user_id, credits)
  values (p_user, 0)
  on conflict (user_id) do nothing;

  select credits into v_credits from public.user_profiles where user_id = p_user;

  -- The signup grant: once per account, ever, the only one worth two, and
  -- deliberately OUTSIDE the cap. The starter credits are how a new install
  -- gets to its first match; refusing them would close the funnel rather than
  -- the free tier.
  if not exists (
    select 1 from public.credit_grants where user_id = p_user and kind = 'signup'
  ) then
    update public.user_profiles
       set credits = credits + 2, updated_at = now()
     where user_id = p_user;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return false;  -- never spend the allowance on a grant that did not land
    end if;
    insert into public.credit_grants (user_id, kind) values (p_user, 'signup');
    -- Starts the daily clock. It pays nothing: the starter credits ARE that
    -- day's free match, so marking it paid_out would charge the user a day they
    -- were never given and leave every new install on 29.
    insert into public.credit_grants (user_id, kind, paid_out)
    values (p_user, 'daily', false);
    return true;
  end if;

  -- THE LIFETIME CAP. Past this many paid daily matches the free tier is over:
  -- no grant, no further rows, and get_credit_state stops naming an hour. It is
  -- checked before the clock so that a capped account writes nothing at all -
  -- an account that keeps inserting bookkeeping rows would keep moving v_last
  -- and leave a trail suggesting grants that never happened.
  if public.free_daily_used_for(p_user) >= public.free_daily_limit() then
    return false;
  end if;

  select max(granted_at) into v_last
    from public.credit_grants
   where user_id = p_user and kind = 'daily';

  if v_last is not null and v_last > now() - interval '8 hours' then
    return false;
  end if;

  -- The day is due. If they are already holding a match, the day is spoken for
  -- and nothing is granted: this is what stops free matches stacking. The row
  -- records the day, not a credit, so it does not count against the cap.
  if coalesce(v_credits, 0) > 0 then
    insert into public.credit_grants (user_id, kind, paid_out)
    values (p_user, 'daily', false);
    return false;
  end if;

  update public.user_profiles
     set credits = credits + 1, updated_at = now()
   where user_id = p_user;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;

  -- The one insert that represents a credit the user actually received.
  insert into public.credit_grants (user_id, kind, paid_out)
  values (p_user, 'daily', true);
  return true;
end;
$$;

revoke all on function public.claim_free_match_for(uuid) from public, anon, authenticated;
grant execute on function public.claim_free_match_for(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The cap, on the legacy client path.
--
-- The build on the App Store still grants its own daily match by writing
-- old + 1, and the guard trigger asks this function whether to permit it. If
-- the cap lived only in claim_free_match_for, every user on an older build
-- would keep collecting free matches for ever and would never see the paywall,
-- which is exactly the outcome this migration exists to prevent.
-- ---------------------------------------------------------------------------
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

  -- The signup credit: once per account, ever, the only grant that may be
  -- larger than one, and not subject to the cap.
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

  -- The same lifetime cap the server path enforces, read through the same
  -- counter. Two counters would eventually disagree, and the one that was
  -- wrong would be whichever the user's build happened to use.
  if public.free_daily_used_for(v_uid) >= public.free_daily_limit() then
    return false;
  end if;

  select max(granted_at) into v_last
    from public.credit_grants
   where user_id = v_uid and kind = 'daily';

  if v_last is null or v_last <= now() - interval '8 hours' then
    -- Permitting the client's +1 IS the payout, so this row is a paid one.
    insert into public.credit_grants (user_id, kind, paid_out)
    values (v_uid, 'daily', true);
    return true;
  end if;

  return false;
end;
$$;

-- The guard trigger runs SECURITY INVOKER, so this is called as the client's
-- own role and `authenticated` must keep EXECUTE or every free grant on the
-- shipped build turns into a permission error instead of a decision.
revoke all on function public.consume_free_grant_for_self(integer) from public, anon, authenticated;
grant execute on function public.consume_free_grant_for_self(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The third writer of a seed row.
--
-- Body is 20260909120000's, unchanged but for the one insert. claim_device_starter
-- is the path a fresh install actually takes (session-bootstrap calls it first),
-- and it seeds a 'daily' row for the same reason the signup branch above does:
-- to close the clock so nothing else pays out for the same arrival. Left at the
-- default it would count, and every new user would begin their lifetime
-- allowance one match down.
-- ---------------------------------------------------------------------------
create or replace function public.claim_device_starter(
  p_device_id      text,
  p_user           uuid,
  p_marker_present boolean default false
)
returns table (granted integer, already_claimed boolean, claimed_by uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior uuid;
  v_award integer;
begin
  if p_user is null or p_device_id is null or length(p_device_id) = 0 then
    return query select 0, false, null::uuid;
    return;
  end if;

  -- Both rations are taken under both locks, in a fixed order (user, then
  -- device) so two concurrent claims can never deadlock against each other.
  perform pg_advisory_xact_lock(hashtext('tunematch_free_grant:' || p_user::text));
  perform pg_advisory_xact_lock(hashtext('tunematch_device:' || p_device_id));

  -- THE USER RATION. A user who has already had a signup grant - from this
  -- function, from claim_free_match_for, or from the legacy client write the
  -- guard trigger rations - is owed nothing, however many device ids they
  -- present.
  if exists (
    select 1 from public.credit_grants
     where user_id = p_user and kind = 'signup'
  ) then
    -- Still record the device, so this device cannot pay out to a DIFFERENT
    -- identity later.
    insert into public.device_grants (device_id, kind, user_id)
    values (p_device_id, 'device_starter', p_user)
    on conflict (device_id, kind) do nothing;

    select user_id into v_prior
      from public.device_grants
     where device_id = p_device_id and kind = 'device_starter';

    return query select 0, true, v_prior;
    return;
  end if;

  -- THE DEVICE RATION.
  select user_id into v_prior
    from public.device_grants
   where device_id = p_device_id and kind = 'device_starter';

  if found then
    -- Close the signup branch for this user before returning, or the device
    -- ration is decorative.
    --
    -- Measured against production on 2026-09-09: the same device id with two
    -- different fresh anonymous identities produced a balance of 2 for BOTH.
    -- This branch refused, correctly, and returned without recording anything
    -- about p_user. session-bootstrap then calls claim_free_match_for on the
    -- very next line, that function looks for a 'signup' row, finds none, and
    -- pays the +2 itself. So the device check refused a grant that was handed
    -- over one line later, and every claim that this project's starter is
    -- rationed per device was false the whole time.
    --
    -- Writing the row here says "this identity has had its signup grant
    -- considered and settled", which is exactly what happened. paid_out is
    -- irrelevant for a 'signup' row; the cap counts 'daily' rows only.
    insert into public.credit_grants (user_id, kind) values (p_user, 'signup')
      on conflict do nothing;
    -- Start their daily clock too, matching the payout branch below, so a
    -- second identity on a used device cannot immediately collect a daily
    -- match as its first act.
    insert into public.credit_grants (user_id, kind, paid_out)
    values (p_user, 'daily', false);

    return query select 0, true, v_prior;
    return;
  end if;

  insert into public.user_profiles (user_id, credits)
  values (p_user, 0)
  on conflict (user_id) do nothing;

  -- A device that already handed out its starter credits under the old client
  -- gets the record without the credits.
  v_award := case when p_marker_present then 0 else 2 end;

  if v_award > 0 then
    update public.user_profiles
       set credits = credits + v_award, updated_at = now()
     where user_id = p_user;
  end if;

  insert into public.device_grants (device_id, kind, user_id)
  values (p_device_id, 'device_starter', p_user)
  on conflict (device_id, kind) do nothing;

  -- Close both grant paths so nothing else pays out for the same arrival. The
  -- daily row is a seed, not a credit: see the note above section 5.
  insert into public.credit_grants (user_id, kind) values (p_user, 'signup')
    on conflict do nothing;
  insert into public.credit_grants (user_id, kind, paid_out)
  values (p_user, 'daily', false);

  return query select v_award, false, p_user;
end;
$$;

revoke all on function public.claim_device_starter(text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_device_starter(text, uuid, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. The pin, as a trigger rather than as a rule inside charge_scan.
--
-- charge_scan is not the only writer of tz_offset_minutes. session-bootstrap
-- takes tzOffsetMinutes from the request body and PATCHes the column with the
-- service role on every app launch, and the update policy on user_profiles
-- lets a client PATCH its own row directly with the anon key (the credits guard
-- constrains `credits`, `id`, `user_id` and `created_at`, and nothing else). A
-- rule that lived only in charge_scan would be re-anchored one request earlier
-- through either of those doors and would look installed while doing nothing.
--
-- So the rule lives on the column. Every writer gets the same answer, and
-- charge_scan can simply read back what was actually pinned instead of assuming
-- its own write landed.
--
-- It COERCES rather than raises. session-bootstrap fires this on every launch
-- and ignores the result; raising there would turn a normal launch into a 500
-- for anyone mid-window. Refusing to move the value is the whole requirement,
-- and a refusal that is silent to the client is exactly right here - there is
-- nothing the user could do about it and nothing they should be told.
--
-- SECURITY DEFINER, unlike guard_user_profile_credits, and safe for the opposite
-- reason: that function's entire rule is a test on current_user, which a definer
-- context would silently make always-true. This one tests no role at all. It
-- needs definer because match_charges is revoked from anon and authenticated,
-- so under invoker rights a client's own PATCH would raise instead of being
-- quietly pinned.
-- ---------------------------------------------------------------------------
create or replace function public.guard_user_profile_tz()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tz_offset_minutes is not distinct from old.tz_offset_minutes then
    return new;
  end if;

  -- No real timezone is more than 14 hours off UTC. Anything else is noise or
  -- an attempt to reach a window that does not exist.
  if new.tz_offset_minutes is not null
     and (new.tz_offset_minutes < -840 or new.tz_offset_minutes > 840) then
    new.tz_offset_minutes := old.tz_offset_minutes;
    return new;
  end if;

  -- Nothing pinned yet. Tempting to accept whatever we are told, since there
  -- is no boundary to move. That is wrong, and it was the one door left open:
  --
  --   never send tzOffsetMinutes, so the column stays NULL and the window is a
  --   rolling 24 hours; take all 10 Pro matches; then PATCH tz_offset_minutes
  --   directly on user_profiles (the credits guard constrains only credits and
  --   the identity columns, so this one is client-writable) to a value that
  --   puts pretend-local time just past 09:00. old is NULL, so this branch
  --   returned early without ever looking at match_charges, charge_scan read
  --   the new pin back, and the count started again from zero. Twenty Pro
  --   matches a day, repeatable.
  --
  -- So an unpinned profile is checked against the window it is actually being
  -- metered by, which is the rolling 24 hours that pro_window_start(null)
  -- returns. Fall through to the same test every pinned profile gets.
  if old.tz_offset_minutes is null and new.tz_offset_minutes is null then
    return new;
  end if;

  -- Held counts as well as final. A held row already counts against the Pro cap
  -- in charge_scan, so if only settled rows blocked the move, a client could
  -- open a scan and re-anchor while it was still in flight. Refunded rows count
  -- against nothing and are correctly ignored.
  if exists (
    select 1 from public.match_charges mc
     where mc.user_id = old.user_id
       and mc.meter = 'pro'
       and mc.status <> 'refunded'
       and mc.created_at >= public.pro_window_start(old.tz_offset_minutes)
  ) then
    new.tz_offset_minutes := old.tz_offset_minutes;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_user_profile_tz on public.user_profiles;
create trigger guard_user_profile_tz
  before update on public.user_profiles
  for each row execute function public.guard_user_profile_tz();

-- Triggers run in name order, so guard_user_profile_credits still fires first
-- and still gets to refuse the whole write before this one is consulted.

-- ---------------------------------------------------------------------------
-- 7. charge_scan reads the pinned offset instead of trusting the request.
--
-- Body is 20260909060000's, with the window computation replaced. The signature
-- is unchanged so recommend-songs keeps binding to it.
-- ---------------------------------------------------------------------------
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
  v_tz        integer;
begin
  if p_user is null or p_scan_id is null or p_request_hash is null then
    raise exception 'charge_scan requires a user, a scan id and a request hash';
  end if;

  perform pg_advisory_xact_lock(hashtext('tunematch_credit:' || p_user::text));

  -- Hand back anything stranded by a scan that never came back.
  for v_stale in
    select mc.scan_id from public.match_charges mc
     where mc.user_id = p_user
       and mc.status = 'held'
       and mc.scan_id <> p_scan_id
       and mc.created_at < now() - interval '15 minutes'
     limit 20
  loop
    perform public.refund_scan(p_user, v_stale.scan_id, 'stale hold, swept at next charge');
  end loop;

  select * into v_existing from public.match_charges mc where mc.scan_id = p_scan_id;

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

    delete from public.match_charges mc where mc.scan_id = p_scan_id;
  end if;

  select (e.status = 'active' and (e.expires_at is null or e.expires_at > now()))
    into v_is_pro
    from public.entitlements e
   where e.user_id = p_user;

  if coalesce(v_is_pro, false) then
    -- The window comes from the PINNED offset, never from the request. A
    -- caller that sends nothing now gets their pinned day rather than the
    -- rolling 24 hours it used to get, which is strictly more accurate and is
    -- already what get_credit_state showed them.
    select up.tz_offset_minutes into v_tz
      from public.user_profiles up where up.user_id = p_user;

    -- The request may OFFER an offset. Whether it takes effect is section 6's
    -- decision, not this function's, and the answer is read back rather than
    -- assumed: an assumed answer is how the count ends up being taken against a
    -- window the database never accepted.
    if p_tz_offset_minutes is not null and p_tz_offset_minutes is distinct from v_tz then
      -- The entitlement can arrive before the profile row does (the RevenueCat
      -- webhook does not create one). Without a row the update would land on
      -- nothing, the offset would never pin, and this whole section would be
      -- decorative for exactly the accounts it matters most for.
      insert into public.user_profiles (user_id, credits)
      values (p_user, 0)
      on conflict (user_id) do nothing;

      update public.user_profiles up
         set tz_offset_minutes = p_tz_offset_minutes, updated_at = now()
       where up.user_id = p_user;

      select up.tz_offset_minutes into v_tz
        from public.user_profiles up where up.user_id = p_user;
    end if;

    v_since := public.pro_window_start(v_tz);

    -- Aliased, and every column qualified. This function RETURNS TABLE with
    -- an OUT parameter called `meter`, so a bare `meter = 'pro'` is ambiguous
    -- between the variable and the column and Postgres refuses it outright.
    -- The same trap waits for `balance`, `outcome` and `response`.
    select count(*) into v_pro_today
      from public.match_charges mc
     where mc.user_id = p_user
       and mc.meter = 'pro'
       and mc.status <> 'refunded'
       and mc.created_at >= v_since;

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

-- ---------------------------------------------------------------------------
-- 8. The state the app renders.
--
-- Existing column order is preserved and the two new ones are appended, so a
-- client reading positionally is not broken by this. Dropped first rather than
-- replaced because CREATE OR REPLACE cannot change a function's return type,
-- which also resets its privileges - hence the grants below.
-- ---------------------------------------------------------------------------
drop function if exists public.get_credit_state();

create or replace function public.get_credit_state()
returns table (
  balance          integer,
  is_pro           boolean,
  next_free_at     timestamptz,
  pro_used_today   integer,
  pro_daily_limit  integer,
  free_daily_used  integer,
  free_daily_limit integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_last       timestamptz;
  v_tz         integer;
  v_since      timestamptz;
  v_free_used  integer;
  v_free_limit integer;
begin
  if v_uid is null then
    return;
  end if;

  select up.tz_offset_minutes into v_tz
    from public.user_profiles up where up.user_id = v_uid;

  select max(cg.granted_at) into v_last
    from public.credit_grants cg where cg.user_id = v_uid and cg.kind = 'daily';

  -- The same day boundary charge_scan enforces the Pro cap against, read from
  -- the same pinned offset through the same function, so the counter the user
  -- sees cannot disagree with the one that stops them.
  v_since := public.pro_window_start(v_tz);

  v_free_used  := public.free_daily_used_for(v_uid);
  v_free_limit := public.free_daily_limit();

  return query
  select
    coalesce((select up.credits from public.user_profiles up where up.user_id = v_uid), 0),
    coalesce((select e.status = 'active' and (e.expires_at is null or e.expires_at > now())
                from public.entitlements e where e.user_id = v_uid), false),
    case
      -- The allowance is gone. NULL, not a time: the app must stop counting
      -- down to a match that will never be granted and offer the paywall
      -- instead. This is the same test claim_free_match_for and
      -- consume_free_grant_for_self make, so the promise and the grant cannot
      -- come apart.
      when v_free_used >= v_free_limit then null::timestamptz
      when v_last is null then now()
      when v_tz is null then v_last + interval '8 hours'
      else
        (date_trunc('day', (now() + make_interval(mins => v_tz)) - interval '9 hours')
           + interval '9 hours' + interval '1 day') - make_interval(mins => v_tz)
    end,
    (select count(*)::integer from public.match_charges mc
      where mc.user_id = v_uid and mc.meter = 'pro'
        and mc.status <> 'refunded' and mc.created_at >= v_since),
    10,
    v_free_used,
    v_free_limit;
end;
$$;

revoke all on function public.get_credit_state() from public;
grant execute on function public.get_credit_state() to authenticated, service_role;

-- ===========================================================================
-- VERIFICATION
--
-- Everything below borrows a real account, asserts, and unwinds through the
-- ROLLBACK_SENTINEL pattern from 20260908210200, so no balance moves, no
-- ration is consumed and no offset is left changed. user_profiles.user_id
-- references auth.users, so a synthetic uuid is not an option.
--
-- Both directions are tested throughout. A cap that refuses too much is worse
-- than one that refuses too little: it takes the daily match away from every
-- free user at once, and the first report would be a support email rather than
-- a failed deploy.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A + B. The lifetime cap, on both grant paths, and the state the app reads.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid    uuid;
  v_before integer;
  v_after  integer;
  v_limit  integer := public.free_daily_limit();
  v_ok     boolean;
  r        record;
  i        integer;
begin
  select p.user_id, p.credits into v_uid, v_before
    from public.user_profiles p order by p.created_at limit 1;

  if v_uid is null then
    raise notice 'free daily cap verify SKIPPED: no user_profiles rows to borrow';
    return;
  end if;

  begin
    -- auth.uid() reads this setting, not the session role, so get_credit_state
    -- can be called as the borrowed user without giving up the privileges the
    -- setup below needs.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

    -- A clean ration, with the signup grant already spent so every path below
    -- reaches the daily branch rather than the starter one.
    delete from public.credit_grants where user_id = v_uid;
    insert into public.credit_grants (user_id, kind) values (v_uid, 'signup');

    -- ---- 1. Well under the cap, the daily match is still granted. ----
    for i in 1 .. 5 loop
      insert into public.credit_grants (user_id, kind, paid_out, granted_at)
      values (v_uid, 'daily', true, now() - interval '9 hours');
    end loop;

    -- Four rows that must NOT count, or this whole block proves nothing.
    --
    -- Written because the first version of this test seeded only paid_out=true
    -- rows and then asserted the count was 6. That assertion holds whether the
    -- counter honours paid_out or ignores the column entirely, so it could not
    -- fail on the bug it names, while printing a notice saying it had passed.
    -- These are the two shapes that are written without paying anything out:
    -- the seed row that starts the daily clock at signup, and the row written
    -- when the day is spoken for because the user already holds a credit. If
    -- either is ever counted, a free user is cut off around match 26 while the
    -- app tells them they have 30.
    insert into public.credit_grants (user_id, kind, paid_out, granted_at)
    values (v_uid, 'daily', false, now() - interval '40 hours'),
           (v_uid, 'daily', false, now() - interval '39 hours'),
           (v_uid, 'daily', false, now() - interval '38 hours'),
           (v_uid, 'daily', false, now() - interval '37 hours');

    update public.user_profiles set credits = 0 where user_id = v_uid;

    if not public.claim_free_match_for(v_uid) then
      raise exception
        'REGRESSION: a user 5 matches into an allowance of % was refused their daily match. Every free user would lose it at once and the app would show a countdown that never resolves. Not deploying.',
        v_limit;
    end if;

    select * into r from public.get_credit_state();
    if r.next_free_at is null then
      raise exception
        'REGRESSION: get_credit_state reported the allowance exhausted at 6 of %. The app would show the paywall to users who still have most of their free matches. Not deploying.',
        v_limit;
    end if;
    -- 5 seeded payouts + the one just granted = 6, and the four paid_out=false
    -- rows must be invisible. Any other number means the counter is wrong in
    -- one direction or the other, and both directions hurt a real user.
    if r.free_daily_used <> 6 or r.free_daily_limit <> v_limit then
      raise exception
        'FAILED: get_credit_state reports % of % free matches used, expected 6 of %. Seed and spoken-for rows are being counted as payouts, or paid ones are not.',
        r.free_daily_used, r.free_daily_limit, v_limit;
    end if;

    -- ---- 2. The legacy client +1 also still works under the cap. ----
    -- The shipped App Store build grants its own daily match this way, so this
    -- is the half that silently breaks every phone in the wild if the check is
    -- placed wrongly.
    --
    -- The grant above just moved the clock, and the 8 hour floor is not what is
    -- under test here, so wind it back. Otherwise this asserts the floor and
    -- reports it as a cap regression.
    update public.credit_grants set granted_at = now() - interval '9 hours'
     where user_id = v_uid and kind = 'daily';
    update public.user_profiles set credits = 0 where user_id = v_uid;

    begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

      update public.user_profiles set credits = credits + 1 where user_id = v_uid;

      raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
    exception
      when insufficient_privilege then
        raise exception
          'REGRESSION: the guard refused the legacy client +1 while the user was under the cap. Every build on the App Store would stop granting the daily match. Not deploying.';
      when others then
        if sqlerrm <> 'ROLLBACK_SENTINEL' then raise; end if;
    end;

    -- ---- 3. At the cap, the server path refuses and moves nothing. ----
    delete from public.credit_grants where user_id = v_uid and kind = 'daily';
    for i in 1 .. v_limit loop
      insert into public.credit_grants (user_id, kind, paid_out, granted_at)
      values (v_uid, 'daily', true, now() - interval '9 hours');
    end loop;
    update public.user_profiles set credits = 0 where user_id = v_uid;

    v_ok := public.claim_free_match_for(v_uid);
    if v_ok then
      raise exception
        'CAP NOT ENFORCED: the server granted a free match to a user who has already had %. The free tier renews for ever and nobody ever reaches the paywall. Not deploying.',
        v_limit;
    end if;
    select credits into v_after from public.user_profiles where user_id = v_uid;
    if v_after <> 0 then
      raise exception
        'FAILED: a refused daily grant still moved the balance to %. The cap returns false while paying out.', v_after;
    end if;

    -- ---- 4. At the cap, the legacy client path refuses too. ----
    begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

      update public.user_profiles set credits = credits + 1 where user_id = v_uid;

      raise exception
        'CAP NOT ENFORCED ON THE CLIENT PATH: the guard permitted a +1 at the lifetime cap. Anyone on the shipped build keeps collecting free matches for ever, so the cap only applies to users who update. Not deploying.';
    exception
      when insufficient_privilege then null;  -- the pass condition
    end;

    -- ---- 5. And the state says so, so the UI can stop promising. ----
    select * into r from public.get_credit_state();
    if r.next_free_at is not null then
      raise exception
        'FAILED: get_credit_state still names next_free_at=% at the cap. The app would count down to a free match the server will never grant, and the user would wait instead of seeing the offer. Not deploying.',
        r.next_free_at;
    end if;
    if r.free_daily_used <> v_limit or r.free_daily_limit <> v_limit then
      raise exception 'FAILED: get_credit_state reports % of % at the cap, expected % of %',
        r.free_daily_used, r.free_daily_limit, v_limit, v_limit;
    end if;

    raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_SENTINEL' then raise; end if;
  end;

  select credits into v_after from public.user_profiles where user_id = v_uid;
  if v_after is distinct from v_before then
    raise exception 'free daily cap verify CHANGED A BALANCE (% -> %), aborting', v_before, v_after;
  end if;

  raise notice 'free daily cap verify PASSED: granted under the cap on both paths, refused at % on both paths, next_free_at goes null', v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. The Pro window cannot be re-anchored.
--
-- The attack is built rather than described: two offsets are computed from the
-- current wall clock so the test does not depend on when the deploy happens.
-- v_pin puts the borrowed user's local time at noon, so their window opened
-- three hours ago; v_evil puts it at 09:30, so a window computed from it opened
-- thirty minutes ago. Ten settled Pro scans are backdated one hour, which puts
-- them inside the first window and outside the second. Before this migration
-- the second offset made the count zero and the eleventh match was free.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid       uuid;
  v_before    integer;
  v_after     integer;
  v_tz_before integer;
  v_tz_after  integer;
  v_now_min   integer;
  v_pin       integer;
  v_evil      integer;
  v_pinned    integer;
  v_scan      uuid;
  r           record;
  i           integer;
begin
  select p.user_id, p.credits, p.tz_offset_minutes
    into v_uid, v_before, v_tz_before
    from public.user_profiles p order by p.created_at limit 1;

  if v_uid is null then
    raise notice 'pro window verify SKIPPED: no user_profiles rows to borrow';
    return;
  end if;

  v_now_min := (extract(hour   from (now() at time zone 'UTC')) * 60
              + extract(minute from (now() at time zone 'UTC')))::integer;

  v_pin  := ((12 * 60      - v_now_min) % 1440 + 1440) % 1440;
  if v_pin  > 720 then v_pin  := v_pin  - 1440; end if;

  v_evil := (( 9 * 60 + 30 - v_now_min) % 1440 + 1440) % 1440;
  if v_evil > 720 then v_evil := v_evil - 1440; end if;

  -- Both offsets are well inside the +/- 840 the request accepts, and the
  -- window arithmetic is invariant under whole days, so the normalisation
  -- above cannot change which instant a window opens at.
  if public.pro_window_start(v_pin) >= now() - interval '1 hour' then
    raise exception
      'pro_window_start is wrong: an offset placing local time at noon should open the window about three hours ago, it opened at %. charge_scan counts the Pro cap with this function, so the cap is wrong too. Not deploying.',
      public.pro_window_start(v_pin);
  end if;
  if public.pro_window_start(v_evil) <= now() - interval '1 hour' then
    raise exception
      'pro_window_start is wrong: an offset placing local time at 09:30 should open the window about thirty minutes ago, it opened at %. Not deploying.',
      public.pro_window_start(v_evil);
  end if;

  begin
    delete from public.match_charges where user_id = v_uid;
    insert into public.entitlements (user_id, product_id, status, expires_at, source)
    values (v_uid, 'selftest_pro', 'active', now() + interval '30 days', 'selftest')
    on conflict (user_id) do update
      set status = 'active', expires_at = now() + interval '30 days';

    update public.user_profiles
       set credits = 3, tz_offset_minutes = v_pin
     where user_id = v_uid;

    -- ---- 1. A day's worth of Pro matches, settled so the stale-hold sweep
    -- inside charge_scan cannot refund them back out of the count, then
    -- backdated an hour so a re-anchored window can be made to miss them. ----
    for i in 1 .. 10 loop
      v_scan := gen_random_uuid();
      select * into r from public.charge_scan(v_uid, v_scan, 'window-' || i::text, v_pin);
      if r.outcome <> 'pro' then
        raise exception
          'REGRESSION: Pro match % returned % instead of pro. A subscriber cannot use what they pay for. Not deploying.', i, r.outcome;
      end if;
      perform public.settle_scan(v_uid, v_scan, '{}'::jsonb);
    end loop;

    update public.match_charges
       set created_at = now() - interval '1 hour'
     where user_id = v_uid and meter = 'pro';

    -- ---- 2. THE ATTACK. Same user, same second, one different number in the
    -- request body. ----
    select * into r from public.charge_scan(v_uid, gen_random_uuid(), 'window-evil', v_evil);
    if r.outcome = 'pro' then
      raise exception
        'PRO CAP BYPASSABLE: an 11th free match was granted after re-sending the timezone offset as %. Any subscriber can move the day boundary on every request and take unlimited matches, and every one of them is a model call we pay for. Not deploying.',
        v_evil;
    end if;
    if r.outcome <> 'charged' then
      raise exception
        'FAILED: the capped Pro match returned % instead of falling through to credits. A subscriber holding a balance they bought would be refused outright.', r.outcome;
    end if;

    select tz_offset_minutes into v_pinned from public.user_profiles where user_id = v_uid;
    if v_pinned is distinct from v_pin then
      raise exception
        'FAILED: charge_scan moved the stored offset from % to % while Pro matches sat inside the window.', v_pin, v_pinned;
    end if;

    -- ---- 3. The other door. session-bootstrap PATCHes this column with the
    -- service role on every launch, from a number in the request body. If that
    -- write can move the boundary, the attack simply happens one request
    -- earlier and the pin above is decorative. ----
    update public.user_profiles set tz_offset_minutes = v_evil where user_id = v_uid;
    select tz_offset_minutes into v_pinned from public.user_profiles where user_id = v_uid;
    if v_pinned is distinct from v_pin then
      raise exception
        'PIN BYPASSABLE: a direct UPDATE moved the offset from % to % while Pro matches sat inside the window. session-bootstrap does exactly this write on every app launch. Not deploying.',
        v_pin, v_pinned;
    end if;

    -- ---- 4. And a real traveller is not frozen out. With the window empty
    -- there is nothing to protect, so the new offset takes and the new day is
    -- honoured. Without this the cap would be correct and the product wrong:
    -- anyone who flies would be stuck on their old day for ever. ----
    delete from public.match_charges where user_id = v_uid;

    select * into r from public.charge_scan(v_uid, gen_random_uuid(), 'window-travel', v_evil);
    if r.outcome <> 'pro' then
      raise exception
        'REGRESSION: a subscriber whose window is empty was not given a Pro match (got %).', r.outcome;
    end if;
    select tz_offset_minutes into v_pinned from public.user_profiles where user_id = v_uid;
    if v_pinned is distinct from v_evil then
      raise exception
        'REGRESSION: the offset can never move (stored %, sent %). A subscriber who changes timezone would keep the wrong day for ever.', v_pinned, v_evil;
    end if;

    raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_SENTINEL' then raise; end if;
  end;

  select credits, tz_offset_minutes into v_after, v_tz_after
    from public.user_profiles where user_id = v_uid;
  if v_after is distinct from v_before or v_tz_after is distinct from v_tz_before then
    raise exception
      'pro window verify LEFT STATE BEHIND (credits % -> %, offset % -> %), aborting',
      v_before, v_after, v_tz_before, v_tz_after;
  end if;

  raise notice 'pro window verify PASSED: the cap holds against a hostile offset on both doors, and a genuine timezone change still lands';
end;
$$;

-- ---------------------------------------------------------------------------
-- Block D. The two bypasses that a review of this migration found still open,
-- both measured against production before they were closed. Each test starts
-- from the state the attack actually starts from, because the earlier blocks
-- all began from a pinned profile and a spent signup grant, which is precisely
-- the state neither attack uses.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid      uuid;
  v_before   integer;
  v_after    integer;
  v_tz_before integer;
  v_tz_after  integer;
  v_evil     integer;
  v_landed   integer;
  v_granted  integer;
  v_dev      text := 'verify-shared-' || replace(gen_random_uuid()::text, '-', '');
begin
  select p.user_id, p.credits, p.tz_offset_minutes
    into v_uid, v_before, v_tz_before
    from public.user_profiles p
   order by p.created_at
   limit 1;

  if v_uid is null then
    raise exception 'bypass verify CANNOT RUN: no account to borrow. Refusing to report a pass that proved nothing.';
  end if;

  begin
    -- ---- 1. THE UNPINNED PRO WINDOW. ----
    -- Start unpinned, which is the state of anyone who simply never sends the
    -- offset, and take a Pro match inside the rolling 24 hours the server
    -- meters them by. A hostile offset must not be accepted after that.
    update public.user_profiles set tz_offset_minutes = null where user_id = v_uid;

    insert into public.match_charges (user_id, scan_id, request_hash, status, meter, created_at)
    values (v_uid, gen_random_uuid(), 'verify-unpinned', 'final', 'pro', now() - interval '30 minutes');

    -- An offset that puts pretend-local time just past 09:00, so the window
    -- would start minutes ago and the count would reset to zero.
    v_evil := (extract(epoch from (date_trunc('day', now()) + interval '9 hours 5 minutes' - now())) / 60)::integer;
    v_evil := greatest(-840, least(840, v_evil));

    update public.user_profiles set tz_offset_minutes = v_evil where user_id = v_uid;
    select tz_offset_minutes into v_landed from public.user_profiles where user_id = v_uid;

    if v_landed is distinct from null then
      raise exception
        'NOT FIXED: an unpinned profile accepted a hostile offset (%) while holding a Pro match inside its current window. A subscriber can take 10 matches unpinned, then pin a fresh window and take 10 more, every day. Not deploying.',
        v_landed;
    end if;

    -- ---- 2. THE DEVICE RATION. ----
    -- The device branch of claim_device_starter must record that this identity
    -- has had its signup grant SETTLED, not merely refused. Measured on
    -- production: two fresh identities on one device id both ended on 2
    -- credits, because the branch returned without writing anything and
    -- claim_free_match_for paid the starter one line later.
    delete from public.credit_grants where user_id = v_uid;
    delete from public.device_grants where device_id = v_dev;
    insert into public.device_grants (device_id, kind, user_id)
    values (v_dev, 'device_starter', null);

    update public.user_profiles set credits = 0 where user_id = v_uid;

    select granted into v_granted
      from public.claim_device_starter(v_dev, v_uid, false);

    if v_granted <> 0 then
      raise exception
        'REGRESSION: a device that already gave out its starter paid another % credits. Not deploying.', v_granted;
    end if;

    -- The real test: the follow-up call session-bootstrap makes one line later.
    if public.claim_free_match_for(v_uid) then
      select credits into v_after from public.user_profiles where user_id = v_uid;
      raise exception
        'NOT FIXED: the device ration refused, and claim_free_match_for then paid the starter anyway (balance now %). Anyone can mint identities on one device for 2 credits each, and the 30-match cap resets with them. Not deploying.',
        v_after;
    end if;

    select credits into v_after from public.user_profiles where user_id = v_uid;
    if v_after <> 0 then
      raise exception
        'NOT FIXED: balance moved to % on a device whose starter was already spent. Not deploying.', v_after;
    end if;

    raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_SENTINEL' then raise; end if;
  end;

  select credits, tz_offset_minutes into v_after, v_tz_after
    from public.user_profiles where user_id = v_uid;
  if v_after is distinct from v_before or v_tz_after is distinct from v_tz_before then
    raise exception
      'bypass verify LEFT STATE BEHIND (credits % -> %, offset % -> %), aborting',
      v_before, v_after, v_tz_before, v_tz_after;
  end if;

  raise notice 'bypass verify PASSED: an unpinned profile cannot be re-anchored, and a used device cannot pay a second identity';
end;
$$;

commit;
