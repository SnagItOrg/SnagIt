-- Migration 031: reverb_price_history.kg_product_id
-- Today reverb_price_history is keyed by `query` (free text from the owning
-- watchlist). Two queries that target the same product ("Roland Juno 60" and
-- "Roland Juno-60") accumulate as separate price series. Adding a nullable
-- kg_product_id and an FK gives us a deterministic anchor.
--
-- The column is nullable because backfill is best-effort and historical rows
-- whose query no longer maps to any kg_product should not block writes.
-- A separate backfill step populates the column via reverb_csp_id matching.

ALTER TABLE reverb_price_history
  ADD COLUMN IF NOT EXISTS kg_product_id uuid REFERENCES kg_product(id) ON DELETE SET NULL;

COMMENT ON COLUMN reverb_price_history.kg_product_id IS
  'Resolved kg_product anchor. Populated post-hoc by mapping the row''s '
  'query (or, preferably, listing_url → CSP id → kg_product.reverb_csp_id) '
  'after migration 030 + 032 land. Nullable: rows with no canonical match '
  'remain query-keyed.';

CREATE INDEX IF NOT EXISTS idx_reverb_price_history_kg_product_id
  ON reverb_price_history(kg_product_id)
  WHERE kg_product_id IS NOT NULL;
