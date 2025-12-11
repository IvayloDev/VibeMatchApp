-- Enable RLS on history table if not already enabled
ALTER TABLE history ENABLE ROW LEVEL SECURITY;

-- Drop existing delete policy if it exists (to avoid conflicts)
DROP POLICY IF EXISTS "Users can delete their own history" ON history;

-- Create policy to allow users to delete their own history items
CREATE POLICY "Users can delete their own history"
ON history
FOR DELETE
USING (auth.uid() = user_id);

