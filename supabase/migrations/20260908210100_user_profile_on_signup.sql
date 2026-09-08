-- Profile rows stop being the client's job.
--
-- Today getUserCredits' PGRST116 branch is the ONLY thing that ever creates a
-- user_profiles row: there is no signup trigger anywhere in this directory.
-- That works, and the lockdown migration keeps it working, but it means a brand
-- new account's balance depends on a client insert succeeding.
--
-- Separate file on purpose: CREATE TRIGGER on auth.users needs ownership of
-- that table, which not every Supabase project grants to the migration role. If
-- this file fails, SKIP IT. Nothing breaks, because the "Users insert own
-- profile" policy in the lockdown keeps the shipped client creating its own row
-- exactly as it does today.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 0, never the column default. Free credits are granted separately and are
  -- rationed through credit_grants; a row that arrives pre-funded would be a
  -- third, invisible grant path.
  insert into public.user_profiles (user_id, credits)
  values (new.id, 0)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts with no profile row read as 0 today anyway (getUserCredits returns 0
-- when its insert fails), so this creates rows without changing a single
-- balance. Runs as the migration role, so the guard trigger skips it.
insert into public.user_profiles (user_id, credits)
select u.id, 0
  from auth.users u
 where not exists (
   select 1 from public.user_profiles p where p.user_id = u.id
 )
on conflict (user_id) do nothing;

commit;
