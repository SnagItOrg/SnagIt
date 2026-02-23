-- Migration 009: Listing-to-product match pipeline
-- Adds normalized_text to listings, creates listing_product_match table,
-- and enables pg_trgm for trigram search on listing text.
--
-- Run in Supabase SQL Editor (or via supabase db push)

-- ── pg_trgm extension (required for trigram index) ────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── listings: add normalized_text ────────────────────────────────────────────
ALTER TABLE listings ADD COLUMN IF NOT EXISTS normalized_text text;

-- Trigram GIN index — enables fast ILIKE / similarity search on listing text
CREATE INDEX IF NOT EXISTS listings_normalized_text_trgm
  ON listings
  USING GIN (normalized_text gin_trgm_ops);

-- ── listing_product_match ─────────────────────────────────────────────────────
CREATE TABLE listing_product_match (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid        REFERENCES listings   NOT NULL,
  product_id uuid        REFERENCES kg_product NOT NULL,
  method     text        NOT NULL CHECK (method IN ('EAN','SKU','MODEL','SYNONYM','FUZZY')),
  score      smallint    NOT NULL CHECK (score BETWEEN 0 AND 100),
  explain    jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX lpm_listing_id  ON listing_product_match (listing_id);
CREATE INDEX lpm_product_id  ON listing_product_match (product_id);
CREATE INDEX lpm_score       ON listing_product_match (score DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE listing_product_match ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON listing_product_match FOR SELECT USING (true);
