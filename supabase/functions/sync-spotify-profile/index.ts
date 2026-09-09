// Fetches the user's Spotify taste data (top artists/tracks short + medium term,
// recently played, saved tracks) and upserts a compact taste profile.
//
// Registered users: access token read from spotify_connections, refreshed if stale,
// profile persisted in spotify_taste_profiles.
// Guest users: client sends access_token + refresh_token inline; server returns the
// derived profile for the client to cache locally.
//
// EVERY CALLER NEEDS A JWT, THE INLINE-TOKEN ONES INCLUDED
//
// The inline-token branch used to take a refresh token from an unauthenticated
// request body, redeem it with the app's own client secret and return the
// resulting listening history. A refresh token for a confidential client is
// inert without that secret, so this endpoint was the missing half: anyone
// holding a leaked token could read that person's top artists, saved tracks and
// recent plays. Every install now holds an identity (anonymous ones included),
// so requiring a user token costs nothing that ships. It is not proof that the
// caller owns the token - guest tokens live on the device and the server has no
// record of which device holds which - so the branch is metered per address as
// well, because an anonymous identity is free to mint.
//
// If every Spotify call answers 403 (the app is in Development mode and the account is not
// on its allowlist) the function responds 403 { error: "spotify_not_allowlisted",
// code: "spotify_not_allowlisted", spotify_status_summary: { path: status } } and saves nothing.

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

// Per-address ceiling on the inline-token branch, counted over the last hour in
// edge_call_log. A real device syncs on connect and then once a day, so this is
// far above any honest usage and still caps how many stolen tokens one attacker
// can pump through in an hour.
const BODY_TOKEN_SYNCS_PER_IP_PER_HOUR = 60;

/**
 * The caller's address, preferring a hop the caller cannot write.
 *
 * The leftmost x-forwarded-for entry is client-supplied, so metering on it lets
 * an attacker reset their own counter every request. cf-connecting-ip and
 * x-real-ip are written by the edge in front of this function; the rightmost
 * forwarded hop is the fallback because it is the one the nearest proxy added.
 */
function callerIp(req: Request): string | null {
  const direct = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "").trim();
  if (direct) return direct;
  const hops = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.length ? hops[hops.length - 1] : null;
}

/**
 * Count and record one inline-token sync. Returns true when the caller must be
 * refused.
 *
 * Refuses outright when there is no address to count against - stripping the
 * header is an attacker's move, not something a phone does. Allows when the
 * ledger itself cannot be read: every caller that reaches here has already
 * proved an identity, and a database hiccup must not silently stop a real
 * user's listening data from reaching their matches.
 */
async function overBodyTokenLimit(sb: any, ip: string | null): Promise<boolean> {
  if (!ip) {
    console.warn("🚫 inline-token sync with no caller address, refusing");
    return true;
  }
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await sb
      .from("edge_call_log")
      .select("id", { count: "exact", head: true })
      .eq("fn", "sync-spotify-profile")
      .eq("mode", "body-tokens")
      .eq("ip", ip)
      .gt("created_at", since);
    if (error) {
      console.warn("⚠️ inline-token meter unreadable, allowing:", error.message);
      return false;
    }
    if ((count ?? 0) >= BODY_TOKEN_SYNCS_PER_IP_PER_HOUR) {
      console.warn(`🚫 inline-token sync ceiling hit for ip=${ip} count=${count}`);
      return true;
    }
    const { error: insertError } = await sb
      .from("edge_call_log")
      .insert({ fn: "sync-spotify-profile", mode: "body-tokens", ip });
    if (insertError) console.warn("edge_call_log insert failed:", insertError.message);
    return false;
  } catch (err) {
    console.warn("⚠️ inline-token meter threw, allowing:", err);
    return false;
  }
}

type CompactArtist = { id: string; name: string; genres: string[]; image: string | null };
type CompactTrack = { id: string; name: string; artist: string; image: string | null };

type SpotifyResult = { status: number; data: any | null };

