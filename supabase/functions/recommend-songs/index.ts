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

// Per-day ATTEMPT ceilings, counted in edge_call_log. Pro is 10 matches a day
// and the largest pack ever sold was 120 credits, so nobody real gets near
// these: they are not a product rule, they are the wall a script runs into.
const DAILY_CALLS_PER_IDENTITY = 60;
const DAILY_CALLS_PER_IP = 200;
// What this function writes as edge_call_log.fn, so its rows can be told apart
// from spotify-search's in the same table.
const METER_FN = "recommend-songs";

// The highest contract this server implements. 1 = the client charges itself,
// 2 = the server charges through charge_scan.
const MAX_KNOWN_CONTRACT = 2;

/**
 * Decide whether a caller may have this object read on their behalf.
 *
 * The service-role client below bypasses RLS, so without this check the
 * function would hand anyone who can guess a path a read primitive over the
 * whole bucket - re-opening, through the back door, the hole the storage
 * policies just closed. Signed-in callers get their own folder; guests get
 * only their own unguessable guest path.
 */
function isOwnStorageUrl(url: string): boolean {
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  if (!base) return false;
  try {
    const target = new URL(url);
    // Parse first, then compare, because the comment above promises a property
    // the old startsWith could not deliver. `${base}/storage/v1/object/../../..`
    // passes a raw prefix test, and fetch() then normalizes the dot segments
    // away and requests something else entirely on the same host: /rest/v1,
    // /auth/v1, anything the project serves. Comparing the parsed origin and
    // the already-normalized pathname is the check the comment describes.
    return target.origin === new URL(base).origin
      && target.pathname.startsWith('/storage/v1/object/');
  } catch {
    // Not a URL at all.
    return false;
  }
}

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
    // Keep every Unicode letter and digit, not just a-z0-9. The ASCII-only
    // version erased any non-Latin script entirely: a Cyrillic, Greek, Korean
    // or Japanese title normalized to "", scored zero overlap, and was
    // rejected, so a user whose chosen artists record in those scripts got
    // "No matches found" every time.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Shared words as a fraction of the LONGER side. Dividing by the shorter side
 * made this a subset test rather than a similarity test: "billy" scored a
 * perfect 1.0 against "billy idol", so every gate built on it passed at maximum
 * confidence for a completely different artist. Titles are the only caller now. */
function tokenOverlap(a: string, b: string): number {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / Math.max(left.size, right.size);
}

// Bulgarian official transliteration. The Cyrillic fix that let non-Latin
// scripts survive normalization never bridged the two alphabets, so "Krisko"
// vs "Криско" scores zero and the pick is thrown away. Spotify lists some
// Bulgarian artists in Latin and some in Cyrillic, and the model is told to
// write the original script, so the two sides genuinely disagree.
const CYRILLIC_TO_LATIN: Record<string, string> = {
  "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh", "з": "z",
  "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p",
  "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch",
  "ш": "sh", "щ": "sht", "ъ": "a", "ь": "y", "ю": "yu", "я": "ya",
  "ы": "y", "э": "e", "ё": "e",
};

// Stylised glyphs the punctuation strip turns into holes: "P!nk" became "p nk"
// and "Ke$ha" became "ke ha", neither of which matches anything. MO needs the
// map because U+00D8 has no canonical decomposition, so the NFD pass misses it.
const STYLISED_GLYPHS: Record<string, string> = {
  "!": "i", "$": "s", "@": "a", "ø": "o", "æ": "ae", "ß": "ss",
};

function foldGlyphs(value: string): string {
  let out = "";
  for (const ch of value) out += STYLISED_GLYPHS[ch] ?? ch;
  return out;
}

function foldScript(value: string): string {
  let out = "";
  for (const ch of value) out += CYRILLIC_TO_LATIN[ch] ?? ch;
  return out;
}

/** The forms a name may legitimately be written in: as normalized, and transliterated. */
function matchKeys(value: string): string[] {
  const lowered = (value || "").toLowerCase();
  const base = normalizeForMatch(foldGlyphs(lowered));
  const latin = normalizeForMatch(foldScript(foldGlyphs(lowered)));
  return latin === base ? [base] : [base, latin];
}

// "The" and "and" are grammar, not identity: "The Beatles" and "Beatles" are
// one act, and Spotify is inconsistent about which form it lists.
const NAME_JOINERS = new Set(["the", "and"]);

// Words that mean the credited act is NOT the artist, however well the rest of
// the name lines up. A karaoke or tribute upload is the classic wrong answer a
// popularity sort reaches for.
const NOT_THE_ARTIST = new Set([
  "karaoke", "tribute", "cover", "covers", "instrumental", "backing",
  "version", "versions", "remix", "style", "famous", "originally",
  "made", "performed",
]);

function artistTokens(normalized: string): string[] {
  const all = normalized.split(" ").filter(Boolean);
  const kept = all.filter((t) => !NAME_JOINERS.has(t));
  // "The The" is entirely joiners, so keep the raw tokens rather than nothing.
  return kept.length ? kept : all;
}

function sameArtistKeys(gotKey: string, wantKey: string, mode: "strict" | "credit"): boolean {
  const a = artistTokens(gotKey);
  const b = artistTokens(wantKey);
  if (!a.length || !b.length) return false;
  if (a.join(" ") === b.join(" ")) return true;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  // A single leftover word is a first name, not an identity. This is the whole
  // Billy / Billy Idol collision class, and exact equality above already keeps
  // a genuine one-word act like Azis or Preslava.
  if (short.length < 2) return false;
  let at = -1;
  for (let i = 0; i + short.length <= long.length; i++) {
    let hit = true;
    for (let j = 0; j < short.length; j++) {
      if (long[i + j] !== short[j]) { hit = false; break; }
    }
    if (hit) { at = i; break; }
  }
  if (at < 0) return false;
  // strict wants a leading extension only ("Bob Marley" -> "Bob Marley & The
  // Wailers"). The fallback has no title to check against, so a name buried
  // mid-string there would hand a stranger's catalog to a popularity sort.
  if (mode === "strict" && at !== 0) return false;
  const extra = long.filter((_, i) => i < at || i >= at + short.length);
  if (extra.some((t) => NOT_THE_ARTIST.has(t))) return false;
  return true;
}

/**
 * Are these two names the same act?
 *
 * "strict" is for choosing an artist with no title to corroborate it, so it
 * only allows a trailing extension of the requested name. "credit" is for
 * checking a track's credit list, where the title match is already the second
 * lock, so a featured artist credited mid-string may still match.
 */
function isSameArtist(got: string, want: string, mode: "strict" | "credit"): boolean {
  for (const g of matchKeys(got)) {
    for (const w of matchKeys(want)) {
      if (sameArtistKeys(g, w, mode)) return true;
    }
  }
  return false;
}

/**
 * The artist's most popular track on Spotify, or null when the artist itself
 * cannot be verified.
 *
 * Used when a recommended title does not resolve. This used to run a free-text
 * artist:"X" search over tracks and sort the page by popularity, so a one-word
 * name returned whoever famous happened to contain that word: "Billy" shipped
 * Billy Idol's "Eyes Without A Face". It now resolves an artist id first and
 * only ever reads that id's own top tracks, so the identity check is the only
 * way in and popularity can no longer bridge to a different artist.
 */
/**
 * The artist's top tracks, most popular first, or [] when the artist itself
 * cannot be resolved. Returned as a list so the caller can first look for the
 * track it actually wanted among them: with cross-script title matching that
 * rescues a pick the search missed, which is a better answer than the most
 * popular song by the same act.
 */
