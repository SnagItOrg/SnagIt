-- Migration 030: kg_product.reverb_csp_id
-- Adds the typed integer column for Reverb's canonical product (CSP) anchor.
-- Backfill from attributes.reverb_csp is performed by migration 032 after
-- scripts/enrich-from-reverb-csp.ts has populated the jsonb carrier.

ALTER TABLE kg_product
  ADD COLUMN IF NOT EXISTS reverb_csp_id integer;

COMMENT ON COLUMN kg_product.reverb_csp_id IS
  'Reverb Comparison Shopping Page id — canonical anchor for joining listings, '
  'price history, and accessory grouping. Resolved from canonical_name via '
  '/api/csps. Source data lives in attributes.reverb_csp during enrichment '
  'until migration 032 promotes it here.';

CREATE INDEX IF NOT EXISTS idx_kg_product_reverb_csp_id
  ON kg_product(reverb_csp_id)
  WHERE reverb_csp_id IS NOT NULL;
