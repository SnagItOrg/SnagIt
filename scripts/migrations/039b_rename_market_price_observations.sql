-- 039b_rename_market_price_observations
--
-- Purpose: Rename price_observations -> market_price_observations, avoiding a one-letter collision with the live price_observation (singular) table.
-- Depends on: 039
-- Kind: schema migration: rename
-- Applied in production: YES (version 20260805130815, applied 2026-08-05/06 via Supabase MCP)
--
-- Extracted verbatim from supabase_migrations.schema_migrations: this is the
-- exact SQL that ran in production. Re-running it against production is NOT
-- required and is not idempotent where noted below.

-- price_observations (plural, migration 039) collided in name with the
-- pre-existing price_observation (singular) table, which is live application
-- code (frontend/app/api/price-observations/route.ts) backing an unrelated
-- feature: authenticated users submitting a manual price report tied to a
-- listing_id. That table is small (14 rows), simple, and stays as-is.
--
-- Renaming the new table to avoid a one-letter-apart collision with a live
-- table of a different shape and purpose.

ALTER TABLE price_observations RENAME TO market_price_observations;
ALTER INDEX price_observations_dedup RENAME TO market_price_observations_dedup;
ALTER INDEX idx_price_observations_product RENAME TO idx_market_price_observations_product;

DROP VIEW price_observations_trusted;
CREATE VIEW market_price_observations_trusted AS
  SELECT * FROM market_price_observations
  WHERE kg_product_id IS NOT NULL AND is_valid IS DISTINCT FROM false;

ALTER POLICY "Public read trusted price observations" ON market_price_observations
  RENAME TO "Public read trusted market price observations";