async function topTracksForArtist(
  artist: string,
  token: string,
  state?: SpotifySearchState,
  market = ""
): Promise<any[]> {
  const wantArtist = (artist || "").trim();
  if (!wantArtist || !token) return [];
  try {
    const params = new URLSearchParams({ type: "artist", limit: "10", q: wantArtist });
    if (market) params.set("market", market);
    const resp = await fetchWithRetry(
      `https://api.spotify.com/v1/search?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (state) state.lastHttpStatus = resp.status;
    if (!resp.ok) return null;
    const data = await resp.json();
    const candidates: any[] = Array.isArray(data?.artists?.items) ? data.artists.items : [];
    const matches = candidates.filter((a: any) => isSameArtist(a?.name ?? "", wantArtist, "strict"));
    if (matches.length === 0) {
      console.warn(`⚠️ No Spotify artist matches "${wantArtist}"`);
      return null;
    }
    // An exact name always beats an extension, so a real act can never be
    // outranked by a bigger band that merely starts with the same words.
    const wantKeys = new Set(matchKeys(wantArtist));
    matches.sort((a: any, b: any) => {
      const aExact = matchKeys(a?.name ?? "").some((k) => wantKeys.has(k)) ? 0 : 1;
      const bExact = matchKeys(b?.name ?? "").some((k) => wantKeys.has(k)) ? 0 : 1;
      return aExact - bExact || (b?.followers?.total ?? 0) - (a?.followers?.total ?? 0);
    });
    const artistId = matches[0]?.id;
    if (!artistId) return [];

    // The user's own market first, when the client sent one: a regional
    // catalogue is exactly where the unscoped call hides releases. Then
    // unscoped, then US, because an explicit market can also be what makes a
    // thin catalogue come back empty.
    const suffixes = market ? [`?market=${market}`, "", "?market=US"] : ["", "?market=US"];
    for (const suffix of suffixes) {
      const topResp = await fetchWithRetry(
        `https://api.spotify.com/v1/artists/${artistId}/top-tracks${suffix}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (state) state.lastHttpStatus = topResp.status;
      if (!topResp.ok) continue;
      const topData = await topResp.json();
      const tracks: any[] = Array.isArray(topData?.tracks) ? topData.tracks : [];
      if (tracks.length === 0) continue;
      tracks.sort((a: any, b: any) => (b?.popularity ?? 0) - (a?.popularity ?? 0));
      return tracks;
    }
    return [];
  } catch (err) {
    console.warn("topTracksForArtist failed:", err);
    return [];
  }
}

/**
 * Which artist name to print on the card.
 *
 * bestTrackMatch deliberately accepts a match on ANY credited artist, because
 * the model often names the feature while Spotify credits someone else first.
 * Printing only artists[0] then puts a name on the card that the reason never
 * mentions, which is the reported bug in a quieter form.
 */
function creditLine(track: any, wantArtist: string): string {
  const names: string[] = (track?.artists ?? []).map((a: any) => a?.name).filter(Boolean);
  if (names.length === 0) return wantArtist;
  const primary = names[0];
  const matched = names.find((n) => isSameArtist(n, wantArtist, "credit"));
  if (!matched || matched === primary) return primary;
  return `${primary}, ${matched}`;
}

/**
 * Did the resolved track actually answer what the model asked for?
 *
 * Deliberately computed on the RESOLVED TRACK rather than on which code path
 * produced it. bestTrackMatch can also return a near-title by the right artist,
 * so keying the reason off "was this the fallback branch" would leave the same
 * wrong pairing shipping through the success path.
 */
function resolutionKind(rec: any, track: any): "exact" | "artist" {
  // Cross-script, like bestTrackMatch: a Cyrillic title and its Latin
  // transliteration are the same title. Equality in any form, or containment
  // when the shorter side is a real phrase - the two tiers bestTrackMatch
  // treats as a title hit. Token overlap is deliberately excluded here: it is
  // loose enough to call a different song "exact", and this function decides
  // whether the row carries the substitution notice.
  const wants = matchKeys(stripDecor(rec?.title ?? ""));
  const gots = matchKeys(track?.name ?? "");
  const titleMatches = wants.some((w) => gots.some((g) => {
    if (!w || !g) return false;
    if (w === g) return true;
    const shorter = Math.min(w.split(" ").filter(Boolean).length, g.split(" ").filter(Boolean).length);
    return shorter >= 2 && (w.includes(g) || g.includes(w));
  }));
  if (!titleMatches) return "artist";
  const credits: string[] = (track?.artists ?? []).map((a: any) => a?.name).filter(Boolean);
  return credits.some((n) => isSameArtist(n, rec?.artist ?? "", "credit")) ? "exact" : "artist";
}

/**
 * When the model's title for an artist does not exist, let it choose from the
 * songs that do.
 *
 * For niche and regional artists the model invents titles: a Bulgarian-taste
 * scan asked for "GO", "Cliché" and "No Drama" by artists who never released
 * them, while an English-taste scan named three real songs and resolved all
 * three. No search fix helps with an invented title. So on a miss, the
 * artist's real top tracks go to a cheap second call that picks the best fit
 * for the photo and writes a reason about THAT song. The pick resolves by
 * construction, the reason is true, and nothing needs a substitution notice.
 *
 * gpt-4.1-mini, a few hundred tokens, only on a miss. Returns null on any
 * failure so the caller falls through to the plain top-track fallback.
 */
async function chooseFromCatalogue(
  rec: any,
  tops: any[],
  vibe: string | undefined,
  openaiKey: string
): Promise<{ track: any; reason: string } | null> {
  const candidates = tops.slice(0, 10).map((t: any, i: number) => ({
    i,
    title: t?.name ?? "",
    album: t?.album?.name ?? "",
    year: String(t?.album?.release_date ?? "").slice(0, 4),
  })).filter((c: any) => c.title);
  if (candidates.length === 0) return null;

  const artistName = tops[0]?.artists?.[0]?.name || rec?.artist || "this artist";
  // Why the model wanted this artist for this photo. artist_reason is written
  // about the artist rather than the invented song, so it survives the swap.
  const context = [rec?.artist_reason, rec?.reason]
    .filter((x: any) => typeof x === "string" && x.trim())
    .join(" ");

  const body = {
    model: "gpt-4.1-mini",
    temperature: 0.4,
    max_tokens: 220,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "catalogue_pick",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { index: { type: "integer" }, reason: { type: "string" } },
          required: ["index", "reason"],
        },
      },
    },
    messages: [
      {
        role: "system",
        content:
          "You choose one real song from a numbered list to match a photo's mood, and write one or two sentences about why THIS song fits THIS photo. Describe the song and the photo; never mention a list, other songs, or that anything was substituted. Reply with the index and the reason.",
      },
      {
        role: "user",
        content:
          `Vibe: ${vibe ?? "unspecified"}.\n` +
          `Why ${artistName} suits this photo: ${context || "(no notes)"}\n\n` +
          `Real songs by ${artistName}:\n` +
          candidates.map((c: any) => `${c.i}. "${c.title}" (${c.album}${c.year ? ", " + c.year : ""})`).join("\n") +
          `\n\nPick the best fit.`,
      },
    ],
  };

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.warn("catalogue pick failed:", resp.status);
      return null;
    }
    const data = await resp.json();
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
    const track = tops[Number(parsed?.index)];
    const reason = typeof parsed?.reason === "string" ? parsed.reason.trim() : "";
    if (!track || !reason) return null;
    return { track, reason };
  } catch (err) {
    console.warn("catalogue pick threw:", err);
    return null;
  }
}

