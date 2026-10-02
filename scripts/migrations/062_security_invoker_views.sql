-- 062_security_invoker_views.sql
--
-- PAN-190 (PAN-191 is its duplicate). The Supabase security advisor reports two
-- ERROR-level `security_definer_view` findings:
--
--     public.browse_product_projection
--     public.market_price_observations_trusted
--
-- Neither view sets `security_invoker`, so each runs with the privileges and
-- the RLS of its OWNER, `postgres`, which carries BYPASSRLS. Both are in
-- `public`, which PostgREST serves, and both carried
-- `anon=arwdDxtm, authenticated=arwdDxtm` (ALL) from the schema-wide default
-- privilege described in scripts/CLAUDE.md P0.
--
-- ── WHAT WAS EXPOSED (measured read-only on production, 2026-09-30) ────────
-- 1. market_price_observations_trusted — ANONYMOUS WRITE. It is a single-table
--    view with no WITH CHECK OPTION, so PostgreSQL makes it auto-updatable
--    (information_schema.views: is_updatable = YES, is_insertable_into = YES).
--    A write through a definer view is checked against the base table's RLS
--    AS THE OWNER, and the owner bypasses RLS. `market_price_observations` has
--    exactly one policy, a SELECT policy, so the table itself refuses every
--    anonymous write — but the view does not. Under `SET ROLE anon`, in a READ
--    ONLY transaction, EXPLAIN (no ANALYZE, nothing executed):
--
--        DELETE FROM market_price_observations         -> One-Time Filter: false
--        DELETE FROM market_price_observations_trusted -> Index Scan ... no RLS filter
--
--    So anyone holding the public anon key could POST / PATCH / DELETE
--    /rest/v1/market_price_observations_trusted: insert fabricated price
--    observations (which the view's WHERE then serves as "trusted"), and
--    rewrite or delete every trusted row. Today 0 of 1,977 rows are trusted,
--    so nothing existing was deletable; the INSERT path was open regardless.
--    READ: no excess. The view's WHERE is byte-for-byte the table's public
--    SELECT policy, so anon reads the same 0 rows either way.
--
-- 2. browse_product_projection — AGGREGATE READ PAST RLS. `listings` has one
--    policy, for `authenticated` users' own watchlist rows; anon sees 0
--    listings directly. Through the view anon sees active_listing_count summed
--    to 10,091 over 4,150 products. Counts only — no listing row, title, price
--    or user is reachable, and the view is not updatable (joins + CTE).
--
-- ── WHO READS THEM ─────────────────────────────────────────────────────────
-- browse_product_projection: every reader is server-side and uses the SERVICE
-- ROLE (`getSupabaseAdmin()`): lib/browse.ts (/browse, /api/browse*,
-- /api/discover, /api/catalogue-tree, the homepage), the product and family
-- pages, /api/product/[slug], /api/search/resolve, /intel, and the admin
-- routes. Edge logs for the 24h before 2026-09-30 18:55Z: 457 requests, all
-- GET, all with the `sb_secret_` key. No anon or authenticated reader exists.
-- market_price_observations_trusted: no reader at all, in code or in the logs.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   ALTER VIEW ... SET (security_invoker = on)                  both views
--   REVOKE ALL ON browse_product_projection FROM anon, authenticated
--   REVOKE ALL ON market_price_observations_trusted FROM anon, authenticated
--   GRANT SELECT ON market_price_observations_trusted TO anon, authenticated
--
-- security_invoker clears the advisor and closes the write hole: writes are
-- checked against the base table's RLS as the caller. It is behaviour-neutral
-- for every current reader, which the guard asserts rather than assumes:
--   * service_role has BYPASSRLS, so the projection it reads is identical.
--     Measured: the view's defining query run AS service_role hashes to the
--     same md5 as the live view over all 4,150 rows.
--   * the trusted view's WHERE equals the table's public SELECT policy, so an
--     anon read returns the same rows under invoker as under definer.
--
-- The REVOKEs are the durable half. `CREATE OR REPLACE VIEW` REPLACES a view's
-- reloptions with whatever its WITH clause lists, so any later migration or
-- rollback that restates a view body without `WITH (security_invoker = on)`
-- silently turns it back into a definer view (058_rollback and 061_rollback
-- both do). GRANTs survive CREATE OR REPLACE, so the revoke still holds then.
-- scripts/lib/security-invoker-views.test.ts fails on any NEW forward
-- migration that restates either view without the option.
--
-- Why anon loses the projection instead of keeping it under invoker: under
-- invoker, anon's RLS on `listings` would return active_listing_count = 0 and
-- supply_state = 'no_live_listings' for all 80 public live products — a
-- silently wrong catalogue, not a denied one. Nothing reads it as anon, so it
-- is revoked. The trusted view keeps anon SELECT: under invoker it exposes
-- exactly what the table's own policy already exposes, and that public read
-- is migration 039's stated intent.
--
-- ── WHAT IT DOES *NOT* DO ──────────────────────────────────────────────────
-- NO DML, no view body change, no column change. It does not touch the
-- base tables' own grants (anon still holds ALL on `market_price_observations`
-- itself, refused by RLS for writes), and it does not remove the schema-wide
-- default privilege (scripts/CLAUDE.md P0). Creates no table.
--
-- PRE / POST / DRIFT: PRE applies, POST is an explicit successful no-op,
-- DRIFT raises before any mutation. Idempotent and re-runnable.
-- Rollback: 062_rollback.sql (refuses by default — it re-opens the write hole).

