-- Remove the client's ability to DELETE its own profile row, and collapse the
-- duplicate policies the table accumulated.
--
-- WHAT WAS THERE
--
-- Seven policies on user_profiles, where the lockdown migration wrote four.
-- The extra ones are pre-existing and were never dropped, because they carry
-- different names:
--
--   Enable all for users based on user_id   {public}         ALL
--   Users can insert own profile            {public}         INSERT
--   Users insert own profile                {authenticated}  INSERT
--   Users can view own profile              {public}         SELECT
--   Users read own profile                  {authenticated}  SELECT
--   Users can update own profile            {public}         UPDATE
--   Users update own profile                {authenticated}  UPDATE
--
-- The duplicates are harmless in themselves: permissive policies OR together,
-- and all of them are scoped to auth.uid() = user_id. The `ALL` one is not
-- harmless, because ALL includes DELETE, and that is a privilege nothing needs.
--
-- WHY DELETE IS SAFE TO REMOVE NOW
--
-- Account deletion is `smooth-handler`, which the app calls from Profile ->
-- Delete Profile. It holds the service role, so RLS does not apply to it and
-- it is unaffected by this migration. The only other caller was `delete-user`,
-- which is now a tombstone that refuses everything. So no code path needs a
-- client-side DELETE.
--
-- What that privilege actually bought a user was the ability to destroy their
-- own purchased balance in one request. Deleting the row and letting the app
-- recreate it is not a credits exploit, since the guard raises on any insert
-- with a non-zero balance and the free-grant ration is keyed by user id rather
-- than by the profile row. It is simply a foot-gun with no upside.
--
-- The `{public}` variants are dropped in favour of the `{authenticated}` ones.
-- That loses nothing: `public` means every role including `anon`, and every one
-- of these is gated on auth.uid() = user_id, which is null for `anon`, so those
-- policies never matched an anonymous request in the first place. Anonymous
-- SIGN-INS are a different thing entirely and are covered, because a Supabase
-- anonymous user carries the role `authenticated`.

begin;

drop policy if exists "Enable all for users based on user_id" on public.user_profiles;
drop policy if exists "Users can insert own profile" on public.user_profiles;
drop policy if exists "Users can view own profile" on public.user_profiles;
drop policy if exists "Users can update own profile" on public.user_profiles;

-- Restate the survivors so this file is sufficient on a fresh environment.
drop policy if exists "Users read own profile" on public.user_profiles;
create policy "Users read own profile"
on public.user_profiles for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users insert own profile" on public.user_profiles;
create policy "Users insert own profile"
on public.user_profiles for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users update own profile" on public.user_profiles;
create policy "Users update own profile"
on public.user_profiles for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- No DELETE policy, deliberately.

-- ---------------------------------------------------------------------------
-- Prove it, in both directions, against a real row.
--
-- The dangerous outcome is not "delete still works". It is "the app stopped
-- working", so the read, the insert shape and the spend are all asserted to
-- still be permitted. A DELETE with no matching policy removes zero rows and
-- raises NOTHING, so that half is checked by looking for the row afterwards
-- rather than by catching an exception.
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid    uuid;
  v_before integer;
  v_seen   integer;
  v_still  integer;
begin
  select user_id, credits into v_uid, v_before
    from public.user_profiles
   where credits >= 1
   order by created_at
   limit 1;

  if v_uid is null then
    raise notice 'user_profiles policy tidy: SKIPPED, no profile with a spendable balance';
    return;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text,
    true
  );

  -- 1. The read the app makes on every Dashboard mount.
  select count(*) into v_seen from public.user_profiles where user_id = v_uid;
  if v_seen <> 1 then
    raise exception
      'REGRESSION: a signed-in user can no longer read their own profile (saw % rows). Every balance in the app would read as 0. Not deploying.', v_seen;
  end if;

  -- 2. The spend.
  begin
    update public.user_profiles set credits = credits - 1 where user_id = v_uid;
  exception when insufficient_privilege then
    raise exception
      'REGRESSION: the spend (-1) is no longer permitted. No signed-in user could use a credit. Not deploying.';
  end;

  -- 3. The delete must now do nothing at all.
  delete from public.user_profiles where user_id = v_uid;
  select count(*) into v_still from public.user_profiles where user_id = v_uid;
  if v_still <> 1 then
    raise exception
      'user_profiles policy tidy FAILED: a client DELETE still removed the row. Not deploying.';
  end if;

  raise notice 'user_profiles policy tidy PASSED: read ok, spend ok, delete refused, balance intact';
  raise exception 'ROLLBACK_SENTINEL' using errcode = 'P0001';
exception
  when others then
    if sqlerrm <> 'ROLLBACK_SENTINEL' then
      raise;
    end if;
end;
$$;

commit;
