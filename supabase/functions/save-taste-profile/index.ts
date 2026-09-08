// Persists a taste profile picked in-app (TastePickerScreen) for a registered
// user. It lands in the same spotify_taste_profiles row, in the same shape, as
// the Spotify-derived profile written by sync-spotify-profile, so
// recommend-songs and the onboarding reveal pages consume both without
// knowing which produced it.
//
// Writes go through the service role on purpose. spotify_taste_profiles has
// no policy granting authenticated users a write on their own row (the one
// permissive policy is the catch-all meant for the service role), and the
// table's write path is meant to stay server-side, like every other Spotify
// table here.
//
// POST { profile: { top_artists: [{ id, name, genres, image }], top_genres: string[] } }
//   with the user's JWT in the Authorization header
//   -> 200 { success: true, stored: "server", summary: { artists, genres } }
//   -> 400 on a malformed or empty profile, 401 when no user resolves,
//      500 when the upsert fails.
//
// Track arrays are always written empty: a picked profile has no listening
// data, and leaving stale Spotify tracks next to hand-picked artists would let
// the old tracks outweigh the new picks in recommend-songs.
//
// Guests never call this. Their profile lives in AsyncStorage only and travels
// inline with each recommend-songs request.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// The picker allows 3 artists and 3 chosen genres; the caps here are wider
// only so a future picker can grow without a function redeploy.
const MAX_ARTISTS = 10;
const MAX_GENRES = 15;
const MAX_GENRES_PER_ARTIST = 5;
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 120;
const MAX_GENRE_LENGTH = 40;
const MAX_IMAGE_URL_LENGTH = 500;

type CompactArtist = { id: string; name: string; genres: string[]; image: string | null };

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

// Spotify genre strings are lower case; keep picked ones the same so the two
// sources look alike in top_genres.
function cleanGenres(value: unknown, maxCount: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    const genre = cleanString(raw, MAX_GENRE_LENGTH).toLowerCase();
    if (!genre || seen.has(genre)) continue;
    seen.add(genre);
    out.push(genre);
    if (out.length >= maxCount) break;
  }
  return out;
}

function cleanImage(value: unknown): string | null {
  return typeof value === "string" && /^https:\/\//.test(value)
    ? value.slice(0, MAX_IMAGE_URL_LENGTH)
    : null;
}

function cleanArtists(value: unknown): CompactArtist[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: CompactArtist[] = [];
  for (const raw of value) {
    const id = cleanString(raw?.id, MAX_ID_LENGTH);
    const name = cleanString(raw?.name, MAX_NAME_LENGTH);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      genres: cleanGenres(raw?.genres, MAX_GENRES_PER_ARTIST),
      image: cleanImage(raw?.image),
    });
    if (out.length >= MAX_ARTISTS) break;
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request JSON" }, 400);
  }

  // Resolve the user from the caller's JWT, never from the body.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Sign in to save a taste profile" }, 401);
  }
  let userId: string | null = null;
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (user) userId = user.id;
  } catch (err) {
    console.warn("Could not resolve user:", err);
  }
  if (!userId) {
    return json({ error: "Sign in to save a taste profile" }, 401);
  }

  const profile = body?.profile;
  if (!profile || typeof profile !== "object") {
    return json({ error: "Missing profile" }, 400);
  }

  const topArtists = cleanArtists(profile.top_artists);
  const topGenres = cleanGenres(profile.top_genres, MAX_GENRES);
  if (topArtists.length === 0 && topGenres.length === 0) {
    return json({ error: "Pick at least one artist or genre" }, 400);
  }

  const now = new Date().toISOString();
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { error: upsertError } = await admin.from("spotify_taste_profiles").upsert({
    user_id: userId,
    top_artists: topArtists,
    top_tracks: [],
    recently_played: [],
    saved_tracks: [],
    top_genres: topGenres,
    refreshed_at: now,
    updated_at: now,
  }, { onConflict: "user_id" });

  if (upsertError) {
    console.error("Failed to upsert taste profile:", upsertError);
    return json({ error: "Failed to save taste profile" }, 500);
  }

  return json({
    success: true,
    stored: "server",
    summary: { artists: topArtists.length, genres: topGenres.length },
  });
});
