-- Operations: recent scrape-run outcomes and why they were gated.
--
-- Kind: operational query (READ-ONLY)
-- Related migrations: 041, 042, 044
--
-- status semantics:
--   passed       published normally
--   quarantined  stored, EXCLUDED from price aggregation and Kup-score
--   failed       hard invariant broken; no lifecycle updates, untrusted

SELECT
  started_at,
  source,
  status,
  coverage_version,
  left(coverage_scope_hash, 12) AS scope,
  scraper_version,
  expected_products,
  covered_products,
  coverage_complete,
  listings_fetched,
  staged_count,
  published_count,
  null_price_dkk,
  volume_delta_pct,
  baseline,
  violations
FROM scrape_run
ORDER BY started_at DESC
LIMIT 20;
