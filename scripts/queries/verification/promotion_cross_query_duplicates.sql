-- Verification: promotion tolerates cross-query duplicates in staging.
--
-- Kind: verification fixture (creates and REMOVES its own synthetic data)
-- Related migrations: 052 (the fix), 046 (listing_coverage_scopes), 051
--
-- Reproduces the P0 that failed four consecutive nightly DBA runs:
--   ON CONFLICT DO UPDATE command cannot affect row a second time
--
-- The same advert is legitimately returned by several product queries, so
-- staging holds several rows for one external_id. listing_coverage_scopes is
-- keyed (listing_id, scope_hash), so before migration 052 those rows all
-- resolved to the same conflict key inside one statement and Postgres aborted
-- the whole promotion.
--
-- Fixture: 4 staging rows = 1 advert found by THREE different product queries
-- + 1 advert found once. Expected after promotion:
--   staging rows          4  (never de-duplicated — provenance is preserved)
--   listings              2  (one current row per distinct advert)
--   coverage scope rows   2  (one per (listing_id, scope_hash))
--   published_count       2  (distinct adverts upserted, NOT staging rows)
--   query coverage rows   3  (every query still accounted for)
--   lifecycle_applied     false (coverage_complete = false)
--
-- Uses source '__dupfix__' throughout and deletes everything it created, so it
-- is safe to run against production and safe to re-run.

CREATE TEMP TABLE IF NOT EXISTS dupfix(ord int, check_name text, expected text, actual text);
TRUNCATE dupfix;

DO $$
DECLARE
  v_run   uuid;
  v_scope text := 'scope-dupfix-test';
  v_dup   text := 'https://example.invalid/__dupfix__/duplicated-advert';
  v_uni   text := 'https://example.invalid/__dupfix__/unique-advert';
  v_res   jsonb;
  v_lid   uuid;
BEGIN
  -- A complete, gate-passed run carrying full cohort identity.
  INSERT INTO scrape_run (source, status, coverage_scope_hash, coverage_version,
                          scraper_version, parser_version, pagination_strategy,
                          run_scope, coverage_complete, global_unique_listings,
                          staged_count, baseline_status)
  VALUES ('__dupfix__','passed', v_scope,'v2','sv-1','pv-1','ps-1',
          'complete', false, 2, 4, 'unavailable')
  RETURNING id INTO v_run;

  -- Same advert, three different product queries. Identical payload except
  -- source_query — exactly what the real scraper produces.
  INSERT INTO listing_staging (run_id, external_id, title, price, currency, price_dkk,
                               url, source, country, platform, source_query)
  VALUES
    (v_run, v_dup, 'Duplicated advert', 5000, 'DKK', 5000, v_dup, '__dupfix__','DK','test','Fender Telecaster'),
    (v_run, v_dup, 'Duplicated advert', 5000, 'DKK', 5000, v_dup, '__dupfix__','DK','test','Fender Stratocaster'),
    (v_run, v_dup, 'Duplicated advert', 5000, 'DKK', 5000, v_dup, '__dupfix__','DK','test','Gibson Les Paul'),
    (v_run, v_uni, 'Unique advert',     9000, 'DKK', 9000, v_uni, '__dupfix__','DK','test','Roland Juno-106');

  -- Per-query coverage evidence must survive independently of the collapse.
  INSERT INTO scrape_query_coverage (run_id, query, query_started, query_completed,
                                     pages_fetched, termination_reason, raw_count,
                                     parsed_count, unique_staged_count)
  VALUES
    (v_run,'Fender Telecaster',   true,true,1,'empty_page',1,1,1),
    (v_run,'Fender Stratocaster', true,true,1,'empty_page',1,1,1),
    (v_run,'Gibson Les Paul',     true,true,1,'empty_page',1,1,1);

  v_res := promote_scrape_run(v_run, false, 3, false, false);

  INSERT INTO dupfix VALUES
    (1,'promotion did not error',   'skipped=false', 'skipped=' || COALESCE((v_res->>'skipped'),'null')),
    (2,'staging rows preserved',    '4', (SELECT count(*)::text FROM listing_staging WHERE run_id=v_run)),
    (3,'listings for dup advert',   '1', (SELECT count(*)::text FROM listings WHERE external_id=v_dup AND source='__dupfix__')),
    (4,'listings total',            '2', (SELECT count(*)::text FROM listings WHERE source='__dupfix__')),
    (5,'coverage scope rows',       '2', (SELECT count(*)::text FROM listing_coverage_scopes WHERE scope_hash=v_scope)),
    (6,'scope rows for dup advert', '1', (SELECT count(*)::text FROM listing_coverage_scopes lcs
                                            JOIN listings l ON l.id=lcs.listing_id
                                           WHERE l.external_id=v_dup AND lcs.scope_hash=v_scope)),
    (7,'published_count',           '2', COALESCE((v_res->>'published'),'null')),
    (8,'query coverage rows kept',  '3', (SELECT count(*)::text FROM scrape_query_coverage WHERE run_id=v_run)),
    (9,'lifecycle_applied',         'false', COALESCE((v_res->>'lifecycle_applied'),'null')),
    (10,'misses created',           '0', (SELECT count(*)::text FROM listings WHERE source='__dupfix__' AND consecutive_misses>0)),
    (11,'delistings created',       '0', (SELECT count(*)::text FROM listings WHERE source='__dupfix__' AND delisted_at IS NOT NULL)),
    (12,'source_query is min()',    'Fender Stratocaster',
        (SELECT lcs.source_query FROM listing_coverage_scopes lcs
           JOIN listings l ON l.id=lcs.listing_id
          WHERE l.external_id=v_dup AND lcs.scope_hash=v_scope)),
    (13,'run promoted',             'true', (SELECT (promoted_at IS NOT NULL)::text FROM scrape_run WHERE id=v_run));

  -- Remove every trace.
  DELETE FROM listing_coverage_scopes WHERE scope_hash = v_scope;
  DELETE FROM market_price_observations WHERE source = '__dupfix__';
  DELETE FROM listings WHERE source = '__dupfix__';
  DELETE FROM scrape_run WHERE id = v_run;  -- cascades staging + query coverage

  INSERT INTO dupfix VALUES
    (14,'residue rows', '0',
      ((SELECT count(*) FROM listings WHERE source='__dupfix__')
     + (SELECT count(*) FROM scrape_run WHERE source='__dupfix__')
     + (SELECT count(*) FROM listing_coverage_scopes WHERE scope_hash=v_scope)
     + (SELECT count(*) FROM market_price_observations WHERE source='__dupfix__'))::text);
END $$;

SELECT ord, check_name, expected, actual,
       CASE WHEN expected = actual THEN 'PASS' ELSE 'FAIL' END AS result
FROM dupfix ORDER BY ord;
