-- Prove the charge machinery before anything is wired to it.
--
-- Every assertion runs against a real profile row and the whole block rolls
-- itself back through a sentinel exception, so no balance moves and no grant is
-- consumed. Kept in the repo rather than run once by hand: it re-runs against
-- any new environment and fails there too.
--
-- The order matters. The privilege checks come FIRST, because a charge function
-- a client can call is worse than a charge function that miscounts: the second
-- is a bug, the first is the hole this whole exercise exists to close.

begin;

do $$
declare
  v_uid     uuid;
  v_before  integer;
  v_after   integer;
  v_scan_a  uuid := '00000000-0000-4000-8000-00000000000a';
  v_scan_b  uuid := '00000000-0000-4000-8000-00000000000b';
  r         record;
  v_ok      boolean;
  v_n       integer;
begin
  -- ---- 0. Nothing a client can reach may move a balance. ----
  if has_function_privilege('authenticated', 'public.charge_scan(uuid,uuid,text)', 'execute') then
    raise exception 'FATAL: authenticated can execute charge_scan. Any client could spend or replay at will. Not deploying.';
  end if;
  if has_function_privilege('anon', 'public.charge_scan(uuid,uuid,text)', 'execute') then
    raise exception 'FATAL: anon can execute charge_scan. Not deploying.';
  end if;
  if has_function_privilege('authenticated', 'public.refund_scan(uuid,uuid,text)', 'execute') then
    raise exception 'FATAL: authenticated can execute refund_scan, which mints a credit per call. Not deploying.';
  end if;
  if has_function_privilege('authenticated', 'public.claim_free_match_for(uuid)', 'execute') then
    raise exception 'FATAL: authenticated can execute claim_free_match_for and would grant itself credits for any user id. Not deploying.';
  end if;
  if has_table_privilege('authenticated', 'public.client_contract', 'UPDATE') then
    raise exception 'FATAL: authenticated can UPDATE client_contract and could declare itself a contract the server does not charge. Not deploying.';
  end if;
  if has_table_privilege('authenticated', 'public.match_charges', 'UPDATE') then
    raise exception 'FATAL: authenticated can UPDATE match_charges and could mark a held charge settled or refunded. Not deploying.';
  end if;
  -- The one read a client is meant to have.
  if not has_function_privilege('authenticated', 'public.get_credit_state()', 'execute') then
    raise exception 'REGRESSION: authenticated cannot call get_credit_state, so the app could never show a balance. Not deploying.';
  end if;

  select user_id, credits into v_uid, v_before
    from public.user_profiles
   order by created_at
   limit 1;

  if v_uid is null then
    raise notice 'credit ledger verify SKIPPED: no profile rows';
    return;
  end if;

  -- ---- 1. An empty balance is refused, and refused BEFORE any work. ----
  update public.user_profiles set credits = 0 where user_id = v_uid;
  select * into r from public.charge_scan(v_uid, v_scan_a, 'hash-a');
  if r.outcome <> 'insufficient' then
    raise exception 'FAILED: charging a 0-credit user returned %, expected insufficient', r.outcome;
  end if;
  select count(*) into v_n from public.match_charges where scan_id = v_scan_a;
  if v_n <> 0 then
    raise exception 'FAILED: a refused charge left a match_charges row behind';
  end if;

  -- ---- 2. A charge is exactly one credit, and a retry is free. ----
  update public.user_profiles set credits = 5 where user_id = v_uid;

  select * into r from public.charge_scan(v_uid, v_scan_a, 'hash-a');
  if r.outcome <> 'charged' or r.balance <> 4 then
    raise exception 'FAILED: first charge returned %/% , expected charged/4', r.outcome, r.balance;
  end if;

  select * into r from public.charge_scan(v_uid, v_scan_a, 'hash-a');
  if r.outcome <> 'replay' or r.balance <> 4 then
    raise exception 'FAILED: replaying the same scan returned %/%, expected replay/4. A dropped connection would double charge.', r.outcome, r.balance;
  end if;

  -- ---- 3. Same scan id, different work, is refused and costs nothing. ----
  select * into r from public.charge_scan(v_uid, v_scan_a, 'hash-DIFFERENT');
  if r.outcome <> 'conflict' then
    raise exception 'FAILED: reusing a scan id for different work returned %, expected conflict', r.outcome;
  end if;
  select credits into v_after from public.user_profiles where user_id = v_uid;
  if v_after <> 4 then
    raise exception 'FAILED: a conflicting charge moved the balance to %, expected 4', v_after;
  end if;

  -- ---- 4. A refund restores exactly one credit, however many times it runs. ----
  perform public.refund_scan(v_uid, v_scan_a, 'test');
  select credits into v_after from public.user_profiles where user_id = v_uid;
  if v_after <> 5 then
    raise exception 'FAILED: refund restored to %, expected 5', v_after;
  end if;
  perform public.refund_scan(v_uid, v_scan_a, 'test again');
  select credits into v_after from public.user_profiles where user_id = v_uid;
  if v_after <> 5 then
    raise exception 'FAILED: a second refund of the same scan minted a credit (balance %), expected 5', v_after;
  end if;

  -- ---- 5. Settled work cannot then be refunded. ----
  select * into r from public.charge_scan(v_uid, v_scan_b, 'hash-b');
  perform public.settle_scan(v_uid, v_scan_b, '{"songs":[]}'::jsonb);
  perform public.refund_scan(v_uid, v_scan_b, 'should not refund');
  select credits into v_after from public.user_profiles where user_id = v_uid;
  if v_after <> 4 then
    raise exception 'FAILED: a settled scan was refunded (balance %), expected 4. Delivered work would be free.', v_after;
  end if;

  -- ---- 6. The free grant is rationed, and the starter does not pay twice. ----
  delete from public.credit_grants where user_id = v_uid;
  update public.user_profiles set credits = 0 where user_id = v_uid;

  v_ok := public.claim_free_match_for(v_uid);
  if not v_ok then
    raise exception 'FAILED: the first free grant was refused, so a new account would land on zero';
  end if;
  select credits into v_after from public.user_profiles where user_id = v_uid;
  if v_after <> 1 then
    raise exception 'FAILED: the starter grant paid % credits, expected exactly 1', v_after;
  end if;

  v_ok := public.claim_free_match_for(v_uid);
  if v_ok then
    raise exception 'FAILED: a second free grant landed immediately after the starter. A fresh account collects two.';
  end if;
  select credits into v_after from public.user_profiles where user_id = v_uid;
  if v_after <> 1 then
    raise exception 'FAILED: the refused grant still moved the balance to %', v_after;
  end if;

  raise notice 'credit ledger verify PASSED: privileges sealed, charge/replay/conflict/refund/settle correct, free grant rationed';
  raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
exception
  when others then
    if sqlerrm <> 'ROLLBACK_SENTINEL' then
      raise;
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Separately: a client impersonation, to prove the revoke actually bites.
--
-- has_table_privilege above asks the catalog. This asks the executor, which is
-- the thing that would be wrong if the catalog were somehow satisfied and the
-- grant still effective through a role membership.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid uuid;
begin
  select user_id into v_uid from public.user_profiles order by created_at limit 1;
  if v_uid is null then
    return;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text,
    true
  );

  begin
    update public.client_contract set max_contract = 99 where user_id = v_uid;
    raise exception 'FATAL: an authenticated client updated client_contract. It could exempt itself from being charged. Not deploying.';
  exception
    when insufficient_privilege then
      null; -- exactly what should happen
  end;

  begin
    perform public.charge_scan(v_uid, gen_random_uuid(), 'impersonated');
    raise exception 'FATAL: an authenticated client executed charge_scan. Not deploying.';
  exception
    when insufficient_privilege then
      null;
  end;

  raise notice 'credit ledger impersonation PASSED: client role refused both the table write and the charge';
  raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
exception
  when others then
    if sqlerrm <> 'ROLLBACK_SENTINEL' then
      raise;
    end if;
end;
$$;

commit;
