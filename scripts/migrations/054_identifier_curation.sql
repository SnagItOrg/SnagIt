-- 054_identifier_curation.sql
--
-- ============================================================================
-- NOT EXECUTED against production or any shared database. Authored and
-- verified only against a disposable local PostgreSQL cluster created by
-- scripts/verify-migrations-isolated.sh.
--
-- Run scripts/queries/verification/kg_migration_state.sql first and
-- confirm detected_state = 'PRE'.
-- ============================================================================
--
-- PURPOSE (safety invariant 3)
-- `kg_identifier` hits score 95 — the matcher's highest confidence tier, meant
-- for EXCLUSIVE product evidence. Three rows violate that:
--
--   'PAUL' -> gibson-les-paul   generic natural-language token (a first name).
--       426 live DBA+KA title hits. PROVEN false positive:
--       "2014 Paul Reed Smith Custom 24" is currently matched to Gibson Les
--       Paul at score 95 and written as is_valid=NULL, i.e. trusted.
--   'TOM'  -> sequential-tom    generic natural-language token (a first name
--       AND a drum-kit part). 6 live hits; its shared set already includes an
--       Alesis "Tom Expansion Pack" and a Roland "Floor Tom" pad.
--   '335'  -> gibson-es-335     a FRAGMENT of the model, not a manufacturer
--       code. 58 live hits. PROVEN cross-model false positives:
--       "1968 Gibson ES-345TD ... 345 335 Guitar" and
--       "1984 Gibson ES-347 TD ... 335 Guitar" both match ES-335 at 95.
--
-- and two cross-brand family terms are ASYMMETRIC — attached to one brand only,
-- so the term silently conferred that brand:
--
--   'Les Paul' -> epiphone-les-paul only  (Gibson had only the bogus 'PAUL')
--   'ES-335'   -> epiphone-es-335 only    (Gibson had only the fragment '335')
--
-- ACTIONS
--   REMOVE  'PAUL', 'TOM', '335'            (archived in full first)
--   ADD     'Les Paul' -> gibson-les-paul   (makes the family term symmetric)
--   ADD     'ES-335'   -> gibson-es-335     (makes the family term symmetric)
--
-- WHY SYMMETRY RATHER THAN DELETION for the family terms: `kg_identifier` has
-- no unique constraint on `value` (verified against pg_constraint), so the
-- schema explicitly supports one term mapping to several products. The matcher
-- treats a shared term as non-exclusive: it emits every title-supported
-- sibling at score 95 and lets explicit brand evidence decide, or defers as
-- `shared_identifier_conflict`. Symmetry therefore makes the evidence honest
-- without losing the brand-resolved matches.
--
-- SCOPE BOUNDARY: same-brand duplicate-product identifier artefacts
-- ('RE-201', 'SPS-1', 'Reference Cardioid', 'Reference Gold', 'RB-338') are
-- NOT touched here — they are consolidated by migration 053. Terms below the
-- matcher's 3-character token floor ('SG', 'DX', 'Z8') never fire and are left
-- alone. Unresolved terms are left fail-closed, by design.
--
-- EXPECTED MATCHER EFFECT (simulated read-only before authoring; see report)
--   * "Paul Reed Smith Custom 24" stops being a trusted Gibson Les Paul
--   * ES-345 / ES-347 listings stop being trusted ES-335s
--   * brand-resolved "Gibson Les Paul ..." / "Gibson ES-335 ..." unchanged @95
--   * brandless "Les Paul" / "ES-335" remain shared_identifier_conflict
--
-- THREE-STATE CONTRACT: PRE -> apply | POST -> successful no-op | DRIFT -> abort.
-- REVERSAL: scripts/migrations/054_rollback.sql
-- An external logical backup remains MANDATORY.

BEGIN;

SET LOCAL statement_timeout = '60s';

-- ── Archive (idempotent DDL) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kg_arch_identifier_054 AS
  SELECT i.*, ''::text AS _action, ''::text AS _reason, now() AS _archived_at
  FROM kg_identifier i WHERE false;
CREATE UNIQUE INDEX IF NOT EXISTS kg_arch_identifier_054_pk ON kg_arch_identifier_054 (id);

