-- Prove the credits guard permits what the shipped app actually does.
--
-- The lockdown migration proves the guard REFUSES a forged write. This proves
-- the other half, which is the more dangerous direction: if the guard also
-- refused the spend or the daily grant, every signed-in user on the App Store
-- build would silently stop being able to match, and the first report would be
-- a support email rather than a failed deploy.
--
-- Everything here impersonates a real user the way PostgREST does and then
-- rolls itself back through a sentinel exception, so no balance moves and no
-- free grant is consumed. Kept in the repo rather than run once by hand: it
-- re-runs against any new environment and fails loudly there too.

begin;

do $$
declare
  v_uid    uuid;
  v_before integer;
  v_after  integer;
begin
  -- A row with something to spend, so the spend test cannot be confused with a
  -- non-negative check constraint.
  select user_id, credits into v_uid, v_before
    from public.user_profiles
   where credits >= 1
   order by created_at
   limit 1;

  if v_uid is null then
    raise notice 'credit guard verify SKIPPED: no profile with a spendable balance';
    return;
  end if;

  -- ---- 1. The spend. deductCredits writes exactly OLD - 1. ----
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text,
      true
    );

    update public.user_profiles
       set credits = credits - 1
     where user_id = v_uid;

    -- Permitted, as required. Undo it.
    raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
  exception
    when insufficient_privilege then
      raise exception
        'REGRESSION: the guard refused the spend (-1). Every signed-in user on the shipped build would be unable to use a credit. Not deploying.';
    when others then
      if sqlerrm <> 'ROLLBACK_SENTINEL' then
        raise;
      end if;
  end;

  -- ---- 2. The free grant. The shipped build writes OLD + 1 for the signup
  -- credit and the daily match. It must be permitted at least once, and the
  -- ration insert it consumes is rolled back with the sentinel below. ----
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text,
      true
    );

    update public.user_profiles
       set credits = credits + 1
     where user_id = v_uid;

    raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
  exception
    when insufficient_privilege then
      raise exception
        'REGRESSION: the guard refused a rationed +1. New accounts would land on zero credits and every user would lose the daily free match. Not deploying.';
    when others then
      if sqlerrm <> 'ROLLBACK_SENTINEL' then
        raise;
      end if;
  end;

  -- ---- 3. Nothing moved. ----
  select credits into v_after from public.user_profiles where user_id = v_uid;
  if v_after is distinct from v_before then
    raise exception 'credit guard verify CHANGED A BALANCE (% -> %), aborting', v_before, v_after;
  end if;

  raise notice 'credit guard verify PASSED: spend permitted, rationed grant permitted, balance intact';
end;
$$;

commit;
