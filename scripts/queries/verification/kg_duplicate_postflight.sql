-- kg_duplicate_postflight.sql
--
-- SELECT-ONLY. Contains no INSERT/UPDATE/DELETE/UPSERT and opens no write
-- transaction. Run AFTER migration 053 has been authorised and applied.
-- Every check must report 'PASS'.
--
-- Migration 053 runs these same assertions inside its own transaction and
-- aborts before COMMIT if any fails. This file exists so the result can be
-- re-audited independently afterwards.

-- ── 1. No ACTIVE duplicate normalised (brand, model_name) pairs remain ──────
WITH norm AS (
  SELECT p.id,
         lower(trim(coalesce(b.name,'')))||'|'||
         lower(regexp_replace(trim(coalesce(p.model_name,'')),'\s+',' ','g')) AS grp
  FROM kg_product p LEFT JOIN kg_brand b ON b.id = p.brand_id
  WHERE coalesce(p.model_name,'') <> '' AND p.status = 'active'
)
SELECT '1. no active duplicate pairs' AS check, count(*) AS remaining,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM (SELECT grp FROM norm GROUP BY 1 HAVING count(*) > 1) x;

-- ── 2. No orphan/split references to any retired loser row ──────────────────
WITH losers(id) AS (VALUES
  ('76e1995a-3c03-4a8f-a19a-d342da7bc48f'::uuid),('923a8381-1887-4edb-acc5-2e72db6e6821'),
  ('f96d61dc-cf81-463b-8bf1-d9beffb0e1d5'),('a08c0c96-c842-496e-8fa7-d7fc97cbe658'),
  ('3bfa3be3-fc54-4698-a1e8-bb2c488ba63c'),('185521d4-c2bc-45e1-a42c-85fadd2248e7'),
  ('37e806b8-0c43-423c-b5eb-89ca10aa5360'),('950e7f3b-a902-4602-9632-2702a755f03a'),
  ('15f32b11-fab0-4007-a1ce-ff7cb2aafb49'),('cef40460-946f-45ac-a7a7-c1aba9770ad4'),
  ('56e302b8-892a-4948-89e3-ff07d944d64f'),('26fd7032-0d6c-4162-b0c0-a5b74755b0f5'),
  ('d6b5172d-2cd3-4398-801f-d1d4e57f30dd'),('0782e37c-c6ad-4045-aeef-b578c5849e75')
)
SELECT '2. no references to losers' AS check, sum(n) AS dangling,
       CASE WHEN coalesce(sum(n),0) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM (
  SELECT count(*) n FROM listing_product_match     m JOIN losers l ON m.product_id = l.id
  UNION ALL SELECT count(*) FROM synonym           s JOIN losers l ON s.product_id = l.id
  UNION ALL SELECT count(*) FROM kg_identifier     i JOIN losers l ON i.product_id = l.id
  UNION ALL SELECT count(*) FROM kg_relation       r JOIN losers l ON r.from_product_id = l.id OR r.to_product_id = l.id
  UNION ALL SELECT count(*) FROM reverb_price_history      x JOIN losers l ON x.kg_product_id = l.id
  UNION ALL SELECT count(*) FROM market_price_observations o JOIN losers l ON o.kg_product_id = l.id
  UNION ALL SELECT count(*) FROM market_price_daily        d JOIN losers l ON d.kg_product_id = l.id
  UNION ALL SELECT count(*) FROM price_observation         p JOIN losers l ON p.product_id = l.id
  UNION ALL SELECT count(*) FROM scrape_query_coverage     c JOIN losers l ON c.kg_product_id = l.id
  UNION ALL SELECT count(*) FROM thomann_product           t JOIN losers l ON t.kg_product_id = l.id
) q;