-- Rows this migration ADDS, so the rollback can remove exactly those and no more.
CREATE TABLE IF NOT EXISTS kg_added_identifier_054 (
  id          uuid PRIMARY KEY,
  product_id  uuid NOT NULL,
  type        text NOT NULL,
  value       text NOT NULL,
  added_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  v_state   text;
  v_fail    text := '';
  v_remove  int;   -- how many of the 3 removable rows still exist, unchanged
  v_added   int;   -- how many of the 2 symmetric rows already exist
  v_arch    int;
  v_053_ok  boolean;
  v_new_lp  uuid := gen_random_uuid();
  v_new_es  uuid := gen_random_uuid();
BEGIN
  -- ── Dependency: migration 053 must be in its completed POST state ───────
  -- 053 dedupes kg_identifier rows, so curating identifiers first could race
  -- with that. 053 does NOT depend on 054.
  SELECT (to_regclass('public.kg_arch_product_053') IS NOT NULL)
     AND (SELECT count(*) FROM kg_arch_product_053) = 16
    INTO v_053_ok;

  -- ── Predicate inputs, guarded on exact ids + values + product identity ──
  SELECT count(*) INTO v_remove FROM kg_identifier i
  WHERE (i.id, i.type, i.value, i.product_id) IN (
    ('bb30eefe-e39c-486c-b73e-0517016da18f'::uuid,'SKU','PAUL','776dff2d-15eb-42fe-8202-471f0feebbb6'::uuid),
    ('65b12d19-9093-4a6f-a841-3b919f37e5dc',      'SKU','TOM', 'b43d7b32-b58e-4ab1-8d47-a565cf448a65'),
    ('b056bb68-0de4-4b5c-9d8f-0d667fe45a1a',      'SKU','335', 'c716d85e-a9b1-4ccf-b96c-387589a73d49'));

  SELECT count(*) INTO v_added FROM kg_identifier i
  WHERE (i.product_id, i.type, lower(trim(i.value))) IN (
    ('776dff2d-15eb-42fe-8202-471f0feebbb6'::uuid,'SKU','les paul'),
    ('c716d85e-a9b1-4ccf-b96c-387589a73d49',      'SKU','es-335'));

  SELECT count(*) INTO v_arch FROM kg_arch_identifier_054;

  -- ── Classify ───────────────────────────────────────────────────────────
  IF v_remove = 3 AND v_added = 0 AND v_arch = 0 THEN
    v_state := 'PRE';
  ELSIF v_remove = 0 AND v_added = 2 AND v_arch = 3 THEN
    v_state := 'POST';
  ELSE
    v_state := 'DRIFT';
  END IF;

  IF v_state = 'POST' THEN
    RAISE NOTICE '054: state=POST — already applied. No-op. No archive recreated, no timestamp touched.';
    RETURN;
  END IF;

  IF v_state = 'DRIFT' THEN
    IF v_remove NOT IN (0,3) THEN v_fail := v_fail || format(' removable_rows=%s(expected 3 or 0);', v_remove); END IF;
    IF v_added  NOT IN (0,2) THEN v_fail := v_fail || format(' symmetric_rows=%s(expected 0 or 2);', v_added); END IF;
    IF v_arch   NOT IN (0,3) THEN v_fail := v_fail || format(' archive_rows=%s(expected 0 or 3);', v_arch); END IF;
    IF v_remove = 3 AND v_added > 0 THEN v_fail := v_fail || ' partial_apply_add_before_remove;'; END IF;
    RAISE EXCEPTION '054 ABORT: state=DRIFT. Failed predicates:%', v_fail;
  END IF;

  -- PRE from here on.
  IF NOT v_053_ok THEN
    RAISE EXCEPTION '054 ABORT: migration 053 is not in its completed POST state; apply 053 first';
  END IF;

  RAISE NOTICE '054: state=PRE — applying (remove 3 unsafe identifiers, add 2 symmetric).';

  -- ── Archive before mutation (full rows) ────────────────────────────────
  INSERT INTO kg_arch_identifier_054
  SELECT i.*, 'remove',
         CASE i.value
           WHEN 'PAUL' THEN 'generic natural-language token; live FP: Paul Reed Smith -> Gibson Les Paul @95'
           WHEN 'TOM'  THEN 'generic natural-language token; also a drum-kit part'
           WHEN '335'  THEN 'model fragment; live FPs: Gibson ES-345TD / ES-347 TD -> ES-335 @95'
         END,
         now()
  FROM kg_identifier i
  WHERE i.id IN ('bb30eefe-e39c-486c-b73e-0517016da18f',
                 '65b12d19-9093-4a6f-a841-3b919f37e5dc',
                 'b056bb68-0de4-4b5c-9d8f-0d667fe45a1a')
  ON CONFLICT (id) DO NOTHING;

  IF (SELECT count(*) FROM kg_arch_identifier_054) <> 3 THEN
    RAISE EXCEPTION '054 ABORT: archive captured % rows, expected 3', (SELECT count(*) FROM kg_arch_identifier_054);
  END IF;

  -- ── Remove unsafe score-95 identifiers ─────────────────────────────────
  DELETE FROM kg_identifier
  WHERE id IN ('bb30eefe-e39c-486c-b73e-0517016da18f',
               '65b12d19-9093-4a6f-a841-3b919f37e5dc',
               'b056bb68-0de4-4b5c-9d8f-0d667fe45a1a');

  -- ── Add symmetric cross-brand family evidence ──────────────────────────
  -- Guarded on normalised value so a re-run cannot create a near-duplicate
  -- ('les paul' vs 'Les Paul'); kg_identifier has no unique index to rely on.
  INSERT INTO kg_identifier (id, product_id, type, value, confidence, source)
  SELECT v_new_lp, '776dff2d-15eb-42fe-8202-471f0feebbb6', 'SKU', 'Les Paul', 80, 'migration_054'
  WHERE NOT EXISTS (SELECT 1 FROM kg_identifier
                    WHERE product_id='776dff2d-15eb-42fe-8202-471f0feebbb6'
                      AND type='SKU' AND lower(trim(value))='les paul');

  INSERT INTO kg_identifier (id, product_id, type, value, confidence, source)
  SELECT v_new_es, 'c716d85e-a9b1-4ccf-b96c-387589a73d49', 'SKU', 'ES-335', 80, 'migration_054'
  WHERE NOT EXISTS (SELECT 1 FROM kg_identifier
                    WHERE product_id='c716d85e-a9b1-4ccf-b96c-387589a73d49'
                      AND type='SKU' AND lower(trim(value))='es-335');

  INSERT INTO kg_added_identifier_054 (id, product_id, type, value)
  SELECT i.id, i.product_id, i.type, i.value FROM kg_identifier i
  WHERE i.source = 'migration_054'
  ON CONFLICT (id) DO NOTHING;

  -- ── In-transaction postflight ──────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM kg_identifier WHERE upper(trim(value)) IN ('PAUL','TOM') OR trim(value) = '335') THEN
    RAISE EXCEPTION 'POSTFLIGHT FAIL: an unsafe generic identifier still exists';
  END IF;

  IF (SELECT count(*) FROM kg_identifier
      WHERE type='SKU' AND lower(trim(value))='les paul') <> 2 THEN
    RAISE EXCEPTION 'POSTFLIGHT FAIL: "Les Paul" is not symmetric across Gibson and Epiphone';
  END IF;
  IF (SELECT count(*) FROM kg_identifier
      WHERE type='SKU' AND lower(trim(value))='es-335') <> 2 THEN
    RAISE EXCEPTION 'POSTFLIGHT FAIL: "ES-335" is not symmetric across Gibson and Epiphone';
  END IF;

  -- No duplicate (product, type, normalised value) anywhere.
  IF EXISTS (SELECT 1 FROM kg_identifier
             GROUP BY product_id, type, lower(trim(value)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'POSTFLIGHT FAIL: duplicate (product, type, normalised value) rows';
  END IF;

  IF (SELECT count(*) FROM kg_added_identifier_054) <> 2 THEN
    RAISE EXCEPTION 'POSTFLIGHT FAIL: added-row ledger holds % rows, expected 2', (SELECT count(*) FROM kg_added_identifier_054);
  END IF;

  RAISE NOTICE '054: applied successfully (3 removed, 2 added).';
END $$;

COMMIT;
