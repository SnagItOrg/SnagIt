-- 053_kg_duplicate_product_consolidation.sql
--
-- ============================================================================
-- NOT EXECUTED. Authored and reviewed only. No statement below has been run
-- against production or any shared database. It has been executed ONLY against
-- a disposable local PostgreSQL cluster created and destroyed by
-- scripts/verify-migrations-isolated.sh.
--
-- Applying it is a separately authorised action. Run
--   scripts/queries/verification/kg_migration_state.sql
-- first and confirm detected_state = 'PRE'.
-- ============================================================================
--
-- PURPOSE
-- Consolidate 14 duplicate normalised (brand, model_name) product groups:
-- 13 merge groups plus one out-of-vertical deactivation (HP Z8, a computer
-- workstation; both rows already inactive).
--
-- WHY IT MATTERS
-- Duplicate rows split matches and metadata across two identities, so the
-- matcher cannot choose between them and defers every affected listing as
-- `product_data_conflict` (currently 2 DBA + 7 Kleinanzeigen). `roland-re-201`
-- is a PUBLIC catalogue product with 148 matches, 20 reverb_price_history rows
-- and 8 scrape_query_coverage rows; its duplicate holds none.
--
-- SURVIVOR HIERARCHY (deterministic, applied in order):
--   1. public catalogue identity
--   2. most validated/visible listing_product_match evidence
--   3. reverb_csp_id present
--   4. metadata completeness (identifiers + synonyms + relations)
--   5. lower(slug) ascending
--
-- ── THREE-STATE CONTRACT (safety invariant 2) ──────────────────────────────
--   PRE   : exact expected pre-state  -> perform the migration in one transaction
--   POST  : exact completed post-state -> explicit successful NO-OP; archives are
--           NOT recreated and no timestamp is touched
--   DRIFT : anything else              -> RAISE EXCEPTION before ANY mutation
--
-- ── REVERSIBILITY (safety invariant 1) ─────────────────────────────────────
-- Every row this migration deletes, overwrites or deactivates is archived in
-- full (all columns) into migration-owned kg_arch_*_053 tables BEFORE mutation,
-- keyed by original id with a unique index so a re-run cannot double-capture.
-- `explain.merged_from_053` is a convenience breadcrumb ONLY and is never the
-- sole copy of a deleted row.
-- Reversal: scripts/migrations/053_rollback.sql
-- An external logical backup remains MANDATORY; internal reversibility is
-- defence in depth, not a substitute.

BEGIN;

SET LOCAL statement_timeout = '180s';

-- ── 1. Archive tables (idempotent DDL; safe in every state) ─────────────────
-- CREATE TABLE ... WHERE false clones every column of the source table, so the
-- archive automatically stays column-complete if the schema evolves.
CREATE TABLE IF NOT EXISTS kg_arch_product_053 AS
  SELECT p.*, ''::text AS _grp, ''::text AS _action, now() AS _archived_at
  FROM kg_product p WHERE false;
CREATE TABLE IF NOT EXISTS kg_arch_lpm_053 AS
  SELECT m.*, ''::text AS _grp, ''::text AS _action, now() AS _archived_at
  FROM listing_product_match m WHERE false;
CREATE TABLE IF NOT EXISTS kg_arch_synonym_053 AS
  SELECT s.*, ''::text AS _grp, ''::text AS _action, now() AS _archived_at
  FROM synonym s WHERE false;
CREATE TABLE IF NOT EXISTS kg_arch_identifier_053 AS
  SELECT i.*, ''::text AS _grp, ''::text AS _action, now() AS _archived_at
  FROM kg_identifier i WHERE false;
CREATE TABLE IF NOT EXISTS kg_arch_relation_053 AS
  SELECT r.*, ''::text AS _grp, ''::text AS _action, now() AS _archived_at
  FROM kg_relation r WHERE false;
CREATE TABLE IF NOT EXISTS kg_arch_mkt_daily_053 AS
  SELECT d.*, ''::text AS _grp, ''::text AS _action, now() AS _archived_at
  FROM market_price_daily d WHERE false;

