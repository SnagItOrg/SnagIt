-- 039_market_price_observations
--
-- Purpose: Create the unified append-only price ledger (originally named price_observations).
-- Depends on: none
-- Kind: schema migration: table + indexes + RLS policy + view
-- Applied in production: YES (version 20260805130440, applied 2026-08-05/06 via Supabase MCP)
--
-- Extracted verbatim from supabase_migrations.schema_migrations: this is the
-- exact SQL that ran in production. Re-running it against production is NOT
-- required and is not idempotent where noted below.

-- Unified price-observation ledger: append-only history across all sources,
-- price types (asking/sold/retail), and countries. Supersedes the query-keyed
-- reverb_price_history / auctionet_price_history pattern going forward.
-- kg_product_id is nullable until matched (mirrors listing_product_match).

CREATE TABLE price_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kg_product_id uuid REFERENCES kg_product(id),
  source text NOT NULL,
  country char(2) NOT NULL,
  price_type text NOT NULL CHECK (price_type IN ('asking', 'sold', 'retail')),
  price_raw numeric NOT NULL,
  currency text NOT NULL,
  price_dkk numeric NOT NULL,
  condition text,
  listing_url text,
  listing_title text,
  external_id text,
  match_confidence smallint CHECK (match_confidence BETWEEN 0 AND 100),
  match_method text CHECK (match_method IN ('sku', 'model', 'synonym', 'fuzzy', 'ai_pass1', 'ai_pass2', 'human')),
  is_valid boolean,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Dedup: same source+external_id+price_type shouldn't recur at the same observed_at
-- (re-scrapes of an unchanged asking price, or reprocessing of a sold comp).
CREATE UNIQUE INDEX price_observations_dedup
  ON price_observations (source, external_id, price_type, observed_at)
  WHERE external_id IS NOT NULL;

-- Primary read path: charts, deltas, arbitrage queries.
CREATE INDEX idx_price_observations_product
  ON price_observations (kg_product_id, price_type, country, observed_at DESC)
  WHERE kg_product_id IS NOT NULL;

ALTER TABLE price_observations ENABLE ROW LEVEL SECURITY;

-- Public read of trusted rows only; writes are service-role (scrapers/match jobs) only.
CREATE POLICY "Public read trusted price observations"
  ON price_observations FOR SELECT
  USING (kg_product_id IS NOT NULL AND is_valid IS DISTINCT FROM false);

-- App-facing view: the only thing charts/deltas/arbitrage code should ever query.
CREATE VIEW price_observations_trusted AS
  SELECT * FROM price_observations
  WHERE kg_product_id IS NOT NULL AND is_valid IS DISTINCT FROM false;
