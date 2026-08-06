-- Verification: a detected fault cannot change authoritative state.
--
-- Kind: verification query (READ-ONLY, never modifies anything)
-- Related migrations: 042, 043, 046, 047
--
-- Run BEFORE and AFTER these fault-injection commands and diff the output:
--   npx tsx scripts/scrape-dba.ts --product="juno-106" --simulate-bad-data
--   npx tsx scripts/scrape-dba.ts --product="juno-106" --simulate-promotion-crash
-- All counters must be bit-identical. Verified 2026-08-06.

SELECT
  (SELECT count(*) FROM listings WHERE source = 'dba.dk')                       AS listings,
  (SELECT count(*) FROM market_price_observations WHERE source = 'dba.dk')      AS observations,
  (SELECT count(*) FROM listings WHERE source = 'dba.dk' AND consecutive_misses > 0) AS with_misses,
  (SELECT count(*) FROM listings WHERE source = 'dba.dk' AND delisted_at IS NOT NULL) AS delisted,
  (SELECT max(scraped_at) FROM listings WHERE source = 'dba.dk')                AS max_scraped,
  (SELECT count(*) FROM listing_staging)                                        AS staged_rows;