-- Repoint ledger: rows that were UPDATEd (not deleted) and must be pointed back.
CREATE TABLE IF NOT EXISTS kg_repoint_053 (
  id             bigserial PRIMARY KEY,
  table_name     text NOT NULL,
  column_name    text NOT NULL,
  row_id         text NOT NULL,
  old_product_id uuid NOT NULL,
  new_product_id uuid NOT NULL,
  captured_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name, row_id)
);

-- Duplicate-capture guards. Keyed on the ORIGINAL primary key.
CREATE UNIQUE INDEX IF NOT EXISTS kg_arch_product_053_pk    ON kg_arch_product_053 (id);
CREATE UNIQUE INDEX IF NOT EXISTS kg_arch_lpm_053_pk        ON kg_arch_lpm_053 (id);
CREATE UNIQUE INDEX IF NOT EXISTS kg_arch_synonym_053_pk    ON kg_arch_synonym_053 (id);
CREATE UNIQUE INDEX IF NOT EXISTS kg_arch_identifier_053_pk ON kg_arch_identifier_053 (id);
CREATE UNIQUE INDEX IF NOT EXISTS kg_arch_relation_053_pk   ON kg_arch_relation_053 (id);
CREATE UNIQUE INDEX IF NOT EXISTS kg_arch_mkt_daily_053_pk  ON kg_arch_mkt_daily_053 (id);

-- ── 2. Manifest ─────────────────────────────────────────────────────────────
CREATE TEMP TABLE _mm (
  grp text NOT NULL, survivor uuid NOT NULL, loser uuid NOT NULL,
  survivor_slug text NOT NULL, loser_slug text NOT NULL
) ON COMMIT DROP;

INSERT INTO _mm VALUES
 ('elektron|analog rytm mkii','3845393d-00ad-473a-bdad-af69fe9a886e','76e1995a-3c03-4a8f-a19a-d342da7bc48f','elektron-analogrytmMKII','elektron-elektron-analog-rytm-mkii'),
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
 ('teisco|synthesizer 110f',  '958685c7-deb4-40cf-87e0-0514f6ded940','0782e37c-c6ad-4045-aeef-b578c5849e75','teisco-synthesizer-110f','teisco-synthesizer-110f-0');

CREATE TEMP TABLE _dm (grp text, product_id uuid, slug text) ON COMMIT DROP;
INSERT INTO _dm VALUES
 ('hp|z8','7e90858b-1652-4a6a-a07b-544bbf38b1f3','hp-z8'),
 ('hp|z8','6e6dd995-d4c9-43ac-8ad0-9dbde6116fa1','hp-z8-workstation');

-- ── 3. STATE MACHINE + MUTATION ────────────────────────────────────────────
DO $$
DECLARE
  v_state        text;
  v_fail         text := '';
  v_ids_ok       boolean;
  v_groups       int;
  v_rows         int;
  v_losers_live  int;   -- losers still active
  v_losers_dead  int;   -- losers already retired
  v_refs         int;   -- dependency rows still pointing at any loser
  v_contradict   int;
  v_public_ok    boolean;
  v_arch_rows    int;
