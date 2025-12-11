-- Create user_profiles table to store user credits and profile data
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  credits INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own profile
CREATE POLICY "Users can view their own profile"
  ON user_profiles
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can update their own profile
CREATE POLICY "Users can update their own profile"
  ON user_profiles
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Policy: Service role can insert/update profiles (for Edge Functions)
CREATE POLICY "Service role can manage profiles"
  ON user_profiles
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create function to update user credits
CREATE OR REPLACE FUNCTION update_user_credits(
  user_id_param UUID,
  new_credits INTEGER
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify the user_id matches the authenticated user
  IF user_id_param != auth.uid() THEN
    RAISE EXCEPTION 'User ID mismatch: cannot update credits for another user';
  END IF;

  INSERT INTO user_profiles (user_id, credits)
  VALUES (user_id_param, new_credits)
  ON CONFLICT (user_id)
  DO UPDATE SET
    credits = new_credits,
    updated_at = NOW();
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION update_user_credits(UUID, INTEGER) TO authenticated;

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

