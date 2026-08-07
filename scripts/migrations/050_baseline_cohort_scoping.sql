-- 050_baseline_cohort_scoping
--
-- Purpose: Record the full baseline cohort identity + the unambiguous GLOBAL run volume on scrape_run, so the quality gate can only compare runs that are actually comparable.
-- Depends on: 044 (coverage_version, coverage_scope_hash), 042 (coverage_complete, promoted_at, baseline)
-- Kind: schema migration: columns + index
-- Applied in production: YES (2026-08-07 via Supabase MCP apply_migration).
--   Verified after: 42 -> 47 columns, all 5 new ones nullable with no default;
--   both CHECK constraints convalidated; index present; 12 rows before and
--   after with 0 rows carrying any new value. Pre-state recorded in
--   snapshots/050_pre_scrape_run.sql.
--
-- Idempotent: every statement is guarded (IF NOT EXISTS / conditional DO block).
-- Re-running is a no-op: ADD COLUMN IF NOT EXISTS skips, the DO block matches
-- constraints on (name, table), CREATE INDEX IF NOT EXISTS skips, and COMMENT
-- is by nature a replace. No DML anywhere, so no row can be touched twice.

-- ── WHY ─────────────────────────────────────────────────────────────────
-- robustBaseline() filtered on (source, status='passed') only. Targeted runs
-- therefore polluted the baseline for complete runs. Observed live: the first
-- full 30-product DBA bootstrap reported volume_swing 12600% (6 -> 762)
-- because the only prior passed runs were `--product=juno-106` runs of 6
-- listings each. Same class of bug as the unscoped coverage function retired
-- in migration 048: an approval that belongs to a narrow scope was applied to
-- a wide one.
--
-- A baseline is only meaningful between runs that measured the same thing.
-- "The same thing" is six fields, matched EXACTLY:
--
--     source · coverage_scope_hash · coverage_version
--     scraper_version · parser_version · pagination_strategy
--
-- coverage_scope_hash already covers the product/query universe, but it is a
-- single opaque digest computed by the scraper. The remaining identity fields
-- are stored separately and compared independently, so a cohort mismatch is
-- visible and auditable rather than hidden inside a hash — and so a scraper
-- can evolve its hash payload without silently widening the cohort.
--
-- No qualifying prior run is NOT a violation. It is `baseline_unavailable`:
-- information. A first complete run in a new cohort is judged only on hard
-- invariants and absolute data contracts; relative volume rules activate on
-- the second run of an identical cohort.

ALTER TABLE scrape_run
  -- Cohort identity. The scraper stamps these; a change to any of them starts
  -- a NEW cohort with no baseline rather than silently comparing across a
  -- behaviour change.
  ADD COLUMN IF NOT EXISTS parser_version         text,
  ADD COLUMN IF NOT EXISTS pagination_strategy    text,
  -- Whether this run attempted the FULL manifest ('complete') or a subset
  -- ('targeted' — any --product / --limit filter). Recorded from the run's
  -- own intent, before scraping, so it cannot be inferred after the fact from
  -- counts that a fault could have changed.
  ADD COLUMN IF NOT EXISTS run_scope              text,
  -- The unambiguous GLOBAL volume measurement for the run: COUNT(DISTINCT
  -- external_id) across the whole run. Baseline and volume rules use this and
  -- nothing else.
  ADD COLUMN IF NOT EXISTS global_unique_listings int,
  -- Outcome of baseline selection for THIS run's gate decision.
  ADD COLUMN IF NOT EXISTS baseline_status        text;

-- Both CHECKs explicitly permit NULL, so every existing row satisfies them
-- and no validation scan can fail. The guards match on (name, table) rather
-- than name alone — a same-named constraint on a different table must not
-- cause a silent skip here.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scrape_run_run_scope_check'
      AND conrelid = 'public.scrape_run'::regclass
  ) THEN
    ALTER TABLE scrape_run
      ADD CONSTRAINT scrape_run_run_scope_check
      CHECK (run_scope IS NULL OR run_scope IN ('complete','targeted'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scrape_run_baseline_status_check'
      AND conrelid = 'public.scrape_run'::regclass
  ) THEN
    ALTER TABLE scrape_run
      ADD CONSTRAINT scrape_run_baseline_status_check
      CHECK (baseline_status IS NULL OR baseline_status IN ('available','unavailable'));
  END IF;
END $$;

-- NO BACKFILL BY DESIGN. Existing rows keep NULL cohort identity and NULL
-- run_scope, which disqualifies them from every baseline. Inventing a
-- retroactive identity for runs whose parser and scope provenance was never
-- recorded is exactly the assumption this migration exists to prevent — and
-- run 43f27632-5881-4095-83a7-b7b840638ba1 (the REJECTED DBA candidate
-- bootstrap) must remain untouched forensic evidence.

CREATE INDEX IF NOT EXISTS idx_scrape_run_baseline_cohort
  ON scrape_run (source, coverage_scope_hash, coverage_version,
                 scraper_version, parser_version, pagination_strategy,
                 started_at DESC);

COMMENT ON COLUMN scrape_run.parser_version IS
  'Parser behaviour version. Part of the baseline cohort key: a parser change alters what "one listing" means, so runs either side of it are not comparable.';
COMMENT ON COLUMN scrape_run.pagination_strategy IS
  'Pagination strategy used by the run. Part of the baseline cohort key: a strategy change alters how much of the universe a run can see.';
COMMENT ON COLUMN scrape_run.run_scope IS
  'complete = the full expected manifest was attempted (no --product / --limit). targeted = a deliberate subset. Only complete runs may ever seed a baseline; a targeted run must never define the norm for a full scope.';
COMMENT ON COLUMN scrape_run.global_unique_listings IS
  'COUNT(DISTINCT external_id) for the WHOLE run. The only volume measure baseline and volume rules may use. Distinct from listings_fetched (raw, counts a listing once per query that returned it) and from sum(scrape_query_coverage.unique_staged_count) (query-local uniqueness).';
COMMENT ON COLUMN scrape_run.baseline_status IS
  'available = a qualifying prior run in an identical cohort was found and relative volume rules were applied. unavailable = none was found; relative rules were INACTIVE for this run. unavailable is information, never a violation.';
COMMENT ON COLUMN scrape_run.baseline IS
  'Full evidence for the baseline decision: cohort key, window, measure, selected run ids and their volumes, median, and the reason each considered run was rejected. Stored so the gate verdict can be re-audited deterministically without re-running selection.';
COMMENT ON COLUMN scrape_run.unique_external_ids IS
  'DEPRECATED ALIAS of global_unique_listings — kept for existing dashboards. Ambiguously named; new logic must read global_unique_listings.';
COMMENT ON COLUMN scrape_run.listings_fetched IS
  'Raw listings accumulated across all queries in the run — a listing returned by two queries is counted twice. NOT a global measurement; never use it for baseline or volume rules.';
