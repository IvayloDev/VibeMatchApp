// Artist search against Spotify's public catalog, authenticated with the app's
// own credentials (Client Credentials flow) rather than a user token.
//
// This is what keeps the in-app taste picker working while the Spotify app is
// in Development mode: catalog search is open to any registered app, only the
// per-user listening endpoints are gated behind the 5-account allowlist.
//
// POST { q: string, limit?: number }
//   -> 200 { artists: [{ id, name, genres: string[], image: string | null }] }
// POST { suggest: { genres: string[], eras: string[], artists: string[] }, limit?: number }
//   -> 200 { artists: [...], basis: "artists" | "taste" | "none" }
//   Starter suggestions for the taste picker. With artists already picked
//   the model names similar ones and each is resolved on Spotify; with only
//   decades and genres, Spotify's catalog is searched by genre and year and
//   the artists behind the top tracks are returned.
//   -> 400 { error } on a blank query, 429 when Spotify rate limits us,
//      502 { error } when Spotify or its token endpoint fails.
//
// Guests call this during onboarding, so it cannot require a JWT
// (verify_jwt = false in supabase/config.toml). Query length and result count
// are capped so the open endpoint cannot be used to hammer Spotify's quota.

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

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 10;
const MAX_QUERY_LENGTH = 100;

// Per-IP ceiling on suggest, counted over the last hour in edge_call_log.
//
// The cost being defended is not tokens (gpt-4.1-mini at this prompt size is
// cents an hour even under sustained abuse) but the app's SHARED Spotify
// quota: suggest runs paged catalog searches, and one script hammering it
// degrades matching for every user of the app at once.
//
// Set high on purpose. Carrier-grade NAT puts many real phones behind one
// address, and a genuine taste-picker session is about ten calls including
// refreshes, so this has room for a dozen simultaneous strangers on the same
// mobile network while still stopping a script dead.
const SUGGEST_CALLS_PER_IP_PER_HOUR = 120;
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

function searchSpotify(q: string, limit: number, token: string, type = "artist"): Promise<Response> {
  const params = new URLSearchParams({ type, limit: String(limit), q });
  return fetch(`${SPOTIFY_SEARCH_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------- suggestions ----------

const SUGGEST_MAX = 8;
// Set when any Spotify call in a suggest request comes back 429, so the
// handler can log it once even though the helpers swallow failures.
const rateLimited: { hit: boolean; retryAfter: string | null } = { hit: false, retryAfter: null };
function noteStatus(resp: Response) {
  if (resp.status === 429) {
    rateLimited.hit = true;
    rateLimited.retryAfter = resp.headers.get("Retry-After");
  }
  return resp;
}
const ERA_RE = /^(19|20)\d0s$/;
const eraToYears = (era: string) => {
  const start = parseInt(era.slice(0, 4), 10);
  return `${start}-${start + 9}`;
};
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Artists behind the top Spotify tracks for each genre x decade pair. */
async function suggestFromTaste(genres: string[], eras: string[], token: string, page = 0): Promise<CompactArtist[]> {
  const years = eras.filter((e) => ERA_RE.test(e)).map(eraToYears);
  const queries: string[] = [];
  const gs = genres.length ? genres : [""];
  const ys = years.length ? years : [""];
  for (const g of gs) for (const y of ys) {
    const parts = [g ? `genre:"${g}"` : "", y ? `year:${y}` : ""].filter(Boolean);
    if (parts.length) queries.push(parts.join(" "));
  }
  if (queries.length === 0) return [];

  // Round-robin over the pairs so one genre does not crowd out the others.
  const perQuery: string[][] = await Promise.all(
    queries.slice(0, 6).map(async (q) => {
      // Each refresh reads the next page of tracks, so the artists change.
      const params = new URLSearchParams({ type: "track", limit: "10", offset: String(page * 10), q });
      const resp = noteStatus(await fetch(`${SPOTIFY_SEARCH_URL}?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } }));
      if (!resp.ok) return [];
      const data = await resp.json();
      const items: any[] = Array.isArray(data?.tracks?.items) ? data.tracks.items : [];
      return items.map((t) => t?.artists?.[0]?.id).filter((id: unknown): id is string => typeof id === "string");
    })
  );
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; ids.length < SUGGEST_MAX * 2; i++) {
    let any = false;
    for (const list of perQuery) {
      const id = list[i];
      if (id === undefined) continue;
      any = true;
      if (!seen.has(id)) { seen.add(id); ids.push(id); }
    }
    if (!any) break;
  }
  if (ids.length === 0) return [];

  const resp = noteStatus(await fetch(`https://api.spotify.com/v1/artists?ids=${ids.slice(0, 20).join(",")}`, {
    headers: { Authorization: `Bearer ${token}` },
  }));
  if (!resp.ok) return [];
  const data = await resp.json();
  const artists: any[] = Array.isArray(data?.artists) ? data.artists : [];
  return artists.map(compactArtist).filter((a) => a.id && a.name);
}

