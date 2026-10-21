-- 070_watchlist_mail.sql
--
-- PAN-276 / PAN-278. Creates `watchlist_mail`: one row per watchlist email
-- sent, keyed by the token its links carry (`klup.dk/w/<token>`). The row
-- holds the listings that mail listed, in the mail's order, so the page shows
-- exactly what the mail showed. The first visit through any of the mail's
-- links stamps `clicked_at`. `prompt` says whether the mail asked "Skal vi
-- stoppe?" ('ask') or announced the pause ('pause'). The runner,
-- scripts/notify-watchlists.ts, reads a watchlist's rows to count its
-- unclicked mails in a row.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   CREATE TABLE watchlist_mail. No address, no title, no query: a random
--   token, ids, two times and a code. The token is 12 base62 characters from
--   a CSPRNG (~71 bits), never derived from an id, so a page cannot be found
--   by counting.
--   RLS enabled with no policy, and every privilege revoked from `anon` and
--   `authenticated` in this transaction (scripts/CLAUDE.md P0). The page
--   `/w/[token]` and the runner read and write through the service role.
--
--   Pausing a watchlist's mails uses the existing `watchlists.active`; no
--   column is added there. No row moves.
--
-- ── FAIL CLOSED ───────────────────────────────────────────────────────────
--   PRE   table absent: create, then a postflight in this transaction.
--   POST  table present in this shape, closed, with its index: an explicit
--         successful no-op.
--   DRIFT anything else raises before any change.
-- Rollback: 070_rollback.sql.

BEGIN;

DO $$
DECLARE
  c_cols constant text :=
    'token text true, watchlist_id uuid true, listing_ids uuid[] true, prompt text false, '
    || 'sent_at timestamp with time zone true, clicked_at timestamp with time zone false';
  c_idx  constant text :=
    'CREATE INDEX watchlist_mail_watchlist ON public.watchlist_mail USING btree (watchlist_id, sent_at)';
  v_tbl  regclass := to_regclass('public.watchlist_mail');
  v_cols text; v_idx text; v_rls boolean; v_open boolean;
BEGIN
  IF v_tbl IS NULL THEN
    CREATE TABLE public.watchlist_mail (
      token        text PRIMARY KEY CHECK (token ~ '^[0-9A-Za-z]{12}$'),
      watchlist_id uuid NOT NULL REFERENCES public.watchlists(id) ON DELETE CASCADE,
      -- The mail's listings in the mail's order; the page reads them by index.
      listing_ids  uuid[] NOT NULL CHECK (cardinality(listing_ids) > 0),
      prompt       text CHECK (prompt IN ('ask', 'pause')),
      sent_at      timestamptz NOT NULL DEFAULT now(),
      clicked_at   timestamptz
    );
    CREATE INDEX watchlist_mail_watchlist ON public.watchlist_mail (watchlist_id, sent_at);
    ALTER TABLE public.watchlist_mail ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.watchlist_mail FROM anon, authenticated;
    COMMENT ON TABLE public.watchlist_mail IS
      'PAN-276/278: one row per watchlist email sent, keyed by the token in its /w/<token> links. No PII. Written by scripts/notify-watchlists.ts; clicked_at by the /w routes.';

    v_tbl := 'public.watchlist_mail'::regclass;
    RAISE NOTICE '070: state=PRE, watchlist_mail created.';
  ELSE
    RAISE NOTICE '070: watchlist_mail already present; verifying.';
  END IF;

  -- The same check is the postflight after PRE and the recognition of POST.
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull, ', ' ORDER BY a.attnum)
    INTO v_cols FROM pg_attribute a WHERE a.attrelid = v_tbl AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT indexdef INTO v_idx
    FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'watchlist_mail_watchlist';
  SELECT c.relrowsecurity INTO v_rls FROM pg_class c WHERE c.oid = v_tbl;
  v_open := has_table_privilege('anon', v_tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR has_table_privilege('authenticated', v_tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  IF v_cols IS DISTINCT FROM c_cols OR v_idx IS DISTINCT FROM c_idx OR NOT v_rls OR v_open THEN
    RAISE EXCEPTION '070 ABORT: state=DRIFT: columns [%] idx [%] rls=% open=%', v_cols, v_idx, v_rls, v_open;
  END IF;
  RAISE NOTICE '070: state=POST. Shape as authored, closed.';
END $$;

COMMIT;
