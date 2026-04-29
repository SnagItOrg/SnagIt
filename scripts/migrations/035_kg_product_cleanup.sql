-- Migration 035: KG product cleanup queue
-- Adds cleanup_status column for the admin merge/inactivate workflow

-- Requires pg_trgm for similarity() used in the cleanup API
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Flag dirty products for review queue
ALTER TABLE kg_product
  ADD COLUMN IF NOT EXISTS cleanup_status text
    CHECK (cleanup_status IN ('pending', 'merged', 'inactivated', 'clean'))
    DEFAULT NULL;

-- Index for the cleanup queue
CREATE INDEX IF NOT EXISTS idx_kg_product_cleanup
  ON kg_product(cleanup_status)
  WHERE cleanup_status = 'pending';
