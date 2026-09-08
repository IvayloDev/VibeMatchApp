-- Close the Spotify tables to the anon key.
--
-- 20260416120000_create_spotify_tables.sql created a policy on each table
-- named "Service role manages ..." with FOR ALL USING (true) and no TO clause.
-- A policy without TO applies to every role, so the app-embedded anon key
-- could SELECT, INSERT, UPDATE and DELETE every row: 263 users' Spotify
-- access and refresh tokens were readable with the public key (verified via
-- the REST API on 2026-09-06). The service role bypasses RLS anyway, so the
-- fix is simply to scope those two policies to service_role. The existing
-- "Users can view own ..." policies keep the client's own-row reads working
-- (lib/spotify.ts, OnboardingScreen.tsx only ever SELECT their own row).
--
-- Apply with the Supabase SQL editor or `supabase db push`, then re-run the
-- check below; the anon key must get zero rows from both tables afterwards.

ALTER POLICY "Service role manages spotify connections"
  ON public.spotify_connections TO service_role;

ALTER POLICY "Service role manages taste profiles"
  ON public.spotify_taste_profiles TO service_role;

-- Verification (run as anon through PostgREST, expect 0 rows):
--   GET /rest/v1/spotify_connections?select=user_id   with apikey = anon key
--   GET /rest/v1/spotify_taste_profiles?select=user_id with apikey = anon key