-- ── 3. Public catalogue identity intact, with its evidence ─────────────────
SELECT '3. roland-re-201 identity' AS check, p.slug, p.status, p.browse_visibility,
       (SELECT count(*) FROM reverb_price_history WHERE kg_product_id = p.id) AS price_rows,
       (SELECT count(*) FROM listing_product_match WHERE product_id = p.id)   AS matches,
       CASE WHEN p.status='active' AND p.browse_visibility='public'
             AND (SELECT count(*) FROM reverb_price_history WHERE kg_product_id = p.id) >= 20
            THEN 'PASS' ELSE 'FAIL' END AS status_check
FROM kg_product p WHERE p.id = '07cc1ac5-a0c9-4707-99ed-c4440a1f9563';

-- ── 4. lpm unique key holds; no listing matched twice to one product ────────
SELECT '4. lpm uniqueness' AS check, count(*) AS violations,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM (SELECT listing_id, product_id FROM listing_product_match GROUP BY 1,2 HAVING count(*) > 1) x;

-- ── 5. Row totals reconcile — evidence preserved, not dropped ───────────────
-- Compare against the pre-migration figures captured by the preflight run.
SELECT '5. evidence totals' AS check,
  (SELECT count(*) FROM listing_product_match)      AS lpm_rows,
  (SELECT count(*) FROM listing_product_match WHERE is_valid IS TRUE)  AS lpm_true,
  (SELECT count(*) FROM listing_product_match WHERE is_valid IS FALSE) AS lpm_false,
  (SELECT count(*) FROM reverb_price_history)       AS reverb_price_rows,
  (SELECT count(*) FROM market_price_observations)  AS market_observations,
  (SELECT count(*) FROM synonym)                    AS synonyms,
  (SELECT count(*) FROM kg_identifier)              AS identifiers;

-- ── 6. HP Z8 treated as out-of-vertical deactivation, not a merge ───────────
SELECT '6. hp z8 deactivated' AS check, count(*) AS active_rows,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM kg_product
WHERE id IN ('7e90858b-1652-4a6a-a07b-544bbf38b1f3','6e6dd995-d4c9-43ac-8ad0-9dbde6116fa1')
  AND status = 'active';

-- ── 7. Loser rows retired but retained (deactivated, not deleted) ───────────
SELECT '7. losers retained inactive' AS check, count(*) AS retained,
       CASE WHEN count(*) = 14 THEN 'PASS' ELSE 'FAIL — expected 14 retained loser rows' END AS status
FROM kg_product
WHERE id IN ('76e1995a-3c03-4a8f-a19a-d342da7bc48f','923a8381-1887-4edb-acc5-2e72db6e6821',
             'f96d61dc-cf81-463b-8bf1-d9beffb0e1d5','a08c0c96-c842-496e-8fa7-d7fc97cbe658',
             '3bfa3be3-fc54-4698-a1e8-bb2c488ba63c','185521d4-c2bc-45e1-a42c-85fadd2248e7',
             '37e806b8-0c43-423c-b5eb-89ca10aa5360','950e7f3b-a902-4602-9632-2702a755f03a',
             '15f32b11-fab0-4007-a1ce-ff7cb2aafb49','cef40460-946f-45ac-a7a7-c1aba9770ad4',
             '56e302b8-892a-4948-89e3-ff07d944d64f','26fd7032-0d6c-4162-b0c0-a5b74755b0f5',
             'd6b5172d-2cd3-4398-801f-d1d4e57f30dd','0782e37c-c6ad-4045-aeef-b578c5849e75')
  AND status = 'inactive';

-- ── 8. Matcher-level proof: product_data_conflict must reach zero ───────────
-- Not expressible in SQL — the matcher decides it. After applying 053, run:
--   npm run report-match-backlog
-- and confirm "Deferred — product-data conflict" is 0 for BOTH dba.dk and
-- kleinanzeigen. Pre-migration baseline: DBA 2, Kleinanzeigen 7.
SELECT '8. product_data_conflict' AS check,
       'run: npm run report-match-backlog (expect 0 for both sources; baseline DBA 2 / KA 7)' AS instruction;