BEGIN;

DO $$
DECLARE
  v_views      text[] := ARRAY['browse_product_projection', 'market_price_observations_trusted'];
  v_view       text;
  v_role       text;
  v_invoker    int := 0;
  v_opt        text;
  v_policy_ok  boolean;
  v_svc_bypass boolean;
  v_bpp_open   boolean;
  v_mpot_write boolean;
  v_mpot_read  boolean;
BEGIN
  -- ── Structural preconditions: without these the change is not neutral ──
  FOREACH v_view IN ARRAY v_views LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = v_view AND c.relkind = 'v'
    ) THEN
      RAISE EXCEPTION '062 ABORT: public.% is not a view (or does not exist). Reconcile by hand.', v_view;
    END IF;
  END LOOP;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      RAISE EXCEPTION '062 ABORT: role % does not exist. This file targets the Supabase role model.', v_role;
    END IF;
  END LOOP;

  -- Every projection reader is the service role. Under invoker it reads as
  -- itself, so it must bypass RLS on the five base tables or the catalogue
  -- changes.
  SELECT rolbypassrls INTO v_svc_bypass FROM pg_roles WHERE rolname = 'service_role';
  IF NOT v_svc_bypass THEN
    RAISE EXCEPTION '062 ABORT: service_role no longer has BYPASSRLS; security_invoker would change every browse read.';
  END IF;

  -- Invoker is read-neutral for the trusted view only while the table's public
  -- SELECT policy is the view's own WHERE clause.
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'market_price_observations'
       AND cmd = 'SELECT' AND permissive = 'PERMISSIVE' AND roles = '{public}'
       AND qual = '((kg_product_id IS NOT NULL) AND (is_valid IS DISTINCT FROM false))'
  ) INTO v_policy_ok;
  IF NOT v_policy_ok THEN
    RAISE EXCEPTION E'062 ABORT: market_price_observations no longer carries the public SELECT policy\n'
      '  "(kg_product_id IS NOT NULL) AND (is_valid IS DISTINCT FROM false)" that equals the view''s WHERE.\n'
      '  security_invoker would change what the view returns. Reconcile by hand.';
  END IF;

  -- ── State ──
  FOREACH v_view IN ARRAY v_views LOOP
    SELECT o.option_value INTO v_opt
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
           LATERAL pg_options_to_table(c.reloptions) o
     WHERE n.nspname = 'public' AND c.relname = v_view AND o.option_name = 'security_invoker';
    IF v_opt IS NULL THEN
      NULL;
    ELSIF lower(v_opt) IN ('on', 'true', 'yes', '1') THEN
      v_invoker := v_invoker + 1;
    ELSE
      RAISE EXCEPTION '062 ABORT: public.% carries security_invoker=% explicitly. Reconcile by hand.', v_view, v_opt;
    END IF;
  END LOOP;

  v_bpp_open := has_table_privilege('anon', 'public.browse_product_projection', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
             OR has_table_privilege('authenticated', 'public.browse_product_projection', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  v_mpot_write := has_table_privilege('anon', 'public.market_price_observations_trusted', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               OR has_table_privilege('authenticated', 'public.market_price_observations_trusted', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  v_mpot_read := has_table_privilege('anon', 'public.market_price_observations_trusted', 'SELECT')
             AND has_table_privilege('authenticated', 'public.market_price_observations_trusted', 'SELECT');

  -- POST: both views invoker, projection closed to anon/authenticated,
  -- trusted view SELECT-only for them.
  IF v_invoker = 2 AND NOT v_bpp_open AND NOT v_mpot_write AND v_mpot_read THEN
    RAISE NOTICE '062: state=POST — both views are security_invoker and the grants are narrowed. No-op.';
    RETURN;
  END IF;

  -- DRIFT: security_invoker already on one or both, but not the full POST
  -- state. Someone has half-applied this by hand.
  IF v_invoker > 0 THEN
    RAISE EXCEPTION E'062 ABORT: drifted state.\n'
      '  security_invoker set on % of 2 views; projection open to anon/authenticated: %;\n'
      '  trusted view writable by anon/authenticated: %; trusted view readable by both: %.\n'
      '  Expected neither view invoker (PRE) or the full POST state. Reconcile by hand.',
      v_invoker, v_bpp_open, v_mpot_write, v_mpot_read;
  END IF;

  -- PRE.
  RAISE NOTICE '062: state=PRE — both views are security definer; applying.';

  ALTER VIEW public.browse_product_projection SET (security_invoker = on);
  ALTER VIEW public.market_price_observations_trusted SET (security_invoker = on);

  REVOKE ALL ON public.browse_product_projection FROM anon, authenticated;
  REVOKE ALL ON public.market_price_observations_trusted FROM anon, authenticated;
  GRANT SELECT ON public.market_price_observations_trusted TO anon, authenticated;

  COMMENT ON VIEW public.market_price_observations_trusted IS
    'Trusted rows of market_price_observations (migration 039). security_invoker (migration 062, PAN-190): '
    'RLS is the caller''s, and the WHERE equals the table''s public SELECT policy. anon/authenticated hold '
    'SELECT only; writes are service-role only.';
END $$;

-- ── Pre-commit assertions: the POST state, and the readers still read ───────
DO $$
DECLARE
  v_view text;
BEGIN
  FOREACH v_view IN ARRAY ARRAY['browse_product_projection', 'market_price_observations_trusted'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
             LATERAL pg_options_to_table(c.reloptions) o
       WHERE n.nspname = 'public' AND c.relname = v_view
         AND o.option_name = 'security_invoker' AND lower(o.option_value) IN ('on', 'true', 'yes', '1')
    ) THEN
      RAISE EXCEPTION '062 ABORT: public.% is not security_invoker after the change.', v_view;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || v_view, 'SELECT') THEN
      RAISE EXCEPTION '062 ABORT: service_role lost SELECT on public.%.', v_view;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.browse_product_projection', 'SELECT')
     OR has_table_privilege('authenticated', 'public.browse_product_projection', 'SELECT') THEN
    RAISE EXCEPTION '062 ABORT: anon/authenticated can still read browse_product_projection.';
  END IF;

  IF has_table_privilege('anon', 'public.market_price_observations_trusted', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('authenticated', 'public.market_price_observations_trusted', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION '062 ABORT: anon/authenticated can still write through market_price_observations_trusted.';
  END IF;

  IF NOT has_table_privilege('anon', 'public.market_price_observations_trusted', 'SELECT') THEN
    RAISE EXCEPTION '062 ABORT: anon lost SELECT on market_price_observations_trusted.';
  END IF;
END $$;

-- Read as the service role, which is every projection reader, inside this
-- transaction: under invoker it must still read base tables it bypasses RLS on.
SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM 1 FROM public.browse_product_projection LIMIT 1;
  PERFORM 1 FROM public.market_price_observations_trusted LIMIT 1;
  RAISE NOTICE '062: service_role reads both views under security_invoker.';
END $$;
RESET ROLE;

COMMIT;
