import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

console.log("🔔 Edge Function loaded");

// Helpers
const jsonResponse = (body: any, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json"
  }
});

/**
 * Fetch an image by URL and convert it to a base64 data URL.
 */
async function toBase64DataURL(url: string): Promise<string> {
  const resp = await fetch(url);
  console.log("🖼 Image fetch status:", resp.status);
  if (!resp.ok) {
    throw new Error(`Failed to fetch image: ${resp.status}`);
  }
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  const mime = url.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${b64}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000; // avoid blowing the argument limit on large images
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Guest uploads live at anonymous/<uuid>/<uuid>.jpg. The nested random uuid is
 * what keeps the object unreachable: `anon` has INSERT-only on the bucket and
 * cannot list, so the path is the capability. The old flat anonymous/<ms>.jpg
 * scheme is deliberately NOT accepted - a 13-digit timestamp is guessable, and
 * accepting it would turn this function into an enumeration oracle.
 */
const GUEST_IMAGE_PATH =
  /^anonymous\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

/**
 * Decide whether a caller may have this object read on their behalf.
 *
 * The service-role client below bypasses RLS, so without this check the
 * function would hand anyone who can guess a path a read primitive over the
 * whole bucket - re-opening, through the back door, the hole the storage
 * policies just closed. Signed-in callers get their own folder; guests get
 * only their own unguessable guest path.
 */
function isAllowedImagePath(path: string, userId?: string): boolean {
  if (!path || path.includes("..") || path.startsWith("/")) return false;
  if (userId && path.startsWith(`${userId}/`)) return true;
  return GUEST_IMAGE_PATH.test(path);
}

/**
 * Read an object out of the `images` bucket with the service role and return it
 * as a base64 data URL. Guests have no session and no read policy, so the
 * client can no longer mint a signed URL itself - the server does it here.
 */
async function storagePathToBase64DataURL(path: string): Promise<string> {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    ?? Deno.env.get('SERVICE_ROLE_KEY')
    ?? '';
  if (!serviceKey) throw new Error("Service role key not configured");

  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey);
  const { data, error } = await sb.storage.from('images').download(path);
  if (error || !data) {
    throw new Error(`Failed to download image: ${error?.message ?? 'no data'}`);
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  const mime = path.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/**
 * Get Spotify access token using client credentials
 */
async function getSpotifyToken(): Promise<string> {
  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID");
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET");
  
  if (!clientId || !clientSecret) {
    console.warn("⚠️ Spotify credentials not configured");
    return "";
  }

  try {
    const authString = btoa(`${clientId}:${clientSecret}`);
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${authString}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(
        "❌ Spotify token request failed:",
        response.status,
        errBody?.slice(0, 800)
      );
      return "";
    }

    const data = await response.json();
    if (!data.access_token) {
      console.error("❌ Spotify token response missing access_token:", JSON.stringify(data)?.slice(0, 500));
      return "";
    }
    return data.access_token;
  } catch (err) {
    console.error("❌ Error getting Spotify token:", err);
    return "";
  }
}

/**
 * Search Spotify for a specific track using title and artist
 * Returns the best match or null
 */
/** Summarize Spotify search JSON for logs (avoids dumping huge payloads). */
/** Tracks last Spotify Search API HTTP status across lookups (for auth vs “no results”). */
type SpotifySearchState = { lastHttpStatus?: number };

function isSpotifyAuthFailure(status?: number): boolean {
  return status === 401 || status === 403;
}

/**
 * Strip "(feat...)", "(Live)", "[Remastered]", " - Radio Edit" etc. from a title
 * or artist so decorated names still resolve on Spotify. Belt-and-suspenders
 * alongside the CANONICAL TITLES prompt rule.
 */
function stripDecor(s: string): string {
  return (s || "")
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "")
    .replace(/\s+-\s+(feat\.?|ft\.?|with|live|remaster(ed)?|deluxe|radio edit|single version).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pick the best Spotify track for a title/artist. Requires a genuine title match
 * (>=20) AND some artist match (>=30), so we never return a different song by the
 * right artist when the exact title isn't on Spotify.
 */
/**
 * Fold a title/artist down to comparable words.
 *
 * Raw string comparison rejects far too much: Spotify ships "Don't Stop Me Now
 * - Remastered 2011", "Beat It (Single Version)", "Bohemien Rhapsody" with
 * accents, and "Tom & Jerry" where the model wrote "and". None of those are
 * substrings of what the model asked for, so a plain includes() check drops a
 * perfectly correct track.
 */
function normalizeForMatch(value: string): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // strip diacritics
    .replace(/\s*[([][^)\]]*[)\]]/g, " ")               // "(Remastered)", "[Live]"
    .replace(/\s+-\s+.*$/, " ")                          // " - Radio Edit", " - 2011 Mix"
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")                         // punctuation, apostrophes
    .trim()
    .replace(/\s+/g, " ");
}

/** Shared words as a fraction of the shorter side. 1 = one side contains all of the other's words. */
function tokenOverlap(a: string, b: string): number {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / Math.min(left.size, right.size);
}

