-- The three server pieces the new client needs before it can stop granting
-- credits itself: a daily grant that matches the app's own rule, a starter
-- grant tied to the device rather than the account, and a next-free-at the
-- client can render without computing it locally.

begin;

-- ---------------------------------------------------------------------------
-- 1. The daily grant tops up to one, it does not add one.
--
-- lib/dailyCredit.ts has always worked this way: if the balance is already
-- above zero the day is marked as spoken for and nothing is granted, so free
-- matches never accumulate. The server twin added +1 whenever the ration
-- allowed, so a user sitting on ten purchased credits would collect a free one
-- every eight hours on top.
--
-- It also now creates the profile row first. Granting into a row that does not
-- exist updated zero rows and still wrote the credit_grants row, which spent
-- the user's allowance on a credit they never received.
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

  -- The signup grant: once per account, ever, and the only one worth two.
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
    insert into public.credit_grants (user_id, kind) values (p_user, 'daily');
    return true;
  end if;

  select max(granted_at) into v_last
    from public.credit_grants
   where user_id = p_user and kind = 'daily';

  if v_last is not null and v_last > now() - interval '8 hours' then
    return false;
  end if;

  -- The day is due. If they are already holding a match, the day is spoken for
  -- and nothing is granted: this is what stops free credits stacking.
  if coalesce(v_credits, 0) > 0 then
    insert into public.credit_grants (user_id, kind) values (p_user, 'daily');
    return false;
  end if;

  update public.user_profiles
     set credits = credits + 1, updated_at = now()
   where user_id = p_user;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;

  insert into public.credit_grants (user_id, kind) values (p_user, 'daily');
  return true;
end;
$$;

revoke all on function public.claim_free_match_for(uuid) from public, anon, authenticated;
grant execute on function public.claim_free_match_for(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The starter grant belongs to the device, not the account.
--
-- Anonymous users are free to create, so an account-scoped starter grant is a
-- refill button: sign out, sign in as somebody new, collect again. The device
-- id already lives in the iOS Keychain and survives a reinstall, which is the
-- same anti-farming basis the client has always used.
--
-- p_marker_present carries the local "already granted" flag from the existing
-- install, so a legacy guest who has already had their starter credits does
-- not get a second helping on update day. Either way both credit_grants rows
-- are written, so the daily clock starts and the signup branch above cannot
-- fire later and pay out again.
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

  perform pg_advisory_xact_lock(hashtext('tunematch_device:' || p_device_id));

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

revoke all on function public.claim_device_starter(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_device_starter(text, uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 3. next_free_at, in the user's own day.
-- ---------------------------------------------------------------------------
alter table public.user_profiles add column if not exists tz_offset_minutes integer;

create or replace function public.get_credit_state()
returns table (balance integer, is_pro boolean, next_free_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_last   timestamptz;
  v_tz     integer;
  v_local  timestamptz;
begin
  if v_uid is null then
    return;
  end if;

  select up.tz_offset_minutes into v_tz
    from public.user_profiles up where up.user_id = v_uid;

  select max(granted_at) into v_last
    from public.credit_grants where user_id = v_uid and kind = 'daily';

  return query
  select
    coalesce((select up.credits from public.user_profiles up where up.user_id = v_uid), 0),
    coalesce((select e.status = 'active' and (e.expires_at is null or e.expires_at > now())
                from public.entitlements e where e.user_id = v_uid), false),
    case
      when v_last is null then now()
      when v_tz is null then v_last + interval '8 hours'
      else
        -- The next 09:00 in the caller's own timezone, which is what the app
        -- has always displayed. Computing it here means the countdown cannot
        -- disagree with the rule the server actually enforces.
        (date_trunc('day', (now() + make_interval(mins => v_tz)) - interval '9 hours')
           + interval '9 hours' + interval '1 day') - make_interval(mins => v_tz)
    end;
end;
$$;

revoke all on function public.get_credit_state() from public;
grant execute on function public.get_credit_state() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Proof, rolled back.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid   uuid;
  v_dev   text := 'selftest-device-' || gen_random_uuid()::text;
  v_uid2  uuid;
  r       record;
  v_ok    boolean;
  v_after integer;
begin
  select user_id into v_uid from public.user_profiles order by created_at limit 1;
  select user_id into v_uid2 from public.user_profiles order by created_at desc limit 1;
  if v_uid is null then
    raise notice 'grants verify SKIPPED: no profile rows';
    return;
  end if;

  -- The daily grant must not top up somebody who already has a match in hand.
  delete from public.credit_grants where user_id = v_uid;
  update public.user_profiles set credits = 5 where user_id = v_uid;
  v_ok := public.claim_free_match_for(v_uid);          -- signup branch, +2
  select credits into v_after from public.user_profiles where user_id = v_uid;
  if v_after <> 7 then
    raise exception 'FAILED: signup grant produced %, expected 7', v_after;
  end if;

  update public.credit_grants set granted_at = now() - interval '9 hours'
   where user_id = v_uid and kind = 'daily';
  v_ok := public.claim_free_match_for(v_uid);
  if v_ok then
    raise exception 'FAILED: the daily grant paid out to a user holding 7 credits. Free matches would stack.';
  end if;
  select credits into v_after from public.user_profiles where user_id = v_uid;
  if v_after <> 7 then
    raise exception 'FAILED: a refused daily grant still moved the balance to %', v_after;
  end if;

  -- At zero, the same call does pay out.
  update public.user_profiles set credits = 0 where user_id = v_uid;
  update public.credit_grants set granted_at = now() - interval '9 hours'
   where user_id = v_uid and kind = 'daily';
  v_ok := public.claim_free_match_for(v_uid);
  if not v_ok then
    raise exception 'REGRESSION: a user at zero was refused their daily match.';
  end if;

  -- The device starter is once per device, whoever is holding it.
  select * into r from public.claim_device_starter(v_dev, v_uid, false);
  if r.granted <> 2 or r.already_claimed then
    raise exception 'FAILED: first device starter returned granted=%, already=%', r.granted, r.already_claimed;
  end if;
  select * into r from public.claim_device_starter(v_dev, v_uid2, false);
  if r.granted <> 0 or not r.already_claimed then
    raise exception 'FAILED: a second identity on the same device collected % credits. Signing out would be a refill button.', r.granted;
  end if;

  -- A device that already granted locally gets the record, not the credits.
  select * into r from public.claim_device_starter('selftest-marked-' || gen_random_uuid()::text, v_uid, true);
  if r.granted <> 0 then
    raise exception 'FAILED: a device with the local marker present was granted % credits again', r.granted;
  end if;

  raise notice 'grants verify PASSED: daily tops up to 1 only at zero, starter is once per device, marker suppresses the award';
  raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
exception
  when others then
    if sqlerrm <> 'ROLLBACK_SENTINEL' then
      raise;
    end if;
end;
$$;

commit;
