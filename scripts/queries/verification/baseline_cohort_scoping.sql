-- Verification: re-audit a gate verdict's baseline decision from stored evidence.
--
-- Kind: verification query (READ-ONLY)
-- Related migrations: 050 (cohort identity + global_unique_listings + baseline_status)
--
-- The gate must be re-auditable without re-running selection: `scrape_run.baseline`
-- records the cohort that was required, the runs that were selected, their
-- volumes, and why every other considered run was rejected.
--
-- Selection rules live in scripts/lib/baseline.ts. This file READS the recorded
-- decision — it deliberately does not reimplement the rules, because two copies
-- of a contract drift.

-- ── 1. What each run declared it measured, and what its gate concluded ────
-- baseline_status = 'unavailable' is INFORMATION, not a violation: it means the
-- relative volume rules were inactive because no qualifying prior run existed
-- in an identical cohort. A first complete run in a new cohort looks like this
-- and is correct.
SELECT
  r.started_at,
  r.status,
  r.run_scope,
  r.baseline_status,
  r.baseline ->> 'reason'          AS baseline_reason,
  (r.baseline ->> 'median_volume')::numeric AS baseline_median,
  (r.baseline ->> 'sample_size')::int       AS baseline_sample,
  r.global_unique_listings,
  r.volume_delta_pct,
  r.coverage_complete,
  left(r.coverage_scope_hash, 12)  AS scope,
  r.scraper_version,
  r.parser_version,
  r.pagination_strategy,
  jsonb_array_length(COALESCE(r.baseline -> 'run_ids', '[]'::jsonb)) AS selected_runs
FROM scrape_run r
WHERE r.source = 'dba.dk'
ORDER BY r.started_at DESC
LIMIT 30;

-- ── 2. Why each considered run was rejected from a given baseline ─────────
-- Expect to see `run_scope_targeted` / `cohort_mismatch:coverage_scope_hash`
-- for the `--product=` runs. Those polluting the baseline is the defect this
-- was built to fix: the first full 30-product DBA run reported
-- volume_swing 12600% (6 -> 762) against six-listing targeted runs.
SELECT
  r.started_at,
  rej ->> 'run_id' AS rejected_run,
  rej ->> 'reason' AS reason
FROM scrape_run r
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.baseline -> 'rejected', '[]'::jsonb)) AS rej
WHERE r.id = '00000000-0000-0000-0000-000000000000'  -- ← replace with the run being audited
ORDER BY reason;

-- ── 3. Which runs are eligible to seed a baseline at all ──────────────────
-- A qualifying run is complete, promoted, coverage-approved, passed, and
-- carries a full cohort identity plus a global volume measurement.
SELECT
  r.source,
  left(r.coverage_scope_hash, 12) AS scope,
  r.scraper_version,
  r.parser_version,
  r.pagination_strategy,
  count(*) FILTER (
    WHERE r.status = 'passed'
      AND r.promoted_at IS NOT NULL
      AND r.run_scope = 'complete'
      AND r.coverage_complete
      AND r.global_unique_listings > 0
  ) AS baseline_eligible_runs,
  count(*) AS runs_in_cohort
FROM scrape_run r
WHERE r.coverage_version IS NOT NULL
GROUP BY r.source, r.coverage_scope_hash, r.scraper_version,
         r.parser_version, r.pagination_strategy
ORDER BY r.source, baseline_eligible_runs DESC;

-- ── 4. The measurements must not be conflated ─────────────────────────────
-- Five different, all-legitimate numbers. Baseline and volume rules use
-- global_unique_listings and nothing else.
SELECT
  r.id,
  sum(c.raw_count)           AS sum_query_raw,        -- overlaps across queries
  sum(c.unique_staged_count) AS sum_query_local_unique,
  r.global_unique_listings   AS global_unique,        -- ← the baseline measure
  r.staged_count,
  r.published_count,
  r.listings_fetched         AS listings_fetched_legacy_raw
FROM scrape_run r
LEFT JOIN scrape_query_coverage c ON c.run_id = r.id
WHERE r.source = 'dba.dk'
GROUP BY r.id, r.global_unique_listings, r.staged_count,
         r.published_count, r.listings_fetched, r.started_at
ORDER BY r.started_at DESC
LIMIT 10;
