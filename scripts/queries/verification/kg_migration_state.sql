-- kg_migration_state.sql
--
-- SELECT-ONLY. No INSERT/UPDATE/DELETE/CREATE/ALTER and no write transaction.
-- Reports the detected state for migrations 053 and 054 and every failed
-- predicate, using the SAME predicates the migrations enforce internally.
--
-- Run BEFORE authorising either migration.
--   detected_state = 'PRE'   -> the migration may be authorised
--   detected_state = 'POST'  -> already applied; the migration is a no-op
--   detected_state = 'DRIFT' -> DO NOT RUN; investigate the failed predicates
--
-- Also verifies archive completeness and rollback eligibility.

-- ── Migration 053 ──────────────────────────────────────────────────────────
WITH manifest(grp, survivor, loser, survivor_slug, loser_slug) AS (VALUES
 ('elektron|analog rytm mkii','3845393d-00ad-473a-bdad-af69fe9a886e'::uuid,'76e1995a-3c03-4a8f-a19a-d342da7bc48f'::uuid,'elektron-analogrytmMKII','elektron-elektron-analog-rytm-mkii'),
 ('elektron|sps-1',           'aaae5cda-7738-4a53-afdd-3cd493d4dab4','923a8381-1887-4edb-acc5-2e72db6e6821','elektron-machinedrum-sps-1','elektron-machinedrum'),
 ('jomox|airbase 99',         '6d6bd2ee-89e9-4469-afb1-10a4982e20f0','f96d61dc-cf81-463b-8bf1-d9beffb0e1d5','jomox-airbase-99','jomox-jomox-airbase-99'),
 ('manley|core',              '92982f65-e9eb-448a-b647-2cc81f23af4c','a08c0c96-c842-496e-8fa7-d7fc97cbe658','manley-core','manley-manley-core'),
 ('manley|reference cardioid','6aeb4f2a-357d-4a2b-8cb2-cd87d0c470ac','3bfa3be3-fc54-4698-a1e8-bb2c488ba63c','manley-ref-c','manley-reference-cardioid'),
 ('manley|reference cardioid','6aeb4f2a-357d-4a2b-8cb2-cd87d0c470ac','185521d4-c2bc-45e1-a42c-85fadd2248e7','manley-ref-c','manley-manley-reference-cardioid'),
 ('manley|reference gold',    'b921847d-4513-4206-8902-f1c7616ca6ac','37e806b8-0c43-423c-b5eb-89ca10aa5360','manley-reference-gold','manley-ref-gold'),
 ('moog|slim phatty',         '40355ea0-81f8-4df4-a2c9-fc788197a146','950e7f3b-a902-4602-9632-2702a755f03a','moog-slim-phatty','moog-moog-slim-phatty'),
 ('moog|subsequent 37',       '46509b95-ce08-4727-85ea-c237d594413d','15f32b11-fab0-4007-a1ce-ff7cb2aafb49','moog-moog-subsequent-37','moog-subsequent-37'),
 ('novation|bass station ii', '666dc5e3-7a50-4f55-90ff-fef267ca9db0','cef40460-946f-45ac-a7a7-c1aba9770ad4','novation-novation-bass-station-ii','novation-bass_station2'),
 ('propellerhead|rb-338',     'a452be02-2649-4c95-9b77-c19fbb353c4f','56e302b8-892a-4948-89e3-ff07d944d64f','propellerhead-rebirth-rb-338','propellerhead-rebirth'),
 ('roland|re-201',            '07cc1ac5-a0c9-4707-99ed-c4440a1f9563','26fd7032-0d6c-4162-b0c0-a5b74755b0f5','roland-re-201','roland-re-201-space-echo'),
 ('teenage engineering|ep-133 k.o. ii','40000232-c58e-4ffa-948f-8de9b90b3285','d6b5172d-2cd3-4398-801f-d1d4e57f30dd','teenage-engineering-teenage-engineering-ep-133-k-o-ii','teenage-engineering-ep-133-ko-ii'),
 ('teisco|synthesizer 110f',  '958685c7-deb4-40cf-87e0-0514f6ded940','0782e37c-c6ad-4045-aeef-b578c5849e75','teisco-synthesizer-110f','teisco-synthesizer-110f-0')
), deact(product_id, slug) AS (VALUES
 ('7e90858b-1652-4a6a-a07b-544bbf38b1f3'::uuid,'hp-z8'),
 ('6e6dd995-d4c9-43ac-8ad0-9dbde6116fa1','hp-z8-workstation')
), all_rows(id, slug) AS (
  SELECT survivor, survivor_slug FROM manifest
  UNION ALL SELECT loser, loser_slug FROM manifest
  UNION ALL SELECT product_id, slug FROM deact
), losers(id) AS (
  SELECT loser FROM manifest UNION ALL SELECT product_id FROM deact
), norm AS (
  SELECT p.id, lower(trim(coalesce(b.name,'')))||'|'||
         lower(regexp_replace(trim(coalesce(p.model_name,'')),'\s+',' ','g')) AS grp
  FROM kg_product p LEFT JOIN kg_brand b ON b.id = p.brand_id
  WHERE coalesce(p.model_name,'') <> ''
), dup AS (SELECT grp, count(*) c FROM norm GROUP BY 1 HAVING count(*) > 1
), facts AS (
  SELECT
    (SELECT bool_and(p.id IS NOT NULL AND p.slug = a.slug)
       FROM all_rows a LEFT JOIN kg_product p ON p.id = a.id)             AS ids_ok,
    (SELECT count(*) FROM dup)                                            AS n_groups,
    (SELECT coalesce(sum(c),0) FROM dup)                                  AS n_rows,
    (SELECT count(*) FROM manifest mm JOIN kg_product p ON p.id=mm.loser WHERE p.status='active')  AS losers_live,
    (SELECT count(*) FROM manifest mm JOIN kg_product p ON p.id=mm.loser WHERE p.status<>'active') AS losers_dead,
    (SELECT count(*) FROM (
        SELECT 1 FROM listing_product_match m JOIN losers l ON m.product_id=l.id
        UNION ALL SELECT 1 FROM synonym s       JOIN losers l ON s.product_id=l.id
        UNION ALL SELECT 1 FROM kg_identifier i JOIN losers l ON i.product_id=l.id
        UNION ALL SELECT 1 FROM kg_relation r   JOIN losers l ON r.from_product_id=l.id OR r.to_product_id=l.id
        UNION ALL SELECT 1 FROM reverb_price_history x      JOIN losers l ON x.kg_product_id=l.id
        UNION ALL SELECT 1 FROM market_price_observations o JOIN losers l ON o.kg_product_id=l.id
        UNION ALL SELECT 1 FROM market_price_daily d        JOIN losers l ON d.kg_product_id=l.id
        UNION ALL SELECT 1 FROM price_observation po        JOIN losers l ON po.product_id=l.id
        UNION ALL SELECT 1 FROM scrape_query_coverage c     JOIN losers l ON c.kg_product_id=l.id
        UNION ALL SELECT 1 FROM thomann_product t           JOIN losers l ON t.kg_product_id=l.id) q) AS refs,
    (SELECT count(*) FROM (
        SELECT m.listing_id FROM manifest mm
        JOIN listing_product_match m ON m.product_id IN (mm.survivor, mm.loser)
        GROUP BY mm.grp, m.listing_id
        HAVING count(*) FILTER (WHERE m.is_valid IS TRUE) > 0
           AND count(*) FILTER (WHERE m.is_valid IS FALSE) > 0) x)        AS contradictions,
    (SELECT EXISTS (SELECT 1 FROM kg_product
       WHERE id='07cc1ac5-a0c9-4707-99ed-c4440a1f9563' AND slug='roland-re-201'
         AND status='active' AND browse_visibility='public'))             AS public_ok,
    (SELECT CASE WHEN to_regclass('public.kg_arch_product_053') IS NULL THEN 0
                 ELSE (SELECT count(*) FROM kg_arch_product_053) END)     AS arch_rows
)
SELECT '053' AS migration,
  CASE
    WHEN ids_ok AND n_groups=14 AND n_rows=29 AND public_ok
         AND losers_live=14 AND losers_dead=0 AND arch_rows=0 THEN 'PRE'
    WHEN ids_ok AND public_ok
         AND losers_live=0 AND losers_dead=14 AND refs=0 AND arch_rows=16 THEN 'POST'
    ELSE 'DRIFT'
  END AS detected_state,
  n_groups, n_rows, losers_live, losers_dead, refs, contradictions, arch_rows,
  ids_ok, public_ok,
  trim(
    CASE WHEN NOT ids_ok                  THEN 'manifest_id_or_slug_drift ' ELSE '' END ||
    CASE WHEN n_groups<>14                THEN 'groups<>14 '                ELSE '' END ||
    CASE WHEN n_rows<>29                  THEN 'rows<>29 '                  ELSE '' END ||
    CASE WHEN NOT public_ok               THEN 'roland_re_201_identity '    ELSE '' END ||
    CASE WHEN losers_live NOT IN (0,14)   THEN 'partial_deactivation '      ELSE '' END ||
    CASE WHEN arch_rows NOT IN (0,16)     THEN 'partial_archive '           ELSE '' END ||
    CASE WHEN contradictions>0            THEN 'CONTRADICTORY_VALIDATION '  ELSE '' END
  ) AS failed_predicates,
  CASE WHEN arch_rows=16 THEN 'eligible' ELSE 'not_applicable' END AS rollback_053
