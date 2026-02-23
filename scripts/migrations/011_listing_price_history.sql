-- Migration 011: listing_price_history
-- Tracks price changes on individual listings over time.
-- Written by the scraper only (via service role); public read via RLS.

CREATE TABLE listing_price_history (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid        REFERENCES listings(id) NOT NULL,
  price_dkk  int         NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lph_listing_id  ON listing_price_history(listing_id);
CREATE INDEX lph_observed_at ON listing_price_history(observed_at DESC);

-- RLS
ALTER TABLE listing_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read listing_price_history"
  ON listing_price_history
  FOR SELECT
  USING (true);

-- No INSERT policy from client — scraper writes via service role (bypasses RLS).
