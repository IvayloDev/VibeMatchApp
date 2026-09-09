-- Close the starter-grant faucet: one starter per USER, not just per device.
--
-- THE BUG, confirmed against production on 2026-09-09.
--
-- claim_device_starter rationed on p_device_id alone. The device id is not a
-- device: it is a string in the request body, shape-checked only by
-- /^[A-Za-z0-9._:-]{8,128}$/ in session-bootstrap. Nothing tied it to the
-- caller, and nothing capped the caller.
--
-- So one anonymous identity, looping POST /functions/v1/session-bootstrap with
-- a fresh random deviceId each time, collected +2 credits PER HTTP REQUEST,
-- without limit. Measured live: balance 0 -> 2 -> 4 -> 6 on three calls, then
-- spent back to 0. Anonymous sign-in is open, so the identity costs nothing
-- either. That is an unbounded mint, and it is exactly what "there should be
-- no way of setting a balance" forbids.
--
-- The design note in 20260909070000 argued the device id "already lives in the
-- iOS Keychain and survives a reinstall, which is the same anti-farming basis
-- the client has always used". True of the honest client. The server never
-- sees a Keychain; it sees whatever was typed into the body. A ration is only
-- as good as the thing it is keyed on, and a client-supplied opaque string is
-- not a thing.
--
-- THE FIX
--
-- Keep the device ration, which does real work (a reinstall mints a new
-- identity but keeps the Keychain id, so the device row correctly refuses a
-- second helping). Add the ration that was missing: a user may receive the
-- starter once, ever, whatever device id accompanies the request.
--
-- credit_grants already records exactly this. claim_device_starter writes a
-- 'signup' row on payout, and claim_free_match_for reads that same row to
-- decide whether a new identity is owed its two credits. Reading it before the
-- payout closes the loop with no new state and no new table.
--
-- WHAT DOES NOT CHANGE
--
-- A genuine first run still gets 2. A reinstall on the same device still gets
-- 0, by the device row, as before. A user who was granted through
-- claim_free_match_for and then reaches this function still gets 0, which was
-- already true and is now true for the right reason. The farmer's second call
-- gets 0 instead of 2.
--
-- Per identity the starter is now capped at 2, which is the intended free
-- tier. Farming across many identities remains possible and is bounded
-- elsewhere (the per-identity and per-IP ceilings in recommend-songs); closing
-- that needs the legacy client paths to age out and is tracked separately.

begin;

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

  -- THE USER RATION. This is the new half. A user who has already had a
  -- signup grant - from this function, from claim_free_match_for, or from the
  -- legacy client write the guard trigger rations - is owed nothing, however
  -- many device ids they present.
  if exists (
    select 1 from public.credit_grants
     where user_id = p_user and kind = 'signup'
  ) then
    -- Still record the device, so this device cannot pay out to a DIFFERENT
    -- identity later. Without this, the farmer's rotated ids stay unspent and
    -- the next fresh identity collects on every one of them.
    insert into public.device_grants (device_id, kind, user_id)
    values (p_device_id, 'device_starter', p_user)
    on conflict (device_id, kind) do nothing;

    select user_id into v_prior
      from public.device_grants
     where device_id = p_device_id and kind = 'device_starter';

    return query select 0, true, v_prior;
    return;
  end if;

  -- THE DEVICE RATION, unchanged.
  select user_id into v_prior
    from public.device_grants
   where device_id = p_device_id and kind = 'device_starter';

  if found then
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

  -- Close both grant paths so nothing else pays out for the same arrival.
  insert into public.credit_grants (user_id, kind) values (p_user, 'signup')
    on conflict do nothing;
  insert into public.credit_grants (user_id, kind) values (p_user, 'daily');

  return query select v_award, false, p_user;
end;
$$;

revoke all on function public.claim_device_starter(text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_device_starter(text, uuid, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- Prove it, against a real row, and abort the deploy if either half is wrong.
--
-- Both directions matter. If the fix refuses a genuine first run, every new
-- install lands on zero credits and the funnel dies silently; that is a worse
-- outcome than the faucet, so it is tested too.
--
-- user_profiles.user_id references auth.users, so a synthetic uuid cannot be
-- used. This borrows a real account instead and undoes everything through the
-- ROLLBACK_SENTINEL pattern already used by 20260908210200, so no balance
-- moves and no ration is consumed.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid    uuid;
  v_before integer;
  v_after  integer;
  v_first  integer;
  v_second integer;
  v_third  integer;
  v_dev    text := 'audit-verify-' || replace(gen_random_uuid()::text, '-', '');
begin
  select p.user_id, p.credits into v_uid, v_before
    from public.user_profiles p
    join public.credit_grants g
      on g.user_id = p.user_id and g.kind = 'signup'
   order by p.created_at
   limit 1;

  if v_uid is null then
    raise notice 'device starter verify SKIPPED: no account with a signup grant to borrow';
    return;
  end if;

  begin
    -- ---- 1. THE FAUCET. This user has already had their signup grant, so a
    -- brand new device id must pay nothing. Before this migration it paid 2,
    -- every single call. ----
    select granted into v_second
      from public.claim_device_starter(v_dev || '-b', v_uid, false);

    select granted into v_third
      from public.claim_device_starter(v_dev || '-c', v_uid, false);

    if v_second <> 0 or v_third <> 0 then
      raise exception
        'NOT FIXED: rotating the device id still paid out (% and %). The starter faucet is open. Not deploying.',
        v_second, v_third;
    end if;

    select credits into v_after from public.user_profiles where user_id = v_uid;
    if v_after is distinct from v_before then
      raise exception
        'NOT FIXED: the balance moved (% -> %) on a call that reported granting 0. Not deploying.',
        v_before, v_after;
    end if;

    -- ---- 2. THE GENUINE FIRST RUN. Same account with its signup grant
    -- removed, which is exactly the state a new install is in. It must still
    -- be paid 2, or every new user starts on zero. ----
    delete from public.credit_grants where user_id = v_uid and kind = 'signup';

    select granted into v_first
      from public.claim_device_starter(v_dev || '-a', v_uid, false);

    if v_first <> 2 then
      raise exception
        'REGRESSION: a genuine first run was granted % instead of 2. Every new install would start on zero credits. Not deploying.',
        v_first;
    end if;

    raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_SENTINEL' then
        raise;
      end if;
  end;

  -- The sentinel unwound the sub-block, so the borrowed account is untouched:
  -- its grant row is back, its balance is back, and the test device rows are
  -- gone with it.
  select credits into v_after from public.user_profiles where user_id = v_uid;
  if v_after is distinct from v_before then
    raise exception 'device starter verify CHANGED A BALANCE (% -> %), aborting', v_before, v_after;
  end if;

  raise notice 'device starter verify PASSED: rotated device ids granted 0, a genuine first run still granted 2, balance intact';
end;
$$;

commit;
