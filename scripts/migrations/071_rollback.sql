-- 071_rollback.sql
--
-- Reverses 071_kg_relation_reissue_of.sql: kg_relation_type_check goes back to
-- the six values from 008.
--
-- Refuses while any `reissue_of` row exists — those are the owner's
-- relations, and the PAN-302 rows file has its own rollback; run that first.
-- Idempotent: the six-value CHECK is an explicit no-op; anything else raises.

BEGIN;

DO $$
DECLARE
  c_old constant text := 'CHECK ((type = ANY (ARRAY[''sibling''::text, ''successor''::text, ''predecessor''::text, ''clone''::text, ''alternative''::text, ''compatible''::text])))';
  c_new constant text := 'CHECK ((type = ANY (ARRAY[''sibling''::text, ''successor''::text, ''predecessor''::text, ''clone''::text, ''alternative''::text, ''compatible''::text, ''reissue_of''::text])))';
  v_def text; v_rows bigint;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conrelid = 'public.kg_relation'::regclass AND conname = 'kg_relation_type_check';

  IF v_def IS NOT DISTINCT FROM c_old THEN
    RAISE NOTICE '071_rollback: kg_relation_type_check is the 008 shape — 071 was never applied. No-op.';
    RETURN;
  END IF;
  IF v_def IS DISTINCT FROM c_new THEN
    RAISE EXCEPTION '071_rollback ABORT: state=DRIFT: kg_relation_type_check is [%]', v_def;
  END IF;

  SELECT count(*) INTO v_rows FROM public.kg_relation WHERE type = 'reissue_of';
  IF v_rows > 0 THEN
    RAISE EXCEPTION '071_rollback ABORT: % reissue_of row(s) exist; roll the rows back first', v_rows;
  END IF;

  ALTER TABLE public.kg_relation
    DROP CONSTRAINT kg_relation_type_check,
    ADD CONSTRAINT kg_relation_type_check
      CHECK (type IN ('sibling', 'successor', 'predecessor', 'clone', 'alternative', 'compatible'));
  RAISE NOTICE '071_rollback: kg_relation_type_check restored to the six values from 008.';
END $$;

COMMIT;
