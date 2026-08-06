-- Verification: per-query pagination coverage for a given run.
--
-- Kind: verification query (READ-ONLY)
-- Related migrations: 044
--
-- Only empty_page / no_next_token / known_last_page are terminal.
-- max_pages_hit / error / unknown mean listings may exist that were never
-- seen, which cannot support delisting.
--
-- Replace the run_id. The rejected DBA candidate bootstrap is
-- '43f27632-5881-4095-83a7-b7b840638ba1' (quarantined; DO NOT reclassify).

SELECT
  r.coverage_version,
  left(r.coverage_scope_hash, 12) AS scope,
  r.scraper_version,
  r.status,
  r.expected_products,
  r.published_count,
  run_has_lifecycle_coverage(r.id) AS lifecycle_coverage,
  c.termination_reason,
  count(c.*)            AS queries,
  sum(c.pages_fetched)  AS pages,
  sum(c.raw_count)      AS raw,
  sum(c.parsed_count)   AS parsed
FROM scrape_run r
LEFT JOIN scrape_query_coverage c ON c.run_id = r.id
WHERE r.id = '43f27632-5881-4095-83a7-b7b840638ba1'
GROUP BY r.id, r.coverage_version, r.coverage_scope_hash, r.scraper_version,
         r.status, r.expected_products, r.published_count, c.termination_reason
ORDER BY queries DESC;
