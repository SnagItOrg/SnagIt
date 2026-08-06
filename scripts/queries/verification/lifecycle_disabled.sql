-- Verification: DBA lifecycle is hard-disabled and no scope is established.
--
-- Kind: verification query (READ-ONLY)
-- Related migrations: 044, 048
--
-- Expected while coverage_v2 bootstrap is incomplete:
--   established_scopes = 0, with_misses = 0, delisted = 0
-- NOTE: source_has_established_coverage() was RETIRED in 048 and now RAISEs
-- by design; use scope_has_established_coverage(source, hash, version).

SELECT
  (SELECT count(*) FROM scrape_run
     WHERE coverage_version = 'v2' AND status = 'passed'
       AND promoted_at IS NOT NULL AND run_has_lifecycle_coverage(id)) AS established_scopes,
  (SELECT count(*) FROM listings WHERE consecutive_misses > 0)          AS with_misses,
  (SELECT count(*) FROM listings WHERE delisted_at IS NOT NULL)         AS delisted,
  (SELECT count(*) FROM listing_coverage_scopes)                        AS scope_memberships;