// Returns the HTTP status next to the body so buildTasteProfile can tell an
// empty library (2xx, no items) from a refused account (403 on every call
// while the Spotify app is in Development mode and the account is not on
// its allowlist).
async function spotifyGet(path: string, token: string): Promise<SpotifyResult> {
  const resp = await fetch(`${SPOTIFY_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    console.warn(`⚠️ Spotify ${path} -> ${resp.status}`);
    return { status: resp.status, data: null };
  }
  return { status: resp.status, data: await resp.json() };
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

const TASTE_PATHS = [
  "/me/top/artists?time_range=short_term&limit=20",
  "/me/top/artists?time_range=medium_term&limit=30",
  "/me/top/tracks?time_range=short_term&limit=20",
  "/me/top/tracks?time_range=medium_term&limit=30",
  "/me/player/recently-played?limit=30",
  "/me/tracks?limit=30",
];

async function buildTasteProfile(accessToken: string) {
  const results = await Promise.all(TASTE_PATHS.map((path) => spotifyGet(path, accessToken)));

  // path -> HTTP status, so the handler can refuse the whole sync when Spotify
  // refused every call instead of saving an empty profile as a success.
  const statuses: Record<string, number> = {};
  TASTE_PATHS.forEach((path, i) => {
    statuses[path] = results[i].status;
  });

  const [topShort, topMedium, topTracksShort, topTracksMedium, recent, saved] =
    results.map((r) => r.data);

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

  return {
    profile: { topArtists, topTracks, recentlyPlayed, savedTracks, topGenres },
    statuses,
  };
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

  // True when the tokens came from the request body rather than from a
  // connection we hold. That decides the response shape at the end: such a
  // caller keeps its Spotify tokens and its taste cache on the device, so it
  // needs the profile and the refreshed pair handed back.
  let tokensFromBody = false;

  if (!userId) {
    console.warn("🚫 sync refused: no user token on the request");
    return json({ error: "Sign in to sync your Spotify taste" }, 401);
  }

  admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: conn, error: connError } = await admin
    .from("spotify_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (connError) {
    console.error("❌ Failed to read spotify_connections:", connError);
    return json({ error: "Could not read your Spotify connection" }, 500);
  }

  if (conn) {
    accessToken = conn.access_token;
    refreshTokenValue = conn.refresh_token;
    connectionExpiresAt = conn.expires_at;
  } else if (typeof body.refresh_token === "string" && body.refresh_token) {
    // An account whose Spotify tokens live on the device: guests on the builds
    // before anonymous identities kept them in SecureStore because there was no
    // uid to file them under. They hold an identity now, so the tokens arrive
    // with a JWT attached and can be honoured. Without this branch they got a
    // 404 and their listening data silently stopped feeding their matches.
    if (await overBodyTokenLimit(admin, callerIp(req))) {
      return json({ error: "Too many sync requests", code: "rate_limited" }, 429);
    }
    accessToken = typeof body.access_token === "string" ? body.access_token : null;
    refreshTokenValue = body.refresh_token;
    connectionExpiresAt = typeof body.expires_at === "string" ? body.expires_at : null;
    tokensFromBody = true;
  } else {
    return json({ error: "No Spotify connection for user" }, 404);
  }

  // Refresh if expired
  const isExpired = !connectionExpiresAt || new Date(connectionExpiresAt).getTime() <= Date.now();
  if (isExpired && refreshTokenValue) {
    const refreshed = await refreshIfNeeded(refreshTokenValue);
    if (!refreshed) return json({ error: "Failed to refresh Spotify token" }, 401);
    accessToken = refreshed.access_token;
    refreshTokenValue = refreshed.refresh_token;
    connectionExpiresAt = new Date(Date.now() + (refreshed.expires_in - 30) * 1000).toISOString();

    // Only when the connection is ours to update. A device-held pair has no
    // row here, and writing one would claim a connection the server was never
    // given; the refreshed tokens go back in the response instead.
    if (admin && !tokensFromBody) {
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
    const { profile, statuses } = await buildTasteProfile(accessToken);

    // Every call answered 403: the account is not on the Development-mode
    // allowlist, so there is no listening data to save. Report it instead of
    // upserting an empty profile that the app would mistake for a connected
    // user with an empty library. A single successful call is enough to
    // proceed as before.
    const statusList = Object.values(statuses);
    const allForbidden = statusList.length > 0 && statusList.every((status) => status === 403);
    if (allForbidden) {
      console.warn("⚠️ Spotify answered 403 to every taste call, account not on the app allowlist:", statuses);
      return json({
        error: "spotify_not_allowlisted",
        code: "spotify_not_allowlisted",
        spotify_status_summary: statuses,
      }, 403);
    }

    // Persisted for every caller, device-held tokens included: recommend-songs
    // falls back to this row when the client sends no taste with the scan, so
    // writing it is what makes matching work for a caller whose local cache
    // never reaches the server.
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
      // A device-held caller still gets its profile back: the copy that drives
      // its matches is the one on the phone, so a failed server write is a
      // degradation rather than a failure. A caller whose connection we hold
      // has nowhere else for the profile to live, so that one is a 500.
      if (!tokensFromBody) return json({ error: "Failed to save taste profile" }, 500);
    }

    if (!tokensFromBody) {
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

    // Device-held tokens: return the full profile so the client can cache it
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
    // Flat sentence to the caller. err.message here is a Spotify complaint or a
    // PostgREST message naming spotify_taste_profiles and its constraints,
    // neither of which the app can act on and both of which map our schema.
    console.error("❌ sync-spotify-profile error:", err);
    return json({ error: "Spotify sync is unavailable right now" }, 500);
  }
});
