-- 053_rollback.sql
--
-- ============================================================================
-- NOT EXECUTED against production or any shared database. Authored and
-- verified only against a disposable local PostgreSQL cluster created by
-- scripts/verify-migrations-isolated.sh.
--
-- Reverses 053_kg_duplicate_product_consolidation.sql using ONLY
-- migration-owned archive data (kg_arch_*_053 + kg_repoint_053). It does not
-- depend on an external backup — though a fresh external logical backup
-- remains mandatory before running either direction in production.
-- ============================================================================
--
-- ORDER MATTERS. Rows are restored before repoints are reversed, and product
-- statuses last, so that no step transiently violates
-- UNIQUE (listing_id, product_id) or a foreign key.

BEGIN;

SET LOCAL statement_timeout = '180s';

DO $$
DECLARE
  v_state    text;
  v_arch     int;
  v_losers_dead int;
  v_restored int;
  v_expected int;
  v_cols     text;
BEGIN
  -- ── State check: only a completed 053 may be rolled back ────────────────
  SELECT count(*) INTO v_arch FROM kg_arch_product_053;
  SELECT count(*) INTO v_losers_dead
  FROM kg_arch_product_053 a JOIN kg_product p ON p.id = a.id
  WHERE p.status = 'inactive';

  IF v_arch = 0 THEN
    RAISE NOTICE '053_rollback: no archive rows — 053 was never applied. No-op.';
    RETURN;
  END IF;
  IF v_arch <> 16 THEN
    RAISE EXCEPTION '053_rollback ABORT: archive holds % product rows, expected 16 (partial/incompatible state)', v_arch;
  END IF;
  IF v_losers_dead <> 16 THEN
    RAISE EXCEPTION '053_rollback ABORT: % of 16 archived products are inactive; post-migration drift detected', v_losers_dead;
  END IF;

  RAISE NOTICE '053_rollback: reversing (16 archived product rows).';

  -- ── 1. Reverse repoints (rows updated in place) ─────────────────────────
  -- Done BEFORE restoring deleted rows so the restored rows cannot collide
  -- with a still-repointed row on (listing_id, product_id).
  UPDATE listing_product_match m SET product_id = r.old_product_id
    FROM kg_repoint_053 r WHERE r.table_name='listing_product_match' AND m.id::text = r.row_id;
  UPDATE synonym s SET product_id = r.old_product_id
    FROM kg_repoint_053 r WHERE r.table_name='synonym' AND s.id::text = r.row_id;
  UPDATE kg_identifier i SET product_id = r.old_product_id
    FROM kg_repoint_053 r WHERE r.table_name='kg_identifier' AND i.id::text = r.row_id;
  UPDATE kg_relation g SET from_product_id = r.old_product_id
    FROM kg_repoint_053 r WHERE r.table_name='kg_relation' AND r.column_name='from_product_id' AND g.id::text = r.row_id;
  UPDATE kg_relation g SET to_product_id = r.old_product_id
    FROM kg_repoint_053 r WHERE r.table_name='kg_relation' AND r.column_name='to_product_id' AND g.id::text = r.row_id;
  UPDATE reverb_price_history x      SET kg_product_id = r.old_product_id
    FROM kg_repoint_053 r WHERE r.table_name='reverb_price_history' AND x.id::text = r.row_id;
  UPDATE market_price_observations o SET kg_product_id = r.old_product_id
    FROM kg_repoint_053 r WHERE r.table_name='market_price_observations' AND o.id::text = r.row_id;
  UPDATE price_observation po        SET product_id    = r.old_product_id
    FROM kg_repoint_053 r WHERE r.table_name='price_observation' AND po.id::text = r.row_id;
  UPDATE scrape_query_coverage c     SET kg_product_id = r.old_product_id
    FROM kg_repoint_053 r WHERE r.table_name='scrape_query_coverage' AND c.id::text = r.row_id;
  UPDATE thomann_product t           SET kg_product_id = r.old_product_id
    FROM kg_repoint_053 r WHERE r.table_name='thomann_product' AND t.id::text = r.row_id;
  UPDATE market_price_daily d        SET kg_product_id = r.old_product_id
    FROM kg_repoint_053 r WHERE r.table_name='market_price_daily' AND d.id::text = r.row_id;

  -- ── 2. Restore rows that were OVERWRITTEN (survivor match rows) ─────────
  UPDATE listing_product_match m
  SET is_valid = a.is_valid, rejected_reason = a.rejected_reason,
      score = a.score, method = a.method, explain = a.explain
  FROM kg_arch_lpm_053 a
  WHERE a._action = 'survivor_overwritten' AND m.id = a.id;

  -- ── 3. Restore rows that were DELETED ───────────────────────────────────
  INSERT INTO listing_product_match (id, listing_id, product_id, method, score, explain, created_at, is_valid, rejected_reason)
  SELECT a.id, a.listing_id, a.product_id, a.method, a.score, a.explain, a.created_at, a.is_valid, a.rejected_reason
  FROM kg_arch_lpm_053 a
  WHERE a._action = 'merge_delete'
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO synonym (id, alias, canonical_query, product_id, category_id, lang, match_type, priority)
  SELECT a.id, a.alias, a.canonical_query, a.product_id, a.category_id, a.lang, a.match_type, a.priority
  FROM kg_arch_synonym_053 a WHERE a._action = 'dedupe_delete'
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO kg_identifier (id, product_id, type, value, confidence, source)
  SELECT a.id, a.product_id, a.type, a.value, a.confidence, a.source
  FROM kg_arch_identifier_053 a WHERE a._action = 'dedupe_delete'
  ON CONFLICT (id) DO NOTHING;

  -- Relations may have been deleted as self-relations or duplicates.
  INSERT INTO kg_relation (id, from_product_id, to_product_id, type, weight, notes)
  SELECT a.id, a.from_product_id, a.to_product_id, a.type, a.weight, a.notes
  FROM kg_arch_relation_053 a
  ON CONFLICT (id) DO NOTHING;

  -- market_price_daily has many columns and the archive carries three extra
  -- bookkeeping columns, so the column list is built dynamically from the
  -- intersection. This keeps the restore correct if either schema changes.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='market_price_daily'
    AND column_name IN (SELECT column_name FROM information_schema.columns
                        WHERE table_schema='public' AND table_name='kg_arch_mkt_daily_053');
  EXECUTE format(
    'INSERT INTO market_price_daily (%s) SELECT %s FROM kg_arch_mkt_daily_053 ON CONFLICT (id) DO NOTHING',
    v_cols, v_cols);

  -- ── 4. Restore product status LAST ──────────────────────────────────────
  UPDATE kg_product p
  SET status = a.status, browse_visibility = a.browse_visibility
  FROM kg_arch_product_053 a WHERE p.id = a.id;

  -- ── 5. Validate restored counts ─────────────────────────────────────────
  SELECT count(*) INTO v_expected FROM kg_arch_lpm_053 WHERE _action IN ('merge_delete','repoint');
  SELECT count(*) INTO v_restored FROM kg_arch_lpm_053 a
    JOIN listing_product_match m ON m.id = a.id
   WHERE a._action IN ('merge_delete','repoint') AND m.product_id = a.product_id;
  IF v_restored <> v_expected THEN
    RAISE EXCEPTION 'ROLLBACK FAIL: % of % listing_product_match rows restored to their original product', v_restored, v_expected;
  END IF;

  SELECT count(*) INTO v_restored FROM kg_arch_product_053 a
    JOIN kg_product p ON p.id = a.id
   WHERE p.status = a.status AND p.browse_visibility IS NOT DISTINCT FROM a.browse_visibility;
  IF v_restored <> 16 THEN
    RAISE EXCEPTION 'ROLLBACK FAIL: % of 16 product rows restored to their original status', v_restored;
  END IF;

  -- ── 6. Clear migration-owned state so 053 detects PRE again ─────────────
  DELETE FROM kg_repoint_053;
  DELETE FROM kg_arch_product_053;
  DELETE FROM kg_arch_lpm_053;
  DELETE FROM kg_arch_synonym_053;
  DELETE FROM kg_arch_identifier_053;
  DELETE FROM kg_arch_relation_053;
  DELETE FROM kg_arch_mkt_daily_053;

  RAISE NOTICE '053_rollback: complete. 053 will now detect state=PRE.';
END $$;

COMMIT;
