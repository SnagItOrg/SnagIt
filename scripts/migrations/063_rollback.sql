-- 063_rollback.sql
--
-- Reverses 063_reverb_price_history_dedup_archive.sql: drops the archive table.
--
-- It REFUSES while the table holds a row. An archived row is the only copy of
-- a removed sold-price row, so run pan213-dedup-rollback.sql (attached to
-- PAN-213) first: it restores the rows to reverb_price_history and empties
-- the archive.
--
-- Idempotent: an absent table is an explicit no-op.

BEGIN;

DO $$
DECLARE
  v_rows bigint;
BEGIN
  IF to_regclass('public.reverb_price_history_dedup_archive') IS NULL THEN
    RAISE NOTICE '063_rollback: archive table absent — 063 was never applied. No-op.';
    RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM public.reverb_price_history_dedup_archive' INTO v_rows;
  IF v_rows > 0 THEN
    RAISE EXCEPTION '063_rollback ABORT: the archive holds % row(s). Run pan213-dedup-rollback.sql first.', v_rows;
  END IF;
  DROP TABLE public.reverb_price_history_dedup_archive;
  RAISE NOTICE '063_rollback: archive table dropped.';
END $$;

COMMIT;
