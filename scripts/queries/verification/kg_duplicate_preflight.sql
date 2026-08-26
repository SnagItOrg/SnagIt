-- kg_duplicate_preflight.sql
--
-- SELECT-ONLY. Contains no INSERT/UPDATE/DELETE/UPSERT and opens no write
-- transaction. Run this BEFORE authorising migration 053; every check must
-- report status='PASS' or the migration must not be run.
--
-- These mirror the preconditions migration 053 enforces internally. Running
-- them first turns an in-transaction RAISE EXCEPTION into a reviewable report.

-- ── 1. Duplicate shape: expect exactly 14 groups / 29 rows ──────────────────
WITH norm AS (
  SELECT p.id,
         lower(trim(coalesce(b.name,'')))||'|'||
         lower(regexp_replace(trim(coalesce(p.model_name,'')),'\s+',' ','g')) AS grp
  FROM kg_product p LEFT JOIN kg_brand b ON b.id = p.brand_id
  WHERE coalesce(p.model_name,'') <> ''
), dup AS (SELECT grp, count(*) c FROM norm GROUP BY 1 HAVING count(*) > 1)
SELECT '1. duplicate shape' AS check,
       count(*) AS groups, coalesce(sum(c),0) AS rows,
       CASE WHEN count(*) = 14 AND coalesce(sum(c),0) = 29 THEN 'PASS' ELSE 'FAIL' END AS status
FROM dup;

-- ── 2. Manifest identity: every survivor/loser id still carries its slug ────
WITH manifest(id, slug) AS (VALUES
  ('3845393d-00ad-473a-bdad-af69fe9a886e'::uuid,'elektron-analogrytmMKII'),
  ('76e1995a-3c03-4a8f-a19a-d342da7bc48f','elektron-elektron-analog-rytm-mkii'),
  ('aaae5cda-7738-4a53-afdd-3cd493d4dab4','elektron-machinedrum-sps-1'),
  ('923a8381-1887-4edb-acc5-2e72db6e6821','elektron-machinedrum'),
  ('6d6bd2ee-89e9-4469-afb1-10a4982e20f0','jomox-airbase-99'),
  ('f96d61dc-cf81-463b-8bf1-d9beffb0e1d5','jomox-jomox-airbase-99'),
  ('92982f65-e9eb-448a-b647-2cc81f23af4c','manley-core'),
  ('a08c0c96-c842-496e-8fa7-d7fc97cbe658','manley-manley-core'),
  ('6aeb4f2a-357d-4a2b-8cb2-cd87d0c470ac','manley-ref-c'),
  ('3bfa3be3-fc54-4698-a1e8-bb2c488ba63c','manley-reference-cardioid'),
  ('185521d4-c2bc-45e1-a42c-85fadd2248e7','manley-manley-reference-cardioid'),
  ('b921847d-4513-4206-8902-f1c7616ca6ac','manley-reference-gold'),
  ('37e806b8-0c43-423c-b5eb-89ca10aa5360','manley-ref-gold'),
  ('40355ea0-81f8-4df4-a2c9-fc788197a146','moog-slim-phatty'),
  ('950e7f3b-a902-4602-9632-2702a755f03a','moog-moog-slim-phatty'),
  ('46509b95-ce08-4727-85ea-c237d594413d','moog-moog-subsequent-37'),
  ('15f32b11-fab0-4007-a1ce-ff7cb2aafb49','moog-subsequent-37'),
  ('666dc5e3-7a50-4f55-90ff-fef267ca9db0','novation-novation-bass-station-ii'),
  ('cef40460-946f-45ac-a7a7-c1aba9770ad4','novation-bass_station2'),
  ('a452be02-2649-4c95-9b77-c19fbb353c4f','propellerhead-rebirth-rb-338'),
  ('56e302b8-892a-4948-89e3-ff07d944d64f','propellerhead-rebirth'),
  ('07cc1ac5-a0c9-4707-99ed-c4440a1f9563','roland-re-201'),
  ('26fd7032-0d6c-4162-b0c0-a5b74755b0f5','roland-re-201-space-echo'),
  ('40000232-c58e-4ffa-948f-8de9b90b3285','teenage-engineering-teenage-engineering-ep-133-k-o-ii'),
  ('d6b5172d-2cd3-4398-801f-d1d4e57f30dd','teenage-engineering-ep-133-ko-ii'),
  ('958685c7-deb4-40cf-87e0-0514f6ded940','teisco-synthesizer-110f'),
  ('0782e37c-c6ad-4045-aeef-b578c5849e75','teisco-synthesizer-110f-0'),
  ('7e90858b-1652-4a6a-a07b-544bbf38b1f3','hp-z8'),
  ('6e6dd995-d4c9-43ac-8ad0-9dbde6116fa1','hp-z8-workstation')
)
SELECT '2. manifest identity' AS check,
       count(*) FILTER (WHERE p.id IS NULL OR p.slug IS DISTINCT FROM m.slug) AS drifted,
       CASE WHEN count(*) FILTER (WHERE p.id IS NULL OR p.slug IS DISTINCT FROM m.slug) = 0
            THEN 'PASS' ELSE 'FAIL' END AS status
FROM manifest m LEFT JOIN kg_product p ON p.id = m.id;