/** Similar-artist names from the model, each resolved on Spotify. */
async function suggestFromArtists(artists: string[], genres: string[], eras: string[], token: string, excludeNames: string[] = []): Promise<CompactArtist[]> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return [];
  const prompt = `A listener likes these artists: ${artists.join(", ")}.${genres.length ? ` Genres they picked: ${genres.join(", ")}.` : ""}${eras.length ? ` Decades they picked: ${eras.join(", ")}.` : ""}
Name 12 other artists they would probably love: contemporaries, influences, label-mates, proteges. Mix well-known and less obvious. Never repeat an artist they already listed.${excludeNames.length ? ` They have already seen and passed on these, do not suggest them: ${excludeNames.join(", ")}.` : ""} Return JSON: {"artists": ["Name", ...]} with canonical artist names only.`;
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: excludeNames.length ? 0.9 : 0.6,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) {
    console.error("suggest: OpenAI failed", resp.status, await resp.text());
    return [];
  }
  const data = await resp.json();
  let names: string[] = [];
  try {
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
    names = Array.isArray(parsed?.artists) ? parsed.artists.filter((n: unknown) => typeof n === "string") : [];
  } catch { names = []; }
  const already = new Set([...artists, ...excludeNames].map(norm));
  names = names.filter((n) => !already.has(norm(n))).slice(0, 12);

  const resolved = await Promise.all(
    names.map(async (name) => {
      const r = noteStatus(await searchSpotify(name, 1, token));
      if (!r.ok) return null;
      const d = await r.json();
      const a = compactArtist(d?.artists?.items?.[0]);
      // Only keep it when Spotify's top hit really is that artist.
      if (!a.id || !a.name || norm(a.name) !== norm(name)) return null;
      return a;
    })
  );
  const out: CompactArtist[] = [];
  const seen = new Set<string>();
  for (const a of resolved) {
    if (a && !seen.has(a.id) && !already.has(norm(a.name))) { seen.add(a.id); out.push(a); }
  }
  return out;
}

/**
 * Count and record one metered call. Returns true when the caller is over the
 * ceiling. Fails OPEN: if the ledger cannot be read, a real user must not be
 * blocked because our own bookkeeping is down.
 */
async function overSuggestLimit(ip: string | null): Promise<boolean> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (!serviceKey || !url || !ip) return false;
  try {
    const sb = createClient(url, serviceKey);
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await sb
      .from("edge_call_log")
      .select("id", { count: "exact", head: true })
      .eq("fn", "spotify-search")
      .eq("ip", ip)
      .gt("created_at", since);
    if ((count ?? 0) >= SUGGEST_CALLS_PER_IP_PER_HOUR) {
      console.warn(`🚫 suggest ceiling hit for ip=${ip} count=${count}`);
      return true;
    }
    // Fire and forget: the count above is what gates, and waiting on the write
    // would put a round trip in front of every suggestion.
    sb.from("edge_call_log")
      .insert({ fn: "spotify-search", mode: "suggest", ip })
      .then(({ error }) => {
        if (error) console.warn("edge_call_log insert failed:", error.message);
      });
    return false;
  } catch (err) {
    console.warn("suggest ceiling check failed, allowing:", err);
    return false;
  }
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

  // Suggestion mode: no free-text query, the picks are the input.
  if (body?.suggest && typeof body.suggest === "object") {
    const clientIp = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
      || req.headers.get("cf-connecting-ip")
      || null;
    if (await overSuggestLimit(clientIp)) {
      return json({
        error: "Too many suggestion requests",
        code: "rate_limited",
      }, 429);
    }
    const strs = (v: unknown, cap: number) =>
      (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 60)).filter(Boolean).slice(0, cap);
    const genres = strs(body.suggest.genres, 3);
    const eras = strs(body.suggest.eras, 3);
    const artists = strs(body.suggest.artists, 6);
    rateLimited.hit = false;
    rateLimited.retryAfter = null;
    // Refresh: ids (Spotify) and names already shown, plus which page to read.
    const excludeIds = new Set(strs(body.suggest.exclude, 60));
    const rawPage = Number(body.suggest.page);
    const page = Number.isFinite(rawPage) ? Math.min(5, Math.max(0, Math.floor(rawPage))) : 0;
    const rawLimit = Number(body?.limit);
    const limit = Number.isFinite(rawLimit) ? Math.min(SUGGEST_MAX, Math.max(1, Math.floor(rawLimit))) : SUGGEST_MAX;
    try {
      const token = await getAppToken();
      const exclude = new Set(artists.map(norm));
      const fresh = (a: CompactArtist) => !exclude.has(norm(a.name)) && !excludeIds.has(a.id);
      if (rateLimited.hit) {
        console.error("SPOTIFY_RATE_LIMITED mode=suggest retry_after=" + (rateLimited.retryAfter ?? "unknown"));
      }
      if (artists.length > 0) {
        const excludeNames = strs(body.suggest.excludeNames, 60);
        const out = (await suggestFromArtists(artists, genres, eras, token, excludeNames)).filter(fresh);
        if (out.length > 0) return json({ artists: out.slice(0, limit), basis: "artists" });
      }
      if (genres.length > 0 || eras.length > 0) {
        const out = (await suggestFromTaste(genres, eras, token, page)).filter(fresh);
        return json({ artists: out.slice(0, limit), basis: out.length ? "taste" : "none" });
      }
      return json({ artists: [], basis: "none" });
    } catch (err: any) {
      console.error("spotify-search suggest error:", err);
      return json({ error: err?.message ?? "Suggestions failed" }, 502);
    }
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
      // Greppable in the Supabase function logs: this is the app hitting
      // Spotify's per-app quota, which is shared across all users.
      console.error("SPOTIFY_RATE_LIMITED mode=search retry_after=" + (retryAfterHeader ?? "unknown"));
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
