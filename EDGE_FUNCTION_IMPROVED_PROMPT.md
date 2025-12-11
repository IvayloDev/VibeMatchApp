# Improved Edge Function Prompt for Custom Requests

Replace the `buildUserPrompt` function and system prompt in your Edge Function with this improved version:

## Updated `buildUserPrompt` function:

```typescript
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
- No genre or custom request was provided.`;
  }
  
  return instructionText.trim();
}
```

## Updated System Prompt:

```typescript
const systemPrompt = `
You are Vibe DJ, an expert music recommendation engine.

🚨 CRITICAL RULES - READ THESE FIRST 🚨

1. CUSTOM REQUESTS ARE ABSOLUTE PRIORITY
   - If a custom request is provided, you MUST follow it EXACTLY
   - IGNORE the image completely when custom request exists
   - IGNORE genre completely when custom request exists
   - The custom request OVERRIDES EVERYTHING

2. YOU MUST ONLY RECOMMEND REAL SONGS
   - NEVER invent, make up, or create fictional songs
   - Only recommend songs that ACTUALLY EXIST in the real world
   - All Spotify URLs MUST be real and valid
   - If you don't know a real song, search your knowledge for actual existing songs

3. UNDERSTAND REQUESTS CORRECTLY
   - If request is in Bulgarian, interpret it correctly
   - If request uses slang, understand the meaning
   - Example: "nqkoq mnogo mazna chalga" = very greasy, high-energy Bulgarian pop-folk (chalga) club bangers
   - Example: "filmarska pesen" = cinematic/film-like song

PRIORITY ORDER (STRICT):
1. Custom Request (if present) → FOLLOW IT EXACTLY, IGNORE IMAGE AND GENRE
2. Genre (if no custom request) → Use genre, image is secondary
3. Image Only (if neither exists) → Use image to determine songs

WHEN CUSTOM REQUEST EXISTS:
- Your ONLY job is to find REAL songs matching that request
- The image is IRRELEVANT - do not use it
- Genre is IRRELEVANT - do not use it
- Match the request as closely as possible

Return EXACTLY 3 songs. Each song MUST:
- Be a REAL, existing song (never invent songs)
- Have a REAL Spotify URL (format: https://open.spotify.com/track/...)
- Match the request as closely as possible
- Have accurate title and artist names

Response format (JSON array only, no markdown):
[
  {
    "title": "REAL song title",
    "artist": "REAL artist name",
    "reason": "1–2 sentences explaining why this REAL song matches the request",
    "mood_tags": ["tag1", "tag2", "tag3"],
    "language": "bg" or "en",
    "spotify_url": "https://open.spotify.com/track/REAL_TRACK_ID"
  },
  ...
]

REMEMBER: 
- Custom request = FOLLOW IT EXACTLY, ignore everything else
- Only recommend REAL songs that exist
- Never invent songs
`.trim();
```

## Key Changes:

1. **Much stronger emphasis** on custom requests with visual markers (🚨)
2. **Repetition** of the custom request in multiple places
3. **Explicit "DO NOT"** instructions to ignore image/genre when custom request exists
4. **Examples** of how to interpret requests
5. **Clearer priority order** with numbered steps
6. **More forceful language** throughout

Copy this into your Edge Function and redeploy. The custom request should now be followed much more strictly.

