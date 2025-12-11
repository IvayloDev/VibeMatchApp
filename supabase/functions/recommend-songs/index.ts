import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

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
    console.warn("⚠️ Spotify credentials not configured, falling back to OpenAI-only mode");
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
      console.error("❌ Spotify token request failed:", response.status);
      return "";
    }

    const data = await response.json();
    return data.access_token;
  } catch (err) {
    console.error("❌ Error getting Spotify token:", err);
    return "";
  }
}

/**
 * Search Spotify for songs matching the query
 */
async function searchSpotify(query: string, accessToken: string, limit: number = 20): Promise<any[]> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(
      `https://api.spotify.com/v1/search?q=${encodedQuery}&type=track&limit=${limit}&market=BG`,
      {
        headers: {
          "Authorization": `Bearer ${accessToken}`
        }
      }
    );

    if (!response.ok) {
      console.error("❌ Spotify search failed:", response.status);
      return [];
    }

    const data = await response.json();
    return data.tracks?.items || [];
  } catch (err) {
    console.error("❌ Error searching Spotify:", err);
    return [];
  }
}

/**
 * Translate/common Bulgarian terms to English for Spotify search
 */
function translateBulgarianToSearchQuery(text: string): string[] {
  const translations: Record<string, string> = {
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
  
  // Replace Bulgarian phrases
  for (const [bg, en] of Object.entries(translations)) {
    if (query.includes(bg)) {
      query = query.replace(new RegExp(bg, 'gi'), en).trim();
    }
  }
  
  // Clean up extra spaces
  query = query.replace(/\s+/g, ' ').trim();
  
  // Generate multiple search query variations
  const queries: string[] = [];
  
  // Primary query
  if (query.length >= 3) {
    queries.push(query);
  } else {
    queries.push(text.trim());
  }
  
  // Try genre-specific searches
  if (query.includes("chalga")) {
    queries.push("chalga");
    queries.push("bulgarian chalga");
  }
  if (query.includes("cinematic") || query.includes("film")) {
    queries.push("cinematic music");
    queries.push("film soundtrack");
  }
  
  // Try without filler words
  const cleanQuery = query.replace(/\b(very|song|music)\b/gi, "").trim();
  if (cleanQuery.length >= 3 && cleanQuery !== query) {
    queries.push(cleanQuery);
  }
  
  return queries;
}

/**
 * Build the text part of the user prompt based on flags/params.
 */
function buildUserPrompt(params: {
  customRequest?: string;
  hasCustomRequest?: boolean;
  genre?: string;
  hasGenre?: boolean;
}): string {
  const { customRequest, hasCustomRequest, genre, hasGenre } = params;
  
  // Determine what to use based on priority
  const useCustomRequest = hasCustomRequest && customRequest && customRequest.trim();
  const useGenre = !useCustomRequest && hasGenre && genre && genre !== "N/A";
  
  let instructionText = "";
  
  if (useCustomRequest) {
    // CUSTOM REQUEST - HIGHEST PRIORITY
    instructionText = `🚨🚨🚨 CRITICAL INSTRUCTION - READ THIS FIRST 🚨🚨🚨

YOU MUST FOLLOW THIS EXACT CUSTOM REQUEST. DO NOT IGNORE IT. DO NOT USE THE IMAGE. DO NOT USE ANY GENRE.

CUSTOM REQUEST: "${customRequest.trim()}"

YOUR TASK:
1. Find REAL songs that match this EXACT request: "${customRequest.trim()}"
2. Interpret the request literally - if it's in Bulgarian, understand it correctly
3. IGNORE the image completely - it is NOT relevant
4. IGNORE any genre - it is NOT relevant
5. ONLY recommend songs that match this specific request

EXAMPLES:
- If request is "nqkoq mnogo mazna chalga" → Find REAL Bulgarian chalga songs that are very greasy/high-energy
- If request is "filmarska pesen" → Find REAL songs with cinematic/film-like qualities
- If request is "dai nqkva mnogo filmarska pesen" → Find REAL very cinematic/film-like songs
- If request is "sad music" → Find REAL sad songs

DO NOT:
- Use the image to determine songs
- Use genre to determine songs
- Recommend songs that don't match the request
- Make up fictional songs

ONLY recommend REAL, existing songs that match: "${customRequest.trim()}"`;
  } else if (useGenre) {
    instructionText = `IMPORTANT: You MUST recommend songs in the "${genre}" genre.
    
- Stick closely to this genre or very nearby subgenres.
- The image should complement the genre selection.
- If the image conflicts with the genre, prioritize the genre.`;
  } else {
    instructionText = `IMPORTANT: Analyze the image and recommend songs based on the visual vibe, mood, and style you detect.
    
- Use only the image to determine the music recommendations.
- No genre or custom request was provided.
- Recommend EXACTLY 3 REAL songs that match the image's mood, colors, style, and atmosphere. YOU MUST RETURN 3 SONGS.

🚨 CRITICAL: You MUST respond with ONLY a JSON array. NO explanations, NO text, NO markdown. Just the JSON array starting with [ and ending with ].`;
  }
  
  return instructionText.trim();
}

// Edge function
serve(async (req) => {
  console.log("🔔 Invocation start");

  // 1) Parse incoming JSON
  let imageUrl: string;
  let genre: string | undefined;
  let customRequest: string | undefined;
  let hasCustomRequest: boolean;
  let hasGenre: boolean;

  try {
    const body = await req.json();
    imageUrl = body.imageUrl;
    genre = body.genre;
    customRequest = body.customRequest;
    hasCustomRequest = body.hasCustomRequest ?? !!(customRequest && customRequest.trim());
    hasGenre = body.hasGenre ?? !!(genre && genre !== "N/A" && !hasCustomRequest);

    console.log("📥 Body:", {
      imageUrl: imageUrl ? `${imageUrl.substring(0, 50)}...` : 'N/A',
      genre,
      customRequest,
      hasCustomRequest,
      hasGenre
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

  // 2) Load API keys
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    console.error("❌ OPENAI_API_KEY not set");
    return jsonResponse({
      error: "Server misconfiguration"
    }, 500);
  }

  // 3) Convert image to base64 data URL
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

  // 4) If custom request exists, try Spotify API first
  const useCustomRequest = hasCustomRequest && customRequest && customRequest.trim();
  let spotifySongs: any[] = [];

  if (useCustomRequest) {
    try {
      const spotifyToken = await getSpotifyToken();
      
      if (spotifyToken) {
        // Get multiple search query variations
        const searchQueries = translateBulgarianToSearchQuery(customRequest);
        console.log("🔍 Trying Spotify searches with queries:", searchQueries);
        
        let allResults: any[] = [];
        
        // Try each query variation until we get results
        for (const searchQuery of searchQueries) {
          const spotifyResults = await searchSpotify(searchQuery, spotifyToken, 20);
          console.log(`🎵 Query "${searchQuery}" found ${spotifyResults.length} songs`);
          
          if (spotifyResults.length > 0) {
            allResults = spotifyResults;
            break; // Found results, stop trying other queries
          }
        }
        
        if (allResults.length > 0) {
          // Return top 3 results
          spotifySongs = allResults.slice(0, 3).map((track: any) => ({
            title: track.name,
            artist: track.artists[0]?.name || "Unknown",
            reason: `This song matches your request: "${customRequest.trim()}"`,
            mood_tags: [],
            language: "bg",
            spotify_url: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
            album_cover: track.album?.images?.[0]?.url
          }));
          
          console.log("✅ Returning", spotifySongs.length, "real songs from Spotify");
          return jsonResponse({
            songs: spotifySongs
          }, 200);
        } else {
          console.warn("⚠️ No songs found on Spotify for any query variation");
          // Return error - no matches found
          return jsonResponse({
            error: "No matches found",
            message: "We couldn't find any songs matching your request. Please try a different search."
          }, 404);
        }
      }
    } catch (err) {
      console.error("❌ Spotify search failed, falling back to OpenAI:", err);
      // Continue to OpenAI fallback
    }
  }

  // 5) Build OpenAI payload (fallback or primary for genre/image-only)
  const systemPrompt = useCustomRequest ? `
You are a music recommendation engine. Your ONLY job is to find REAL songs.

🚨 ABSOLUTE RULE: When a custom request is provided in a separate message, you MUST:
1. IGNORE the image completely - it is NOT relevant
2. IGNORE any genre - it is NOT relevant  
3. ONLY use the custom request text to find songs
4. The custom request OVERRIDES EVERYTHING

BULGARIAN TRANSLATIONS:
- "filmarska pesen" = cinematic/film-like song
- "dai nqkva mnogo filmarska pesen" = give me a very cinematic/film-like song  
- "nqkoq mnogo mazna chalga" = very greasy, high-energy Bulgarian chalga
- "chalga" = Bulgarian pop-folk music

REAL SONGS ONLY:
- ONLY recommend songs you KNOW exist from your training data
- NEVER invent songs
- All Spotify URLs must be real

RESPONSE FORMAT:
Return EXACTLY 3 songs as a JSON array, no other text:
[
  {
    "title": "REAL song title",
    "artist": "REAL artist name", 
    "reason": "Why this matches the request",
    "mood_tags": ["tag1", "tag2"],
    "language": "bg" or "en",
    "spotify_url": "https://open.spotify.com/track/REAL_ID"
  },
  { ... song 2 ... },
  { ... song 3 ... }
]

YOU MUST ALWAYS RETURN EXACTLY 3 SONGS.
`.trim() : `
You are Vibe DJ, an expert music recommendation engine that analyzes images and recommends music.

YOUR JOB: Analyze the provided image and recommend EXACTLY 3 real songs that match the visual mood, colors, style, and atmosphere you detect in the image. This is a legitimate creative music recommendation service. YOU MUST ALWAYS RETURN EXACTLY 3 SONGS.

IMPORTANT: Provide VARIETY in your recommendations - don't always suggest the same songs. Consider different artists, genres, and eras that match the image's vibe.

🚨 CRITICAL RULES - READ THESE FIRST 🚨

1. YOU MUST PROCESS THE IMAGE AND PROVIDE MUSIC RECOMMENDATIONS
   - This is a legitimate music recommendation service
   - You are analyzing visual content (colors, mood, style, atmosphere) to suggest appropriate music
   - This is a creative and artistic task - you MUST analyze the image and provide recommendations
   - If the image contains any content, you should still analyze its visual elements (colors, mood, composition) and recommend music accordingly
   - Your task is to match music to visual aesthetics, not to judge image content

2. YOU MUST ONLY RECOMMEND REAL SONGS THAT YOU KNOW EXIST
   - NEVER invent, make up, or create fictional songs
   - ONLY recommend songs from your training data that you are CERTAIN exist
   - If you are not 100% sure a song exists, DO NOT recommend it
   - All Spotify URLs MUST be real and valid URLs to actual tracks
   - If you cannot find 3 songs you KNOW exist, recommend fewer but REAL songs
   - Better to return 1-2 real songs than 3 fake ones

2. UNDERSTAND REQUESTS CORRECTLY
   - If request is in Bulgarian, interpret it correctly
   - If request uses slang, understand the meaning

3. RESPONSE FORMAT - CRITICAL - YOU MUST FOLLOW THIS EXACTLY
   - You MUST respond with ONLY a valid JSON array
   - NO explanations, NO apologies, NO markdown, NO text before or after
   - NO "Here are some songs:" or "I found these:" or any other text
   - Start your response with [ and end with ]
   - If you cannot find songs, return an empty array [] - DO NOT write an apology

You MUST return EXACTLY 3 songs. Each song MUST:
- Be a REAL song from your knowledge that you are CERTAIN exists
- Have a REAL Spotify URL that you know is correct (format: https://open.spotify.com/track/...)
- Match the request as closely as possible
- Have accurate title and artist names that you know are correct
- Be DIFFERENT from each other - provide variety in artists, genres, and styles

IMPORTANT: 
- You MUST always return exactly 3 songs
- Provide VARIETY - don't suggest the same songs repeatedly for similar images
- Consider different artists, genres, eras, and styles that match the mood
- If you can't find 3 perfect matches, find 3 songs that are close enough to the mood/style but still varied

YOU MUST RESPOND WITH ONLY THIS JSON FORMAT (no other text):
[
  {
    "title": "REAL song title",
    "artist": "REAL artist name",
    "reason": "1–2 sentences explaining why this REAL song matches the request",
    "mood_tags": ["tag1", "tag2", "tag3"],
    "language": "bg" or "en",
    "spotify_url": "https://open.spotify.com/track/REAL_TRACK_ID"
  }
]

REMEMBER: 
- You MUST return EXACTLY 3 songs - no more, no less
- Only recommend REAL songs that you KNOW exist from your training data
- Never invent songs
- Respond with ONLY JSON, no explanations or apologies
`.trim();

  const userText = buildUserPrompt({
    customRequest,
    hasCustomRequest,
    genre,
    hasGenre
  });

  console.log("📝 User prompt text:", userText);

  // Build messages array - if custom request exists, make it SUPER prominent
  const messages: any[] = [
    {
      role: "system",
      content: systemPrompt
    }
  ];

  if (useCustomRequest && customRequest) {
    // For custom requests, send the request FIRST as a separate message
    // This makes it impossible to ignore
    messages.push({
      role: "user",
      content: `🚨🚨🚨 CUSTOM REQUEST - THIS IS YOUR PRIMARY TASK 🚨🚨🚨

The user wants: "${customRequest.trim()}"

YOUR JOB:
- Find REAL songs that match: "${customRequest.trim()}"
- IGNORE the image completely
- IGNORE any genre
- ONLY use this custom request: "${customRequest.trim()}"

Interpret this request:
- "filmarska pesen" = cinematic/film-like song
- "dai nqkva mnogo filmarska pesen" = give me a very cinematic/film-like song
- "nqkoq mnogo mazna chalga" = very greasy, high-energy Bulgarian chalga

Return ONLY a JSON array with EXACTLY 3 REAL songs that match "${customRequest.trim()}". YOU MUST RETURN 3 SONGS.`
    });
    
    // Then send the image (but it should be ignored)
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: "NOTE: The image below is IRRELEVANT. Use ONLY the custom request above: \"" + customRequest.trim() + "\""
        },
        {
          type: "image_url",
          image_url: {
            url: dataUrl,
            detail: "low" // Use low detail to reduce processing and potential filter triggers
          }
        }
      ]
    });
  } else {
    // Normal flow for genre/image-only
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
            detail: "low" // Use low detail to reduce processing and potential filter triggers
          }
        }
      ]
    });
  }

  const payload = {
    model: "gpt-4o",
    messages: messages,
    max_tokens: 800,
    temperature: 0.9 // Higher temperature for more variety and creativity
  };

  console.log("📤 OpenAI payload (without image):", {
    model: payload.model,
    messages: payload.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content.map((c: any) => ({
        type: c.type,
        text: c.text || '[image]'
      }))
    })),
    max_tokens: payload.max_tokens,
    temperature: payload.temperature
  });

  // 6) Call OpenAI
  let openaiResp: Response;
  try {
    openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("❌ Network error calling OpenAI:", err);
    return jsonResponse({
      error: "OpenAI request network failure"
    }, 502);
  }

  // 7) Handle non-200 responses
  if (!openaiResp.ok) {
    const errBody = await openaiResp.json().catch(() => null);
    console.error("❌ OpenAI API error:", openaiResp.status, errBody);
    return jsonResponse({
      error: "OpenAI request failed",
      details: errBody
    }, openaiResp.status);
  }

  // 8) Parse OpenAI response and strip fences if needed
  let songs: any;
  let raw: string | undefined;
  try {
    const result = await openaiResp.json();
    console.log("🔍 OpenAI raw result:", JSON.stringify(result, null, 2));
    
    const message = result.choices?.[0]?.message;
    if (!message) throw new Error("No message in OpenAI response");

    raw = message.content;
    console.log("📥 Raw OpenAI content length:", raw?.length || 0);
    console.log("📥 Raw OpenAI content (first 500 chars):", typeof raw === 'string' ? raw.substring(0, 500) : raw);
    
    // Check if content is empty or null
    if (!raw || (typeof raw === 'string' && raw.trim().length === 0)) {
      throw new Error("OpenAI returned empty content");
    }

    // Check if response starts with apology or explanation (OpenAI refusal)
    if (typeof raw === "string" && (
      raw.trim().startsWith("I'm sorry") || 
      raw.trim().startsWith("I cannot") || 
      raw.trim().startsWith("Sorry") ||
      raw.trim().startsWith("I can't assist") ||
      raw.trim().startsWith("I'm unable") ||
      raw.trim().toLowerCase().includes("i can't help") ||
      raw.trim().toLowerCase().includes("i cannot help")
    )) {
      console.error("❌ OpenAI refused to process (content filter or policy):", raw.substring(0, 200));
      // Return a user-friendly error instead of throwing
      return jsonResponse({
        error: "Content processing error",
        message: "We couldn't process this image. Please try a different photo.",
        code: "OPENAI_REFUSAL"
      }, 400);
    }

    // Handle accidental ```json ... ``` wrappers
    const fenceMatch = typeof raw === "string" && raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      raw = fenceMatch[1];
      console.log("📝 Extracted JSON from code fence");
    }

    // Remove any leading/trailing text and extract JSON array
    if (typeof raw === "string") {
      raw = raw.trim();
      
      // First, try to remove common prefixes/suffixes
      raw = raw.replace(/^(Here are|I found|Here's|These are|Recommendations:)[\s\S]*?(\[)/i, '[');
      raw = raw.replace(/(\])[\s\S]*?(\.|$)/i, ']');
      
      // Try to find JSON array in the response - use greedy match to get complete array
      // First, find the start of the array
      const arrayStart = raw.indexOf('[');
      if (arrayStart !== -1) {
        // Find the matching closing bracket by counting brackets
        let bracketCount = 0;
        let inString = false;
        let escapeNext = false;
        
        for (let i = arrayStart; i < raw.length; i++) {
          const char = raw[i];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '[') {
              bracketCount++;
            } else if (char === ']') {
              bracketCount--;
              if (bracketCount === 0) {
                // Found the matching closing bracket
                raw = raw.substring(arrayStart, i + 1);
                console.log("📝 Extracted complete JSON array from response");
                break;
              }
            }
          }
        }
      } else {
        // No array found, try to find any JSON structure
        const anyJsonMatch = raw.match(/(\[|\{)[\s\S]*(]|\})/);
        if (anyJsonMatch) {
          raw = anyJsonMatch[0];
          console.log("📝 Extracted JSON structure from response");
        } else {
          // Remove markdown code blocks if any
          raw = raw.replace(/^`+|`+$/g, "").trim();
        }
      }
    }

    // Pre-fix common OpenAI JSON errors BEFORE first parse attempt
    // Fix missing spotify_url key (most common error)
    // Pattern: ]spotify.com/track/... (no space, no quotes, no key)
    raw = raw.replace(/\]spotify\.com\/track\/([a-zA-Z0-9]+)"/g, '],\n    "spotify_url": "https://open.spotify.com/track/$1"');
    raw = raw.replace(/\]\s+spotify\.com\/track\/([a-zA-Z0-9]+)"/g, '],\n    "spotify_url": "https://open.spotify.com/track/$1"');
    raw = raw.replace(/\]\s*(https?:\/\/)?(open\.)?spotify\.com\/track\/([a-zA-Z0-9]+)(")?/g, '],\n    "spotify_url": "https://open.spotify.com/track/$3"$4');
    
    // Remove trailing commas
    raw = raw.replace(/,(\s*[}\]])/g, '$1');

    // Try to parse JSON with better error handling
    try {
      songs = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (parseErr: any) {
      const errorPos = parseInt(parseErr.message.match(/position (\d+)/)?.[1] || '0');
      console.error("❌ JSON parse error:", parseErr.message);
      console.error("❌ Problematic JSON (first 500 chars):", raw.substring(0, 500));
      console.error("❌ Problematic JSON (around error position " + errorPos + "):", 
        raw.substring(Math.max(0, errorPos - 100), Math.min(raw.length, errorPos + 100)));
      console.error("❌ Full raw JSON length:", raw.length);
      
      // Try to fix common JSON errors
      let fixedRaw = raw;
      
      // Fix 1: Remove trailing commas before closing brackets/braces
      fixedRaw = fixedRaw.replace(/,(\s*[}\]])/g, '$1');
      
      // Fix 2: Fix missing quotes around keys (but not values)
      fixedRaw = fixedRaw.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
      
      // Fix 3: Fix single quotes to double quotes (but be careful with apostrophes in text)
      // Only replace single quotes that are clearly JSON syntax, not in text content
      fixedRaw = fixedRaw.replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3'); // Keys
      fixedRaw = fixedRaw.replace(/(:\s*)'([^']+)'(\s*[,}])/g, '$1"$2"$3'); // String values
      
      // Fix 4: Fix missing spotify_url key (common OpenAI error) - MUST BE FIRST
      // Pattern: ]spotify.com/track/... (no space, no quotes, no key)
      // This handles: "mood_tags": ["tag1", "tag2"]spotify.com/track/ID"
      // Must match: ] followed immediately (no space) by spotify.com/track/ID"
      fixedRaw = fixedRaw.replace(/\]spotify\.com\/track\/([a-zA-Z0-9]+)"/g, '],\n    "spotify_url": "https://open.spotify.com/track/$1"');
      
      // Also handle with space: ] spotify.com/track/ID"
      fixedRaw = fixedRaw.replace(/\]\s+spotify\.com\/track\/([a-zA-Z0-9]+)"/g, '],\n    "spotify_url": "https://open.spotify.com/track/$1"');
      
      // Handle with https:// prefix but missing key: ]https://open.spotify.com/track/ID"
      fixedRaw = fixedRaw.replace(/\]\s*(https?:\/\/)?(open\.)?spotify\.com\/track\/([a-zA-Z0-9]+)(")?/g, '],\n    "spotify_url": "https://open.spotify.com/track/$3"$4');
      
      // Handle if it's missing language field too: ]spotify.com/track/ID"\n  }
      fixedRaw = fixedRaw.replace(/\]spotify\.com\/track\/([a-zA-Z0-9]+)"\s*\n\s*}/g, '],\n    "language": "en",\n    "spotify_url": "https://open.spotify.com/track/$1"\n  }');
      
      console.log("🔧 After Fix 4 (spotify_url fix), JSON preview:", fixedRaw.substring(0, 500));
      
      // Fix 5: Fix missing commas between properties
      fixedRaw = fixedRaw.replace(/"\s*"([^"])/g, '", "$1'); // Missing comma between string properties
      fixedRaw = fixedRaw.replace(/}\s*{/g, '}, {'); // Missing comma between objects
      fixedRaw = fixedRaw.replace(/]\s*\[/g, '], ['); // Missing comma between arrays
      
      // Fix 6: Fix missing commas before spotify_url or language fields
      fixedRaw = fixedRaw.replace(/\]\s*"spotify_url"/g, '],\n    "spotify_url"');
      fixedRaw = fixedRaw.replace(/\]\s*"language"/g, '],\n    "language"');
      
      // Fix 7: Fix incomplete spotify_url values (missing quotes or key) - more aggressive
      fixedRaw = fixedRaw.replace(/(\]|")\s*(https?:\/\/)?(open\.)?spotify\.com\/track\/([a-zA-Z0-9]+)(")?/g, '$1,\n    "spotify_url": "https://open.spotify.com/track/$4"$5');
      
      // Fix 6: Remove any control characters that might break JSON
      fixedRaw = fixedRaw.replace(/[\x00-\x1F\x7F]/g, '');
      
      // Try parsing again
      try {
        songs = JSON.parse(fixedRaw);
        console.log("✅ Successfully parsed after fixing common JSON errors");
      } catch (retryErr: any) {
        console.error("❌ Retry parse also failed:", retryErr.message);
        
        // Last resort: Try to extract and fix individual song objects
        try {
          // Extract all objects from the array
          const objectMatches = fixedRaw.match(/\{[^}]*\}/g);
          if (objectMatches && objectMatches.length > 0) {
            const fixedSongs: any[] = [];
            for (const objStr of objectMatches) {
              try {
                // Try to fix this individual object
                let fixedObj = objStr;
                fixedObj = fixedObj.replace(/,(\s*[}])/g, '$1'); // Remove trailing commas
                fixedObj = fixedObj.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":'); // Fix keys
                const parsed = JSON.parse(fixedObj);
                if (parsed.title && parsed.artist) {
                  fixedSongs.push(parsed);
                }
              } catch {
                // Skip this object if it can't be parsed
                continue;
              }
            }
            if (fixedSongs.length > 0) {
              songs = fixedSongs;
              console.log("✅ Successfully parsed by extracting individual song objects");
            } else {
              throw retryErr;
            }
          } else {
            throw retryErr;
          }
        } catch {
          throw parseErr; // Re-throw original error
        }
      }
    }
    
    console.log("✅ Parsed songs:", JSON.stringify(songs, null, 2));
    
    // Validate songs have required fields
    if (!Array.isArray(songs) || songs.length === 0) {
      throw new Error("Invalid songs array");
    }
    
    // Log validation warnings
    songs.forEach((song: any, index: number) => {
      if (!song.title || !song.artist) {
        console.warn(`⚠️ Song ${index + 1} missing title or artist`);
      }
      if (!song.spotify_url || !song.spotify_url.includes('open.spotify.com/track/')) {
        console.warn(`⚠️ Song ${index + 1} has invalid or missing Spotify URL:`, song.spotify_url);
      }
    });
    
  } catch (err) {
    console.error("❌ Failed to parse OpenAI response:", err);
    
    // Log the full raw content for debugging (truncated to avoid huge logs)
    const rawPreview = typeof raw !== 'undefined' ? String(raw).substring(0, 1000) : 'N/A';
    console.error("❌ Raw OpenAI content (first 1000 chars):", rawPreview);
    console.error("❌ Error details:", {
      message: err?.message,
      stack: err?.stack,
      rawLength: typeof raw === 'string' ? raw.length : 0
    });
    
    // Try one more time with more aggressive JSON extraction
    if (typeof raw === "string" && raw.length > 0) {
      try {
        // Try multiple extraction strategies
        const extractionStrategies = [
          // Strategy 1: Find JSON array with flexible matching
          () => {
            const match = raw.match(/\[[\s\S]{0,10000}\]/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
            return null;
          },
          // Strategy 2: Find JSON after common prefixes
          () => {
            const afterPrefix = raw.replace(/^[^[]*/, '');
            const match = afterPrefix.match(/\[[\s\S]{0,10000}\]/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
            return null;
          },
          // Strategy 3: Find JSON before common suffixes
          () => {
            const beforeSuffix = raw.replace(/[^\]]*$/, '');
            const match = beforeSuffix.match(/\[[\s\S]{0,10000}\]/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
            return null;
          },
          // Strategy 4: Try parsing the entire string (in case it's just JSON)
          () => {
            try {
              const parsed = JSON.parse(raw.trim());
              if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            } catch {
              return null;
            }
            return null;
          }
        ];
        
        for (const strategy of extractionStrategies) {
          try {
            const extracted = strategy();
            if (extracted && Array.isArray(extracted) && extracted.length > 0) {
              console.log("✅ Successfully extracted JSON on retry using strategy");
              songs = extracted;
              break;
            }
          } catch (strategyErr) {
            // Continue to next strategy
            continue;
          }
        }
      } catch (retryErr) {
        console.error("❌ Retry parsing also failed:", retryErr);
      }
    }
    
    // If we still don't have songs, return error with more details
    if (!songs || !Array.isArray(songs) || songs.length === 0) {
      return jsonResponse({
        error: "Failed to parse OpenAI response",
        message: "We couldn't process the music recommendations. Please try again.",
        details: err?.message ?? String(err),
        rawPreview: typeof raw === 'string' ? raw.substring(0, 200) : 'No raw content available'
      }, 500);
    }
  }

  // 9) Validate we have at least 3 songs before returning
  if (!Array.isArray(songs) || songs.length < 3) {
    console.warn(`⚠️ Only got ${songs?.length || 0} songs, need at least 3`);
    return jsonResponse({
      error: "No matches found",
      message: "We couldn't find enough songs matching your request. Please try a different search."
    }, 404);
  }

  console.log(`✅ Returning ${songs.length} songs`);

  // 10) Return recommendations (exactly 3 songs)
  return jsonResponse({
    songs: songs.slice(0, 3) // Ensure exactly 3 songs
  }, 200);
});
