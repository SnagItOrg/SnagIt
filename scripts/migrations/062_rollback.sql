-- 062_rollback.sql
--
-- Reverses 062_security_invoker_views.sql.
--
-- ── THIS ROLLBACK REFUSES BY DEFAULT ───────────────────────────────────────
-- Fully reversing 062 turns market_price_observations_trusted back into an
-- auto-updatable SECURITY DEFINER view that anon/authenticated may write to —
-- i.e. it lets anyone holding the public anon key insert, rewrite and delete
-- market price observations past RLS. There is no operational reason to want
-- that, so it is not reachable by accident.
--
-- The only plausible reason to roll back is a reader of browse_product_projection
-- that uses the anon or authenticated key and that 062's measurement missed
-- (every reader found in code, and every request in 24h of edge logs, uses the
-- service role). That case has its own mode, which leaves the write hole shut:
--
--     PGOPTIONS="-c klup.rollback_mode=restore_browse_read" \
--       psql -X -v ON_ERROR_STOP=1 -f scripts/migrations/062_rollback.sql
--
-- Modes:
--   (unset)              -> REFUSE. Nothing changes. This is the default.
--   restore_browse_read  -> browse_product_projection only: security definer
--                           again, anon/authenticated privileges restored
--                           exactly as before 062 (ALL; the view is not
--                           updatable, so this is read access). The trusted
--                           view stays invoker and SELECT-only.
--   unsafe_reexpose      -> Full reversal of both views, exactly as before 062.
--                           Re-opens anonymous writes through the trusted view.
--
-- Pre-062 state restored (read on production 2026-09-30): no reloptions, and
-- relacl {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm,
-- service_role=arwdDxtm} on both views. Idempotent: a view already in its
-- pre-062 state is left alone.

BEGIN;

DO $$
DECLARE
  v_mode text := coalesce(current_setting('klup.rollback_mode', true), '');
  v_view text;
  v_targets text[];
BEGIN
  IF v_mode = '' THEN
    RAISE EXCEPTION E'062_rollback REFUSED: reversing 062 re-opens anonymous writes through market_price_observations_trusted.\n'
      '  Set klup.rollback_mode=restore_browse_read (projection only, safe) or unsafe_reexpose (full). See the file header.';
  ELSIF v_mode = 'restore_browse_read' THEN
    v_targets := ARRAY['browse_product_projection'];
  ELSIF v_mode = 'unsafe_reexpose' THEN
    v_targets := ARRAY['browse_product_projection', 'market_price_observations_trusted'];
  ELSE
    RAISE EXCEPTION '062_rollback REFUSED: unknown klup.rollback_mode "%".', v_mode;
  END IF;

  FOREACH v_view IN ARRAY v_targets LOOP
    IF to_regclass('public.' || v_view) IS NULL THEN
      RAISE EXCEPTION '062_rollback ABORT: public.% does not exist. Reconcile by hand.', v_view;
    END IF;

    IF NOT EXISTS (
         SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
                LATERAL pg_options_to_table(c.reloptions) o
          WHERE n.nspname = 'public' AND c.relname = v_view AND o.option_name = 'security_invoker')
       AND has_table_privilege('anon', 'public.' || v_view, 'INSERT,UPDATE,DELETE')
       AND has_table_privilege('authenticated', 'public.' || v_view, 'SELECT') THEN
      RAISE NOTICE '062_rollback: public.% is already in its pre-062 state. No-op.', v_view;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER VIEW public.%I RESET (security_invoker)', v_view);
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated', v_view);
    RAISE WARNING '062_rollback (%): public.% is SECURITY DEFINER again and anon/authenticated hold ALL.', v_mode, v_view;
  END LOOP;

  IF v_mode = 'unsafe_reexpose' THEN
    COMMENT ON VIEW public.market_price_observations_trusted IS NULL;
  END IF;

  RAISE NOTICE '062_rollback: committed (mode %).', v_mode;
END $$;

COMMIT;
