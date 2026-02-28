-- Migration 014: Add Reverb / multi-source columns to listings
-- Adds external_id (unique, nullable — DBA rows keep NULL),
-- platform, condition, brand_id, and is_active.
-- Safe to run multiple times (IF NOT EXISTS / IF NOT EXISTS constraint).

ALTER TABLE listings ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS platform    text;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS condition   text;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS brand_id    uuid REFERENCES kg_brand(id);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_active   boolean;

-- Unique constraint on external_id for upsert conflict resolution.
-- NULLs are not considered equal, so existing DBA rows (NULL) are unaffected.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'listings_external_id_key'
  ) THEN
    ALTER TABLE listings ADD CONSTRAINT listings_external_id_key UNIQUE (external_id);
  END IF;
END $$;

-- Index for per-platform queries
CREATE INDEX IF NOT EXISTS listings_platform ON listings (platform);
CREATE INDEX IF NOT EXISTS listings_brand_id ON listings (brand_id);
