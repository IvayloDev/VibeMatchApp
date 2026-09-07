-- recommend-songs now records the caller's IP with every shipped track and
-- reads it back for a per-IP daily ceiling. Device and user ids are supplied
-- by the caller and can be rotated; the IP is the one dimension they cannot.
alter table public.recommendation_log add column if not exists ip text;

create index if not exists recommendation_log_ip_idx
  on public.recommendation_log (ip, created_at desc);
