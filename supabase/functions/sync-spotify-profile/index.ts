// Fetches the user's Spotify taste data (top artists/tracks short + medium term,
// recently played, saved tracks) and upserts a compact taste profile.
//
// Registered users: access token read from spotify_connections, refreshed if stale,
// profile persisted in spotify_taste_profiles.
// Guest users: client sends access_token + refresh_token inline; server returns the
// derived profile for the client to cache locally.

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

const SPOTIFY_API = "https://api.spotify.com/v1";

type CompactArtist = { id: string; name: string; genres: string[]; image: string | null };
type CompactTrack = { id: string; name: string; artist: string; image: string | null };

async function spotifyGet(path: string, token: string): Promise<any | null> {
  const resp = await fetch(`${SPOTIFY_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    console.warn(`⚠️ Spotify ${path} -> ${resp.status}`);
    return null;
  }
  return await resp.json();
}

async function refreshIfNeeded(
  refreshTokenValue: string,
): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET") ?? "";
  const auth = "Basic " + btoa(`${clientId}:${clientSecret}`);
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshTokenValue,
      client_id: clientId,
    }).toString(),
  });
  if (!resp.ok) {
    console.error("❌ Refresh failed in sync:", await resp.text());
    return null;
  }
  const data = await resp.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshTokenValue,
    expires_in: data.expires_in,
  };
}

function compactArtist(a: any): CompactArtist {
  return {
    id: a?.id ?? "",
    name: a?.name ?? "",
    genres: Array.isArray(a?.genres) ? a.genres.slice(0, 5) : [],
    // Index 1 = ~300px medium size, fall back to the largest, then null
    image: a?.images?.[1]?.url ?? a?.images?.[0]?.url ?? null,
  };
}

function compactTrack(t: any): CompactTrack {
  return {
    id: t?.id ?? "",
    name: t?.name ?? "",
    artist: t?.artists?.[0]?.name ?? "",
    image: t?.album?.images?.[1]?.url ?? t?.album?.images?.[0]?.url ?? null,
  };
}

function deriveTopGenres(artists: CompactArtist[]): string[] {
  const counts = new Map<string, number>();
  for (const a of artists) {
    for (const g of a.genres) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([g]) => g);
}

async function buildTasteProfile(accessToken: string) {
  const [topShort, topMedium, topTracksShort, topTracksMedium, recent, saved] = await Promise.all([
    spotifyGet("/me/top/artists?time_range=short_term&limit=20", accessToken),
    spotifyGet("/me/top/artists?time_range=medium_term&limit=30", accessToken),
    spotifyGet("/me/top/tracks?time_range=short_term&limit=20", accessToken),
    spotifyGet("/me/top/tracks?time_range=medium_term&limit=30", accessToken),
    spotifyGet("/me/player/recently-played?limit=30", accessToken),
    spotifyGet("/me/tracks?limit=30", accessToken),
  ]);

  const artistsMap = new Map<string, CompactArtist>();
  for (const a of [...(topShort?.items ?? []), ...(topMedium?.items ?? [])]) {
    const c = compactArtist(a);
    if (c.id && !artistsMap.has(c.id)) artistsMap.set(c.id, c);
  }
  const topArtists = Array.from(artistsMap.values()).slice(0, 40);

  const tracksMap = new Map<string, CompactTrack>();
  for (const t of [...(topTracksShort?.items ?? []), ...(topTracksMedium?.items ?? [])]) {
    const c = compactTrack(t);
    if (c.id && !tracksMap.has(c.id)) tracksMap.set(c.id, c);
  }
  const topTracks = Array.from(tracksMap.values()).slice(0, 40);

  const recentlyPlayed = (recent?.items ?? [])
    .map((item: any) => compactTrack(item?.track))
    .filter((t: CompactTrack) => t.id);

  const savedTracks = (saved?.items ?? [])
    .map((item: any) => compactTrack(item?.track))
    .filter((t: CompactTrack) => t.id);

  const topGenres = deriveTopGenres(topArtists);

  return { topArtists, topTracks, recentlyPlayed, savedTracks, topGenres };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request JSON" }, 400);
  }

  // Resolve user (optional)
  let userId: string | undefined;
  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user } } = await sb.auth.getUser();
      if (user) userId = user.id;
    } catch (err) {
      console.warn("⚠️ Could not resolve user:", err);
    }
  }

  let accessToken: string | null = null;
  let refreshTokenValue: string | null = null;
  let connectionExpiresAt: string | null = null;
  let admin: any = null;

  if (userId) {
    admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { data: conn, error } = await admin
      .from("spotify_connections")
      .select("access_token, refresh_token, expires_at")
      .eq("user_id", userId)
      .single();
    if (error || !conn) {
      return json({ error: "No Spotify connection for user" }, 404);
    }
    accessToken = conn.access_token;
    refreshTokenValue = conn.refresh_token;
    connectionExpiresAt = conn.expires_at;
  } else {
    // Guest: caller supplies tokens
    accessToken = body.access_token ?? null;
    refreshTokenValue = body.refresh_token ?? null;
    connectionExpiresAt = body.expires_at ?? null;
    if (!accessToken || !refreshTokenValue) {
      return json({ error: "Missing access_token/refresh_token for guest" }, 400);
    }
  }

  // Refresh if expired
  const isExpired = !connectionExpiresAt || new Date(connectionExpiresAt).getTime() <= Date.now();
  if (isExpired && refreshTokenValue) {
    const refreshed = await refreshIfNeeded(refreshTokenValue);
    if (!refreshed) return json({ error: "Failed to refresh Spotify token" }, 401);
    accessToken = refreshed.access_token;
    refreshTokenValue = refreshed.refresh_token;
    connectionExpiresAt = new Date(Date.now() + (refreshed.expires_in - 30) * 1000).toISOString();

    if (userId && admin) {
      await admin.from("spotify_connections").update({
        access_token: accessToken,
        refresh_token: refreshTokenValue,
        expires_at: connectionExpiresAt,
        updated_at: new Date().toISOString(),
      }).eq("user_id", userId);
    }
  }

  if (!accessToken) return json({ error: "No access token" }, 401);

  try {
    const profile = await buildTasteProfile(accessToken);

    if (userId && admin) {
      const { error: upsertError } = await admin.from("spotify_taste_profiles").upsert({
        user_id: userId,
        top_artists: profile.topArtists,
        top_tracks: profile.topTracks,
        recently_played: profile.recentlyPlayed,
        saved_tracks: profile.savedTracks,
        top_genres: profile.topGenres,
        refreshed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (upsertError) {
        console.error("❌ Failed to upsert taste profile:", upsertError);
        return json({ error: "Failed to save taste profile" }, 500);
      }
      return json({
        success: true,
        stored: "server",
        summary: {
          artists: profile.topArtists.length,
          tracks: profile.topTracks.length,
          genres: profile.topGenres.length,
        },
      });
    }

    // Guest: return full profile so client can cache locally
    return json({
      success: true,
      stored: "client",
      profile: {
        top_artists: profile.topArtists,
        top_tracks: profile.topTracks,
        recently_played: profile.recentlyPlayed,
        saved_tracks: profile.savedTracks,
        top_genres: profile.topGenres,
        refreshed_at: new Date().toISOString(),
      },
      // Return updated tokens so client can persist refreshed values
      tokens: {
        access_token: accessToken,
        refresh_token: refreshTokenValue,
        expires_at: connectionExpiresAt,
      },
    });
  } catch (err: any) {
    console.error("❌ sync-spotify-profile error:", err);
    return json({ error: err?.message ?? "Internal error" }, 500);
  }
});