BEGIN
  -- ---- predicate inputs -------------------------------------------------
  SELECT bool_and(p.id IS NOT NULL AND p.slug = m.slug) INTO v_ids_ok
  FROM (SELECT survivor AS id, survivor_slug AS slug FROM _mm
        UNION ALL SELECT loser, loser_slug FROM _mm
        UNION ALL SELECT product_id, slug FROM _dm) m
  LEFT JOIN kg_product p ON p.id = m.id;

  WITH norm AS (
    SELECT p.id, p.status,
           lower(trim(coalesce(b.name,'')))||'|'||
           lower(regexp_replace(trim(coalesce(p.model_name,'')),'\s+',' ','g')) AS grp
    FROM kg_product p LEFT JOIN kg_brand b ON b.id = p.brand_id
    WHERE coalesce(p.model_name,'') <> ''
  ), dup AS (SELECT grp, count(*) c FROM norm GROUP BY 1 HAVING count(*) > 1)
  SELECT count(*), coalesce(sum(c),0) INTO v_groups, v_rows FROM dup;

  -- Only the 14 MERGE losers gate the state. The 2 HP Z8 rows are already
  -- status='inactive' in production (verified by the read-only audit), so
  -- including them would make the real pre-state look like DRIFT. Their
  -- deactivation below is idempotent.
  SELECT count(*) FILTER (WHERE p.status = 'active'),
         count(*) FILTER (WHERE p.status <> 'active')
    INTO v_losers_live, v_losers_dead
  FROM _mm JOIN kg_product p ON p.id = _mm.loser;

  SELECT count(*) INTO v_refs FROM (
      SELECT 1 FROM listing_product_match m JOIN _mm ON m.product_id = _mm.loser
      UNION ALL SELECT 1 FROM synonym s        JOIN _mm ON s.product_id = _mm.loser
      UNION ALL SELECT 1 FROM kg_identifier i  JOIN _mm ON i.product_id = _mm.loser
      UNION ALL SELECT 1 FROM kg_relation r    JOIN _mm ON r.from_product_id = _mm.loser OR r.to_product_id = _mm.loser
      UNION ALL SELECT 1 FROM reverb_price_history x      JOIN _mm ON x.kg_product_id = _mm.loser
      UNION ALL SELECT 1 FROM market_price_observations o  JOIN _mm ON o.kg_product_id = _mm.loser
      UNION ALL SELECT 1 FROM market_price_daily d         JOIN _mm ON d.kg_product_id = _mm.loser
      UNION ALL SELECT 1 FROM price_observation po         JOIN _mm ON po.product_id = _mm.loser
      UNION ALL SELECT 1 FROM scrape_query_coverage c      JOIN _mm ON c.kg_product_id = _mm.loser
      UNION ALL SELECT 1 FROM thomann_product t            JOIN _mm ON t.kg_product_id = _mm.loser
  ) q;

  SELECT count(*) INTO v_contradict FROM (
    SELECT m.listing_id FROM _mm
    JOIN listing_product_match m ON m.product_id IN (_mm.survivor, _mm.loser)
    GROUP BY _mm.grp, m.listing_id
    HAVING count(*) FILTER (WHERE m.is_valid IS TRUE) > 0
       AND count(*) FILTER (WHERE m.is_valid IS FALSE) > 0) x;

  SELECT EXISTS (SELECT 1 FROM kg_product
                 WHERE id='07cc1ac5-a0c9-4707-99ed-c4440a1f9563'
                   AND slug='roland-re-201' AND status='active' AND browse_visibility='public')
    INTO v_public_ok;

  SELECT count(*) INTO v_arch_rows FROM kg_arch_product_053;

  -- ---- classify ---------------------------------------------------------
  IF v_ids_ok AND v_groups = 14 AND v_rows = 29 AND v_public_ok
     AND v_losers_live = 14 AND v_losers_dead = 0 AND v_arch_rows = 0 THEN
    v_state := 'PRE';
  ELSIF v_ids_ok AND v_public_ok
     AND v_losers_live = 0 AND v_losers_dead = 14 AND v_refs = 0 AND v_arch_rows = 16 THEN
    v_state := 'POST';
  ELSE
    v_state := 'DRIFT';
  END IF;

  -- ---- POST: explicit successful no-op ----------------------------------
  IF v_state = 'POST' THEN
    RAISE NOTICE '053: state=POST — already applied. No-op. No archive recreated, no timestamp touched.';
    RETURN;
  END IF;

  -- ---- DRIFT: abort before ANY mutation ---------------------------------
  IF v_state = 'DRIFT' THEN
    IF NOT v_ids_ok            THEN v_fail := v_fail || ' manifest_id_or_slug_drift;'; END IF;
    IF v_groups <> 14          THEN v_fail := v_fail || format(' duplicate_groups=%s(expected 14);', v_groups); END IF;
    IF v_rows   <> 29          THEN v_fail := v_fail || format(' duplicate_rows=%s(expected 29);', v_rows); END IF;
    IF NOT v_public_ok         THEN v_fail := v_fail || ' roland_re_201_public_identity;'; END IF;
    IF v_losers_live NOT IN (0,14) THEN v_fail := v_fail || format(' partial_deactivation live=%s dead=%s;', v_losers_live, v_losers_dead); END IF;
    IF v_losers_live = 0 AND v_refs > 0 THEN v_fail := v_fail || format(' post_state_but_%s_dangling_refs;', v_refs); END IF;
    IF v_arch_rows NOT IN (0,16) THEN v_fail := v_fail || format(' partial_archive rows=%s;', v_arch_rows); END IF;
    RAISE EXCEPTION '053 ABORT: state=DRIFT. Failed predicates:%', v_fail;
  END IF;

  -- ---- PRE: hard stop on contradictory human validation ------------------
  IF v_contradict > 0 THEN
    RAISE EXCEPTION '053 ABORT: % listing(s) carry contradictory manual validation across a duplicate group; resolve manually first', v_contradict;
  END IF;

  RAISE NOTICE '053: state=PRE — applying (14 groups, 29 rows).';

  -- ══ ARCHIVE EVERYTHING THAT WILL BE DELETED / OVERWRITTEN / DEACTIVATED ══
  -- Products: all 16 losers, full row (captures original status/browse_visibility).
  INSERT INTO kg_arch_product_053
  SELECT p.*, x.grp, 'deactivate', now() FROM kg_product p
  JOIN (SELECT grp, loser AS id FROM _mm UNION ALL SELECT grp, product_id FROM _dm) x ON x.id = p.id
  ON CONFLICT (id) DO NOTHING;

  -- listing_product_match: EVERY row belonging to a loser, whether it will be
  -- repointed or deleted. Deleted rows are only recoverable from here.
  INSERT INTO kg_arch_lpm_053
  SELECT m.*, _mm.grp,
         CASE WHEN EXISTS (SELECT 1 FROM listing_product_match s
                           WHERE s.listing_id = m.listing_id AND s.product_id = _mm.survivor)
              THEN 'merge_delete' ELSE 'repoint' END,
         now()
  FROM listing_product_match m JOIN _mm ON m.product_id = _mm.loser
  ON CONFLICT (id) DO NOTHING;

  -- The SURVIVING row is overwritten by the merge, so archive it too.
  INSERT INTO kg_arch_lpm_053
  SELECT s.*, _mm.grp, 'survivor_overwritten', now()
  FROM listing_product_match s JOIN _mm ON s.product_id = _mm.survivor
  WHERE EXISTS (SELECT 1 FROM listing_product_match l
                WHERE l.product_id = _mm.loser AND l.listing_id = s.listing_id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO kg_arch_synonym_053
  SELECT s.*, _mm.grp,
         CASE WHEN EXISTS (SELECT 1 FROM synonym k WHERE k.alias = s.alias AND k.product_id = _mm.survivor)
              THEN 'dedupe_delete' ELSE 'repoint' END, now()
  FROM synonym s JOIN _mm ON s.product_id = _mm.loser
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO kg_arch_identifier_053
  SELECT i.*, _mm.grp,
         CASE WHEN EXISTS (SELECT 1 FROM kg_identifier k
                           WHERE lower(trim(k.value)) = lower(trim(i.value))
                             AND k.type = i.type AND k.product_id = _mm.survivor)
              THEN 'dedupe_delete' ELSE 'repoint' END, now()
  FROM kg_identifier i JOIN _mm ON i.product_id = _mm.loser
  ON CONFLICT (id) DO NOTHING;

  -- Relations touching a loser: repointed, and possibly deleted afterwards as
  -- self-relations or duplicates. Archive the originals first.
  INSERT INTO kg_arch_relation_053
  SELECT r.*, _mm.grp, 'repoint_or_delete', now()
  FROM kg_relation r JOIN _mm ON r.from_product_id = _mm.loser OR r.to_product_id = _mm.loser
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO kg_arch_mkt_daily_053
  SELECT d.*, _mm.grp, 'repoint_or_delete', now()
  FROM market_price_daily d JOIN _mm ON d.kg_product_id = _mm.loser
  ON CONFLICT (id) DO NOTHING;

  -- ══ REPOINT LEDGER (rows updated in place) ══════════════════════════════
  INSERT INTO kg_repoint_053 (table_name, column_name, row_id, old_product_id, new_product_id)
  SELECT 'listing_product_match','product_id', m.id::text, m.product_id, _mm.survivor
  FROM listing_product_match m JOIN _mm ON m.product_id = _mm.loser
  WHERE NOT EXISTS (SELECT 1 FROM listing_product_match s
                    WHERE s.listing_id = m.listing_id AND s.product_id = _mm.survivor)
  UNION ALL SELECT 'synonym','product_id', s.id::text, s.product_id, _mm.survivor
  FROM synonym s JOIN _mm ON s.product_id = _mm.loser
  WHERE NOT EXISTS (SELECT 1 FROM synonym k WHERE k.alias = s.alias AND k.product_id = _mm.survivor)
  UNION ALL SELECT 'kg_identifier','product_id', i.id::text, i.product_id, _mm.survivor
  FROM kg_identifier i JOIN _mm ON i.product_id = _mm.loser
  WHERE NOT EXISTS (SELECT 1 FROM kg_identifier k WHERE lower(trim(k.value)) = lower(trim(i.value))
                      AND k.type = i.type AND k.product_id = _mm.survivor)
  UNION ALL SELECT 'kg_relation','from_product_id', r.id::text, r.from_product_id, _mm.survivor
  FROM kg_relation r JOIN _mm ON r.from_product_id = _mm.loser
  UNION ALL SELECT 'kg_relation','to_product_id', r.id::text, r.to_product_id, _mm.survivor
  FROM kg_relation r JOIN _mm ON r.to_product_id = _mm.loser
  UNION ALL SELECT 'reverb_price_history','kg_product_id', x.id::text, x.kg_product_id, _mm.survivor
  FROM reverb_price_history x JOIN _mm ON x.kg_product_id = _mm.loser
  UNION ALL SELECT 'market_price_observations','kg_product_id', o.id::text, o.kg_product_id, _mm.survivor
  FROM market_price_observations o JOIN _mm ON o.kg_product_id = _mm.loser
  UNION ALL SELECT 'price_observation','product_id', po.id::text, po.product_id, _mm.survivor
  FROM price_observation po JOIN _mm ON po.product_id = _mm.loser
  UNION ALL SELECT 'scrape_query_coverage','kg_product_id', c.id::text, c.kg_product_id, _mm.survivor
  FROM scrape_query_coverage c JOIN _mm ON c.kg_product_id = _mm.loser
  UNION ALL SELECT 'thomann_product','kg_product_id', t.id::text, t.kg_product_id, _mm.survivor
  FROM thomann_product t JOIN _mm ON t.kg_product_id = _mm.loser
  -- market_price_daily rows that survive the collision check are REPOINTED, so
  -- they belong in the ledger too. Omitting them left a repointed aggregate
  -- unreversible — caught by the isolated apply/rollback checksum test.
  UNION ALL SELECT 'market_price_daily','kg_product_id', d.id::text, d.kg_product_id, _mm.survivor
  FROM market_price_daily d JOIN _mm ON d.kg_product_id = _mm.loser
  WHERE NOT EXISTS (SELECT 1 FROM market_price_daily k WHERE k.kg_product_id = _mm.survivor
                      AND k.snapshot_date=d.snapshot_date AND k.source=d.source
                      AND k.country=d.country AND k.price_type=d.price_type)
  ON CONFLICT (table_name, column_name, row_id) DO NOTHING;

  -- ══ MUTATE ══════════════════════════════════════════════════════════════
  -- listing_product_match: merge into survivor per the approved truth table.
  --   rejection dominates | confirmation beats unreviewed | strongest score wins
  UPDATE listing_product_match s
  SET is_valid = CASE
        WHEN s.is_valid IS FALSE OR l.is_valid IS FALSE THEN FALSE
        WHEN s.is_valid IS TRUE  OR l.is_valid IS TRUE  THEN TRUE
        ELSE NULL END,
      rejected_reason = coalesce(s.rejected_reason, l.rejected_reason),
      score  = greatest(s.score, l.score),
      method = CASE WHEN l.score > s.score THEN l.method ELSE s.method END,
      explain = s.explain || jsonb_build_object('merged_from_053',
                  jsonb_build_object('archived_in','kg_arch_lpm_053','loser_row_id', l.id))
  FROM listing_product_match l JOIN _mm ON l.product_id = _mm.loser
  WHERE s.product_id = _mm.survivor AND s.listing_id = l.listing_id;

  DELETE FROM listing_product_match l USING _mm
  WHERE l.product_id = _mm.loser
    AND EXISTS (SELECT 1 FROM listing_product_match s
                WHERE s.listing_id = l.listing_id AND s.product_id = _mm.survivor);
  UPDATE listing_product_match l SET product_id = _mm.survivor FROM _mm WHERE l.product_id = _mm.loser;

  -- synonym: UNIQUE (alias, product_id)
  DELETE FROM synonym s USING _mm
  WHERE s.product_id = _mm.loser
    AND EXISTS (SELECT 1 FROM synonym k WHERE k.alias = s.alias AND k.product_id = _mm.survivor);
  UPDATE synonym s SET product_id = _mm.survivor FROM _mm WHERE s.product_id = _mm.loser;

  -- kg_identifier: no unique key; dedupe on (lower(value), type, product)
  DELETE FROM kg_identifier i USING _mm
  WHERE i.product_id = _mm.loser
    AND EXISTS (SELECT 1 FROM kg_identifier k WHERE lower(trim(k.value)) = lower(trim(i.value))
                  AND k.type = i.type AND k.product_id = _mm.survivor);
  UPDATE kg_identifier i SET product_id = _mm.survivor FROM _mm WHERE i.product_id = _mm.loser;

  -- kg_relation: two FK columns; then drop self-relations and duplicates
  UPDATE kg_relation r SET from_product_id = _mm.survivor FROM _mm WHERE r.from_product_id = _mm.loser;
  UPDATE kg_relation r SET to_product_id   = _mm.survivor FROM _mm WHERE r.to_product_id   = _mm.loser;
  DELETE FROM kg_relation WHERE from_product_id = to_product_id;
  DELETE FROM kg_relation a USING kg_relation b
  WHERE a.from_product_id = b.from_product_id AND a.to_product_id = b.to_product_id
    AND a.type = b.type AND a.id > b.id;

  -- Price evidence: repoint only. Unique keys exclude the product id, so no
  -- observation is ever collapsed.
  UPDATE reverb_price_history x      SET kg_product_id = _mm.survivor FROM _mm WHERE x.kg_product_id = _mm.loser;
  UPDATE market_price_observations o SET kg_product_id = _mm.survivor FROM _mm WHERE o.kg_product_id = _mm.loser;
  UPDATE price_observation po        SET product_id    = _mm.survivor FROM _mm WHERE po.product_id    = _mm.loser;
  UPDATE scrape_query_coverage c     SET kg_product_id = _mm.survivor FROM _mm WHERE c.kg_product_id = _mm.loser;
  UPDATE thomann_product t           SET kg_product_id = _mm.survivor FROM _mm WHERE t.kg_product_id = _mm.loser;

  -- market_price_daily: unique key DOES include kg_product_id. Aggregates are
  -- derived and recomputable, so a collision drops the loser row (archived).
  DELETE FROM market_price_daily d USING _mm
  WHERE d.kg_product_id = _mm.loser
    AND EXISTS (SELECT 1 FROM market_price_daily k WHERE k.kg_product_id = _mm.survivor
                  AND k.snapshot_date=d.snapshot_date AND k.source=d.source
                  AND k.country=d.country AND k.price_type=d.price_type);
  UPDATE market_price_daily d SET kg_product_id = _mm.survivor FROM _mm WHERE d.kg_product_id = _mm.loser;

  -- Retire loser rows: DEACTIVATE, never delete. Slug unchanged so
  -- /product/<loser-slug> keeps resolving for one release.
  UPDATE kg_product p SET status='inactive', browse_visibility='hidden'
  FROM _mm WHERE p.id = _mm.loser;
  UPDATE kg_product p SET status='inactive', browse_visibility='hidden'
  FROM _dm WHERE p.id = _dm.product_id;

  -- ══ IN-TRANSACTION POSTFLIGHT ═══════════════════════════════════════════
  WITH norm AS (
    SELECT p.id, lower(trim(coalesce(b.name,'')))||'|'||
           lower(regexp_replace(trim(coalesce(p.model_name,'')),'\s+',' ','g')) AS grp
    FROM kg_product p LEFT JOIN kg_brand b ON b.id = p.brand_id
    WHERE coalesce(p.model_name,'') <> '' AND p.status = 'active')
  SELECT count(*) INTO v_groups FROM (SELECT grp FROM norm GROUP BY 1 HAVING count(*) > 1) x;
  IF v_groups > 0 THEN RAISE EXCEPTION 'POSTFLIGHT FAIL: % active duplicate group(s) remain', v_groups; END IF;

  SELECT count(*) INTO v_refs FROM (
      SELECT 1 FROM listing_product_match m JOIN _mm ON m.product_id = _mm.loser
      UNION ALL SELECT 1 FROM synonym s       JOIN _mm ON s.product_id = _mm.loser
      UNION ALL SELECT 1 FROM kg_identifier i JOIN _mm ON i.product_id = _mm.loser
      UNION ALL SELECT 1 FROM kg_relation r   JOIN _mm ON r.from_product_id = _mm.loser OR r.to_product_id = _mm.loser
      UNION ALL SELECT 1 FROM reverb_price_history x     JOIN _mm ON x.kg_product_id = _mm.loser
      UNION ALL SELECT 1 FROM market_price_observations o JOIN _mm ON o.kg_product_id = _mm.loser
      UNION ALL SELECT 1 FROM market_price_daily d        JOIN _mm ON d.kg_product_id = _mm.loser
      UNION ALL SELECT 1 FROM price_observation po        JOIN _mm ON po.product_id = _mm.loser
      UNION ALL SELECT 1 FROM scrape_query_coverage c     JOIN _mm ON c.kg_product_id = _mm.loser
      UNION ALL SELECT 1 FROM thomann_product t           JOIN _mm ON t.kg_product_id = _mm.loser) q;
  IF v_refs > 0 THEN RAISE EXCEPTION 'POSTFLIGHT FAIL: % dangling reference(s) to a loser row', v_refs; END IF;

  IF NOT EXISTS (SELECT 1 FROM kg_product WHERE id='07cc1ac5-a0c9-4707-99ed-c4440a1f9563'
                   AND slug='roland-re-201' AND status='active' AND browse_visibility='public') THEN
    RAISE EXCEPTION 'POSTFLIGHT FAIL: roland-re-201 public identity lost';
  END IF;
  IF (SELECT count(*) FROM reverb_price_history WHERE kg_product_id='07cc1ac5-a0c9-4707-99ed-c4440a1f9563') < 20 THEN
    RAISE EXCEPTION 'POSTFLIGHT FAIL: roland-re-201 lost price history';
  END IF;

  SELECT count(*) INTO v_refs FROM (
    SELECT listing_id, product_id FROM listing_product_match GROUP BY 1,2 HAVING count(*) > 1) x;
  IF v_refs > 0 THEN RAISE EXCEPTION 'POSTFLIGHT FAIL: % duplicate (listing_id, product_id) pair(s)', v_refs; END IF;

  -- Archive completeness: every loser product archived, and every deleted row
  -- present in an archive table.
  IF (SELECT count(*) FROM kg_arch_product_053) <> 16 THEN
    RAISE EXCEPTION 'POSTFLIGHT FAIL: archive holds % product rows, expected 16', (SELECT count(*) FROM kg_arch_product_053);
  END IF;

  RAISE NOTICE '053: applied successfully.';
END $$;

COMMIT;
