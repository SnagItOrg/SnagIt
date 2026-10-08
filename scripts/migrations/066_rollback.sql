-- 066_rollback.sql
--
-- Reverses 066_watchlist_notification.sql: drops the table.
--
-- It REFUSES while the table holds a row other than the 324 'seen' pairs 066
-- inserted. Any other row is the only record of a mail Klup sent or tried to
-- send, so empty it on purpose first if that history is to go with it. The
-- seen pairs are derived from `listings` and come back with a re-apply.
--
-- Idempotent: an absent table is an explicit no-op.

BEGIN;

DO $$
DECLARE
  v_rows bigint;
BEGIN
  IF to_regclass('public.watchlist_notification') IS NULL THEN
    RAISE NOTICE '066_rollback: watchlist_notification absent — 066 was never applied. No-op.';
    RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM public.watchlist_notification WHERE outcome <> ''seen''' INTO v_rows;
  IF v_rows > 0 THEN
    RAISE EXCEPTION '066_rollback ABORT: watchlist_notification holds % delivery row(s). Empty it on purpose first.', v_rows;
  END IF;
  DROP TABLE public.watchlist_notification;
  RAISE NOTICE '066_rollback: watchlist_notification dropped.';
END $$;

COMMIT;
