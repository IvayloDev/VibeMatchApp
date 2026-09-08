-- A call ledger for the edge functions that spend a shared resource but have
-- no per-user identity to meter against.
--
-- spotify-search is the first caller. Its suggest mode runs paged Spotify
-- track searches and a gpt-4.1-mini call, it takes no JWT (guests use it during
-- onboarding) and the client sends no device id, so the IP is the only thing
-- there is to count. The cost that matters is not tokens, which are cents an
-- hour even under abuse, but the app-wide Spotify quota: that quota is shared
-- by every user of the app, so one script hammering suggest degrades matching
-- for everybody.
--
-- Deliberately not reusing recommendation_log: that table means "a track we
-- served a user" and is read by the repeat-suppression queries. Mixing call
-- metering into it would corrupt both.
create table if not exists public.edge_call_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  fn text not null,
  mode text,
  ip text
);

create index if not exists edge_call_log_fn_ip_idx
  on public.edge_call_log (fn, ip, created_at desc);

create index if not exists edge_call_log_created_at_idx
  on public.edge_call_log (created_at desc);

alter table public.edge_call_log enable row level security;
-- No policies: anon and authenticated get nothing. The functions write and
-- read it with the service role, which bypasses RLS.

-- Rows older than a day are past every window anyone counts, and this table
-- grows with traffic rather than with users.
create or replace function public.prune_edge_call_log(p_keep_hours int default 48)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.edge_call_log
   where created_at < now() - make_interval(hours => p_keep_hours);
$$;

revoke all on function public.prune_edge_call_log(int) from public, anon, authenticated;
grant execute on function public.prune_edge_call_log(int) to service_role;
