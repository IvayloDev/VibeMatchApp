# Spotify API Integration Guide

## The Problem
OpenAI doesn't have access to Spotify's database, so it may invent plausible-sounding but non-existent songs.

## Solution: Use Spotify API to Search for Real Songs

### Step 1: Get Spotify API Credentials

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Get your **Client ID** and **Client Secret**
4. Add these as secrets in Supabase:
   - Go to Supabase Dashboard → Edge Functions → Secrets
   - Add `SPOTIFY_CLIENT_ID`
   - Add `SPOTIFY_CLIENT_SECRET`

### Step 2: Update Edge Function

Add this function to search Spotify:

```typescript
/**
 * Get Spotify access token using client credentials
 */
async function getSpotifyToken(): Promise<string> {
  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID");
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET");
  
  if (!clientId || !clientSecret) {
    throw new Error("Spotify credentials not configured");
  }

  const authString = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${authString}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await response.json();
  return data.access_token;
}

/**
 * Search Spotify for songs matching the query
 */
async function searchSpotify(query: string, accessToken: string, limit: number = 10): Promise<any[]> {
  const encodedQuery = encodeURIComponent(query);
  const response = await fetch(
    `https://api.spotify.com/v1/search?q=${encodedQuery}&type=track&limit=${limit}`,
    {
      headers: {
        "Authorization": `Bearer ${accessToken}`
      }
    }
  );

  const data = await response.json();
  return data.tracks?.items || [];
}
```

### Step 3: Update the Flow

Instead of asking OpenAI to recommend songs directly, you can:

**Option A: Use OpenAI to generate search queries, then search Spotify**
1. Ask OpenAI to generate search queries based on the custom request
2. Use those queries to search Spotify API
3. Return the real Spotify results

**Option B: Use OpenAI to understand the request, then search Spotify directly**
1. Parse the custom request with OpenAI to understand intent
2. Build Spotify search queries from the parsed intent
3. Search Spotify API for real songs
4. Return the real results

### Example Implementation (Option B):

```typescript
// After getting customRequest, before calling OpenAI for songs:

if (useCustomRequest) {
  // 1. Get Spotify token
  const spotifyToken = await getSpotifyToken();
  
  // 2. Build search query from custom request
  // For Bulgarian: "filmarska pesen" → search for "cinematic song" or "film music"
  let searchQuery = customRequest.trim();
  
  // Translate/common Bulgarian terms
  const translations: Record<string, string> = {
    "filmarska pesen": "cinematic song",
    "filmarska": "cinematic",
    "chalga": "chalga",
    "mazna": "greasy energetic",
    // Add more translations
  };
  
  for (const [bg, en] of Object.entries(translations)) {
    if (searchQuery.toLowerCase().includes(bg)) {
      searchQuery = searchQuery.replace(new RegExp(bg, 'gi'), en);
    }
  }
  
  // 3. Search Spotify
  const spotifyResults = await searchSpotify(searchQuery, spotifyToken, 20);
  
  // 4. Use OpenAI to rank/filter the real Spotify results
  // Or just return the top Spotify results
  songs = spotifyResults.slice(0, 3).map(track => ({
    title: track.name,
    artist: track.artists[0].name,
    spotify_url: track.external_urls.spotify,
    // ... other fields
  }));
}
```

### Benefits:
- ✅ Only real songs from Spotify
- ✅ Guaranteed valid Spotify URLs
- ✅ No fake songs
- ✅ Works for any language/genre

### Quick Start (Simplified):
If you want a quick fix without full integration, you can:
1. Add Spotify API search as a fallback
2. If OpenAI returns songs, validate them against Spotify
3. If validation fails, search Spotify directly

Would you like me to implement the full Spotify API integration in your Edge Function?