/**
 * Pick the Spotify track that really is the requested song, or nothing.
 *
 * The point of the gate is that a hallucinated title must NOT silently resolve
 * to a different song by the right artist - that used to happen and shipped
 * wrong (occasionally explicit) tracks. That guarantee is kept: a title with no
 * word overlap still scores 0 and is rejected.
 *
 * What changed is tolerance for formatting. Comparison now happens on
 * normalized forms and accepts strong word overlap, so remaster suffixes,
 * accents, "&" vs "and" and apostrophes no longer throw away a correct match
 * and push the whole request toward a "No matches found" 404.
 *
 * Ties break toward the more popular track, which favours the canonical studio
 * cut over a random live or karaoke upload.
 */
function bestTrackMatch(tracks: any[], normTitle: string, normArtist: string): any | null {
  const wantTitle = normalizeForMatch(normTitle);
  const wantArtist = normalizeForMatch(normArtist);

  let best: any = null;
  let bestScore = 0;

  for (const track of tracks) {
    const rawTitle = track.name?.toLowerCase().trim() || "";
    // No early return on an exact raw hit: Spotify search often lists a live or
    // karaoke upload above the studio original, and returning the first exact
    // string match picked those. Scoring every candidate lets the popularity
    // tie-break below choose the canonical recording.
    const gotTitle = normalizeForMatch(rawTitle);
    // Any credited artist may be the match - the model often names the featured
    // artist, and Spotify only puts one of them first.
    const gotArtists: string[] = (track.artists || [])
      .map((a: any) => normalizeForMatch(a?.name || ""))
      .filter(Boolean);

    let titleScore = 0;
    if (gotTitle && gotTitle === wantTitle) titleScore = 40;
    else if (gotTitle && wantTitle && (gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle))) titleScore = 25;
    else if (tokenOverlap(gotTitle, wantTitle) >= 0.6) titleScore = 20;

    let artistScore = 0;
    for (const got of gotArtists) {
      let candidate = 0;
      if (got === wantArtist) candidate = 60;
      else if (wantArtist && (got.includes(wantArtist) || wantArtist.includes(got))) candidate = 35;
      else if (tokenOverlap(got, wantArtist) >= 0.5) candidate = 30;
      if (candidate > artistScore) artistScore = candidate;
    }

    if (titleScore < 20 || artistScore < 30) continue; // still demand a real title + artist match

    const score = titleScore + artistScore;
    const popularity = track.popularity ?? 0;
    if (score > bestScore || (score === bestScore && popularity > (best?.popularity ?? -1))) {
      bestScore = score;
      best = track;
    }
  }
  return best;
}

function spotifyAuthErrorResponse() {
  return jsonResponse({
    error: "Spotify API error",
    code: "SPOTIFY_AUTH",
    message:
      "Music search is temporarily unavailable. If this continues, Spotify credentials on the server may need to be updated."
  }, 503);
}

/** Parse Spotify Web API error JSON: { "error": { "status": number, "message": string } } */
function parseSpotifyApiErrorBody(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: string; status?: number } };
    if (j?.error?.message) {
      return `${j.error.status ?? "?"}: ${j.error.message}`;
    }
  } catch {
    /* not JSON */
  }
  return text?.slice(0, 500) ?? "";
}

function logSpotifySearchApiResponse(
  phase: "primary" | "fallback",
  response: Response,
  data: Record<string, unknown>
) {
    const tracks = (data as { tracks?: { total?: number; items?: unknown[] } })?.tracks;
    const items = tracks?.items ?? [];
    const preview = items.slice(0, 5).map((t: any) => ({
      id: t?.id,
      name: t?.name,
      artist: t?.artists?.[0]?.name
    }));
    console.log(
      `🎵 Spotify API response [${phase}] http=${response.status} total=${tracks?.total ?? "?"} items=${items.length} preview=`,
      JSON.stringify(preview)
    );
}