/**
 * The line to show when the shipped track is not the one the reason was
 * written about. Never falls back to rec.reason: that text names a specific
 * song, so on a substitution it is a fabrication about a song the user is not
 * looking at. Never empty either, so the card and the rows keep a description.
 *
 * It leads with the substitution itself rather than quietly presenting a
 * different song as the pick. The card clamps to two lines, so the admission
 * is what a reader sees without expanding, and the model's artist line follows
 * it for anyone who taps through.
 */
function artistLevelReason(rec: any, track: any): string {
  const name = (track?.artists ?? [])[0]?.name || rec?.artist || "this artist";
  const written = typeof rec?.artist_reason === "string" ? rec.artist_reason.trim() : "";
  // Said as a choice, not a failure. "We couldn't find" three times on one
  // photo reads as the app not working; the truth is that the pick did not
  // resolve on Spotify and the artist's best-known track stands in for it.
  const admission = `Our first pick isn't on Spotify, so here's ${name}'s best-known track instead.`;
  return written ? `${admission} ${written}` : admission;
}

/** One response row. The reason follows what resolved, never the code path. */
function shippedSong(rec: any, track: any) {
  const kind = resolutionKind(rec, track);
  return {
    title: track.name,
    artist: creditLine(track, rec.artist),
    reason: kind === "exact" ? rec.reason : artistLevelReason(rec, track),
    // The tags were written for the model's own pick, so on a substitution they
    // describe a song we are not showing. Nothing on the client reads them.
    mood_tags: kind === "exact" ? rec.mood_tags : [],
    match_kind: kind,
    // What the model asked for, kept beside what shipped. On a substitution
    // this is the only record of the title that failed to resolve, and it is
    // what distinguishes "the model invents titles for this artist" from "the
    // track exists and search cannot see it" - two problems with different
    // fixes. Nothing on the client renders it.
    requested: { title: rec?.title ?? null, artist: rec?.artist ?? null },
    language: "en",
    spotify_url: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
    album_cover: track.album?.images?.[0]?.url,
    preview_url: track.preview_url ?? null, // 30s clip; often null on newer apps - client falls back to iTunes
  };
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
  // Every form the wanted title may be written in: as given, and transliterated
  // to Latin. The artist comparison has folded script this way since the Billy
  // Idol fix; the title comparison never did, so a model that wrote
  // "Che doydesh li s men" could not match Spotify's "Ше дойдеш ли с мен",
  // scored zero, and every Bulgarian pick fell to the artist's top track with
  // an apology attached. Three in a row on one photo was that, not bad picks.
  const wantTitles = matchKeys(normTitle);
  const wantTitle = wantTitles[0];
  const wantArtist = normalizeForMatch(normArtist);

  let best: any = null;
  let bestScore = 0;

  for (const track of tracks) {
    const rawTitle = track.name?.toLowerCase().trim() || "";
    // No early return on an exact raw hit: Spotify search often lists a live or
    // karaoke upload above the studio original, and returning the first exact
    // string match picked those. Scoring every candidate lets the popularity
    // tie-break below choose the canonical recording.
    const gotTitles = matchKeys(rawTitle);
    const gotTitle = gotTitles[0];
    // Any credited artist may be the match - the model often names the featured
    // artist, and Spotify only puts one of them first.
    const gotArtists: string[] = (track.artists || [])
      .map((a: any) => normalizeForMatch(a?.name || ""))
      .filter(Boolean);

    // Containment only counts when the shorter title is a real phrase. A
    // one-word wanted title used to match any longer title containing that
    // word, so "Love" resolved to "Lovely" and "Дъга" to "Дъга и слънце" -
    // the reported bug on the success path instead of the fallback.
    const shorterTitleTokens = Math.min(
      gotTitle.split(" ").filter(Boolean).length,
      wantTitle.split(" ").filter(Boolean).length
    );
    // Best score over every (got form, want form) pair, so a Cyrillic title
    // and its transliteration are the same title.
    let titleScore = 0;
    for (const g of gotTitles) {
      for (const w of wantTitles) {
        let sc = 0;
        if (g && g === w) sc = 40;
        else if (g && w && shorterTitleTokens >= 2 && (g.includes(w) || w.includes(g))) sc = 25;
        else if (tokenOverlap(g, w) >= 0.6) sc = 20;
        if (sc > titleScore) titleScore = sc;
      }
    }

    // Identity, not string containment. The old branches gave 35 for a raw
    // includes() and 30 for a half-token overlap, so "Bruno Mars" passed as
    // "Bruno Major" and "DJ Khaled" as "DJ Snake".
    let artistScore = 0;
    for (const got of gotArtists) {
      let candidate = 0;
      if (got === wantArtist) candidate = 60;
      else if (isSameArtist(got, wantArtist, "credit")) candidate = 45;
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
  state?: SpotifySearchState,
  market = ""
): Promise<any | null> {
  const marketParam = market ? `&market=${market}` : "";
  try {
    // Strip decorations (feat./Live/Remastered/...) so decorated titles resolve.
    title = stripDecor(title);
    artist = stripDecor(artist);
    // Always build the query ourselves — never trust AI-generated search_query
    // (AI occasionally corrupts it with JSON syntax artifacts)
    let query = `track:"${title}" artist:"${artist}"`;
    let encodedQuery = encodeURIComponent(query);
    const primarySearchUrl = `https://api.spotify.com/v1/search?q=${encodedQuery}&type=track&limit=10${marketParam}`;
    console.log("🎵 Spotify search [primary] query:", query, "| encoded q param:", encodedQuery, "| url:", primarySearchUrl);

    let response = await fetchWithRetry(primarySearchUrl, {
      headers: {
        "Authorization": `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      if (state) state.lastHttpStatus = response.status;
      if (response.status === 429) {
        console.error("SPOTIFY_RATE_LIMITED mode=resolve retry_after=" + (response.headers.get("Retry-After") ?? "unknown"));
      }
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
      const fallbackSearchUrl = `https://api.spotify.com/v1/search?q=${encodedQuery}&type=track&limit=10${marketParam}`;
      console.log("🎵 Spotify search [fallback] query:", query, "| encoded q param:", encodedQuery, "| url:", fallbackSearchUrl);

      response = await fetchWithRetry(fallbackSearchUrl, {
        headers: {
          "Authorization": `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        if (state) state.lastHttpStatus = response.status;
      if (response.status === 429) {
        console.error("SPOTIFY_RATE_LIMITED mode=resolve retry_after=" + (response.headers.get("Retry-After") ?? "unknown"));
      }
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

// Caps on the caller-supplied text that ends up inside an OpenAI prompt.
//
// avoidTracks and avoidArtists are joined into the SYSTEM prompt, and every
// name in an inline taste profile is interpolated into the user prompt. None
// of it was bounded, so the request body WAS the prompt: an attacker could put
// a hundred kilobytes of their own instructions above our rules and bill the
// tokens to us. Both dimensions have to be capped, because ten thousand short
// strings cost the same as one enormous one.
const MAX_AVOID_ITEMS = 60;
const MAX_AVOID_LENGTH = 120;
const MAX_TASTE_ITEMS = 40;
const MAX_TASTE_NAME_LENGTH = 120;
const MAX_TASTE_GENRE_LENGTH = 40;

/**
 * Flatten one caller-supplied string so it can sit inside a prompt.
 *
 * Control characters and line breaks are replaced, not merely trimmed: a
 * newline inside an "avoid" entry closes our bullet list and lets whatever
 * follows read as the next system instruction. Truncation happens last, so
 * padding the front cannot buy extra room past the cap.
 */
function cleanPromptString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** The same treatment for a list, plus a count cap and de-duplication. */
function cleanPromptList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    const item = cleanPromptString(raw, maxLength);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

function cleanTasteTracks(value: unknown): Array<{ name: string; artist: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Array<{ name: string; artist: string }> = [];
  for (const raw of value) {
    const name = cleanPromptString((raw as any)?.name, MAX_TASTE_NAME_LENGTH);
    const artist = cleanPromptString((raw as any)?.artist, MAX_TASTE_NAME_LENGTH);
    // buildTasteBlock prints the pair as one line, so half an entry is noise.
    if (!name || !artist) continue;
    const key = `${name}|${artist}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, artist });
    if (out.length >= MAX_TASTE_ITEMS) break;
  }
  return out;
}

function cleanTasteArtists(value: unknown): Array<{ name: string; genres?: string[] }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Array<{ name: string; genres?: string[] }> = [];
  for (const raw of value) {
    const name = cleanPromptString((raw as any)?.name, MAX_TASTE_NAME_LENGTH);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, genres: cleanPromptList((raw as any)?.genres, 5, MAX_TASTE_GENRE_LENGTH) });
    if (out.length >= MAX_TASTE_ITEMS) break;
  }
  return out;
}

/**
 * Rebuild an inline taste profile field by field instead of trusting one.
 *
 * The body version used to be accepted on `typeof === "object"` alone and
 * handed straight to buildTasteBlock, which interpolates every name and artist
 * into the user prompt. Copying only the fields we understand, at lengths we
 * chose, is the only version of this that cannot be turned into a prompt of
 * the caller's own.
 *
 * Guests are why this path exists at all: they have no row in
 * spotify_taste_profiles, so their profile has to travel in the request. The
 * profile loaded from the database further down is written by our own
 * functions and needs no scrub.
 */
function cleanTasteProfile(value: unknown): TasteProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const profile: TasteProfile = {
    top_artists: cleanTasteArtists(raw.top_artists),
    top_tracks: cleanTasteTracks(raw.top_tracks),
    recently_played: cleanTasteTracks(raw.recently_played),
    saved_tracks: cleanTasteTracks(raw.saved_tracks),
    // Chosen decades ride in here as "era:1980s"; the cap is wide enough.
    top_genres: cleanPromptList(raw.top_genres, MAX_TASTE_ITEMS, MAX_TASTE_GENRE_LENGTH),
    // Only the two values isManualTaste and the prompt builders know about. An
    // unknown source string would otherwise reach nothing, but pinning it here
    // keeps the profile shape closed.
    source: raw.source === "manual" ? "manual" : "spotify",
  };
  const entries = (profile.top_artists?.length ?? 0)
    + (profile.top_tracks?.length ?? 0)
    + (profile.recently_played?.length ?? 0)
    + (profile.saved_tracks?.length ?? 0)
    + (profile.top_genres?.length ?? 0);
  // Nothing survived the scrub, so there is no profile - and saying so lets
  // the DB lookup below run for a signed-in user instead of being skipped by
  // an empty object.
  return entries > 0 ? profile : null;
}

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
  if (artists.length) {
    parts.push(
      isManualTaste(profile)
        ? `Artists they chose (deliberate, high-intent - the single strongest signal here): ${artists.join(", ")}`
        : `Most-listened artists: ${artists.join(", ")}`
    );
  }
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
    return `\n\nUSER MUSIC TASTE - typed by hand in the app, so every entry is deliberate:
- Chosen artists outrank everything else. At least 3 of the 5 picks must sit in their world: contemporaries, label-mates, influences, proteges, same local scene. Never the chosen artists themselves. They also set the language and region.
- Chosen decades and genres are hard: position 1 must be released in a chosen decade and belong to a chosen genre. "Released in" means the original release year, not a modern record that sounds like it. Where artists were also chosen, the artists win the conflict.
- The image and the vibe decide which track from that space fits; they never override it.
- Discovery is the product: never an artist listed in the profile, and no deep cut from one.`;
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
  manualTaste: boolean = false,
  poolSize: number = 5
): string {
  const avoidSection = avoidTracks.length > 0 || avoidArtists.length > 0
    ? `\n\nAVOID THESE (do not recommend):\n${avoidTracks.length > 0 ? `- Tracks: ${avoidTracks.join(", ")}\n` : ""}${avoidArtists.length > 0 ? `- Artists: ${avoidArtists.join(", ")}\n` : ""}`
    : "";

  const tasteGuidance = buildTasteGuidance(hasTaste, manualTaste);

  return `You are VibeMatch, a personalized music curator. You combine the visual/emotional read of an image with the user's overall sonic taste to surface songs they'll love — including ones they haven't discovered yet.${tasteGuidance}

Hard rules:
- Valid JSON matching the schema, nothing else.
- Exactly ${poolSize} tracks, never fewer, never an empty list. The preferences above compete for these ${poolSize} slots; they are not filters. If they cannot all hold, relax in this order and still return ${poolSize}: decade, genre, "avoid mainstream", scene.
- Ranked best to worst; position 1 is the most on-point pick.
- A different artist per track, and none that appears anywhere in the user's profile. Recommending one they already listed is a failure.
- Skip ultra-mainstream staples and viral defaults (Mr. Brightside, Bohemian Rhapsody, Heat Waves, Blinding Lights, Sweater Weather, Riptide, Go by The Chemical Brothers, Midnight City, Weightless, Nightcall, Intro by The xx, and obvious equivalents).
- At least 2 distinct subgenres or eras across the ${poolSize}.
- Only songs you are confident exist. Write title and artist exactly as Spotify lists them, in the original script (Cyrillic, Greek, Hangul, Japanese included), or the track will not resolve.
- Plain studio titles: no "(feat. ...)", "(Live)", "(Remastered)", "(Radio Edit)" suffixes.
- Also write "artist_reason": one sentence on why this ARTIST fits the photo and the user's taste. It is shown when the exact track cannot be found, so it must not name a track title or describe one specific song.
- Language: default to English-language music, unless the user's chosen artists or genres belong to another language or scene, in which case draw from that scene.
${avoidSection}

Return JSON: {"recommendations":[{"title":"","artist":"","reason":"2-3 sentences: first name what is actually in the photo and its mood, then tie that to a specific trait of the user's taste, naming the bridge artist or production trait rather than a genre tag.","artist_reason":"1 sentence about the artist only, naming no track.","mood_tags":["","",""],"search_query":"track:\\"Title\\" artist:\\"Artist\\""}]}`;
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
IMPORTANT: Default to international (primarily English) songs unless the user's chosen artists or genres point at another language or scene.`;
  }

  return `Analyze the image and recommend 6 songs that match the atmosphere, color palette, energy, and implied story. Prefer unexpected-but-accurate picks over obvious hits.
IMPORTANT: Default to international (primarily English) songs unless the user's chosen artists or genres point at another language or scene.`;
}

