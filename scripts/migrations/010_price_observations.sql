-- Migration 010: Price observations
-- Crowdsourced price data per product, linked via listing_product_match.
-- Users report typical price ranges; we aggregate into p25/p50/p75 stats.

CREATE TABLE price_observation (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid        REFERENCES kg_product(id),
  listing_id    uuid        REFERENCES listings(id),
  price_dkk     int         NOT NULL,
  price_min_dkk int,
  price_max_dkk int,
  source        text        NOT NULL DEFAULT 'user'
                            CHECK (source IN ('user', 'admin', 'scrape')),
  user_id       uuid        REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX po_product_id  ON price_observation (product_id);
CREATE INDEX po_listing_id  ON price_observation (listing_id);
CREATE INDEX po_user_id     ON price_observation (user_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE price_observation ENABLE ROW LEVEL SECURITY;

-- Anyone can read (needed for price stats display)
CREATE POLICY "Public read"
  ON price_observation FOR SELECT
  USING (true);

-- Authenticated users can insert their own rows
CREATE POLICY "Auth insert own"
  ON price_observation FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
