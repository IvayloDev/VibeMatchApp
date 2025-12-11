-- Fix update_user_credits function to ensure proper permissions and validation

-- Drop and recreate the function with proper security
DROP FUNCTION IF EXISTS update_user_credits(UUID, INTEGER);

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

