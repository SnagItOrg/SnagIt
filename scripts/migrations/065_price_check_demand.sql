-- 065_price_check_demand.sql
--
-- PAN-247. Creates `price_check_demand`: every DBA link pasted into
-- /tjek-prisen, with what Klup answered. One row per ad URL, counted each time
-- it is checked. The nightly re-check (scripts/recheck-demand.ts) re-reads each
-- active ad and marks it sold or removed; /admin/demand lists the rows,
-- most-checked first, so the owner can turn demand into KG products or
-- publications.
--
-- WHY. Only a matched product's slug reached `price_fetch_queue`; an
-- unrecognised link, its title and its price were saved nowhere. The owner,
-- 2026-10-07: "We must save every DBA link and turn it into a demand list."
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   CREATE TABLE price_check_demand. No IP, no user id, no PII: the ad's URL,
--   title and asking price, and Klup's answer. Primary key on `url`.
--   RLS enabled with no policy, and every privilege revoked from `anon` and
--   `authenticated` in this transaction (scripts/CLAUDE.md P0: a new `public`
--   table is otherwise born world-readable and world-writable). The route and
--   the nightly script write through the service role.
--
-- ── WHAT IT DOES *NOT* DO ──────────────────────────────────────────────────
-- NO DML. Nothing is backfilled: rows arrive as links are pasted.
--
-- PRE / POST / DRIFT: PRE creates, POST is an explicit successful no-op, DRIFT
-- (the table exists in another shape, or anon or authenticated can reach it)
-- raises before any mutation. Rollback: 065_rollback.sql.

BEGIN;

DO $$
DECLARE
  v_tbl  regclass := to_regclass('public.price_check_demand');
  v_cols text; v_rls boolean; v_open boolean;
  c_cols constant text :=
    'url text true, source text true, title text false, price integer false, currency text false, '
    || 'state text true, matched_slug text false, guesses jsonb true, picked_slug text false, '
    || 'ad_state text true, check_count integer true, created_at timestamp with time zone true, '
    || 'last_seen_at timestamp with time zone true, rechecked_at timestamp with time zone false';
BEGIN
  IF v_tbl IS NULL THEN
    CREATE TABLE public.price_check_demand (
      url          text PRIMARY KEY,
      source       text NOT NULL CHECK (source IN ('dba', 'thomann')),
      title        text,
      price        integer,
      currency     text,
      -- The answer the last check gave: PriceCheckState in frontend/lib/price-check.ts.
      state        text NOT NULL CHECK (state IN ('verdict', 'not_enough_data', 'not_recognised', 'cant_read')),
      -- The product Klup recognised, public or not. A private match is the demand signal.
      matched_slug text,
      -- [{slug, name}] offered when nothing was recognised (PAN-244 part 2).
      guesses      jsonb NOT NULL DEFAULT '[]'::jsonb,
      picked_slug  text,
      -- What the nightly re-check last saw of the ad itself.
      ad_state     text NOT NULL DEFAULT 'active' CHECK (ad_state IN ('active', 'sold', 'removed')),
      check_count  integer NOT NULL DEFAULT 1,
      created_at   timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      rechecked_at timestamptz
    );
    ALTER TABLE public.price_check_demand ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.price_check_demand FROM anon, authenticated;
    COMMENT ON TABLE public.price_check_demand IS
      'PAN-247: every DBA link pasted into /tjek-prisen and what Klup answered. No PII. Written by /api/tjek-prisen and scripts/recheck-demand.ts; read by /admin/demand.';
    v_tbl := 'public.price_check_demand'::regclass;
    RAISE NOTICE '065: state=PRE, price_check_demand created.';
  ELSE
    RAISE NOTICE '065: price_check_demand already present; verifying its shape.';
  END IF;

  -- The same check proves a fresh create and recognises POST; anything else is DRIFT.
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull, ', ' ORDER BY a.attnum)
    INTO v_cols FROM pg_attribute a WHERE a.attrelid = v_tbl AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT c.relrowsecurity INTO v_rls FROM pg_class c WHERE c.oid = v_tbl;
  v_open := has_table_privilege('anon', v_tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR has_table_privilege('authenticated', v_tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  IF v_cols IS DISTINCT FROM c_cols OR NOT v_rls OR v_open THEN
    RAISE EXCEPTION '065 ABORT: state=DRIFT: columns [%] rls=% anon_or_authenticated_can_reach=%', v_cols, v_rls, v_open;
  END IF;
  RAISE NOTICE '065: state=POST. Shape as authored, RLS on, no anon or authenticated privilege.';
END $$;

COMMIT;
