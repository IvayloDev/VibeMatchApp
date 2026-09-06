// Artist search against Spotify's public catalog, authenticated with the app's
// own credentials (Client Credentials flow) rather than a user token.
//
// This is what keeps the in-app taste picker working while the Spotify app is
// in Development mode: catalog search is open to any registered app, only the
// per-user listening endpoints are gated behind the 5-account allowlist.
//
// POST { q: string, limit?: number }
//   -> 200 { artists: [{ id, name, genres: string[], image: string | null }] }
//   -> 400 { error } on a blank query, 429 when Spotify rate limits us,
//      502 { error } when Spotify or its token endpoint fails.
//
// Guests call this during onboarding, so it cannot require a JWT
// (verify_jwt = false in supabase/config.toml). Query length and result count
// are capped so the open endpoint cannot be used to hammer Spotify's quota.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

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

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 10;
const MAX_QUERY_LENGTH = 100;
// Treat the app token as expired this long before Spotify does, so a request
// never goes out with a token that dies in flight.
const TOKEN_EXPIRY_MARGIN_MS = 60 * 1000;

// Same shape as compactArtist in sync-spotify-profile, so a picked artist is
// indistinguishable from a Spotify-derived one downstream.
type CompactArtist = { id: string; name: string; genres: string[]; image: string | null };

// Module scope outlives a single request on a warm isolate, so one token
// serves many searches. A cold start simply fetches a fresh one.
let cachedToken: { value: string; expiresAt: number } | null = null;
// Concurrent searches on a cold isolate share one token request instead of
// each hitting the token endpoint.
let pendingToken: Promise<string> | null = null;

async function fetchAppToken(): Promise<string> {
  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("Spotify credentials are not configured");
  }

  const resp = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
  });
  if (!resp.ok) {
    console.error("Spotify app token request failed:", resp.status, await resp.text());
    throw new Error(`Spotify token request failed (${resp.status})`);
  }

  const data = await resp.json();
  if (typeof data?.access_token !== "string" || !data.access_token) {
    throw new Error("Spotify token response had no access_token");
  }
  const expiresInMs = (typeof data.expires_in === "number" ? data.expires_in : 3600) * 1000;
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + expiresInMs - TOKEN_EXPIRY_MARGIN_MS,
  };
  return cachedToken.value;
}

async function getAppToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (!pendingToken) {
    pendingToken = fetchAppToken().finally(() => {
      pendingToken = null;
    });
  }
  return pendingToken;
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

function searchSpotify(q: string, limit: number, token: string): Promise<Response> {
  const params = new URLSearchParams({ type: "artist", limit: String(limit), q });
  return fetch(`${SPOTIFY_SEARCH_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
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

  const q = typeof body?.q === "string" ? body.q.trim().slice(0, MAX_QUERY_LENGTH) : "";
  if (!q) {
    return json({ error: "Missing query" }, 400);
  }

  const rawLimit = Number(body?.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;

  try {
    let token = await getAppToken();
    let resp = await searchSpotify(q, limit, token);

    // A 401 on a cached token means Spotify invalidated it early. Drop the
    // cache and retry once with a fresh one before giving up.
    if (resp.status === 401) {
      cachedToken = null;
      token = await getAppToken();
      resp = await searchSpotify(q, limit, token);
    }

    if (resp.status === 429) {
      const retryAfterHeader = resp.headers.get("Retry-After");
      const retryAfter = retryAfterHeader === null ? NaN : Number(retryAfterHeader);
      return json({
        error: "Spotify is rate limiting searches, try again in a moment",
        retry_after: Number.isFinite(retryAfter) ? retryAfter : null,
      }, 429);
    }

    if (!resp.ok) {
      console.error("Spotify search failed:", resp.status, await resp.text());
      return json({ error: `Spotify search failed (${resp.status})` }, 502);
    }

    const data = await resp.json();
    const items: any[] = Array.isArray(data?.artists?.items) ? data.artists.items : [];
    const artists = items
      .map(compactArtist)
      .filter((a: CompactArtist) => a.id && a.name);

    return json({ artists });
  } catch (err: any) {
    console.error("spotify-search error:", err);
    return json({ error: err?.message ?? "Spotify search failed" }, 502);
  }
});
