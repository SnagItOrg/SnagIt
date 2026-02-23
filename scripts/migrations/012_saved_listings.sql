-- Migration 012: saved_listings
-- Users can save listings they care about; triggers price-drop notifications.

CREATE TABLE saved_listings (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) NOT NULL,
  listing_id uuid        REFERENCES listings(id)   NOT NULL,
  saved_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, listing_id)
);

-- RLS: users can only see and manage their own saved listings
ALTER TABLE saved_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own saved listings"
  ON saved_listings
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own saved listings"
  ON saved_listings
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saved listings"
  ON saved_listings
  FOR DELETE
  USING (auth.uid() = user_id);
