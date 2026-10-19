-- 068_rollback.sql
--
-- Reverses 068_user_feedback.sql: drops the table.
--
-- It REFUSES while the table holds a row. A feedback row is the only copy of
-- what a visitor wrote that the manager can read (the email went to the
-- owner), so empty the table on
-- purpose first (TRUNCATE public.user_feedback) if the rows are to go with it.
--
-- Idempotent: an absent table is an explicit no-op.

BEGIN;

DO $$
DECLARE
  v_rows bigint;
BEGIN
  IF to_regclass('public.user_feedback') IS NULL THEN
    RAISE NOTICE '068_rollback: user_feedback absent — 068 was never applied. No-op.';
    RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM public.user_feedback' INTO v_rows;
  IF v_rows > 0 THEN
    RAISE EXCEPTION '068_rollback ABORT: user_feedback holds % row(s). Empty it on purpose first.', v_rows;
  END IF;
  DROP TABLE public.user_feedback;
  RAISE NOTICE '068_rollback: user_feedback dropped.';
END $$;

COMMIT;
