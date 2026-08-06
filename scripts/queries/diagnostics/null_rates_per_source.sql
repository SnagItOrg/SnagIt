-- Diagnostic: per-source data-contract health for recent scrapes.
--
-- Kind: diagnostic query (READ-ONLY)
-- Related migrations: none (inspects `listings`)
--
-- WHY THIS EXISTS: on 2026-08-05 scrape-finn and scrape-blocket both exited 0
-- while 100% of saved listings had NULL price_dkk, making the NO and SE
-- markets invisible to /intel's arbitrage medians. A job can be operationally
-- green and product-worthless. null_despite_price should always be 0.

SELECT
  source,
  count(*)                                                        AS scraped_24h,
  count(*) FILTER (WHERE price_dkk IS NULL AND price IS NOT NULL) AS null_despite_price,
  count(*) FILTER (WHERE price IS NULL)                           AS null_price,
  count(*) FILTER (WHERE country IS NULL)                         AS null_country,
  count(*) FILTER (WHERE external_id IS NULL)                     AS null_external_id,
  max(scraped_at)                                                 AS last_scraped
FROM listings
WHERE scraped_at > now() - interval '24 hours'
GROUP BY source
ORDER BY scraped_24h DESC;
