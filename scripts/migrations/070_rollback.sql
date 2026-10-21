-- 070_rollback.sql
--
-- Reverses 070_watchlist_mail.sql: drops `watchlist_mail`.
--
-- What it does NOT undo: a watchlist the runner paused (`active = false`
-- after a 'pause' mail) stays paused. That is the user's setting now, and a
-- user who answered "Ja, stop" is indistinguishable from it once the table is
-- gone, so the NOTICE prints how many there are and the operator decides.
-- Every /w/<token> link in a mail already sent answers 404 afterwards.
--
-- Idempotent: an absent table is an explicit no-op.

BEGIN;

DO $$
DECLARE
  v_paused bigint;
BEGIN
  IF to_regclass('public.watchlist_mail') IS NULL THEN
    RAISE NOTICE '070_rollback: watchlist_mail absent — 070 was never applied. No-op.';
    RETURN;
  END IF;
  EXECUTE $q$
    SELECT count(DISTINCT m.watchlist_id) FROM public.watchlist_mail m
      JOIN public.watchlists w ON w.id = m.watchlist_id
     WHERE m.prompt = 'pause' AND w.active = false
  $q$ INTO v_paused;
  DROP TABLE public.watchlist_mail;
  RAISE NOTICE '070_rollback: watchlist_mail dropped. % watchlist(s) paused by a pause mail stay paused.', v_paused;
END $$;

COMMIT;