FROM facts;

-- ── Migration 054 ──────────────────────────────────────────────────────────
WITH f AS (
  SELECT
    (SELECT count(*) FROM kg_identifier i WHERE (i.id, i.type, i.value, i.product_id) IN (
       ('bb30eefe-e39c-486c-b73e-0517016da18f'::uuid,'SKU','PAUL','776dff2d-15eb-42fe-8202-471f0feebbb6'::uuid),
       ('65b12d19-9093-4a6f-a841-3b919f37e5dc',      'SKU','TOM', 'b43d7b32-b58e-4ab1-8d47-a565cf448a65'),
       ('b056bb68-0de4-4b5c-9d8f-0d667fe45a1a',      'SKU','335', 'c716d85e-a9b1-4ccf-b96c-387589a73d49'))) AS removable,
    (SELECT count(*) FROM kg_identifier i WHERE (i.product_id, i.type, lower(trim(i.value))) IN (
       ('776dff2d-15eb-42fe-8202-471f0feebbb6'::uuid,'SKU','les paul'),
       ('c716d85e-a9b1-4ccf-b96c-387589a73d49',      'SKU','es-335')))                                      AS n_symmetric,
    (SELECT CASE WHEN to_regclass('public.kg_arch_identifier_054') IS NULL THEN 0
                 ELSE (SELECT count(*) FROM kg_arch_identifier_054) END)                                    AS arch_rows,
    (SELECT CASE WHEN to_regclass('public.kg_arch_product_053') IS NULL THEN 0
                 ELSE (SELECT count(*) FROM kg_arch_product_053) END)                                       AS arch_053
)
SELECT '054' AS migration,
  CASE
    WHEN removable=3 AND n_symmetric=0 AND arch_rows=0 THEN 'PRE'
    WHEN removable=0 AND n_symmetric=2 AND arch_rows=3 THEN 'POST'
    ELSE 'DRIFT'
  END AS detected_state,
  removable, n_symmetric, arch_rows,
  CASE WHEN arch_053=16 THEN 'satisfied' ELSE 'NOT satisfied — apply 053 first' END AS dependency_053,
  trim(
    CASE WHEN removable NOT IN (0,3) THEN 'removable_rows_unexpected ' ELSE '' END ||
    CASE WHEN n_symmetric NOT IN (0,2) THEN 'symmetric_rows_unexpected ' ELSE '' END ||
    CASE WHEN arch_rows NOT IN (0,3) THEN 'partial_archive '           ELSE '' END
  ) AS failed_predicates,
  CASE WHEN arch_rows=3 THEN 'eligible' ELSE 'not_applicable' END AS rollback_054
FROM f;
