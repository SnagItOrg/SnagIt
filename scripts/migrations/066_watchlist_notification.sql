-- 066_watchlist_notification.sql
--
-- PAN-12. Creates `watchlist_notification`: one row per (watchlist, listing)
-- the watchlist email has handled, with the attempt time and the outcome. The
-- runner is scripts/notify-watchlists.ts (PM2 on panter); the unique pair is
-- what makes it send at most once.
--
-- Owner decisions, 2026-10-07 (on PAN-12): 1. the trigger is panter's PM2
-- flow; 2. the 324 historical unnotified matches, and anything older than the
-- go-live, are marked seen and never sent; 3. every supported marketplace;
-- 4. a small restricted table, never a secret.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   CREATE TABLE watchlist_notification. No address, no title, no provider
--   message: two ids, an outcome code, the provider's bounded reason code.
--   RLS enabled with no policy, and every privilege revoked from `anon` and
--   `authenticated` in this transaction (scripts/CLAUDE.md P0). The runner
--   writes through the service role.
--
--   INSERT the 324 legacy pairs — `listings` rows the disabled Vercel cron
--   tied to a watchlist and never notified — with outcome 'seen'. Their
--   attempted_at is the go-live the runner reads: nothing ingested before it
--   is ever sent. `listings` itself is not touched.
--
-- ── FAIL CLOSED ───────────────────────────────────────────────────────────
--   PRE   table absent, and the legacy set is exactly the measured 324 pairs
--         (count + md5 of the sorted pairs, production 2026-10-08): create and
--         insert, then a postflight in this transaction.
--   POST  table present in this shape, closed, holding exactly those 324 seen
--         pairs: an explicit successful no-op.
--   DRIFT anything else raises before any change.
-- Rollback: 066_rollback.sql.

BEGIN;

DO $$
DECLARE
  c_n    constant bigint := 324;
  c_md5  constant text   := '0a6c0a9a567a0f88307f2f2689a0c324';
  c_cols constant text :=
    'watchlist_id uuid true, listing_id uuid true, outcome text true, detail text false, '
    || 'attempted_at timestamp with time zone true';
  v_tbl  regclass := to_regclass('public.watchlist_notification');
  v_n bigint; v_md5 text; v_cols text; v_rls boolean; v_open boolean;
BEGIN
  IF v_tbl IS NULL THEN
    SELECT count(*), md5(string_agg(watchlist_id::text || ':' || id::text, ',' ORDER BY watchlist_id, id))
      INTO v_n, v_md5
      FROM public.listings WHERE watchlist_id IS NOT NULL AND notified_at IS NULL;
    IF v_n <> c_n OR v_md5 IS DISTINCT FROM c_md5 THEN
      RAISE EXCEPTION '066 ABORT: state=DRIFT: legacy set is % pairs md5 %, expected % md5 %', v_n, v_md5, c_n, c_md5;
    END IF;

    CREATE TABLE public.watchlist_notification (
      watchlist_id uuid NOT NULL REFERENCES public.watchlists(id) ON DELETE CASCADE,
      listing_id   uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
      outcome      text NOT NULL CHECK (outcome IN ('seen', 'pending', 'sent', 'failed', 'no_recipient', 'opted_out')),
      -- The provider's bounded reason code on a failed send; never free text.
      detail       text,
      attempted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (watchlist_id, listing_id)
    );
    CREATE INDEX watchlist_notification_listing ON public.watchlist_notification (listing_id);
    ALTER TABLE public.watchlist_notification ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.watchlist_notification FROM anon, authenticated;
    COMMENT ON TABLE public.watchlist_notification IS
      'PAN-12: one row per (watchlist, listing) the watchlist email handled. No PII. Written by scripts/notify-watchlists.ts; the earliest seen row is the go-live.';

    INSERT INTO public.watchlist_notification (watchlist_id, listing_id, outcome)
      SELECT watchlist_id, id, 'seen' FROM public.listings
       WHERE watchlist_id IS NOT NULL AND notified_at IS NULL;

    v_tbl := 'public.watchlist_notification'::regclass;
    RAISE NOTICE '066: state=PRE, watchlist_notification created, % legacy pairs marked seen.', c_n;
  ELSE
    RAISE NOTICE '066: watchlist_notification already present; verifying.';
  END IF;

  -- The same check is the postflight after PRE and the recognition of POST.
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull, ', ' ORDER BY a.attnum)
    INTO v_cols FROM pg_attribute a WHERE a.attrelid = v_tbl AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT c.relrowsecurity INTO v_rls FROM pg_class c WHERE c.oid = v_tbl;
  v_open := has_table_privilege('anon', v_tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR has_table_privilege('authenticated', v_tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  SELECT count(*), md5(string_agg(watchlist_id::text || ':' || listing_id::text, ',' ORDER BY watchlist_id, listing_id))
    INTO v_n, v_md5 FROM public.watchlist_notification WHERE outcome = 'seen';
  IF v_cols IS DISTINCT FROM c_cols OR NOT v_rls OR v_open OR v_n <> c_n OR v_md5 IS DISTINCT FROM c_md5 THEN
    RAISE EXCEPTION '066 ABORT: state=DRIFT: columns [%] rls=% open=% seen=% md5=%', v_cols, v_rls, v_open, v_n, v_md5;
  END IF;
  RAISE NOTICE '066: state=POST. Shape as authored, closed, % seen pairs.', c_n;
END $$;

COMMIT;