/**
 * fetch with retry on transient Spotify failures (5xx, 429).
 * Up to 3 attempts: 0ms, 400ms, 1200ms backoff.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const delays = [0, 400, 1200];
  let lastResponse: Response | null = null;
  for (const ms of delays) {
    if (ms > 0) await new Promise(r => setTimeout(r, ms));
    const resp = await fetch(url, init);
    if (resp.status < 500 && resp.status !== 429) return resp;
    lastResponse = resp;
    console.warn(`↻ Spotify ${resp.status} — retrying after ${ms}ms backoff`);
  }
  return lastResponse!;
}

async function findTrackOnSpotify(
  title: string, 
  artist: string, 
  searchQuery: string,
  accessToken: string,
  state?: SpotifySearchState
): Promise<any | null> {
  try {
    // Strip decorations (feat./Live/Remastered/...) so decorated titles resolve.
    title = stripDecor(title);
    artist = stripDecor(artist);
    // Always build the query ourselves — never trust AI-generated search_query
    // (AI occasionally corrupts it with JSON syntax artifacts)
    let query = `track:"${title}" artist:"${artist}"`;
    let encodedQuery = encodeURIComponent(query);
    const primarySearchUrl = `https://api.spotify.com/v1/search?q=${encodedQuery}&type=track&limit=10`;
    console.log("🎵 Spotify search [primary] query:", query, "| encoded q param:", encodedQuery, "| url:", primarySearchUrl);

    let response = await fetchWithRetry(primarySearchUrl, {
      headers: {
        "Authorization": `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      if (state) state.lastHttpStatus = response.status;
      const errText = await response.text();
      const detail = parseSpotifyApiErrorBody(errText);
      if (response.status === 403 || response.status === 401) {
        console.error(
          `❌ Spotify search ${response.status} for "${title}" by "${artist}" — ${detail}`,
          "\n→ Fix: Supabase Edge secrets SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET must match https://developer.spotify.com/dashboard (same app). 403 often means wrong secret, revoked app, or Developer Terms not accepted."
        );
      } else {
        console.warn(
          `⚠️ Spotify search failed for "${title}" by "${artist}":`,
          response.status,
          detail || errText?.slice(0, 500)
        );
      }
      return null;
    }

    const data = await response.json();
    logSpotifySearchApiResponse("primary", response, data);
    const tracks = data.tracks?.items || [];

    if (tracks.length === 0) {
      // Fallback: try without quotes (fuzzy search)
      query = `${title} ${artist}`;
      encodedQuery = encodeURIComponent(query);
      const fallbackSearchUrl = `https://api.spotify.com/v1/search?q=${encodedQuery}&type=track&limit=10`;
      console.log("🎵 Spotify search [fallback] query:", query, "| encoded q param:", encodedQuery, "| url:", fallbackSearchUrl);

      response = await fetchWithRetry(fallbackSearchUrl, {
        headers: {
          "Authorization": `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        if (state) state.lastHttpStatus = response.status;
        const errText = await response.text();
        const detail = parseSpotifyApiErrorBody(errText);
        if (response.status === 403 || response.status === 401) {
          console.error("❌ Spotify search [fallback]", response.status, detail);
        } else {
          console.warn("⚠️ Spotify search [fallback] failed:", response.status, detail || errText?.slice(0, 500));
        }
        return null;
      }

      const fallbackData = await response.json();
      logSpotifySearchApiResponse("fallback", response, fallbackData);
      const fallbackTracks = fallbackData.tracks?.items || [];
      
      if (fallbackTracks.length === 0) {
        return null;
      }
      
      // Apply same strict matching to fallback results
      const normalizedTitle = title.toLowerCase().trim();
      const normalizedArtist = artist.toLowerCase().trim();

      const fallbackMatch = bestTrackMatch(fallbackTracks, normalizedTitle, normalizedArtist);
      if (fallbackMatch) {
        console.log(`✅ Found fallback match for "${title}" by "${artist}": "${fallbackMatch.name}" by "${fallbackMatch.artists[0]?.name}"`);
        return fallbackMatch;
      }
      console.warn(`⚠️ No good fallback match for "${title}" by "${artist}" (needs real title + artist match)`);
      return null;
    }

    // Find best match by comparing title and artist similarity
    const normalizedTitle = title.toLowerCase().trim();
    const normalizedArtist = artist.toLowerCase().trim();

    const primaryMatch = bestTrackMatch(tracks, normalizedTitle, normalizedArtist);
    if (primaryMatch) {
      console.log(`✅ Found match for "${title}" by "${artist}": "${primaryMatch.name}" by "${primaryMatch.artists[0]?.name}"`);
      return primaryMatch;
    }
    console.warn(`⚠️ No good match for "${title}" by "${artist}" (needs real title + artist match)`);
    return null;
  } catch (err) {
    console.error(`❌ Error searching Spotify for "${title}" by "${artist}":`, err);
    return null;
  }
}

/**
 * Translate Bulgarian (both Latin and Cyrillic) to English search terms
 */
function translateBulgarianToSearchQuery(text: string): string[] {
  // Cyrillic to Latin mappings (expanded)
  const cyrillicToLatin: Record<string, string> = {
    "някоя": "nqkoq",
    "няква": "nqkva",
    "някой": "nqkoi",
    "песен": "pesen",
    "мазна": "mazna",
    "мазно": "mazno",
    "чалга": "chalga",
    "чалги": "chalgi",
    "филмарска": "filmarska",
    "филмарски": "filmarski",
    "дай": "dai",
    "дайте": "daite",
    "много": "mnogo",
    "множество": "mnozhestvo",
  };

  // Latin to English mappings
  const latinToEnglish: Record<string, string> = {
    "filmarska pesen": "cinematic song",
    "filmarska": "cinematic",
    "pesen": "song",
    "chalga": "chalga",
    "mazna": "energetic",
    "nqkoq": "",
    "nqkva": "",
    "mnogo": "very",
    "dai": "",
    "molq": "",
  };

  let query = text.toLowerCase().trim();
  
  // Convert Cyrillic to Latin first
  for (const [cyr, lat] of Object.entries(cyrillicToLatin)) {
    if (query.includes(cyr)) {
      query = query.replace(new RegExp(cyr, 'gi'), lat).trim();
    }
  }
  
  // Then translate Latin to English
  for (const [lat, en] of Object.entries(latinToEnglish)) {
    if (query.includes(lat)) {
      query = query.replace(new RegExp(lat, 'gi'), en).trim();
    }
  }
  
  query = query.replace(/\s+/g, ' ').trim();
  
  const queries: string[] = [];
  if (query.length >= 3) {
    queries.push(query);
  }
  
  if (query.includes("chalga")) {
    queries.push("chalga");
    queries.push("bulgarian chalga");
  }
  if (query.includes("cinematic") || query.includes("film")) {
    queries.push("cinematic music");
    queries.push("film soundtrack");
  }
  
  return queries.length > 0 ? queries : [text.trim()];
}

// Mirrors ERA_TAG_PREFIX in lib/taste.ts. Chosen decades travel inside
// top_genres because spotify_taste_profiles has no column of its own for them.
const ERA_TAG_PREFIX = "era:";