// Edge function
/**
 * A stable fingerprint of the semantic request, so a retry can be told apart
 * from a different question wearing the same scan id. Only the inputs that
 * change the answer go in: the debug flag and the device id do not.
 */
async function requestFingerprint(parts: Record<string, unknown>): Promise<string> {
  const canonical = JSON.stringify(parts, Object.keys(parts).sort());
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  console.log("🔔 Invocation start");

  // 0) Try to get user from Authorization header (if present)
  let userId: string | undefined;
  // Anonymous sign-in shipped with 1.3.0, the first build that speaks contract
  // 2, so this flag is also a version signal. The contract gate below is the
  // one place that matters.
  let isAnonymous = false;
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
        isAnonymous = user.is_anonymous === true;
        console.log("✅ Authenticated user:", userId, isAnonymous ? "(anonymous)" : "(registered)");
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
  // Opaque per-install id the client keeps in the keychain. Lets guests get
  // server-side "already served" exclusion even when their local history is
  // empty. Never used for anything else.
  let deviceId: string | undefined;
  // When true the success response carries the OpenAI token counts, so a
  // prompt change can be measured instead of guessed. Off for the app.
  let debugUsage = false;
  // Contract 2 means "charge me server-side"; anything less is served under the
  // old client-charges rules.
  let contract = 1;
  let scanId: string | undefined;
  // Minutes to ADD to UTC to get the caller's local time: +120 for UTC+2. Note
  // that JavaScript's getTimezoneOffset() returns the opposite sign, so the
  // client must send `-new Date().getTimezoneOffset()`. Getting it backwards
  // moves the Pro day boundary by twice the offset, which is the kind of bug
  // that only shows up for users in one hemisphere.
  let tzOffsetMinutes: number | undefined;
  // ISO 3166-1 alpha-2, from the device. Spotify search without a market
  // omits region-restricted releases, and local catalogues (the Bulgarian
  // one, for instance) are exactly where that hides the track the model
  // picked. Empty when the client did not send it, which changes nothing.
  let market = "";

  try {
    const body = await req.json();
    if (typeof body.deviceId === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(body.deviceId)) {
      deviceId = body.deviceId;
    }
    debugUsage = body.debug === true;
    // The contract marker. A build that does not send it charges itself
    // client-side, and charging it here as well would take two credits for one
    // match, or withhold a match it had already paid for. Who is allowed to
    // claim that is decided by the contract gate below, not here.
    //
    // Clamped to the contracts this server actually understands. client_contract
    // keeps the highest number it is ever told and the gate reads it back, so
    // one caller sending contract 99 would otherwise write a number nothing can
    // interpret into the record that decides whether they get charged. A future
    // contract 3 belongs here, deliberately, next to the code that honours it.
    if (Number.isInteger(body.contract)) {
      contract = Math.min(Math.max(body.contract, 1), MAX_KNOWN_CONTRACT);
    }
    if (typeof body.scanId === "string" && /^[0-9a-f-]{36}$/i.test(body.scanId)) scanId = body.scanId;
    if (Number.isInteger(body.tzOffsetMinutes) && Math.abs(body.tzOffsetMinutes) <= 14 * 60) {
      tzOffsetMinutes = body.tzOffsetMinutes;
    }
    if (typeof body.market === "string" && /^[A-Z]{2}$/.test(body.market)) {
      market = body.market;
    }
    imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : "";
    imagePath = typeof body.imagePath === "string" ? body.imagePath : undefined;
    vibe = typeof body.vibe === "string" ? body.vibe : undefined;
    // The user id comes from the verified JWT only. It used to fall back to
    // body.userId, which let any caller name another user and have that
    // person's history and taste profile shape the picks.

    // Both lists are joined into the SYSTEM prompt, so they are scrubbed and
    // capped here rather than trusted. Unbounded, they are a free channel for
    // the caller to write our instructions and spend our tokens.
    avoidTracks = cleanPromptList(body.avoidTracks, MAX_AVOID_ITEMS, MAX_AVOID_LENGTH);
    avoidArtists = cleanPromptList(body.avoidArtists, MAX_AVOID_ITEMS, MAX_AVOID_LENGTH);
    // Guest taste profile may be passed inline from the client. Rebuilt field
    // by field, because every string in it lands in the user prompt.
    tasteProfile = cleanTasteProfile(body.tasteProfile);

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

    // imageUrl is kept for builds that predate imagePath. It must point at
    // this project's own bucket: an arbitrary URL would make this function
    // fetch anything on the caller's behalf and bill the result to OpenAI.
    if (!imagePath && imageUrl && !isOwnStorageUrl(imageUrl)) {
      console.warn("🚫 Rejected imageUrl host");
      return jsonResponse({
        error: "Forbidden image url"
      }, 403);
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

  // The service-role client. Built here rather than further down because both
  // gates below need it and both have to run before this function does any
  // work on the caller's behalf.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
  const logClient = serviceKey ? createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey) : null;

  // Who this call is metered against.
  //
  // cf-connecting-ip is written by the edge in front of us and the caller
  // cannot forge it, so it wins. x-forwarded-for is a caller-supplied list
  // that our proxy appends to, which makes its LEFTMOST hop pure attacker
  // input - and that is the hop the old order preferred, so a script could
  // mint a fresh identity per request with one header and never meet a
  // ceiling. Within that header only the rightmost hop, the one added closest
  // to us, is worth reading.
  const forwardedFor = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  const clientIp = req.headers.get("cf-connecting-ip")
    ?? forwardedFor[forwardedFor.length - 1]
    ?? null;

  // 1b) The contract gate.
  //
  // `contract` decides whether the server charges for this match, and the
  // CALLER sends it. Contract 1 exists only for builds shipped before the
  // server charged anything: those deduct client-side, so charging them too
  // would take two credits for one match. That escape hatch has to stay open
  // for genuinely old builds and shut for everyone else, or "contract" is
  // simply an opt-out from paying that anyone can take by deleting a field.
  //
  // Two things prove a caller is not an old build:
  //   - an anonymous identity, which only exists from 1.3.0, the same build
  //     that sends contract 2. An anonymous caller claiming contract 1 is
  //     lying about what it is.
  //   - a registered user whose client has already been seen speaking
  //     contract 2. note_client_contract has been recording that in
  //     public.client_contract all along and nothing ever read it back. A
  //     real client never downgrades; a downgrade is someone editing the body.
  if (contract < 2) {
    const refuseContract = () => jsonResponse({
      error: "Unsupported client",
      code: "contract_required",
      message: "Please update the app to keep matching.",
    }, 400);

    if (isAnonymous) {
      console.warn("🚫 anonymous caller sent contract", contract);
      return refuseContract();
    }

    // There is deliberately NO client_contract arm here.
    //
    // The obvious next step is to also refuse a contract-1 request from anyone
    // whose client_contract row already says 2. It was written that way, and it
    // locks real customers out. client_contract is keyed on the ACCOUNT and
    // max_contract only ever climbs, so one person with an updated iPhone and
    // an iPad still on the App Store build is recorded at 2 by the phone and
    // then refused on the iPad, with paid credits in their balance and no way
    // to spend them. A staged rollout, a second device, a restored older build
    // and a device left behind on an older iOS all produce that same shape.
    //
    // It would not have caught the attacker it was aimed at either: the row is
    // only written when a caller VOLUNTEERS contract 2, so a client that never
    // sends it is never recorded and so never refused.
    //
    // So the gate is the anonymous check above and nothing else. That one is
    // airtight in the direction that matters, because an anonymous identity
    // cannot predate the build that mints them, and it covers the guest path
    // where the free matches actually live. Registered legacy clients keep the
    // uncharged path until pre-1.3.0 builds age out, which is the same
    // condition that gates revoking UPDATE on user_profiles.
  }

  // Record the contract now, not after a successful charge. The write used to
  // sit at the end of the charge block, so the adoption table only ever
  // learned about users who had credits to spend: a contract-2 caller who was
  // out of credits, or whose match failed, was never recorded, and the gate
  // directly above reads exactly that table. Recorded late, such a user could
  // claim contract 1 forever.
  if (contract >= 2 && userId && logClient) {
    const { error: noteError } = await logClient.rpc('note_client_contract', {
      p_user: userId,
      p_contract: contract,
    });
    if (noteError) console.warn("⚠️ note_client_contract failed:", noteError.message);
  }

  // 1c) The daily attempt ceiling.
  //
  // Credits are only charged for contract-2 callers, so without this the anon
  // key in the app binary is an unmetered OpenAI account for everybody else.
  //
  // Counted in edge_call_log and counted BEFORE the work. The old check
  // counted recommendation_log rows, which are written on the single
  // full-success path, so every request that failed after the model call was a
  // free, uncounted model call - and the caller decides whether a request
  // fails: an image that resolves to nothing, a taste profile no song can
  // match. Attempts are what costs money, so attempts are what is counted.
  //
  // edge_call_log has no identity column (fn, mode, ip), so the subject key
  // goes in `ip` behind a prefix that cannot collide with an address, and
  // `mode` says what kind of subject it is. The index is on (fn, ip,
  // created_at), which is exactly how these are read.
  const meterSubjects: Array<{ kind: string; key: string; limit: number }> = [];
  if (userId) meterSubjects.push({ kind: 'user', key: `user:${userId}`, limit: DAILY_CALLS_PER_IDENTITY });
  if (deviceId) meterSubjects.push({ kind: 'device', key: `device:${deviceId}`, limit: DAILY_CALLS_PER_IDENTITY });
  if (clientIp) meterSubjects.push({ kind: 'ip', key: clientIp, limit: DAILY_CALLS_PER_IP });

  // Fail CLOSED for the callers we cannot bill, OPEN for the ones we can.
  //
  // A registered, non-anonymous user is far more often a paying customer than
  // an attacker, and refusing one because our own ledger is unreadable turns
  // our outage into their outage. Everyone else - no JWT, or an anonymous one,
  // which is where the free matches live - is refused, because for them an
  // unreadable ledger IS the attack. The old block wrapped the whole check in
  // a catch that continued on any failure, which is not a metering check; it
  // is a comment about one.
  // Anyone the server can name gets the benefit of the doubt. Only a caller
  // with no identity at all is refused when our own ledger is unreadable.
  //
  // This deliberately includes anonymous identities. Every guest on 1.3.0 is
  // anonymous, guests buy packs and subscribe straight from the wall, and
  // excluding them turned a blip in our own ledger into a 503 for most of the
  // paying user base. An anonymous caller is already refused a free match by
  // the contract gate above, so the meter is not the thing holding that line.
  const meterFailsOpen = !!userId;
  const meterUnavailable = (why: string): Response | null => {
    if (meterFailsOpen) {
      console.error("🚨 attempt meter unavailable, letting a registered user through:", why);
      return null;
    }
    console.error("🚫 attempt meter unavailable, refusing:", why);
    return jsonResponse({
      error: "Matching is busy",
      code: "meter_unavailable",
      message: "Matching is busy right now. Please try again in a moment.",
    }, 503);
  };

  if (!logClient) {
    const refusal = meterUnavailable("no service role key");
    if (refusal) return refusal;
  } else if (meterSubjects.length === 0) {
    // No user, no device id and no IP: there is nothing to count against, so
    // this caller cannot be metered at all.
    const refusal = meterUnavailable("no subject to meter");
    if (refusal) return refusal;
  } else {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const counted = await Promise.all(
        meterSubjects.map(async (subject) => {
          const { count, error } = await logClient
            .from('edge_call_log')
            .select('id', { count: 'exact', head: true })
            .eq('fn', METER_FN)
            .eq('ip', subject.key)
            .gt('created_at', since);
          return { subject, calls: count ?? 0, error: error?.message ?? null };
        })
      );

      // The old code destructured `count` and dropped `error`, so a read that
      // never happened came back as zero calls and waved the request through.
      const unreadable = counted.find((row) => row.error);
      if (unreadable) {
        const refusal = meterUnavailable(`count failed: ${unreadable.error}`);
        if (refusal) return refusal;
      }

      const over = counted.find((row) => row.calls >= row.subject.limit);
      if (over) {
        console.warn("🚫 Daily attempt ceiling hit", {
          kind: over.subject.kind,
          calls: over.calls,
          limit: over.subject.limit,
          userId: userId ?? null,
          ip: clientIp,
        });
        return jsonResponse({
          error: "Daily limit reached",
          code: "rate_limited",
          message: "That's a lot of matches for one day. Try again tomorrow."
        }, 429);
      }

      // Written before the work and awaited on purpose. A fire-and-forget insert
      // can be dropped when the isolate returns first, and an attempt that is
      // not written is an attempt that is not counted - which is the failure
      // this whole block exists to fix.
      const { error: writeError } = await logClient
        .from('edge_call_log')
        .insert(meterSubjects.map((s) => ({ fn: METER_FN, mode: s.kind, ip: s.key })));
      if (writeError) {
        const refusal = meterUnavailable(`insert failed: ${writeError.message}`);
        if (refusal) return refusal;
      }
    } catch (err) {
      // A throw here is the client failing rather than the query returning an
      // error, but it means the same thing: no ledger. It goes through the same
      // door, because the old version's catch-and-continue is exactly what made
      // this check decorative.
      const refusal = meterUnavailable(`ledger unreachable: ${err}`);
      if (refusal) return refusal;
    }
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

  // 2b) Served-track exclusions from recommendation_log. Two lists:
  //   - the most-served tracks for this vibe in the last 30 days, across
  //     everyone: the model's reflex picks that every sunset used to get;
  //   - what this device (or user) has been served recently, so guests are
  //     covered even when their local history was wiped.
  if (logClient) {
    try {
      const [{ data: popular }, { data: served }] = await Promise.all([
        logClient.rpc('most_served_tracks', { p_vibe: vibe ?? null, p_days: 30, p_limit: 12 }),
        deviceId || userId
          ? logClient
              .from('recommendation_log')
              .select('title, artist')
              .or([deviceId ? `device_id.eq.${deviceId}` : null, userId ? `user_id.eq.${userId}` : null].filter(Boolean).join(','))
              .order('created_at', { ascending: false })
              .limit(20)
          : Promise.resolve({ data: [] as Array<{ title: string; artist: string }> }),
      ]);
      const label = (r: { title: string; artist: string }) => `${r.title} (${r.artist})`;
      const popularTracks = (popular ?? []).map(label);
      const servedTracks = (served ?? []).map(label);
      // Capped: the list is pure prompt weight, and past ~40 titles it buys
      // almost no extra variety.
      avoidTracks = Array.from(new Set([...avoidTracks, ...servedTracks, ...popularTracks])).slice(0, 40);
      console.log(`🚫 Excluding ${popularTracks.length} over-served + ${servedTracks.length} already-served tracks`);
    } catch (err) {
      console.warn("⚠️ recommendation_log lookup failed, continuing without it:", err);
    }
  }

  // 2c) The charge.
  //
  // Only for callers that asked to be charged, and asking is a claim the gate
  // in 1b has already tested: unchecked, this whole block is opt-in and the
  // way out is deleting one field.
  //
  // A request that gets through with contract 1 pays for itself on the client,
  // because that build re-reads its balance AFTER any server charge would
  // land, computes old-1 from that, writes it, and then demands a later read
  // equal to its own arithmetic. Charging such a client either takes two
  // credits or makes it withhold a match the user already paid for. There is
  // no version of charging an old build that is not worse than not charging
  // it.
  //
  // Placed before the image is fetched and long before OpenAI, so a caller with
  // no balance costs nothing, and so a replay short-circuits before any work.
  let heldScanId: string | undefined;
  let chargeMeter: string | undefined;
  let creditsBalance: number | null = null;

  if (contract >= 2) {
    if (!userId) {
      return jsonResponse({ error: "Unauthorized", code: "auth_required" }, 401);
    }
    if (!scanId) {
      return jsonResponse({ error: "Missing scanId", code: "bad_request" }, 400);
    }
    if (!logClient) {
      // No service role means no way to charge. Refusing is the only honest
      // answer: serving would be a free match for anyone who noticed.
      console.error("❌ contract 2 request but no service role key");
      return jsonResponse({ error: "Server misconfiguration" }, 500);
    }

    const requestHash = await requestFingerprint({
      imagePath: imagePath ?? null,
      imageUrl: imagePath ? null : imageUrl,
      vibe: vibe ?? null,
      avoidTracks: avoidTracks ?? [],
      avoidArtists: avoidArtists ?? [],
      hasTasteProfile: !!tasteProfile,
    });

    const { data: chargeRows, error: chargeError } = await logClient.rpc('charge_scan', {
      p_user: userId,
      p_scan_id: scanId,
      p_request_hash: requestHash,
      // Absent means the server falls back to a rolling 24 hours for the Pro
      // cap, which needs no timezone and is never more generous than the
      // 09:00-local rule it stands in for.
      p_tz_offset_minutes: tzOffsetMinutes ?? null,
    });

    if (chargeError) {
      console.error("❌ charge_scan failed:", chargeError.message);
      return jsonResponse({ error: "Could not start the match", code: "charge_failed" }, 503);
    }

    const charge = Array.isArray(chargeRows) ? chargeRows[0] : chargeRows;
    chargeMeter = charge?.meter;
    creditsBalance = typeof charge?.balance === "number" ? charge.balance : null;

    if (charge?.outcome === "insufficient") {
      return jsonResponse({
        error: "Out of credits",
        code: "insufficient_credits",
        credits: { balance: creditsBalance ?? 0 },
      }, 402);
    }
    if (charge?.outcome === "conflict") {
      return jsonResponse({
        error: "That match id is already in use for a different photo",
        code: "scan_conflict",
      }, 409);
    }
    if (charge?.outcome === "replay" && charge?.response) {
      // Delivered before. Hand back the same answer rather than running the
      // model again and charging for it. After 20260909040000, charge_scan
      // only says 'replay' for a settled row with a real payload, so the
      // response check is belt and braces: against an older database a held or
      // refunded row could still replay with nothing in it, and answering 200
      // with no songs is the exact bug that migration fixes. Without a payload
      // this falls through to the 503 below, which is a failure the client
      // already handles and a retry can clear.
      console.log("♻️ replaying a settled scan", scanId);
      return jsonResponse({ ...charge.response, credits: { balance: creditsBalance, meter: chargeMeter } }, 200);
    }
    if (charge?.outcome === "in_flight") {
      // The same scan is already running. Starting a second model run would be
      // a second paid call against one credit, and whichever finished last
      // would decide what the user sees.
      console.warn("⏳ scan already in flight", scanId);
      return jsonResponse({
        error: "That match is already running",
        code: "scan_in_flight",
        credits: { balance: creditsBalance },
      }, 409);
    }
    if (charge?.outcome !== "charged" && charge?.outcome !== "pro") {
      console.error("❌ unexpected charge outcome:", charge?.outcome);
      return jsonResponse({ error: "Could not start the match", code: "charge_failed" }, 503);
    }

    heldScanId = scanId;
  }

  /**
   * Every exit after the charge goes through one of these two, so a credit can
   * never be kept for work that was not delivered. `respond` refunds;
   * `settleAndRespond` is used at the single success return.
   */
  const respond = async (payload: any, status = 200): Promise<Response> => {
    if (heldScanId && logClient && userId) {
      const { data, error } = await logClient.rpc('refund_scan', {
        p_user: userId,
        p_scan_id: heldScanId,
        p_reason: `status ${status}`,
      });
      if (error) console.error("🚨 refund failed, hold left for the sweeper:", error.message);
      else creditsBalance = typeof data === "number" ? data : creditsBalance;
      heldScanId = undefined;
    }
    const withCredits = contract >= 2
      ? { ...payload, credits: { balance: creditsBalance, meter: chargeMeter } }
      : payload;
    return jsonResponse(withCredits, status);
  };

  const refundThen = async (response: Response): Promise<Response> => {
    if (heldScanId && logClient && userId) {
      const { error } = await logClient.rpc('refund_scan', {
        p_user: userId,
        p_scan_id: heldScanId,
        p_reason: 'spotify auth failure',
      });
      if (error) console.error("🚨 refund failed, hold left for the sweeper:", error.message);
      heldScanId = undefined;
    }
    return response;
  };

  const settleAndRespond = async (payload: any): Promise<Response> => {
    if (heldScanId && logClient && userId) {
      const { error } = await logClient.rpc('settle_scan', {
        p_user: userId,
        p_scan_id: heldScanId,
        p_response: payload,
      });
      if (error) console.warn("⚠️ settle_scan failed, the sweeper will refund a delivered match:", error.message);
      heldScanId = undefined;
    }
    const withCredits = contract >= 2
      ? { ...payload, credits: { balance: creditsBalance, meter: chargeMeter } }
      : payload;
    return jsonResponse(withCredits, 200);
  };

  // 3) Load API keys
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    console.error("❌ OPENAI_API_KEY not set");
    return await respond({
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
    return await respond({
      error: "Failed to fetch or encode image"
    }, 502);
  }

  // 5) Build OpenAI prompt
  const tasteBlock = buildTasteBlock(tasteProfile);
  const hasTaste = !!tasteBlock;
  const manualTaste = hasTaste && isManualTaste(tasteProfile);
  // A manual taste profile steers the picks into the user's own scene, where
  // Spotify's catalog is thinner and per-pick resolution is lowest. Give those
  // requests one spare pick so a stricter artist gate cannot push them under
  // the three songs the app needs. English-taste requests pay nothing.
  const poolSize = manualTaste ? 6 : 5;
  const systemPrompt = buildSystemPrompt(avoidTracks, avoidArtists, hasTaste, manualTaste, poolSize);
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
                  // Shown instead of `reason` when the exact track does not
                  // resolve, so a substituted pick still explains itself.
                  artist_reason: { type: "string" },
                  mood_tags: {
                    type: "array",
                    items: { type: "string" }
                  },
                  search_query: { type: "string" }
                },
                required: ["title", "artist", "reason", "artist_reason", "mood_tags", "search_query"],
                additionalProperties: false
              },
              minItems: poolSize,
              maxItems: poolSize
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

  // Token counts from the model, surfaced only when the caller passes debug.
  let openaiUsage: any = null;
  let openaiResp: Response;
  try {
    const headers = {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json"
    };
    
    console.log("📤 Request headers:", {
      // Presence and length only. This used to print the first 20 characters
      // of the header, which is "Bearer " plus 13 live characters of the
      // OpenAI key, into a log anyone with dashboard access can read. The line
      // above already does it the right way.
      hasAuthorization: !!headers["Authorization"],
      authorizationLength: headers["Authorization"].length,
      contentType: headers["Content-Type"]
    });
    
    openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("❌ Network error calling OpenAI:", err);
    return await respond({
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
    
    return await respond({
      error: "OpenAI request failed",
      details: errBody
    }, openaiResp.status);
  }

  // 7) Parse OpenAI response
  let openaiData: any;
  try {
    const result = await openaiResp.json();
    openaiUsage = result?.usage ?? null;
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

    if (openaiData.recommendations.length !== 5) {
      console.warn(`⚠️ Expected 5 recommendations, got ${openaiData.recommendations.length}`);
    }

    console.log(`✅ Got ${openaiData.recommendations.length} recommendations from OpenAI`);
  } catch (err) {
    console.error("❌ Failed to parse OpenAI response:", err);
    return await respond({
      error: "Failed to parse OpenAI response",
      message: "We couldn't process the music recommendations. Please try again."
    }, 500);
  }

  // 8) Resolve tracks via Spotify
  const spotifyToken = await getSpotifyToken();
  if (!spotifyToken) {
    // No app token means no spotify_url, no artwork and no preview on any card.
    // This used to ship the model's picks anyway through respond(), which
    // REFUNDS - and the client counts three or more songs as a delivered
    // match. So the user got the match and the credit back, and could match
    // the same photo again for free for as long as our Spotify credentials
    // were down.
    //
    // Refusing is the honest settlement of the two: the failure is ours, the
    // user keeps their credit, and songs nobody can play are not the product.
    // It is also the same answer this function already gives when Spotify auth
    // fails a few lines later, and the client has a retryable message for that
    // exact code (scanErrors 'spotify_unavailable').
    console.error("❌ No Spotify app token; refusing rather than shipping unplayable songs");
    return await refundThen(spotifyAuthErrorResponse());
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
      spotifySearchState,
      market
    );

    if (track) {
      resolvedSongs.push(shippedSong(rec, track));
    } else {
      // The title did not resolve. Outside the English-language mainstream
      // the model often names a real artist but invents a track title, and
      // the strict title gate then throws the whole pick away. Falling back
      // to that artist's most popular track keeps a real, correct-scene song
      // instead of failing the request. The artist is still verified, so a
      // hallucinated artist is dropped as before.
      const tops = await topTracksForArtist(rec.artist, spotifyToken, spotifySearchState, market);

      // Rescue first: the wanted title may be right there in the artist's top
      // ten, unreachable by search only because of spelling or script. Matched
      // with the same cross-script scorer as the searches, so it ships as the
      // real pick with its real reason, not as a substitution.
      const rescued = tops.length
        ? bestTrackMatch(tops, (rec.title || "").toLowerCase().trim(), (rec.artist || "").toLowerCase().trim())
        : null;
      if (rescued) {
        console.log(`🩹 rescued "${rec.title}" by "${rec.artist}" from the artist's top tracks`);
        resolvedSongs.push(shippedSong(rec, rescued));
        continue;
      }

      // The pick did not exist. Let the model choose among songs that do, and
      // write about the one it chose, so this ships as a real pick with a
      // true reason rather than as a substitution with a notice.
      if (tops.length && openaiKey) {
        const chosen = await chooseFromCatalogue(rec, tops, vibe, openaiKey);
        if (chosen) {
          console.log(`🎯 catalogue pick for "${rec.artist}": "${chosen.track?.name}" (asked for "${rec.title}")`);
          resolvedSongs.push({
            ...shippedSong(rec, chosen.track),
            reason: chosen.reason,
            mood_tags: rec.mood_tags ?? [],
            match_kind: "catalogue",
          });
          continue;
        }
      }

      const fallback = tops[0] ?? null;
      if (fallback) {
        // Print the artist we are actually shipping. The old line printed
        // rec.artist, so a swap read as "using X by Billy" and concealed that
        // the card would say Billy Idol.
        console.warn(
          `↩️ "${rec.title}" by "${rec.artist}" not found; using "${fallback.name}" by "${fallback.artists?.[0]?.name}" instead`
        );
        resolvedSongs.push(shippedSong(rec, fallback));
      } else {
        console.warn(`⚠️ Could not find "${rec.title}" by "${rec.artist}" on Spotify`);
        failedSongs.push(rec);
      }
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
        return await refundThen(spotifyAuthErrorResponse());
      }
      return await respond({
        error: "No matches found",
        message: "We couldn't find any songs matching your request on Spotify. Please try a different search.",
        // null = every Spotify Search call returned 2xx; failure was empty results or strict title/artist scoring
        lastSpotifyHttpStatus: spotifySearchState.lastHttpStatus ?? null,
        // What the model asked for, so a resolution failure can be told apart
        // from a bad prompt without reading the function logs.
        requested: failedSongs.map((s: any) => `${s.title} - ${s.artist}`),
      }, 404);
    }
  }

  // 10) Rank exact resolutions ahead of artist-level substitutions before the
  // dedupe and the slice, so the hero card carries a reason written for the
  // song it is showing whenever any pick resolved exactly. Model rank breaks
  // ties, so the order inside each group is the order the model asked for.
  const rankedSongs = resolvedSongs
    .map((song, index) => ({ song, index }))
    .sort((a, b) => {
      const aKind = a.song.match_kind === "exact" ? 0 : 1;
      const bKind = b.song.match_kind === "exact" ? 0 : 1;
      return aKind - bKind || a.index - b.index;
    })
    .map((entry) => entry.song);

  // 11) Check for duplicate artists (safety net)
  const artistSet = new Set<string>();
  const deduplicatedSongs: any[] = [];

  for (const song of rankedSongs) {
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
      return await respond({
        ...(debugUsage && openaiUsage ? { usage: { prompt: openaiUsage.prompt_tokens, completion: openaiUsage.completion_tokens, total: openaiUsage.total_tokens } } : {}),
        songs: deduplicatedSongs,
        warning: failedSongs.length > 0 ? `${failedSongs.length} song(s) could not be found on Spotify` : undefined,
        has_taste: hasTaste,
        resolution: {
          exact: deduplicatedSongs.filter((s: any) => s.match_kind === "exact").length,
          artist: deduplicatedSongs.filter((s: any) => s.match_kind !== "exact").length,
          failed: failedSongs.length,
        },
      }, 200);
    } else {
      // No songs found at all - return error
      if (isSpotifyAuthFailure(spotifySearchState.lastHttpStatus)) {
        return await refundThen(spotifyAuthErrorResponse());
      }
      // Say what was asked for. Without this a resolution failure is a black
      // box: the model may have picked fine songs that Spotify could not
      // match, and there is no way to tell that from a bad prompt.
      return await respond({
        error: "No matches found",
        message: "We couldn't find any songs matching your request on Spotify. Please try a different search.",
        lastSpotifyHttpStatus: spotifySearchState.lastHttpStatus ?? null,
        requested: (openaiData?.recommendations ?? []).map((r: any) => `${r?.title} - ${r?.artist}`),
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

  const shipped = deduplicatedSongs.slice(0, 3);
  const resolution = {
    exact: shipped.filter((s: any) => s.match_kind === "exact").length,
    catalogue: shipped.filter((s: any) => s.match_kind === "catalogue").length,
    artist: shipped.filter((s: any) => s.match_kind === "artist").length,
    failed: failedSongs.length,
    // The picks that resolved to nothing, so a stored result says what was
    // asked for and not merely how many were lost.
    unresolved: failedSongs.map((r: any) => ({ title: r?.title ?? null, artist: r?.artist ?? null })),
  };
  const usage = openaiUsage
    ? { prompt: openaiUsage.prompt_tokens, completion: openaiUsage.completion_tokens, total: openaiUsage.total_tokens }
    : null;
  console.log("💸 tokens", JSON.stringify(usage));
  // Record what we ship so the next request can avoid it. Fire and forget.
  if (logClient) {
    logClient
      .from('recommendation_log')
      .insert(
        shipped.map((s: any) => ({
          vibe: vibe ?? null,
          title: s.title,
          artist: s.artist,
          spotify_url: s.spotify_url ?? null,
          device_id: deviceId ?? null,
          user_id: userId ?? null,
          ip: clientIp,
        }))
      )
      .then(({ error }) => {
        if (error) console.warn("⚠️ recommendation_log insert failed:", error.message);
      });
  }

  return await settleAndRespond({
    ...(debugUsage && usage ? { usage } : {}),
    songs: shipped, // Ensure exactly 3
    // Whether a Spotify taste profile shaped these picks, so the client can
    // tell personalized results from generic ones.
    has_taste: hasTaste,
    // How many shipped picks are the song the model actually named. Without
    // this the substitution rate is invisible outside the function logs.
    resolution,
  });
});
