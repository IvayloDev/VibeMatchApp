-- The server-side scan ledger: the machinery that lets recommend-songs be the
-- only thing that ever spends a credit.
--
-- NOTHING HERE CHANGES ANY BEHAVIOUR. Every table is unreachable by a client
-- and every function but one is callable only by the service role. The charge
-- path stays dormant until recommend-songs starts calling it, and it will only
-- call it for clients that ask for it by sending `contract: 2`, which no build
-- in the field sends. This migration is safe to apply to production today.
--
-- WHY THE CHARGE MOVES TO THE SERVER AT ALL
--
-- Today the client decides to spend. The guard on user_profiles constrains what
-- a client may write the balance TO, which stops a forged balance, but it
-- cannot make a client spend: a patched build simply skips its own deduction
-- and matches for free. The only way "no way of setting a balance" becomes
-- literally true is for the balance to move exclusively inside functions the
-- client cannot call, driven by work the server itself performed.
--
-- ONE CURRENCY, DELIBERATELY
--
-- A free match grants a credit and then the scan spends one, rather than being
-- a separate meter that has to be refunded in its own currency when a scan
-- fails. Pro is the one exception: it does not touch the balance at all, so a
-- Pro scan holds a row with meter 'pro' and refunds to nothing. Entitlements
-- are populated by the RevenueCat webhook later; until then the table is empty
-- and every caller falls through to credits, which is exactly today's
-- behaviour.
--
-- IDEMPOTENCY IS THE POINT
--
-- A scan is identified by a client-generated uuid and a hash of the request
-- that produced it. The same pair replays the stored response and charges
-- nothing, so a retry after a dropped connection cannot double charge and
-- cannot re-run the model. The same uuid with a DIFFERENT request is a
-- conflict, refused and uncharged, because it is either a bug or an attempt to
-- get a second match on one charge.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tables. RLS on, zero policies, and privileges revoked from the client
--    roles so a stray request raises rather than silently reading nothing.
-- ---------------------------------------------------------------------------

-- One row per scan attempt. The primary key is the client's scan id, which is
-- what makes a retry collide with its own earlier attempt instead of becoming
-- a second charge.
create table if not exists public.match_charges (
  scan_id      uuid primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  meter        text not null check (meter in ('credits', 'pro')),
  request_hash text not null,
  status       text not null check (status in ('held', 'final', 'refunded')),
  response     jsonb,
  created_at   timestamptz not null default now(),
  settled_at   timestamptz,
  refunded_at  timestamptz
);

create index if not exists match_charges_user_recent
  on public.match_charges (user_id, created_at desc);
-- Partial index for the stale-hold sweep, which only ever looks at 'held'.
create index if not exists match_charges_held
  on public.match_charges (created_at) where status = 'held';

-- What contract version each user's client has proven it speaks. This is the
-- adoption signal that eventually allows revoking UPDATE on user_profiles.
--
-- Deliberately its own table rather than a column on user_profiles: a column
-- there would be writable by the client under the existing update policy, and
-- the guard only constrains `credits`. A client that could raise its own
-- contract number could opt itself out of being charged.
create table if not exists public.client_contract (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  max_contract integer not null default 1,
  last_seen_at timestamptz not null default now()
);

-- Pro, as the server understands it. Populated by the RevenueCat webhook.
-- Empty for now, which means every caller falls through to credits.
create table if not exists public.entitlements (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  product_id text,
  status     text not null,
  expires_at timestamptz,
  source     text,
  updated_at timestamptz not null default now()
);

-- Grants tied to a device rather than an account, so that signing out, or
-- deleting an anonymous user and making a new one, does not re-earn the
-- starter credits. The device id already exists client-side and lives in the
-- iOS Keychain, so it survives a reinstall.
create table if not exists public.device_grants (
  device_id  text not null,
  kind       text not null,
  user_id    uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (device_id, kind)
);

alter table public.match_charges   enable row level security;
alter table public.client_contract enable row level security;
alter table public.entitlements    enable row level security;
alter table public.device_grants   enable row level security;

-- RLS with no policies already denies everything, but a client hitting these
-- over PostgREST would get an empty 200 rather than an error, which reads like
-- "no rows" instead of "not yours". Revoking the privilege makes it say so.
revoke all on public.match_charges   from anon, authenticated;
revoke all on public.client_contract from anon, authenticated;
revoke all on public.entitlements    from anon, authenticated;
revoke all on public.device_grants   from anon, authenticated;

-- The ration table gains two kinds: the starter grant a fresh install gets,
-- and the one-off recovery of a legacy guest's local balance.
alter table public.credit_grants drop constraint if exists credit_grants_kind_check;
alter table public.credit_grants add constraint credit_grants_kind_check
  check (kind in ('signup', 'daily', 'device_starter', 'legacy_local'));

