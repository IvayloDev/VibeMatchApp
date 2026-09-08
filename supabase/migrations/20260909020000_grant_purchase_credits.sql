-- One atomic way to turn a verified purchase into credits, shared by every
-- caller that has one.
--
-- validate-purchase currently inserts the purchases row, then updates the
-- balance, then deletes the row by hand if the update failed. That rollback
-- exists because the two writes are separate: without it a failed grant leaves
-- a dedupe row that makes every retry return alreadyProcessed, permanently
-- locking a paying customer out of credits they were charged for. A function
-- doing both in one transaction removes the failure mode instead of
-- compensating for it.
--
-- It also gives the RevenueCat webhook and validate-purchase a single place to
-- converge. The same purchase can legitimately arrive from both: the client
-- calls validate-purchase the moment the SDK resolves, and RevenueCat sends the
-- webhook independently. Keying on the store's transaction id means whichever
-- lands first grants, and the other is a no-op.

begin;

create or replace function public.grant_purchase_credits(
  p_user     uuid,
  p_product  text,
  p_txn      text,
  p_platform text,
  p_credits  integer,
  p_source   text default 'unknown'
)
returns table (granted boolean, balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
  v_balance  integer;
begin
  if p_user is null or p_txn is null or p_credits is null or p_credits <= 0 then
    raise exception 'grant_purchase_credits requires a user, a transaction id and a positive credit count';
  end if;

  perform pg_advisory_xact_lock(hashtext('tunematch_credit:' || p_user::text));

  -- The unique constraint on transaction_id is what makes this idempotent, so
  -- a replayed webhook, a client retry, or both racing, can only grant once.
  insert into public.purchases (user_id, product_id, transaction_id, platform, credits_granted, validation_data)
  values (
    p_user, p_product, p_txn, p_platform, p_credits,
    jsonb_build_object('validated_by', p_source, 'validated_at', now())
  )
  on conflict (transaction_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select credits into v_balance from public.user_profiles where user_id = p_user;
    return query select false, coalesce(v_balance, 0);
    return;
  end if;

  update public.user_profiles
     set credits = credits + p_credits, updated_at = now()
   where user_id = p_user
   returning credits into v_balance;

  -- A purchase must never be lost because a profile row was missing.
  if v_balance is null then
    insert into public.user_profiles (user_id, credits)
    values (p_user, p_credits)
    on conflict (user_id) do update set credits = public.user_profiles.credits + p_credits
    returning credits into v_balance;
  end if;

  return query select true, coalesce(v_balance, 0);
end;
$$;

-- Pro, as the server understands it. Only the webhook calls this.
create or replace function public.apply_entitlement(
  p_user    uuid,
  p_product text,
  p_status  text,
  p_expires timestamptz,
  p_source  text default 'revenuecat'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then
    return;
  end if;
  insert into public.entitlements (user_id, product_id, status, expires_at, source, updated_at)
  values (p_user, p_product, p_status, p_expires, p_source, now())
  on conflict (user_id) do update
    set product_id = excluded.product_id,
        status     = excluded.status,
        expires_at = excluded.expires_at,
        source     = excluded.source,
        updated_at = now();
end;
$$;

revoke all on function public.grant_purchase_credits(uuid, text, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.apply_entitlement(uuid, text, text, timestamptz, text)         from public, anon, authenticated;
grant execute on function public.grant_purchase_credits(uuid, text, text, text, integer, text) to service_role;
grant execute on function public.apply_entitlement(uuid, text, text, timestamptz, text)        to service_role;

-- ---------------------------------------------------------------------------
-- Prove it grants exactly once, and that no client can call it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid     uuid;
  v_before  integer;
  v_after   integer;
  v_txn     text := 'selftest-txn-' || gen_random_uuid()::text;
  r         record;
  v_rows    integer;
begin
  if has_function_privilege('authenticated', 'public.grant_purchase_credits(uuid,text,text,text,integer,text)', 'execute') then
    raise exception 'FATAL: authenticated can execute grant_purchase_credits and could grant itself any pack. Not deploying.';
  end if;
  if has_function_privilege('anon', 'public.grant_purchase_credits(uuid,text,text,text,integer,text)', 'execute') then
    raise exception 'FATAL: anon can execute grant_purchase_credits. Not deploying.';
  end if;
  if has_function_privilege('authenticated', 'public.apply_entitlement(uuid,text,text,timestamptz,text)', 'execute') then
    raise exception 'FATAL: authenticated can execute apply_entitlement and could make itself Pro. Not deploying.';
  end if;

  select user_id, credits into v_uid, v_before
    from public.user_profiles order by created_at limit 1;
  if v_uid is null then
    raise notice 'grant_purchase_credits verify SKIPPED: no profile rows';
    return;
  end if;

  select * into r from public.grant_purchase_credits(v_uid, 'tunematch_credits_18', v_txn, 'ios', 18, 'selftest');
  if not r.granted or r.balance <> v_before + 18 then
    raise exception 'FAILED: first grant returned granted=%, balance=%, expected true/%', r.granted, r.balance, v_before + 18;
  end if;

  -- The same transaction again, as a replayed webhook or a client retry would.
  select * into r from public.grant_purchase_credits(v_uid, 'tunematch_credits_18', v_txn, 'ios', 18, 'selftest');
  if r.granted then
    raise exception 'FAILED: the same transaction granted twice. A replayed webhook would double every purchase.';
  end if;

  select credits into v_after from public.user_profiles where user_id = v_uid;
  if v_after <> v_before + 18 then
    raise exception 'FAILED: balance is % after a duplicate grant, expected %', v_after, v_before + 18;
  end if;

  select count(*) into v_rows from public.purchases where transaction_id = v_txn;
  if v_rows <> 1 then
    raise exception 'FAILED: % purchases rows for one transaction, expected 1', v_rows;
  end if;

  raise notice 'grant_purchase_credits verify PASSED: grants once, replays are no-ops, clients cannot call it';
  raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
exception
  when others then
    if sqlerrm <> 'ROLLBACK_SENTINEL' then
      raise;
    end if;
end;
$$;

commit;
