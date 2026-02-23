-- Migration 009 (idempotent/safe version)
-- Safe to run multiple times — use this if 009_listing_match.sql fails
-- because some objects already exist.

-- ── pg_trgm extension ─────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── listings: add normalized_text ────────────────────────────────────────────
ALTER TABLE listings ADD COLUMN IF NOT EXISTS normalized_text text;

-- Trigram GIN index
CREATE INDEX IF NOT EXISTS listings_normalized_text_trgm
  ON listings
  USING GIN (normalized_text gin_trgm_ops);

-- ── listing_product_match ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listing_product_match (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid        REFERENCES listings   NOT NULL,
  product_id uuid        REFERENCES kg_product NOT NULL,
  method     text        NOT NULL CHECK (method IN ('EAN','SKU','MODEL','SYNONYM','FUZZY')),
  score      smallint    NOT NULL CHECK (score BETWEEN 0 AND 100),
  explain    jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS lpm_listing_id  ON listing_product_match (listing_id);
CREATE INDEX IF NOT EXISTS lpm_product_id  ON listing_product_match (product_id);
CREATE INDEX IF NOT EXISTS lpm_score       ON listing_product_match (score DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE listing_product_match ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY has no IF NOT EXISTS — use a DO block
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'listing_product_match'
      AND policyname = 'Public read'
  ) THEN
    CREATE POLICY "Public read" ON listing_product_match FOR SELECT USING (true);
  END IF;
END $$;