type TasteProfile = {
  top_artists?: Array<{ name: string; genres?: string[] }>;
  top_tracks?: Array<{ name: string; artist: string }>;
  recently_played?: Array<{ name: string; artist: string }>;
  saved_tracks?: Array<{ name: string; artist: string }>;
  top_genres?: string[];
  // 'manual' = picked by hand in the app's taste picker. Absent or 'spotify' =
  // derived from Spotify listening data, where genres are auto-tagged noise.
  source?: string;
};

const isManualTaste = (profile: TasteProfile | null | undefined) => profile?.source === "manual";

/**
 * Format a compact taste-profile block for the LLM prompt.
 * Order matters: lead with high-intent signals (saved + top artists), end with
 * the noisiest one (top_genres) so the model doesn't anchor on a transient
 * genre tag from a short listening window.
 */
function buildTasteBlock(profile: TasteProfile | null): string {
  if (!profile) return "";

  const saved = (profile.saved_tracks ?? []).slice(0, 20).map((t) => `${t.name} — ${t.artist}`);
  const artists = (profile.top_artists ?? []).slice(0, 25).map((a) => a.name);
  const tracks = (profile.top_tracks ?? []).slice(0, 20).map((t) => `${t.name} — ${t.artist}`);
  const recent = (profile.recently_played ?? []).slice(0, 15).map((t) => `${t.name} — ${t.artist}`);
  // The in-app picker has no era column to write to, so it tags chosen decades
  // into top_genres as "era:1980s" (see ERA_TAG_PREFIX in lib/taste.ts). Split
  // them back out: a decade the user chose deliberately is a strong signal and
  // must not sit in the deliberately-downweighted genre line.
  const allGenres = (profile.top_genres ?? []).filter((g) => typeof g === "string");
  const eras = allGenres
    .filter((g) => g.startsWith(ERA_TAG_PREFIX))
    .map((g) => g.slice(ERA_TAG_PREFIX.length))
    .filter(Boolean)
    .slice(0, 5);
  const genres = allGenres.filter((g) => !g.startsWith(ERA_TAG_PREFIX)).slice(0, 10);

  const parts: string[] = [];
  if (saved.length) parts.push(`Saved (high-intent — songs they chose to keep): ${saved.join("; ")}`);
  if (artists.length) parts.push(`Most-listened artists: ${artists.join(", ")}`);
  if (tracks.length) parts.push(`Most-listened tracks: ${tracks.join("; ")}`);
  if (recent.length) parts.push(`Currently in rotation: ${recent.join("; ")}`);
  if (eras.length) parts.push(`Decades they chose (deliberate, high-intent): ${eras.join(", ")}`);
  if (genres.length) {
    // A genre typed into the picker is a choice; a genre Spotify auto-tagged
    // from one week of listening is a hint. Label them so the model weights
    // them differently.
    parts.push(
      isManualTaste(profile)
        ? `Genres they chose (deliberate, high-intent): ${genres.join(", ")}`
        : `Spotify-tagged genres (noisy hint - derived from listening, can be skewed by short binges): ${genres.join(", ")}`
    );
  }

  if (parts.length === 0) return "";
  return parts.join("\n");
}

function buildTasteGuidance(hasTaste: boolean, manual: boolean = false): string {
  if (!hasTaste) return "";
  if (manual) {
    // Picker profiles are short and every line in them was typed on purpose.
    // Without this branch the model reads "rock, 1990s" through the Spotify
    // rules below, treats the genre as noise, and answers the vibe alone: the
    // same two songs for every sunset regardless of what the user chose.
    return `\n\nUSER MUSIC TASTE - READ THIS CAREFULLY:
- The user typed this profile by hand in the app. Every decade, genre and artist listed is a deliberate choice, not a listening statistic. There is no noise in it.
- CHOSEN DECADES AND GENRES ARE A HARD PREFERENCE. Position 1 MUST be a track released in one of the chosen decades AND belonging to one of the chosen genres (or a direct subgenre of it). At least 4 of the 6 picks must satisfy both. The remaining picks may stretch one of the two, never both.
- "Released in the decade" means the original release year. A 2019 record that sounds like 1994 is not a 1990s pick; put those in the stretch slots only.
- Chosen artists are anchors: pick contemporaries, label-mates, influences or proteges of those artists, never the artists themselves.
- The image mood and the chosen vibe decide WHICH tracks from that space fit; they never override the decade or the genre. If the image is a sunset and the user chose 1990s rock, the answer is a 1990s rock song that feels like a sunset, not a sunset song from another era.
- DISCOVERY IS THE PRODUCT: never pick an artist listed in the profile. Surface songs the user probably has not heard but will recognise as their kind of thing.
- A pick is GREAT when a friend who knows the user's taste would say "of course, this is so them" while also "wait, how did you find this?"`;
  }
  return `\n\nUSER MUSIC TASTE — READ THIS CAREFULLY:
- The user's Spotify listening profile is provided below. Treat it as their SONIC DNA, not a genre filter.
- "Sonic DNA" = the production style, instrumentation, vocal qualities, mood, era, rhythmic feel, and lyrical sensibility that runs through their saved tracks and top artists.
- DO NOT anchor on top_genres alone. Spotify's auto-tagged genres reflect short listening windows and can be a temporary obsession (e.g. one week of italo-disco does not make someone an italo-disco listener). Use genres only as one weak signal among many.
- Weight signals: saved tracks > top artists > chosen decades > top tracks > recently played > top_genres. Saved and hand-chosen decades = high intent. Auto-tagged genres = lowest weight.
- WHEN DECADES ARE LISTED, THEY ARE A HARD PREFERENCE: the user picked them by hand. Draw the majority of picks from those decades, or from records that unmistakably wear that decade's production. A 2024 synthwave record is a legitimate answer for someone who chose the 1980s; a 2024 hyperpop record is not. If a decade genuinely cannot carry the image's mood, you may reach outside it for at most one of the six picks.
- Cross-genre is fine and encouraged: if a folk listener saves moody electronic tracks, electronic is in-bounds. Trust the audible patterns over the tag.
- DISCOVERY IS THE PRODUCT: EVERY one of the 6 picks must be an artist NOT listed anywhere in the user's profile (not in saved, top tracks, recently-played, or top artists). Zero exceptions. Surface adjacent artists, label-mates, contemporaries, influences, or proteges of artists they already love - songs they probably haven't heard but will recognize as "their kind of thing."
- Do NOT reach for a "deep cut" from an artist they already listen to. A track the user could have surfaced themselves is a failed pick, however well it fits.
- The image mood + chosen vibe set the emotional anchor. The user's sonic DNA shapes which adjacent musical space we draw from. They are weighted equally — neither should override the other.
- A pick is GREAT when a friend who knows the user's taste would say "of course, this is so them" while also "wait, how did you find this?"`;
}

