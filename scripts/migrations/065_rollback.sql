-- 065_rollback.sql
--
-- Reverses 065_price_check_demand.sql: drops the table.
--
-- It REFUSES while the table holds a row. A demand row is the only record of
-- a link someone pasted, so empty the table on purpose first
-- (TRUNCATE public.price_check_demand) if the rows are to go with it.
--
-- Idempotent: an absent table is an explicit no-op.

BEGIN;

DO $$
DECLARE
  v_rows bigint;
BEGIN
  IF to_regclass('public.price_check_demand') IS NULL THEN
    RAISE NOTICE '065_rollback: price_check_demand absent — 065 was never applied. No-op.';
    RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM public.price_check_demand' INTO v_rows;
  IF v_rows > 0 THEN
    RAISE EXCEPTION '065_rollback ABORT: price_check_demand holds % row(s). Empty it on purpose first.', v_rows;
  END IF;
  DROP TABLE public.price_check_demand;
  RAISE NOTICE '065_rollback: price_check_demand dropped.';
END $$;

COMMIT;
