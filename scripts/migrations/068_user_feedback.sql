-- 068_user_feedback.sql
--
-- PAN-251 / PAN-256. Creates `user_feedback`: one row per piece of feedback
-- /api/feedback accepted — the feedback sheet's four kinds and "Giv os et
-- tip" — so the manager can read what visitors said. Until now the route only
-- emailed the owner and stored nothing; the manager was blind to it.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   CREATE TABLE user_feedback. What the form sent, as frontend/lib/feedback.ts
--   read it: the kind, the surface, the page, the text, the tip fields, and
--   the visitor's address only when they typed it. Never the IP.
--   `linear_issue_id` is the issue the manager files in the Linear Feedback
--   project for the row, through its own connector; the route never writes it.
--   RLS enabled with no policy, and every privilege revoked from `anon` and
--   `authenticated` in this transaction (scripts/CLAUDE.md P0: a new `public`
--   table is otherwise born world-readable and world-writable). The route
--   writes through the service role; the manager reads through it.
--
-- ── WHAT IT DOES *NOT* DO ──────────────────────────────────────────────────
-- NO DML. Nothing is backfilled: the mails already sent are not rows.
--
-- PRE / POST / DRIFT: PRE creates, POST is an explicit successful no-op, DRIFT
-- (the table exists in another shape, or anon or authenticated can reach it)
-- raises before any mutation. Rollback: 068_rollback.sql.

BEGIN;

DO $$
DECLARE
  v_tbl  regclass := to_regclass('public.user_feedback');
  v_cols text; v_rls boolean; v_open boolean;
  c_cols constant text :=
    'id uuid true, created_at timestamp with time zone true, kind text true, surface text true, '
    || 'path text true, text text false, email text false, product_slug text false, state text false, '
    || 'tip_price_dkk integer false, tip_name text false, listing_url text false, linear_issue_id text false';
BEGIN
  IF v_tbl IS NULL THEN
    CREATE TABLE public.user_feedback (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at      timestamptz NOT NULL DEFAULT now(),
      -- FeedbackKind in frontend/lib/feedback.ts: the sheet's four kinds, or price_tip (PAN-256).
      kind            text NOT NULL,
      -- FeedbackSurface: product or tjek-prisen.
      surface         text NOT NULL,
      -- The page path the form was on.
      path            text NOT NULL,
      "text"          text,
      -- Only when the visitor typed it: "may we answer you?". Never the IP.
      email           text,
      product_slug    text,
      -- The tjek-prisen state the answer was in, if any.
      state           text,
      -- price_tip only: whole kroner, what the visitor says it is, and the ad the tip is about.
      tip_price_dkk   integer,
      tip_name        text,
      listing_url     text,
      -- The issue the manager filed in the Linear Feedback project; null until it has.
      linear_issue_id text
    );
    ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.user_feedback FROM anon, authenticated;
    COMMENT ON TABLE public.user_feedback IS
      'PAN-251/PAN-256: every piece of feedback /api/feedback accepted. The address only when typed; never the IP. Written by the route through the service role; read by the manager.';
    v_tbl := 'public.user_feedback'::regclass;
    RAISE NOTICE '068: state=PRE, user_feedback created.';
  ELSE
    RAISE NOTICE '068: user_feedback already present; verifying its shape.';
  END IF;

  -- The same check proves a fresh create and recognises POST; anything else is DRIFT.
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull, ', ' ORDER BY a.attnum)
    INTO v_cols FROM pg_attribute a WHERE a.attrelid = v_tbl AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT c.relrowsecurity INTO v_rls FROM pg_class c WHERE c.oid = v_tbl;
  v_open := has_table_privilege('anon', v_tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR has_table_privilege('authenticated', v_tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  IF v_cols IS DISTINCT FROM c_cols OR NOT v_rls OR v_open THEN
    RAISE EXCEPTION '068 ABORT: state=DRIFT: columns [%] rls=% anon_or_authenticated_can_reach=%', v_cols, v_rls, v_open;
  END IF;
  RAISE NOTICE '068: state=POST. Shape as authored, RLS on, no anon or authenticated privilege.';
END $$;

COMMIT;
