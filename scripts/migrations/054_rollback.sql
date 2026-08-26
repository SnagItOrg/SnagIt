-- 054_rollback.sql
--
-- ============================================================================
-- NOT EXECUTED against production or any shared database. Authored and
-- verified only against a disposable local PostgreSQL cluster created by
-- scripts/verify-migrations-isolated.sh.
--
-- Reverses 054_identifier_curation.sql using ONLY migration-owned data
-- (kg_arch_identifier_054 + kg_added_identifier_054). An external logical
-- backup remains mandatory before running either direction in production.
-- ============================================================================

BEGIN;

SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_arch     int;
  v_added    int;
  v_restored int;
BEGIN
  SELECT count(*) INTO v_arch  FROM kg_arch_identifier_054;
  SELECT count(*) INTO v_added FROM kg_added_identifier_054;

  IF v_arch = 0 AND v_added = 0 THEN
    RAISE NOTICE '054_rollback: no archive rows — 054 was never applied. No-op.';
    RETURN;
  END IF;
  IF v_arch <> 3 OR v_added <> 2 THEN
    RAISE EXCEPTION '054_rollback ABORT: archive=% added=% (expected 3 / 2); partial or incompatible state',
                    v_arch, v_added;
  END IF;

  RAISE NOTICE '054_rollback: reversing (restore 3, remove 2).';

  -- 1. Remove exactly the rows 054 added — never anything else.
  DELETE FROM kg_identifier i
  USING kg_added_identifier_054 a
  WHERE i.id = a.id;

  -- 2. Restore the archived originals, byte-for-byte including id.
  INSERT INTO kg_identifier (id, product_id, type, value, confidence, source)
  SELECT a.id, a.product_id, a.type, a.value, a.confidence, a.source
  FROM kg_arch_identifier_054 a
  ON CONFLICT (id) DO NOTHING;

  -- 3. Validate
  SELECT count(*) INTO v_restored
  FROM kg_arch_identifier_054 a JOIN kg_identifier i ON i.id = a.id
  WHERE i.product_id = a.product_id AND i.type = a.type AND i.value = a.value
    AND i.confidence IS NOT DISTINCT FROM a.confidence
    AND i.source     IS NOT DISTINCT FROM a.source;
  IF v_restored <> 3 THEN
    RAISE EXCEPTION 'ROLLBACK FAIL: % of 3 identifier rows restored exactly', v_restored;
  END IF;

  IF EXISTS (SELECT 1 FROM kg_identifier WHERE source = 'migration_054') THEN
    RAISE EXCEPTION 'ROLLBACK FAIL: migration_054 rows still present';
  END IF;

  -- 4. Clear migration-owned state so 054 detects PRE again.
  DELETE FROM kg_added_identifier_054;
  DELETE FROM kg_arch_identifier_054;

  RAISE NOTICE '054_rollback: complete. 054 will now detect state=PRE.';
END $$;

COMMIT;
