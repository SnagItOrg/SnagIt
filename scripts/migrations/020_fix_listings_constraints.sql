-- 020_fix_listings_constraints.sql
--
-- Problem: listings_url_watchlist_unique uses NULLS NOT DISTINCT,
-- so all scraper-sourced rows (watchlist_id IS NULL) with the same URL
-- collide. Reverb upserts fail because of this.
--
-- Fix:
--   1. Drop the old blanket unique constraint
--   2. Add a partial unique index for DBA/watchlist listings (watchlist_id IS NOT NULL)
--   3. Replace the single-column external_id key with (external_id, source)
--      for scraper-sourced listings

-- Step 1: Drop old constraint
ALTER TABLE listings
  DROP CONSTRAINT IF EXISTS listings_url_watchlist_unique;

-- Step 2: Partial unique index — only for watchlist-linked listings
CREATE UNIQUE INDEX IF NOT EXISTS listings_url_watchlist_unique
  ON listings (url, watchlist_id)
  WHERE watchlist_id IS NOT NULL;

-- Step 3: Drop old single-column external_id constraint
ALTER TABLE listings
  DROP CONSTRAINT IF EXISTS listings_external_id_key;

-- Step 4: Composite unique index for scraper-sourced listings
CREATE UNIQUE INDEX IF NOT EXISTS listings_external_id_source_unique
  ON listings (external_id, source)
  WHERE external_id IS NOT NULL;
