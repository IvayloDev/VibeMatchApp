-- A purchase has two ids, and the grant paths were keyed on different ones.
--
-- RevenueCat gives every non-subscription purchase an internal id (the `id`
-- in /v1/subscribers) and carries the store's transaction id beside it
-- (`store_transaction_id` there, `transaction_id` on a webhook event).
-- validate-purchase, session-bootstrap and recovery recorded the internal id;
-- the webhook recorded the store id. purchases.transaction_id is UNIQUE, so
-- each path thought it was deduplicating - against a string the other path
-- never wrote. A 5-pack bought tonight was granted by validate-purchase and
-- then again by the webhook, minutes apart: 10 credits for 5.
--
-- Two changes. The store id becomes the primary key on every path, since it
-- is the one both the subscriber API and the webhook expose. And the grant
-- refuses a duplicate under EITHER id, so purchases already on file under an
-- internal id cannot be granted a second time when the webhook arrives with
-- the store id for the same sale.

begin;

alter table public.purchases add column if not exists alt_transaction_id text;

-- One function, not an overload pair. Keeping a six-argument version beside a
-- seven-argument one with defaults makes a six-named-argument call ambiguous
-- and Postgres refuses it outright - the same trap consume_free_grant_for_self
-- fell into earlier. Dropping the old signature here, inside the transaction
-- that creates the new one, leaves no window: every deployed caller passes six
-- named arguments and resolves to the new function with p_alt_txn defaulted.
drop function if exists public.grant_purchase_credits(uuid, text, text, text, integer, text);
create unique index if not exists purchases_alt_transaction_id_key
  on public.purchases (alt_transaction_id) where alt_transaction_id is not null;

create or replace function public.grant_purchase_credits(
  p_user     uuid,
  p_product  text,
  p_txn      text,
  p_platform text,
  p_credits  integer,
  p_source   text default 'unknown',
  p_alt_txn  text default null
)
returns table (granted boolean, balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_dup     boolean;
begin
  if p_user is null or p_txn is null or p_credits is null or p_credits <= 0 then
    raise exception 'grant_purchase_credits requires a user, a transaction id and a positive credit count';
  end if;

  -- Per-user lock: two paths for the same sale, arriving together with
  -- different ids, serialize here, so the either-id check below is not a
  -- check-then-insert race.
  perform pg_advisory_xact_lock(hashtext('tunematch_credit:' || p_user::text));

  select exists (
    select 1 from public.purchases p
     where p.transaction_id = p_txn
        or (p_alt_txn is not null and p.transaction_id = p_alt_txn)
        or p.alt_transaction_id = p_txn
        or (p_alt_txn is not null and p.alt_transaction_id = p_alt_txn)
  ) into v_dup;

  if v_dup then
    select up.credits into v_balance from public.user_profiles up where up.user_id = p_user;
    return query select false, coalesce(v_balance, 0);
    return;
  end if;

  insert into public.purchases (user_id, product_id, transaction_id, alt_transaction_id, platform, credits_granted, validation_data)
  values (
    p_user, p_product, p_txn, p_alt_txn, p_platform, p_credits,
    jsonb_build_object('validated_by', p_source, 'validated_at', now())
  );

  update public.user_profiles
     set credits = credits + p_credits, updated_at = now()
   where user_id = p_user
   returning credits into v_balance;

  if v_balance is null then
    insert into public.user_profiles (user_id, credits)
    values (p_user, p_credits)
    on conflict (user_id) do update set credits = public.user_profiles.credits + p_credits
    returning credits into v_balance;
  end if;

  return query select true, coalesce(v_balance, 0);
end;
$$;

revoke all on function public.grant_purchase_credits(uuid, text, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.grant_purchase_credits(uuid, text, text, text, integer, text, text) to service_role;

-- Proof: the same sale under its two ids grants once.
do $$
declare
  v_uid    uuid;
  v_before integer;
  v_after  integer;
  v_store  text := 'selftest-store-' || gen_random_uuid()::text;
  v_rc     text := 'selftest-rc-' || gen_random_uuid()::text;
  r        record;
begin
  select user_id, credits into v_uid, v_before from public.user_profiles order by created_at limit 1;
  if v_uid is null then
    raise notice 'purchase dedupe verify SKIPPED: no profile rows';
    return;
  end if;

  -- validate-purchase style: store id primary, internal id alternate.
  select * into r from public.grant_purchase_credits(v_uid, 'tunematch_credits_5', v_store, 'ios', 5, 'selftest', v_rc);
  if not r.granted then raise exception 'FAILED: first grant refused'; end if;

  -- webhook style: store id only, moments later.
  select * into r from public.grant_purchase_credits(v_uid, 'tunematch_credits_5', v_store, 'ios', 5, 'selftest');
  if r.granted then raise exception 'FAILED: webhook-shaped duplicate granted again by store id'; end if;

  -- a legacy caller that still keys on the internal id.
  select * into r from public.grant_purchase_credits(v_uid, 'tunematch_credits_5', v_rc, 'ios', 5, 'selftest');
  if r.granted then raise exception 'FAILED: duplicate granted again by internal id'; end if;

  select credits into v_after from public.user_profiles where user_id = v_uid;
  if v_after <> v_before + 5 then
    raise exception 'FAILED: balance moved by % for one sale, expected 5', v_after - v_before;
  end if;

  raise notice 'purchase dedupe verify PASSED: one sale under two ids granted once';
  raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
exception
  when others then
    if sqlerrm <> 'ROLLBACK_SENTINEL' then
      raise;
    end if;
end;
$$;

commit;
