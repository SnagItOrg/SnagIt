-- 042_listing_staging_fail_closed
--
-- Purpose: Add listing_staging + coverage/provenance columns so the gate prevents publication rather than recording damage.
-- Depends on: 041
-- Kind: schema migration: table + columns
-- Applied in production: YES (version 20260806125720, applied 2026-08-05/06 via Supabase MCP)
--
-- Extracted verbatim from supabase_migrations.schema_migrations: this is the
-- exact SQL that ran in production. Re-running it against production is NOT
-- required and is not idempotent where noted below.

-- ── FAIL-CLOSED PUBLICATION ─────────────────────────────────────────────
-- The gate previously ran AFTER upserting to `listings` and writing events,
-- so it recorded damage rather than preventing it. Scrapes now land in
-- staging keyed by run_id; only a `passed` run is promoted atomically into
-- the authoritative tables. A detected fault must be INCAPABLE of changing
-- authoritative state, not merely logged.

CREATE TABLE listing_staging (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES scrape_run(id) ON DELETE CASCADE,
  external_id     text,
  title           text,
  price           integer,
  currency        text,
  price_dkk       numeric,
  url             text,
  image_url       text,
  location        text,
  source          text NOT NULL,
  country         char(2),
  normalized_text text,
  platform        text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_listing_staging_run ON listing_staging (run_id);
ALTER TABLE listing_staging ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE listing_staging IS
  'Scrape output lands here first, keyed by run_id. Only runs whose quality gate returns `passed` are promoted to `listings`. Quarantined/failed runs keep their rows here for forensics with zero downstream effect.';

-- ── COVERAGE MANIFEST + PROVENANCE ──────────────────────────────────────
-- "No exceptions thrown" is not proof of a complete run: a scraper can
-- return HTTP 200 and still lose half its pages to changed pagination.
-- Completeness is asserted against an EXPECTED manifest.

ALTER TABLE scrape_run
  ADD COLUMN IF NOT EXISTS expected_products  int,
  ADD COLUMN IF NOT EXISTS covered_products   int,
  ADD COLUMN IF NOT EXISTS expected_pages     int,
  ADD COLUMN IF NOT EXISTS fetched_pages      int,
  ADD COLUMN IF NOT EXISTS coverage_complete  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gate_version       text,
  ADD COLUMN IF NOT EXISTS scraper_version    text,
  ADD COLUMN IF NOT EXISTS baseline           jsonb,
  ADD COLUMN IF NOT EXISTS raw_count          int,
  ADD COLUMN IF NOT EXISTS staged_count       int,
  ADD COLUMN IF NOT EXISTS published_count    int,
  ADD COLUMN IF NOT EXISTS promoted_at        timestamptz;

COMMENT ON COLUMN scrape_run.coverage_complete IS
  'True only when every expected product/query/page in the manifest was actually fetched. Required for lifecycle reconciliation — absence of exceptions is not sufficient.';
COMMENT ON COLUMN scrape_run.baseline IS
  'The baseline values used in the gate decision (median over recent PASSED runs). Recorded so a decision can be re-audited; prevents one bad run silently becoming the new normal.';

-- ── IDEMPOTENT MISS COUNTING ────────────────────────────────────────────
-- A listing may accrue at most ONE miss per unique complete run. Retries in
-- the same night must not compound into a false delisting.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS last_miss_run_id uuid;

COMMENT ON COLUMN listings.last_miss_run_id IS
  'The run_id that last incremented consecutive_misses. A repeat/retry of the same run cannot increment it again — makes reconciliation idempotent.';
