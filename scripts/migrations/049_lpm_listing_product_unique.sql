-- 049_lpm_listing_product_unique
--
-- Purpose: Record the unique index on listing_product_match(listing_id,
--          product_id) that prevents the duplicate-match explosion. This
--          index already exists in production — it was applied manually by
--          copy-pasting SQL that was printed by
--          scripts/cleanup-listing-product-match.ts, so it had no migration
--          file and the repo could not reproduce it.
-- Depends on: none (the table predates the numbered migrations)
-- Kind: index
-- Applied in production: YES — pre-existing as `lpm_listing_product_unique`.
--          Verified 2026-08-06 via pg_indexes. This file documents it so a
--          clean database gets the same constraint; it is a no-op against
--          production.
--
-- BACKGROUND: a runaway match-listings loop generated 17M rows in
-- listing_product_match in April 2026. The table was truncated and this
-- index added so the same failure cannot recur silently.
--
-- WARNING: creating this on a database that still contains duplicate
-- (listing_id, product_id) pairs will FAIL. Run
-- scripts/cleanup-listing-product-match.ts first to remove them.

CREATE UNIQUE INDEX IF NOT EXISTS lpm_listing_product_unique
  ON listing_product_match (listing_id, product_id);
