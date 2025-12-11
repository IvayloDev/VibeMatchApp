-- Create purchases table to track IAP transactions
CREATE TABLE IF NOT EXISTS purchases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  receipt_data TEXT, -- iOS receipt or Android purchase token
  order_id TEXT, -- Android order ID
  credits_granted INTEGER NOT NULL DEFAULT 0,
  validation_data JSONB, -- Store validation response from store
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_purchases_user_id ON purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_transaction_id ON purchases(transaction_id);
CREATE INDEX IF NOT EXISTS idx_purchases_created_at ON purchases(created_at DESC);

-- Enable Row Level Security
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only view their own purchases
CREATE POLICY "Users can view their own purchases"
  ON purchases
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Only service role can insert purchases (via Edge Function)
CREATE POLICY "Service role can insert purchases"
  ON purchases
  FOR INSERT
  WITH CHECK (true); -- Edge function uses service role key

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_purchases_updated_at
  BEFORE UPDATE ON purchases
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

