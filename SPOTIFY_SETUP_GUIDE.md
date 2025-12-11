# Spotify API Setup Guide

## Step 1: Get Spotify API Credentials

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Log in with your Spotify account (or create one)
3. Click **"Create app"**
4. Fill in:
   - **App name**: VibeMatch (or any name)
   - **App description**: Music recommendation app
   - **Website**: Your website (optional)
   - **Redirect URI**: Not needed for client credentials flow
   - **Developer**: Your name
5. Accept the terms and click **"Save"**
6. You'll see your **Client ID** and **Client Secret**
   - Click **"Show client secret"** to reveal it

## Step 2: Add Secrets to Supabase

1. Go to your Supabase Dashboard
2. Navigate to **Edge Functions** → **Secrets**
3. Click **"Add new secret"**
4. Add two secrets:
   - **Name**: `SPOTIFY_CLIENT_ID`
     **Value**: Your Spotify Client ID
   - **Name**: `SPOTIFY_CLIENT_SECRET`
     **Value**: Your Spotify Client Secret
5. Click **"Save"** for each

## Step 3: Deploy Updated Edge Function

The Edge Function is already updated to use Spotify API! Just:

1. Copy the updated `index.ts` from `supabase/functions/recommend-songs/index.ts`
2. Paste it into Supabase Dashboard → Edge Functions → `recommend-songs` → Edit
3. Click **"Deploy updates"**

## How It Works

### With Spotify API (Custom Requests):
1. When a custom request is provided, the function:
   - Gets a Spotify access token
   - Translates Bulgarian terms to English search queries
   - Searches Spotify API for real songs
   - Returns the top 3 matching songs from Spotify
   - **Guarantees only real songs!**

### Without Spotify API (Fallback):
- If Spotify credentials aren't set, it falls back to OpenAI
- Still tries to recommend real songs, but may have issues

## Bulgarian Translation Examples

The function automatically translates common Bulgarian terms:
- "filmarska pesen" → "cinematic song"
- "chalga" → "chalga" (kept as is, Spotify knows this genre)
- "mazna" → "energetic"
- "dai nqkva" → removed (just filler words)

## Testing

After setup, test with:
- Custom request: "dai nqkva mnogo filmarska pesen"
- Should return real songs from Spotify
- All Spotify URLs will be valid

## Benefits

✅ **100% Real Songs** - Only songs that exist on Spotify
✅ **Valid Spotify URLs** - All URLs are guaranteed to work
✅ **No Fake Songs** - Can't invent songs if they come from Spotify
✅ **Works for Any Language** - Spotify search handles multiple languages

## Troubleshooting

**"Spotify credentials not configured" warning:**
- Make sure you added both secrets in Supabase
- Check the secret names are exactly: `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`
- Redeploy the Edge Function after adding secrets

**No results from Spotify:**
- Try different search terms
- Check if the search query makes sense in English
- Spotify may not have songs matching very specific requests

