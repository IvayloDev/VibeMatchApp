-- Every track recommend-songs ships, so the function can stop serving the
-- same songs over and over. Two exclusions read from this table:
--   1. the most-served tracks per vibe in the last 30 days, across everyone
--      (the model's reflex picks: "Go", "Midnight City", "Weightless");
--   2. everything this device or user has been served recently, which also
--      covers guests whose local history is empty.
-- Written and read with the service role only; no client policy.

create table if not exists public.recommendation_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  vibe text,
  title text not null,
  artist text not null,
  spotify_url text,
  device_id text,
  user_id uuid
);

create index if not exists recommendation_log_created_at_idx
  on public.recommendation_log (created_at desc);
create index if not exists recommendation_log_device_idx
  on public.recommendation_log (device_id, created_at desc);
create index if not exists recommendation_log_user_idx
  on public.recommendation_log (user_id, created_at desc);

alter table public.recommendation_log enable row level security;
-- No policies: the anon and authenticated roles get nothing. The edge
-- function uses the service role, which bypasses RLS.

-- The 30-day, per-vibe leaderboard the function excludes from. Security
-- definer so the function can call it with one round trip; only exposed to
-- the service role.
create or replace function public.most_served_tracks(p_vibe text, p_days int default 30, p_limit int default 20)
returns table (title text, artist text, n bigint)
language sql
security definer
set search_path = public
as $$
  select title, artist, count(*) as n
  from public.recommendation_log
  where created_at > now() - make_interval(days => p_days)
    and (p_vibe is null or vibe = p_vibe)
  group by title, artist
  having count(*) >= 3
  order by n desc
  limit p_limit;
$$;

revoke all on function public.most_served_tracks(text, int, int) from public, anon, authenticated;
grant execute on function public.most_served_tracks(text, int, int) to service_role;
