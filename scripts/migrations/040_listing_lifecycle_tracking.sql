-- 040_listing_lifecycle_tracking
--
-- Purpose: Add listing lifecycle columns so price history models listing identity, not daily snapshots.
-- Depends on: none
-- Kind: schema migration: columns + index
-- Applied in production: YES (version 20260806112446, applied 2026-08-05/06 via Supabase MCP)
--
-- Extracted verbatim from supabase_migrations.schema_migrations: this is the
-- exact SQL that ran in production. Re-running it against production is NOT
-- required and is not idempotent where noted below.

-- Asking-price history must model LISTING LIFECYCLE, not daily snapshots.
--
-- A listing that sits on DBA for 90 days is one supply data point observed
-- 90 times, not 90 independent data points. Daily snapshotting would let
-- long-lived, overpriced listings dominate any median — the stale ads that
-- never sell would define the "market price", which is exactly backwards.
--
-- These columns give the listing an identity across snapshots so we can
-- derive: time on market, price trajectory, and whether a disappearance
-- looks like a sale vs. an expiry.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS delisted_at   timestamptz;

-- Seed from what we already know: scraped_at is the last time we saw a row.
UPDATE listings SET first_seen_at = scraped_at WHERE first_seen_at IS NULL;

COMMENT ON COLUMN listings.first_seen_at IS
  'First time this listing was observed. With scraped_at (last seen) this gives time-on-market.';
COMMENT ON COLUMN listings.delisted_at IS
  'When the listing stopped appearing in search results. A disappearance is NOT proof of sale — it may be expired, deleted, or renewed by the seller.';

CREATE INDEX IF NOT EXISTS idx_listings_lifecycle
  ON listings (source, first_seen_at, delisted_at);