-- ── 3. Contradictory human validation — the hard stop ───────────────────────
WITH norm AS (
  SELECT p.id,
         lower(trim(coalesce(b.name,'')))||'|'||
         lower(regexp_replace(trim(coalesce(p.model_name,'')),'\s+',' ','g')) AS grp
  FROM kg_product p LEFT JOIN kg_brand b ON b.id = p.brand_id
  WHERE coalesce(p.model_name,'') <> ''
), dup AS (SELECT grp FROM norm GROUP BY 1 HAVING count(*) > 1),
d AS (SELECT n.* FROM norm n JOIN dup ON dup.grp = n.grp)
SELECT '3. contradictory validation' AS check,
       count(*) AS contradictions,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL — resolve manually' END AS status
FROM (
  SELECT d.grp, m.listing_id
  FROM d JOIN listing_product_match m ON m.product_id = d.id
  GROUP BY 1,2
  HAVING count(*) FILTER (WHERE m.is_valid IS TRUE)  > 0
     AND count(*) FILTER (WHERE m.is_valid IS FALSE) > 0
) x;

-- ── 4. Public catalogue identity ────────────────────────────────────────────
SELECT '4. public catalogue identity' AS check, slug, status AS product_status, browse_visibility,
       CASE WHEN status='active' AND browse_visibility='public' THEN 'PASS' ELSE 'FAIL' END AS status_check
FROM kg_product WHERE id = '07cc1ac5-a0c9-4707-99ed-c4440a1f9563';

-- ── 5. Collision forecast per unique constraint ─────────────────────────────
-- How many rows the migration will DELETE rather than repoint. Reviewers should
-- confirm these numbers are acceptable before authorising.
WITH manifest(survivor, loser) AS (VALUES
  ('aaae5cda-7738-4a53-afdd-3cd493d4dab4'::uuid,'923a8381-1887-4edb-acc5-2e72db6e6821'::uuid),
  ('6d6bd2ee-89e9-4469-afb1-10a4982e20f0','f96d61dc-cf81-463b-8bf1-d9beffb0e1d5'),
  ('92982f65-e9eb-448a-b647-2cc81f23af4c','a08c0c96-c842-496e-8fa7-d7fc97cbe658'),
  ('6aeb4f2a-357d-4a2b-8cb2-cd87d0c470ac','3bfa3be3-fc54-4698-a1e8-bb2c488ba63c'),
  ('6aeb4f2a-357d-4a2b-8cb2-cd87d0c470ac','185521d4-c2bc-45e1-a42c-85fadd2248e7'),
  ('b921847d-4513-4206-8902-f1c7616ca6ac','37e806b8-0c43-423c-b5eb-89ca10aa5360'),
  ('40355ea0-81f8-4df4-a2c9-fc788197a146','950e7f3b-a902-4602-9632-2702a755f03a'),
  ('46509b95-ce08-4727-85ea-c237d594413d','15f32b11-fab0-4007-a1ce-ff7cb2aafb49'),
  ('666dc5e3-7a50-4f55-90ff-fef267ca9db0','cef40460-946f-45ac-a7a7-c1aba9770ad4'),
  ('a452be02-2649-4c95-9b77-c19fbb353c4f','56e302b8-892a-4948-89e3-ff07d944d64f'),
  ('07cc1ac5-a0c9-4707-99ed-c4440a1f9563','26fd7032-0d6c-4162-b0c0-a5b74755b0f5'),
  ('40000232-c58e-4ffa-948f-8de9b90b3285','d6b5172d-2cd3-4398-801f-d1d4e57f30dd'),
  ('958685c7-deb4-40cf-87e0-0514f6ded940','0782e37c-c6ad-4045-aeef-b578c5849e75'),
  ('3845393d-00ad-473a-bdad-af69fe9a886e','76e1995a-3c03-4a8f-a19a-d342da7bc48f')
)
SELECT '5. collision forecast' AS check,
  (SELECT count(*) FROM manifest mm JOIN listing_product_match l ON l.product_id = mm.loser
     WHERE EXISTS (SELECT 1 FROM listing_product_match s
                   WHERE s.listing_id = l.listing_id AND s.product_id = mm.survivor)) AS lpm_merge_delete,
  (SELECT count(*) FROM manifest mm JOIN synonym s ON s.product_id = mm.loser
     WHERE EXISTS (SELECT 1 FROM synonym k WHERE k.alias = s.alias AND k.product_id = mm.survivor)) AS synonym_dedupe_delete,
  (SELECT count(*) FROM manifest mm JOIN kg_identifier i ON i.product_id = mm.loser
     WHERE EXISTS (SELECT 1 FROM kg_identifier k WHERE lower(trim(k.value)) = lower(trim(i.value))
                     AND k.type = i.type AND k.product_id = mm.survivor)) AS identifier_dedupe_delete,
  (SELECT count(*) FROM manifest mm JOIN market_price_daily d ON d.kg_product_id = mm.loser
     WHERE EXISTS (SELECT 1 FROM market_price_daily k WHERE k.kg_product_id = mm.survivor
                     AND k.snapshot_date=d.snapshot_date AND k.source=d.source
                     AND k.country=d.country AND k.price_type=d.price_type)) AS mkt_daily_dedupe_delete;
