-- 071_kg_relation_reissue_of.sql
--
-- PAN-302. Lets `kg_relation.type` be `reissue_of`: a row reads "`from` is a
-- reissue of `to`" — the Telefunken Elektroakustik U47 of the Neumann U 47,
-- the ELA M 251E of the vintage ELA M 251. The product page shows it as one
-- line, "Genudgivelse af Neumann U 47", and on the original "Genudgivet af …"
-- (frontend/lib/reissues.ts). Owner's option (a), 2026-10-27.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   Replaces kg_relation_type_check (the six-value CHECK from 008) with the
--   same six values plus 'reissue_of'. No row moves, no column, no grant.
--   The relation never reaches a price: no band, median or verdict reads
--   kg_relation (CLAUDE.md §7). The rows themselves are a separate,
--   guarded data file the owner runs after this.
--
-- ── FAIL CLOSED ───────────────────────────────────────────────────────────
--   PRE   the six-value CHECK from 008: replace, then verify in this
--         transaction.
--   POST  the seven-value CHECK: an explicit successful no-op.
--   DRIFT anything else raises before any change.
-- Rollback: 071_rollback.sql.

BEGIN;

DO $$
DECLARE
  c_old constant text := 'CHECK ((type = ANY (ARRAY[''sibling''::text, ''successor''::text, ''predecessor''::text, ''clone''::text, ''alternative''::text, ''compatible''::text])))';
  c_new constant text := 'CHECK ((type = ANY (ARRAY[''sibling''::text, ''successor''::text, ''predecessor''::text, ''clone''::text, ''alternative''::text, ''compatible''::text, ''reissue_of''::text])))';
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conrelid = 'public.kg_relation'::regclass AND conname = 'kg_relation_type_check';

  IF v_def IS NOT DISTINCT FROM c_new THEN
    RAISE NOTICE '071: state=POST. kg_relation admits reissue_of already. No-op.';
    RETURN;
  END IF;
  IF v_def IS DISTINCT FROM c_old THEN
    RAISE EXCEPTION '071 ABORT: state=DRIFT: kg_relation_type_check is [%]', v_def;
  END IF;

  ALTER TABLE public.kg_relation
    DROP CONSTRAINT kg_relation_type_check,
    ADD CONSTRAINT kg_relation_type_check
      CHECK (type IN ('sibling', 'successor', 'predecessor', 'clone', 'alternative', 'compatible', 'reissue_of'));

  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conrelid = 'public.kg_relation'::regclass AND conname = 'kg_relation_type_check';
  IF v_def IS DISTINCT FROM c_new THEN
    RAISE EXCEPTION '071 ABORT: postflight: kg_relation_type_check is [%]', v_def;
  END IF;
  RAISE NOTICE '071: state=PRE, kg_relation admits reissue_of.';
END $$;

COMMIT;
