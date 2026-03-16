-- Migration 019: Add listing_data jsonb to saved_listings + UPDATE RLS policy
-- The POST handler upserts listing_data so the saved page can render cards
-- even if the original listing is deleted from the listings table.

ALTER TABLE saved_listings ADD COLUMN IF NOT EXISTS listing_data jsonb;

-- The upsert (INSERT ... ON CONFLICT UPDATE) requires an UPDATE policy.
-- Migration 012 only created SELECT, INSERT, DELETE policies.
CREATE POLICY "Users can update their own saved listings"
  ON saved_listings
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
