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

async function findTrackOnSpotify(
  title: string, 
  artist: string, 
  searchQuery: string,
  accessToken: string,
  state?: SpotifySearchState
): Promise<any | null> {
  try {
    // First try exact search with track:"title" artist:"artist"
    let query = searchQuery || `track:"${title}" artist:"${artist}"`;
    let encodedQuery = encodeURIComponent(query);
    const primarySearchUrl = `https://api.spotify.com/v1/search?q=${encodedQuery}&type=track&limit=10`;
    console.log("🎵 Spotify search [primary] query:", query, "| encoded q param:", encodedQuery, "| url:", primarySearchUrl);

    let response = await fetch(primarySearchUrl, {
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

      response = await fetch(fallbackSearchUrl, {
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
      
      let bestMatch: any = null;
      let bestScore = 0;
      
      for (const track of fallbackTracks) {
        const trackTitle = track.name?.toLowerCase().trim() || "";
        const trackArtist = track.artists?.[0]?.name?.toLowerCase().trim() || "";
        
        let score = 0;
        
        if (trackTitle === normalizedTitle && trackArtist === normalizedArtist) {
          return track; // Perfect match
        }
        
        if (trackTitle === normalizedTitle) {
          score += 40;
        } else if (trackTitle.includes(normalizedTitle) || normalizedTitle.includes(trackTitle)) {
          score += 20;
        }
        
        if (trackArtist === normalizedArtist) {
          score += 60;
        } else if (trackArtist.includes(normalizedArtist) || normalizedArtist.includes(trackArtist)) {
          score += 30;
        } else {
          score -= 50; // No artist match
        }
        
        if (score > bestScore) {
          bestScore = score;
          bestMatch = track;
        }
      }
      
      // Only return if we have a decent match
      if (bestMatch && bestScore >= 30) {
        console.log(`✅ Found fallback match for "${title}" by "${artist}": "${bestMatch.name}" by "${bestMatch.artists[0]?.name}" (score: ${bestScore})`);
        return bestMatch;
      }
      
      console.warn(`⚠️ No good fallback match found for "${title}" by "${artist}". Best score: ${bestScore}`);
      return null;
    }

    // Find best match by comparing title and artist similarity
    const normalizedTitle = title.toLowerCase().trim();
    const normalizedArtist = artist.toLowerCase().trim();
    
    // Score tracks by match quality
    let bestMatch: any = null;
    let bestScore = 0;
    
    for (const track of tracks) {
      const trackTitle = track.name?.toLowerCase().trim() || "";
      const trackArtist = track.artists?.[0]?.name?.toLowerCase().trim() || "";
      
      let score = 0;
      
      // Exact match = highest score
      if (trackTitle === normalizedTitle && trackArtist === normalizedArtist) {
        return track; // Return immediately for perfect match
      }
      
      // Title similarity (40 points max)
      if (trackTitle === normalizedTitle) {
        score += 40;
      } else if (trackTitle.includes(normalizedTitle) || normalizedTitle.includes(trackTitle)) {
        score += 20; // Partial match
      }
      
      // Artist similarity (60 points max - more important)
      if (trackArtist === normalizedArtist) {
        score += 60;
      } else if (trackArtist.includes(normalizedArtist) || normalizedArtist.includes(trackArtist)) {
        score += 30; // Partial artist match
      } else {
        // No artist match at all - very low score
        score -= 50;
      }
      
      // Update best match if this score is higher
      if (score > bestScore) {
        bestScore = score;
        bestMatch = track;
      }
    }
    
    // Only return if we have a decent match (at least some artist similarity)
    // Require minimum score of 30 to ensure at least partial artist match
    if (bestMatch && bestScore >= 30) {
      console.log(`✅ Found match for "${title}" by "${artist}": "${bestMatch.name}" by "${bestMatch.artists[0]?.name}" (score: ${bestScore})`);
      return bestMatch;
    }
    
    // No good match found
    console.warn(`⚠️ No good match found for "${title}" by "${artist}". Best score: ${bestScore}`);
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

/**
 * Build system prompt based on mode
 */
function buildSystemPrompt(
  useCustomRequest: boolean,
  avoidTracks: string[],
  avoidArtists: string[]
): string {
  const avoidSection = avoidTracks.length > 0 || avoidArtists.length > 0
    ? `\n\nAVOID THESE (do not recommend):\n${avoidTracks.length > 0 ? `- Tracks: ${avoidTracks.join(", ")}\n` : ""}${avoidArtists.length > 0 ? `- Artists: ${avoidArtists.join(", ")}\n` : ""}`
    : "";

  if (useCustomRequest) {
    return `You are VibeMatch, a music curator. Given a custom request, recommend 3 non-obvious real songs that match it.

Hard rules:
- Output MUST be valid JSON matching the schema. No extra text.
- Recommend exactly 3 tracks (no more, no less).
- No repeated artist (each track must have a different artist).
- Avoid ultra-mainstream, over-recommended staples (no "default playlist" picks like Mr. Brightside, Bohemian Rhapsody, etc.).
- Ensure diversity: at least 2 distinct subgenres OR eras across the 3 tracks.
- Only suggest songs you are confident exist (title + primary artist).
- Prefer deep cuts and non-obvious picks over top hits.
- IMPORTANT: Unless the request specifically mentions Bulgarian/chalga/BG music, recommend international (primarily English) songs. Only suggest Bulgarian songs if explicitly requested.
${avoidSection}

Return JSON with this structure:
{
  "recommendations": [
    {
      "title": "REAL song title",
      "artist": "REAL artist name",
      "reason": "1-2 sentences: why this matches the request",
      "mood_tags": ["tag1", "tag2", "tag3"],
      "search_query": "track:\\"title\\" artist:\\"artist\\""
    }
  ]
}`;
  }

  return `You are VibeMatch, a music curator. Given an image, infer the mood/scene/subtext and propose 3 non-obvious real songs.

Hard rules:
- Output MUST be valid JSON matching the schema. No extra text.
- Recommend exactly 3 tracks (no more, no less).
- No repeated artist (each track must have a different artist).
- Avoid ultra-mainstream, over-recommended staples (no "default playlist" picks like Mr. Brightside, Bohemian Rhapsody, etc.).
- Ensure diversity: at least 2 distinct subgenres OR eras across the 3 tracks.
- Only suggest songs you are confident exist (title + primary artist).
- Prefer deep cuts and non-obvious picks over top hits.
- IMPORTANT: Recommend ONLY international (primarily English) songs. DO NOT recommend Bulgarian/chalga/BG music unless the image or context explicitly shows Bulgarian content or culture. Default to English-language music.
${avoidSection}

Return JSON with this structure:
{
  "recommendations": [
    {
      "title": "REAL song title",
      "artist": "REAL artist name",
      "reason": "1-2 sentences: visual cue -> emotional inference -> musical match",
      "mood_tags": ["tag1", "tag2", "tag3"],
      "search_query": "track:\\"title\\" artist:\\"artist\\""
    }
  ]
}`;
}

/**
 * Build user prompt
 */
function buildUserPrompt(params: {
  customRequest?: string;
  hasCustomRequest?: boolean;
  genre?: string;
  hasGenre?: boolean;
}): string {
  const { customRequest, hasCustomRequest, genre, hasGenre } = params;
  
  const useCustomRequest = hasCustomRequest && customRequest && customRequest.trim();
  const useGenre = !useCustomRequest && hasGenre && genre && genre !== "N/A";
  
  if (useCustomRequest) {
    return `Custom request: "${customRequest.trim()}"

Recommend 3 songs that match this request. Prefer unexpected-but-accurate picks over obvious hits.
IMPORTANT: Unless the request specifically mentions Bulgarian/chalga/BG music, recommend ONLY international (primarily English) songs. Only suggest Bulgarian songs if explicitly requested.`;
  } else if (useGenre) {
    return `Recommend songs in the "${genre}" genre. The image should complement the genre selection.
IMPORTANT: Recommend ONLY international (primarily English) songs in this genre. DO NOT recommend Bulgarian/chalga/BG music unless explicitly part of the genre request.`;
  } else {
    return `Analyze the image and recommend 3 songs that match the atmosphere, color palette, energy, and implied story. Prefer unexpected-but-accurate picks over obvious hits.
IMPORTANT: Recommend ONLY international (primarily English) songs. DO NOT recommend Bulgarian/chalga/BG music.`;
  }
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
  let genre: string | undefined;
  let customRequest: string | undefined;
  let hasCustomRequest: boolean;
  let hasGenre: boolean;
  let avoidTracks: string[] = [];
  let avoidArtists: string[] = [];

  try {
    const body = await req.json();
    imageUrl = body.imageUrl;
    genre = body.genre;
    customRequest = body.customRequest;
    hasCustomRequest = body.hasCustomRequest ?? !!(customRequest && customRequest.trim());
    hasGenre = body.hasGenre ?? !!(genre && genre !== "N/A" && !hasCustomRequest);
    // Only use userId from body if we didn't get it from auth header
    if (!userId) {
      userId = body.userId;
    }
    avoidTracks = body.avoidTracks || [];
    avoidArtists = body.avoidArtists || [];

    console.log("📥 Body:", {
      imageUrl: imageUrl ? `${imageUrl.substring(0, 50)}...` : 'N/A',
      genre,
      customRequest,
      hasCustomRequest,
      hasGenre,
      userId: userId || 'N/A',
      avoidTracks: avoidTracks.length,
      avoidArtists: avoidArtists.length
    });

    if (!imageUrl) {
      return jsonResponse({
        error: "imageUrl is required"
      }, 400);
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
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? ''
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

        // Extract unique track IDs and artist names
        const seenTracks = new Set<string>();
        const seenArtists = new Set<string>();

        allSongs.forEach((song: any) => {
          if (song.spotify_url) {
            const trackId = song.spotify_url.split('/track/')[1]?.split('?')[0];
            if (trackId) seenTracks.add(trackId);
          }
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
  let dataUrl: string;
  try {
    dataUrl = await toBase64DataURL(imageUrl);
    console.log("🔗 Data URL length:", dataUrl.length);
  } catch (err) {
    console.error("❌ Image conversion failed:", err);
    return jsonResponse({
      error: "Failed to fetch or encode image"
    }, 502);
  }

  // 5) Build OpenAI prompt
  const useCustomRequest = !!(hasCustomRequest && customRequest && customRequest.trim());
  const systemPrompt = buildSystemPrompt(useCustomRequest, avoidTracks, avoidArtists);
  const userText = buildUserPrompt({
    customRequest,
    hasCustomRequest,
    genre,
    hasGenre
  });

  console.log("📝 System prompt length:", systemPrompt.length);
  console.log("📝 User prompt:", userText);

  // Build messages
  const messages: any[] = [
    {
      role: "system",
      content: systemPrompt
    }
  ];

  if (useCustomRequest && customRequest) {
    messages.push({
      role: "user",
      content: userText
    });
  } else {
    messages.push({
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
    });
  }

  // 6) Call OpenAI with structured output
  const payload = {
    model: "gpt-4o",
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
              minItems: 3,
              maxItems: 3
            }
          },
          required: ["recommendations"],
          additionalProperties: false
        }
      }
    },
    max_tokens: 800,
    temperature: 0.6 // Balanced: creativity in content, reliability in structure (0.5-0.7 range)
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

    if (openaiData.recommendations.length !== 3) {
      console.warn(`⚠️ Expected 3 recommendations, got ${openaiData.recommendations.length}`);
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
        album_cover: null
      }))
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
        album_cover: track.album?.images?.[0]?.url
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

  // 11) Ensure we have exactly 3 songs
  if (deduplicatedSongs.length < 3) {
    console.warn(`⚠️ Only got ${deduplicatedSongs.length} songs after deduplication, need 3`);
    
    // If we have at least 1 song, return what we have (better UX than error)
    // In production, you could implement retry logic here to get replacements
    if (deduplicatedSongs.length > 0) {
      console.warn("⚠️ Returning partial results - some songs not found on Spotify or had duplicate artists");
      return jsonResponse({
        songs: deduplicatedSongs,
        warning: failedSongs.length > 0 ? `${failedSongs.length} song(s) could not be found on Spotify` : undefined
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
    songs: deduplicatedSongs.slice(0, 3) // Ensure exactly 3
  }, 200);
});
