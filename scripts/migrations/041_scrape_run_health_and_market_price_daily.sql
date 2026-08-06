-- 041_scrape_run_health_and_market_price_daily
--
-- Purpose: Add scrape_run (per-run quality gate) and market_price_daily (layer-3 aggregate); add lifecycle miss counters.
-- Depends on: 040
-- Kind: schema migration: tables + columns + indexes + RLS
-- Applied in production: YES (version 20260806124955, applied 2026-08-05/06 via Supabase MCP)
--
-- Extracted verbatim from supabase_migrations.schema_migrations: this is the
-- exact SQL that ran in production. Re-running it against production is NOT
-- required and is not idempotent where noted below.

-- ── THREE SEPARATE LAYERS FOR PRICE DATA ────────────────────────────────
-- market_price_observations is an EVENT LOG, not a statistical sample of the
-- market. Computing a median directly over it biases toward listings that
-- changed price (they emit more events) versus stable ones.
--
--   Layer 1  Current asking median   -> one current row per ACTIVE listing
--                                       (query `listings`, not the event log)
--   Layer 2  Price-change history    -> market_price_observations events
--   Layer 3  Historical market level -> market_price_daily (this migration)
--
-- Layer 3 is the only correct basis for "what was the market level on date X".

CREATE TABLE market_price_daily (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date       date NOT NULL,
  kg_product_id       uuid REFERENCES kg_product(id),
  source              text NOT NULL,
  country             char(2) NOT NULL,
  price_type          text NOT NULL CHECK (price_type IN ('asking','sold','retail')),
  active_listing_count int NOT NULL,
  min_dkk             numeric,
  p25_dkk             numeric,
  median_dkk          numeric,
  p75_dkk             numeric,
  max_dkk             numeric,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, kg_product_id, source, country, price_type)
);

CREATE INDEX idx_market_price_daily_lookup
  ON market_price_daily (kg_product_id, price_type, country, snapshot_date DESC);

ALTER TABLE market_price_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read market price daily"
  ON market_price_daily FOR SELECT USING (kg_product_id IS NOT NULL);

COMMENT ON TABLE market_price_daily IS
  'Layer 3: daily aggregated market level per product/source/market. The correct basis for historical price charts. Never aggregate market_price_observations directly — it is an event log and over-weights listings that changed price.';

-- ── LIFECYCLE: DELIST ONLY AFTER REPEATED MISSES ────────────────────────
-- A single failed or partial source run must never mark listings as gone.
-- Delisting requires N consecutive COMPLETE, SUCCESSFUL runs without a
-- re-find. Any re-find resets the counter and reactivates the listing.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS last_seen_at        timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_misses  int NOT NULL DEFAULT 0;

UPDATE listings SET last_seen_at = scraped_at WHERE last_seen_at IS NULL;

COMMENT ON COLUMN listings.consecutive_misses IS
  'Complete successful source runs in a row where this listing was not re-found. Reset to 0 on any re-find. Delisting triggers at a threshold, never on a single miss.';
COMMENT ON COLUMN listings.delisted_at IS
  'When the listing stopped appearing after repeated misses. NOT a sale date — the listing may have expired, been deleted, or been renewed. Never interpret as a transaction.';

-- ── RUN HEALTH: THE QUALITY GATE ────────────────────────────────────────
-- Every scrape run records what it actually produced, not just that it
-- exited 0. The Finn/Blocket price_dkk bug was a green exit code with 100%
-- unusable output; this table is what would have caught it the same night.

CREATE TABLE scrape_run (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source              text NOT NULL,
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  -- passed: publish | quarantined: stored, excluded from prices/Kup-score
  -- | failed: no lifecycle updates at all
  status              text NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running','passed','quarantined','failed')),
  products_attempted  int  NOT NULL DEFAULT 0,
  products_failed     int  NOT NULL DEFAULT 0,
  listings_fetched    int  NOT NULL DEFAULT 0,
  listings_saved      int  NOT NULL DEFAULT 0,
  unique_external_ids int  NOT NULL DEFAULT 0,
  duplicate_rate      numeric,
  null_price          int  NOT NULL DEFAULT 0,
  null_currency       int  NOT NULL DEFAULT 0,
  null_price_dkk      int  NOT NULL DEFAULT 0,
  null_url            int  NOT NULL DEFAULT 0,
  null_title          int  NOT NULL DEFAULT 0,
  price_min_dkk       numeric,
  price_median_dkk    numeric,
  price_max_dkk       numeric,
  new_listings        int  NOT NULL DEFAULT 0,
  price_changes       int  NOT NULL DEFAULT 0,
  refound_listings    int  NOT NULL DEFAULT 0,
  delisted_listings   int  NOT NULL DEFAULT 0,
  volume_delta_pct    numeric,
  violations          jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes               text
);

CREATE INDEX idx_scrape_run_source_time ON scrape_run (source, started_at DESC);
CREATE INDEX idx_scrape_run_status ON scrape_run (source, status, started_at DESC);

ALTER TABLE scrape_run ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE scrape_run IS
  'Per-run output quality gate. status=quarantined means the data is stored but must be excluded from price aggregation and Kup-score. Hard invariant violations (missing price_dkk, invalid currency, empty external_id) block publication; volume/match-rate swings quarantine rather than discard.';
