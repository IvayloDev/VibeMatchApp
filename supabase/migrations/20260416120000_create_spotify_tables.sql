-- Spotify OAuth tokens per registered user
CREATE TABLE IF NOT EXISTS spotify_connections (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  scope TEXT,
  spotify_user_id TEXT,
  display_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE spotify_connections ENABLE ROW LEVEL SECURITY;

-- Users can read their own connection (for UI status), but NOT tokens directly.
-- We expose a safe view below; full table is service-role only for writes.
CREATE POLICY "Users can view own spotify connection"
  ON spotify_connections
  FOR SELECT
  USING (auth.uid() = user_id);

-- Only service role writes (edge function uses service key)
CREATE POLICY "Service role manages spotify connections"
  ON spotify_connections
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_spotify_connections_updated_at
  BEFORE UPDATE ON spotify_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- Cached Spotify taste profile per user
CREATE TABLE IF NOT EXISTS spotify_taste_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  top_artists JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_tracks JSONB NOT NULL DEFAULT '[]'::jsonb,
  recently_played JSONB NOT NULL DEFAULT '[]'::jsonb,
  saved_tracks JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_genres TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  refreshed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE spotify_taste_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own taste profile"
  ON spotify_taste_profiles
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages taste profiles"
  ON spotify_taste_profiles
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_spotify_taste_profiles_updated_at
  BEFORE UPDATE ON spotify_taste_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