-- ---------------------------------------------------------------------------
-- 2. The free grant, server side.
--
-- consume_free_grant_for_self() resolves auth.uid() and is called by the guard
-- trigger on behalf of a client write. This is its twin for a server that
-- already knows which user it is acting for, and it moves the balance itself
-- rather than merely permitting someone else to.
-- ---------------------------------------------------------------------------
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
    -- Start the daily clock at the same moment. The client already works this
    -- way (grantGuestFreeCredits calls markDailyCreditGrantedToday, so the
    -- starter credits ARE that day's free match); without this the daily
    -- branch below sees no previous grant and pays out a second credit in the
    -- same breath. That is harmless where this only PERMITS a client write,
    -- which is what consume_free_grant_for_self does, but here it moves the
    -- balance itself, so it would really be +2 on a fresh account.
    insert into public.credit_grants (user_id, kind) values (p_user, 'daily');
    update public.user_profiles
       set credits = credits + 1, updated_at = now()
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

-- ---------------------------------------------------------------------------
-- 3. The charge.
--
-- Outcomes: 'charged', 'pro', 'replay', 'conflict', 'insufficient'.
-- The caller must not spend a cent on the model until this returns 'charged',
-- 'pro' or 'replay'.
-- ---------------------------------------------------------------------------
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

  -- Serialize everything this user is doing to their own balance. Two devices
  -- on one account, or a double-tap, must not both pass a `credits > 0` check.
  perform pg_advisory_xact_lock(hashtext('tunematch_credit:' || p_user::text));

  select * into v_existing from public.match_charges where scan_id = p_scan_id;

  if found then
    -- Someone else's scan id, or the same id carrying different work. Either
    -- way this is not the request that was paid for.
    if v_existing.user_id <> p_user or v_existing.request_hash <> p_request_hash then
      select up.credits into v_balance from public.user_profiles up where up.user_id = p_user;
      return query select 'conflict'::text, coalesce(v_balance, 0), v_existing.meter, null::jsonb;
      return;
    end if;

    -- A genuine retry. Hand back what was already paid for and charge nothing.
    -- A refunded charge replays too: the work failed, the credit is already
    -- back, and re-running it would charge a second time for the same scan id.
    select up.credits into v_balance from public.user_profiles up where up.user_id = p_user;
    return query select 'replay'::text, coalesce(v_balance, 0), v_existing.meter, v_existing.response;
    return;
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

  -- The decrement is conditional in the same statement that performs it, so
  -- there is no window between reading a balance and spending it.
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

-- ---------------------------------------------------------------------------
-- 4. Settle and refund.
-- ---------------------------------------------------------------------------
create or replace function public.settle_scan(
  p_user     uuid,
  p_scan_id  uuid,
  p_response jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.match_charges
     set status = 'final', settled_at = now(), response = p_response
   where scan_id = p_scan_id
     and user_id = p_user
     and status = 'held';
end;
$$;

-- Refunds are uncapped, deliberately. A cap turns an outage into destroyed
-- paid credits: every failure the user did not cause would eventually stop
-- being refunded, and the ones being refused are exactly the ones where we
-- took a credit and returned nothing.
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

  -- Only a held charge is refundable. Settled work was delivered, and a second
  -- refund of the same scan would mint a credit.
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
     set status = 'refunded', refunded_at = now(),
         response = coalesce(response, jsonb_build_object('refund_reason', p_reason))
   where scan_id = p_scan_id;

  return coalesce(v_balance, 0);
end;
$$;

-- A hold that was never settled or refunded means the function died between
-- charging and answering. The user paid and got nothing, so time alone should
-- give it back.
create or replace function public.sweep_stale_holds(p_older_than interval default '15 minutes')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r     record;
  v_hit integer := 0;
begin
  for r in
    select scan_id, user_id from public.match_charges
     where status = 'held' and created_at < now() - p_older_than
     limit 500
  loop
    perform public.refund_scan(r.user_id, r.scan_id, 'stale hold swept');
    v_hit := v_hit + 1;
  end loop;
  return v_hit;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Adoption bookkeeping and the one client-callable read.
-- ---------------------------------------------------------------------------
create or replace function public.note_client_contract(p_user uuid, p_contract integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.client_contract (user_id, max_contract, last_seen_at)
  values (p_user, p_contract, now())
  on conflict (user_id) do update
    set max_contract = greatest(public.client_contract.max_contract, excluded.max_contract),
        last_seen_at = now();
end;
$$;

-- The only function here a client may call. It takes no arguments: the user is
-- auth.uid(), so there is nobody else to ask about.
create or replace function public.get_credit_state()
returns table (balance integer, is_pro boolean, next_free_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_last timestamptz;
begin
  if v_uid is null then
    return;
  end if;

  select max(granted_at) into v_last
    from public.credit_grants where user_id = v_uid and kind = 'daily';

  return query
  select
    coalesce((select up.credits from public.user_profiles up where up.user_id = v_uid), 0),
    coalesce((select e.status = 'active' and (e.expires_at is null or e.expires_at > now())
                from public.entitlements e where e.user_id = v_uid), false),
    case
      when not exists (select 1 from public.credit_grants where user_id = v_uid and kind = 'signup')
        then now()
      when v_last is null then now()
      else v_last + interval '8 hours'
    end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Privileges. Everything that moves a balance is service-role only.
-- ---------------------------------------------------------------------------
revoke all on function public.claim_free_match_for(uuid)                from public, anon, authenticated;
revoke all on function public.charge_scan(uuid, uuid, text)             from public, anon, authenticated;
revoke all on function public.settle_scan(uuid, uuid, jsonb)            from public, anon, authenticated;
revoke all on function public.refund_scan(uuid, uuid, text)             from public, anon, authenticated;
revoke all on function public.sweep_stale_holds(interval)               from public, anon, authenticated;
revoke all on function public.note_client_contract(uuid, integer)       from public, anon, authenticated;

grant execute on function public.claim_free_match_for(uuid)          to service_role;
grant execute on function public.charge_scan(uuid, uuid, text)       to service_role;
grant execute on function public.settle_scan(uuid, uuid, jsonb)      to service_role;
grant execute on function public.refund_scan(uuid, uuid, text)       to service_role;
grant execute on function public.sweep_stale_holds(interval)         to service_role;
grant execute on function public.note_client_contract(uuid, integer) to service_role;

revoke all on function public.get_credit_state() from public;
grant execute on function public.get_credit_state() to authenticated, service_role;

commit;
