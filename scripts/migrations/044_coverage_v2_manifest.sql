-- 044_coverage_v2_manifest
--
-- Purpose: Add scrape_query_coverage (per-query pagination evidence), coverage_v2 columns, run_has_lifecycle_coverage(), scope_has_established_coverage().
-- Depends on: 043
-- Kind: schema migration + functions
-- Applied in production: YES (version 20260806131629, applied 2026-08-05/06 via Supabase MCP)
--
-- Extracted verbatim from supabase_migrations.schema_migrations: this is the
-- exact SQL that ran in production. Re-running it against production is NOT
-- required and is not idempotent where noted below.

-- ── WHY v1 COVERAGE WAS UNSAFE ──────────────────────────────────────────
-- v1 asserted "every expected product was scraped" — that is QUERY coverage,
-- not LISTING coverage. A run that fetched only page 1 of every query would
-- have passed, established a false coverage universe, and three identical
-- pagination faults could then still mass-delist. The bootstrap guard only
-- deferred that risk by one night; it did not remove it.
--
-- coverage_v2 records pagination termination explicitly, per query, and is
-- scope-aware: approval belongs to (source, coverage_scope_hash,
-- scraper_version), never to a source as a whole.

-- Per-query coverage evidence.
CREATE TABLE scrape_query_coverage (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL REFERENCES scrape_run(id) ON DELETE CASCADE,
  query               text NOT NULL,
  kg_product_id       uuid REFERENCES kg_product(id),
  query_started       boolean NOT NULL DEFAULT false,
  query_completed     boolean NOT NULL DEFAULT false,
  pages_fetched       int     NOT NULL DEFAULT 0,
  -- Only these three mean pagination ended because there was nothing left.
  -- Anything else (error, max_pages_hit, unknown) means we do NOT know
  -- whether more listings existed → cannot support delisting.
  termination_reason  text CHECK (termination_reason IN
                        ('empty_page','no_next_token','known_last_page',
                         'max_pages_hit','error','unknown')),
  raw_count           int NOT NULL DEFAULT 0,
  parsed_count        int NOT NULL DEFAULT 0,
  parse_error_count   int NOT NULL DEFAULT 0,
  unique_staged_count int NOT NULL DEFAULT 0,
  pagination_tokens   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, query)
);

CREATE INDEX idx_query_coverage_run ON scrape_query_coverage (run_id);
ALTER TABLE scrape_query_coverage ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE scrape_query_coverage IS
  'Per-query pagination evidence for coverage_v2. Lifecycle-grade coverage requires every query completed with a terminal termination_reason (empty_page/no_next_token/known_last_page) — max_pages_hit, error and unknown all mean listings may exist that we never saw.';

ALTER TABLE scrape_run
  ADD COLUMN IF NOT EXISTS coverage_version    text,
  ADD COLUMN IF NOT EXISTS coverage_scope_hash text,
  ADD COLUMN IF NOT EXISTS parse_error_count   int NOT NULL DEFAULT 0;

COMMENT ON COLUMN scrape_run.coverage_scope_hash IS
  'Hash of (products/queries, filters, scraper_version). Approval is scope-specific: a smaller new search universe must not inherit approval from a larger old one.';

-- ── LIFECYCLE-GRADE COVERAGE ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION run_has_lifecycle_coverage(p_run_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_status   text;
  v_version  text;
  v_expected int;
  v_promoted timestamptz;
  v_queries  int;
  v_complete int;
  v_terminal int;
  v_raw      int;
  v_parsed   int;
BEGIN
  SELECT status, coverage_version, expected_products, promoted_at
    INTO v_status, v_version, v_expected, v_promoted
  FROM scrape_run WHERE id = p_run_id;

  IF NOT FOUND OR v_status <> 'passed' OR v_version IS DISTINCT FROM 'v2' THEN
    RETURN false;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE query_completed),
         count(*) FILTER (WHERE termination_reason IN ('empty_page','no_next_token','known_last_page')),
         COALESCE(sum(raw_count), 0),
         COALESCE(sum(parsed_count), 0)
    INTO v_queries, v_complete, v_terminal, v_raw, v_parsed
  FROM scrape_query_coverage WHERE run_id = p_run_id;

  -- Every expected query present, completed, and terminated for a known reason.
  IF v_queries = 0 OR v_queries <> v_complete OR v_queries <> v_terminal THEN
    RETURN false;
  END IF;
  IF v_expected IS NOT NULL AND v_queries < v_expected THEN
    RETURN false;
  END IF;

  -- Raw-to-parsed ratio inside an acceptable band: a parser silently dropping
  -- results looks like "fewer listings exist", which would fake delistings.
  IF v_raw > 0 AND (v_parsed::numeric / v_raw) < 0.95 THEN
    RETURN false;
  END IF;

  RETURN true;
END $$;

-- ── SCOPE-SPECIFIC BOOTSTRAP ────────────────────────────────────────────
-- Replaces the boolean per-source version. A change to the product universe,
-- pagination, filters, or scraper version requires a fresh bootstrap.
CREATE OR REPLACE FUNCTION scope_has_established_coverage(
  p_source     text,
  p_scope_hash text,
  p_scraper_version text
)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scrape_run r
    WHERE r.source = p_source
      AND r.coverage_scope_hash = p_scope_hash
      AND r.scraper_version = p_scraper_version
      AND r.coverage_version = 'v2'
      AND r.status = 'passed'
      AND r.promoted_at IS NOT NULL
      AND run_has_lifecycle_coverage(r.id)
  );
$$;

-- ── HARD-DISABLE v1 LIFECYCLE ───────────────────────────────────────────
-- No existing run carries coverage_version='v2', so this returns false for
-- every source until a v2 run is proven. Tonight's DBA run publishes its
-- listings atomically but cannot accumulate misses or delist anything.
CREATE OR REPLACE FUNCTION source_has_established_coverage(p_source text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scrape_run r
    WHERE r.source = p_source
      AND r.coverage_version = 'v2'
      AND r.status = 'passed'
      AND r.promoted_at IS NOT NULL
      AND run_has_lifecycle_coverage(r.id)
  );
$$;

COMMENT ON FUNCTION source_has_established_coverage IS
  'DEPRECATED in favour of scope_has_established_coverage(source, scope_hash, scraper_version). Retained so existing callers fail CLOSED: it now requires coverage_version=''v2'', which no v1 run can satisfy.';