/**
 * Build system prompt based on mode
 */
function buildSystemPrompt(
  avoidTracks: string[],
  avoidArtists: string[],
  hasTaste: boolean = false,
  manualTaste: boolean = false
): string {
  const avoidSection = avoidTracks.length > 0 || avoidArtists.length > 0
    ? `\n\nAVOID THESE (do not recommend):\n${avoidTracks.length > 0 ? `- Tracks: ${avoidTracks.join(", ")}\n` : ""}${avoidArtists.length > 0 ? `- Artists: ${avoidArtists.join(", ")}\n` : ""}`
    : "";

  const tasteGuidance = buildTasteGuidance(hasTaste, manualTaste);

  return `You are VibeMatch, a personalized music curator. You combine the visual/emotional read of an image with the user's overall sonic taste to surface songs they'll love — including ones they haven't discovered yet.${tasteGuidance}

Hard rules:
- Output MUST be valid JSON matching the schema. No extra text.
- Recommend exactly 6 tracks (no more, no less) — we need extras as fallbacks in case some can't be found on Spotify.
- RANKING IS CRITICAL: Sort recommendations from BEST to WORST match. Position 1 must be the single most on-point pick that best combines the image mood + chosen vibe with the user's sonic DNA. Positions 2-3 are strong alternatives. Positions 4-6 are good fallbacks.
- No repeated artist (each track must have a different artist).
- Avoid ultra-mainstream, over-recommended staples and viral overplayed hits. Banned examples (do not pick these or their obvious equivalents): Mr. Brightside, Bohemian Rhapsody, Heat Waves, Blinding Lights, Physical (Dua Lipa), Shut Up and Dance, Sweater Weather, Riptide. If a track has been a TikTok/playlist default or has billions of streams, skip it.
- Ensure diversity: at least 3 distinct subgenres OR eras across the 6 tracks. Cross-genre picks are welcomed when the sonic DNA fits.
- STRICT NO-REPEAT: do NOT recommend any track or artist that appears anywhere in the user's saved/top/recently-played/top-artists lists. All 6 must be artists they have NOT listened to. A repeat is an automatic failure - find adjacent, undiscovered music instead.
- Only suggest songs you are confident exist (title + primary artist).
- CANONICAL TITLES ONLY: put the plain studio title in "title" and the primary artist in "artist". No "(feat. ...)", "(Live)", "(Remastered)", "(Deluxe)", "(Radio Edit)" or similar suffixes - they break music-service lookup.
- IMPORTANT: Recommend ONLY international (primarily English) songs. DO NOT recommend Bulgarian/chalga/BG music unless the image or context explicitly shows Bulgarian content or culture. Default to English-language music.
${avoidSection}

Return JSON with this structure:
{
  "recommendations": [
    {
      "title": "REAL song title",
      "artist": "REAL artist name",
      "reason": "2-3 sentences. START by naming what is actually in the photo - the concrete scene and its mood (e.g. 'A foggy harbor at dusk, still and a little lonely...'). THEN connect that to a specific sonic-DNA trait of the user (e.g. 'shares the dusty, lo-fi warmth of your saved [Artist] tracks'). For discovery picks, name the bridge to a listed artist or production trait, not a genre tag.",
      "mood_tags": ["tag1", "tag2", "tag3"],
      "search_query": "track:\\"Song Title\\" artist:\\"Artist Name\\""
    }
  ]
}`;
}

const VIBE_GUIDANCE: Record<string, string> = {
  hype: "energetic, upbeat, high-BPM, anthemic — fits party / workout / going-out content",
  chill: "relaxed, laid-back, mellow, easy-listening — fits hangouts / coffee / vibey daytime",
  romantic: "soft, intimate, warm, swooning — fits sunsets / love / tender moments",
  moody: "melancholic, deep, introspective, nocturnal — fits night / pensive / cinematic feel",
};

/**
 * Build user prompt
 */
