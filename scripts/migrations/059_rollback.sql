-- 059_rollback.sql
--
-- Reverses 059_kg_product_year_discontinued.sql: drops the CHECK and the
-- kg_product.year_discontinued column.
--
-- ── REFUSES TO DESTROY CURATED YEARS BY DEFAULT ────────────────────────────
-- Once an operator has set a discontinued year, dropping the column erases
-- that curation with no other copy. So this script refuses whenever any row
-- carries a value, unless the loss is accepted explicitly:
--
--     PGOPTIONS="-c klup.rollback_mode=drop_with_data" \
--       psql -X -v ON_ERROR_STOP=1 -f scripts/migrations/059_rollback.sql
--
-- With no value stored (the state right after 059), it drops without asking.
-- BEFORE running it, switch KLUP_YEAR_DISCONTINUED off and redeploy: with the
-- flag on, the application selects the column and PostgREST fails the query
-- once it is gone.
--
-- Idempotent: absent column and constraint is an explicit no-op.

BEGIN;

DO $$
DECLARE
  v_mode    text := coalesce(current_setting('klup.rollback_mode', true), '');
  v_has_col boolean;
  v_nonnull bigint := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'kg_product' AND column_name = 'year_discontinued'
  ) INTO v_has_col;

  IF NOT v_has_col THEN
    -- The CHECK references the column, so it cannot outlive it; drop defensively.
    ALTER TABLE public.kg_product DROP CONSTRAINT IF EXISTS kg_product_year_discontinued_check;
    RAISE NOTICE '059_rollback: year_discontinued absent — 059 was never applied. No-op.';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.kg_product WHERE year_discontinued IS NOT NULL' INTO v_nonnull;

  IF v_nonnull > 0 AND v_mode <> 'drop_with_data' THEN
    RAISE EXCEPTION E'059_rollback REFUSED: % product(s) carry a curated year_discontinued.\n'
      '  Dropping the column erases that curation permanently.\n'
      '  To accept the loss: PGOPTIONS="-c klup.rollback_mode=drop_with_data"', v_nonnull;
  END IF;

  IF v_nonnull > 0 THEN
    RAISE WARNING '059_rollback: dropping year_discontinued with % curated value(s).', v_nonnull;
  END IF;

  ALTER TABLE public.kg_product DROP CONSTRAINT IF EXISTS kg_product_year_discontinued_check;
  ALTER TABLE public.kg_product DROP COLUMN year_discontinued;

  RAISE NOTICE '059_rollback: committed — kg_product.year_discontinued and its CHECK removed.';
END $$;

COMMIT;