function buildUserPrompt(params: { vibe?: string }): string {
  const { vibe } = params;
  const vibeKey = vibe?.toLowerCase().trim();
  const guidance = vibeKey ? VIBE_GUIDANCE[vibeKey] : undefined;

  if (vibe && guidance) {
    return `The user picked the "${vibe}" vibe for their social-media story photo (${guidance}).

Analyze the image and recommend 6 songs that match this vibe AND complement the photo's atmosphere, color palette, and implied story. Lean into the emotional tone of the vibe. Prefer unexpected-but-accurate picks over obvious hits.
IMPORTANT: Recommend ONLY international (primarily English) songs. DO NOT recommend Bulgarian/chalga/BG music.`;
  }

  return `Analyze the image and recommend 6 songs that match the atmosphere, color palette, energy, and implied story. Prefer unexpected-but-accurate picks over obvious hits.
IMPORTANT: Recommend ONLY international (primarily English) songs. DO NOT recommend Bulgarian/chalga/BG music.`;
}

// Edge function
serve(async (req) => {
  console.log("🔔 Invocation start");

  // 0) Try to get user from Authorization header (if present)
  let userId: string | undefined;
  const authHeader = req.headers.get('Authorization');
  
  if (authHeader) {
    try {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        {
          global: {
            headers: {
              Authorization: authHeader,
            },
          },
        }
      );
      
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
      if (!userError && user) {
        userId = user.id;
        console.log("✅ Authenticated user:", userId);
      } else {
        console.log("ℹ️ No user from auth header (guest user)");
      }
    } catch (err) {
      console.warn("⚠️ Error getting user from auth header:", err);
      // Continue as guest user
    }
  } else {
    console.log("ℹ️ No Authorization header (guest user)");
  }

  // 1) Parse incoming JSON
  let imageUrl: string;
  let imagePath: string | undefined;
  let vibe: string | undefined;
  let avoidTracks: string[] = [];
  let avoidArtists: string[] = [];
  let tasteProfile: TasteProfile | null = null;

  try {
    const body = await req.json();
    imageUrl = body.imageUrl;
    imagePath = typeof body.imagePath === "string" ? body.imagePath : undefined;
    vibe = typeof body.vibe === "string" ? body.vibe : undefined;
    // Only use userId from body if we didn't get it from auth header
    if (!userId) {
      userId = body.userId;
    }
    avoidTracks = body.avoidTracks || [];
    avoidArtists = body.avoidArtists || [];
    // Guest taste profile may be passed inline from the client
    if (body.tasteProfile && typeof body.tasteProfile === "object") {
      tasteProfile = body.tasteProfile as TasteProfile;
    }

    console.log("📥 Body:", {
      imageUrl: imageUrl ? `${imageUrl.substring(0, 50)}...` : 'N/A',
      imagePath: imagePath || 'N/A',
      vibe,
      userId: userId || 'N/A',
      avoidTracks: avoidTracks.length,
      avoidArtists: avoidArtists.length
    });

    if (!imagePath && !imageUrl) {
      return jsonResponse({
        error: "imagePath is required"
      }, 400);
    }

    // imagePath is the path clients use now. Reject anything the caller has no
    // business reading before the service-role download below ever runs.
    if (imagePath && !isAllowedImagePath(imagePath, userId)) {
      console.warn("🚫 Rejected imagePath:", imagePath, "userId:", userId || 'guest');
      return jsonResponse({
        error: "Forbidden image path"
      }, 403);
    }
  } catch (err) {
    console.error("❌ Bad request JSON:", err);
    return jsonResponse({
      error: "Bad request JSON"
    }, 400);
  }

  // 2) Get user history for deduplication (if userId provided)
  if (userId) {
    try {
      // Service role so RLS (auth.uid() = user_id) doesn't block the lookup — an
      // unauthenticated anon client reads zero rows and silently disables dedup.
      const historyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        ?? Deno.env.get('SERVICE_ROLE_KEY')
        ?? Deno.env.get('SUPABASE_ANON_KEY')
        ?? '';
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        historyKey
      );

      const { data: history } = await supabaseClient
        .from('history')
        .select('songs')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10); // Last 10 recommendations

      if (history && history.length > 0) {
        const allSongs: any[] = [];
        history.forEach(item => {
          if (item.songs && Array.isArray(item.songs)) {
            allSongs.push(...item.songs);
          }
        });

        // Readable "Title — Artist" strings so the model can actually avoid past
        // picks (opaque Spotify IDs meant nothing to it), plus artist names.
        const seenTracks = new Set<string>();
        const seenArtists = new Set<string>();

        allSongs.forEach((song: any) => {
          if (song.title && song.artist) seenTracks.add(`${song.title} — ${song.artist}`);
          if (song.artist) seenArtists.add(song.artist);
        });

        avoidTracks = [...avoidTracks, ...Array.from(seenTracks)];
        avoidArtists = [...avoidArtists, ...Array.from(seenArtists)];

        console.log(`📋 Found ${avoidTracks.length} tracks and ${avoidArtists.length} artists to avoid`);
      }
    } catch (err) {
      console.warn("⚠️ Could not fetch user history:", err);
      // Continue without history
    }

    // 2b) Load Spotify taste profile from DB (if not already passed inline)
    // Use service role so RLS (auth.uid() = user_id) doesn't block the lookup.
    if (!tasteProfile) {
      try {
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
          ?? Deno.env.get('SERVICE_ROLE_KEY')
          ?? '';
        const sb = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          serviceKey
        );
        const { data: tasteRow, error: tasteErr } = await sb
          .from('spotify_taste_profiles')
          .select('top_artists, top_tracks, recently_played, saved_tracks, top_genres')
          .eq('user_id', userId)
          .maybeSingle();
        if (tasteErr) {
          console.warn("⚠️ Taste profile query error:", tasteErr.message);
        }
        if (tasteRow) {
          tasteProfile = tasteRow as TasteProfile;
          console.log("🎵 Loaded taste profile from DB", {
            genres: (tasteRow.top_genres || []).length,
            artists: (tasteRow.top_artists || []).length,
            tracks: (tasteRow.top_tracks || []).length,
          });
        } else {
          console.log("🎵 No taste profile row for user", userId);
        }
      } catch (err) {
        console.warn("⚠️ Could not fetch Spotify taste profile:", err);
      }
    }
  }

  // 3) Load API keys
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    console.error("❌ OPENAI_API_KEY not set");
    return jsonResponse({
      error: "Server misconfiguration"
    }, 500);
  }

  // 4) Convert image to base64 data URL
  // Prefer imagePath: the object is read server-side with the service role, so
  // the client never needs read access to storage. imageUrl is only still here
  // for app builds shipped before that change.
  let dataUrl: string;
  try {
    dataUrl = imagePath
      ? await storagePathToBase64DataURL(imagePath)
      : await toBase64DataURL(imageUrl);
    console.log("🔗 Data URL length:", dataUrl.length);
  } catch (err) {
    console.error("❌ Image conversion failed:", err);
    return jsonResponse({
      error: "Failed to fetch or encode image"
    }, 502);
  }

  // 5) Build OpenAI prompt
  const tasteBlock = buildTasteBlock(tasteProfile);
  const hasTaste = !!tasteBlock;
  const manualTaste = hasTaste && isManualTaste(tasteProfile);
  const systemPrompt = buildSystemPrompt(avoidTracks, avoidArtists, hasTaste, manualTaste);
  let userText = buildUserPrompt({ vibe });
  if (hasTaste) {
    const header = manualTaste
      ? "USER'S CHOSEN TASTE (typed by hand in the app; decades and genres are hard requirements):"
      : "USER'S SPOTIFY LISTENING PROFILE (personalize recommendations to match):";
    userText = `${header}\n${tasteBlock}\n\n${userText}`;
  }

  console.log("📝 System prompt length:", systemPrompt.length);
  console.log("📝 User prompt length:", userText.length);
  console.log("🎵 Taste profile injected:", hasTaste);

  // Build messages — image always included
  const messages: any[] = [
    {
      role: "system",
      content: systemPrompt
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: userText
        },
        {
          type: "image_url",
          image_url: {
            url: dataUrl,
            detail: "low"
          }
        }
      ]
    }
  ];

  // 6) Call OpenAI with structured output
  const payload = {
    model: "gpt-4.1",
    messages: messages,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "music_recommendations",
        strict: true,
        schema: {
          type: "object",
          properties: {
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  artist: { type: "string" },
                  reason: { type: "string" },
                  mood_tags: {
                    type: "array",
                    items: { type: "string" }
                  },
                  search_query: { type: "string" }
                },
                required: ["title", "artist", "reason", "mood_tags", "search_query"],
                additionalProperties: false
              },
              minItems: 6,
              maxItems: 6
            }
          },
          required: ["recommendations"],
          additionalProperties: false
        }
      }
    },
    max_tokens: 1200,
    temperature: 0.75 // Lean into discovery / creative picks
  };

  console.log("📤 Calling OpenAI with structured output");
  console.log("📤 OpenAI API Key present:", !!openaiKey, "Length:", openaiKey?.length || 0);

  let openaiResp: Response;
  try {
    const headers = {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json"
    };
    
    console.log("📤 Request headers:", {
      hasAuthorization: !!headers["Authorization"],
      authorizationPrefix: headers["Authorization"]?.substring(0, 20) + "...",
      contentType: headers["Content-Type"]
    });
    
    openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("❌ Network error calling OpenAI:", err);
    return jsonResponse({
      error: "OpenAI request network failure"
    }, 502);
  }

  if (!openaiResp.ok) {
    const errBody = await openaiResp.json().catch(() => null);
    console.error("❌ OpenAI API error:", openaiResp.status, errBody);
    console.error("❌ Response headers:", Object.fromEntries(openaiResp.headers.entries()));
    
    // Check for specific missing header error
    if (errBody?.error?.message?.includes("header") || errBody?.error?.message?.includes("authorization")) {
      console.error("❌ Missing or invalid Authorization header detected");
    }
    
    return jsonResponse({
      error: "OpenAI request failed",
      details: errBody
    }, openaiResp.status);
  }

  // 7) Parse OpenAI response
  let openaiData: any;
  try {
    const result = await openaiResp.json();
    const message = result.choices?.[0]?.message;
    if (!message) throw new Error("No message in OpenAI response");

    const content = message.content;
    if (!content) throw new Error("OpenAI returned empty content");

    // With structured output, content should be valid JSON
    // Fallback: if it's a string, try to parse it
    if (typeof content === 'string') {
      // Try to extract JSON if wrapped in markdown
      let jsonStr = content.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      
      // Try to find JSON object/array
      const objMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objMatch) {
        jsonStr = objMatch[0];
      }
      
      openaiData = JSON.parse(jsonStr);
    } else {
      openaiData = content;
    }

    if (!openaiData.recommendations || !Array.isArray(openaiData.recommendations)) {
      throw new Error("Invalid response structure: missing recommendations array");
    }

    if (openaiData.recommendations.length !== 6) {
      console.warn(`⚠️ Expected 6 recommendations, got ${openaiData.recommendations.length}`);
    }

    console.log(`✅ Got ${openaiData.recommendations.length} recommendations from OpenAI`);
  } catch (err) {
    console.error("❌ Failed to parse OpenAI response:", err);
    return jsonResponse({
      error: "Failed to parse OpenAI response",
      message: "We couldn't process the music recommendations. Please try again."
    }, 500);
  }

  // 8) Resolve tracks via Spotify
  const spotifyToken = await getSpotifyToken();
  if (!spotifyToken) {
    console.warn("⚠️ No Spotify token, returning OpenAI recommendations without Spotify URLs");
    return jsonResponse({
      songs: openaiData.recommendations.map((rec: any) => ({
        title: rec.title,
        artist: rec.artist,
        reason: rec.reason,
        mood_tags: rec.mood_tags,
        language: "en",
        spotify_url: null,
        album_cover: null,
        preview_url: null
      })),
      has_taste: hasTaste
    }, 200);
  }

  const resolvedSongs: any[] = [];
  const failedSongs: any[] = [];
  const spotifySearchState: SpotifySearchState = {};

  for (const rec of openaiData.recommendations) {
    const track = await findTrackOnSpotify(
      rec.title,
      rec.artist,
      rec.search_query,
      spotifyToken,
      spotifySearchState
    );

    if (track) {
      resolvedSongs.push({
        title: track.name,
        artist: track.artists[0]?.name || rec.artist,
        reason: rec.reason,
        mood_tags: rec.mood_tags,
        language: "en",
        spotify_url: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
        album_cover: track.album?.images?.[0]?.url,
        preview_url: track.preview_url ?? null // 30s clip; often null on newer apps - client falls back to iTunes
      });
    } else {
      console.warn(`⚠️ Could not find "${rec.title}" by "${rec.artist}" on Spotify`);
      failedSongs.push(rec);
    }
  }

  // 9) Handle missing tracks
  if (failedSongs.length > 0) {
    console.warn(`⚠️ ${failedSongs.length} songs could not be found on Spotify:`, 
      failedSongs.map(s => `"${s.title}" by ${s.artist}`).join(", "));
    
    // If we have at least 1 resolved song, continue (we'll handle partial results below)
    // If no songs found at all, return error
    if (resolvedSongs.length === 0) {
      if (isSpotifyAuthFailure(spotifySearchState.lastHttpStatus)) {
        return spotifyAuthErrorResponse();
      }
      return jsonResponse({
        error: "No matches found",
        message: "We couldn't find any songs matching your request on Spotify. Please try a different search.",
        // null = every Spotify Search call returned 2xx; failure was empty results or strict title/artist scoring
        lastSpotifyHttpStatus: spotifySearchState.lastHttpStatus ?? null
      }, 404);
    }
  }

  // 10) Check for duplicate artists (safety net)
  const artistSet = new Set<string>();
  const deduplicatedSongs: any[] = [];
  
  for (const song of resolvedSongs) {
    const artistKey = song.artist?.toLowerCase().trim() || "";
    if (!artistSet.has(artistKey)) {
      artistSet.add(artistKey);
      deduplicatedSongs.push(song);
    } else {
      console.warn(`⚠️ Duplicate artist detected: ${song.artist}, skipping "${song.title}"`);
    }
  }

  // 11) We ship the top 3 resolved picks; picks 4-6 are Spotify-miss fallbacks.
  if (deduplicatedSongs.length < 3) {
    console.warn(`⚠️ Only got ${deduplicatedSongs.length} songs after deduplication, need 3`);
    
    // If we have at least 1 song, return what we have (better UX than error)
    // In production, you could implement retry logic here to get replacements
    if (deduplicatedSongs.length > 0) {
      console.warn("⚠️ Returning partial results - some songs not found on Spotify or had duplicate artists");
      return jsonResponse({
        songs: deduplicatedSongs,
        warning: failedSongs.length > 0 ? `${failedSongs.length} song(s) could not be found on Spotify` : undefined,
        has_taste: hasTaste
      }, 200);
    } else {
      // No songs found at all - return error
      if (isSpotifyAuthFailure(spotifySearchState.lastHttpStatus)) {
        return spotifyAuthErrorResponse();
      }
      return jsonResponse({
        error: "No matches found",
        message: "We couldn't find any songs matching your request on Spotify. Please try a different search.",
        lastSpotifyHttpStatus: spotifySearchState.lastHttpStatus ?? null
      }, 404);
    }
  }

  console.log(`✅ Returning ${deduplicatedSongs.length} resolved songs (all unique artists)`);
  console.log(
    "📤 Response to client (summary):",
    JSON.stringify(
      deduplicatedSongs.slice(0, 3).map((s: any) => ({
        title: s.title,
        artist: s.artist,
        spotify_url: s.spotify_url
      }))
    )
  );

  return jsonResponse({
    songs: deduplicatedSongs.slice(0, 3), // Ensure exactly 3
    // Whether a Spotify taste profile shaped these picks, so the client can
    // tell personalized results from generic ones.
    has_taste: hasTaste
  }, 200);
});
