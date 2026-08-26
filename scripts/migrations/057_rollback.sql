-- 057_rollback.sql
--
-- Reverses 057_restrict_release_archive_tables.sql.
--
-- ── THIS ROLLBACK REFUSES BY DEFAULT ───────────────────────────────────────
-- Reversing 057 means putting the migration 053 / 054 rollback evidence back
-- on the public PostgREST surface with anon/authenticated write privileges —
-- i.e. restoring a state in which an anonymous caller can DELETE the archive
-- rows the 053 and 054 rollbacks depend on. There is no legitimate operational
-- reason to want that, so it is not reachable by accident.
--
-- Repository convention requires every migration to be reversible, so an
-- explicit unsafe opt-in exists:
--
--     PGOPTIONS="-c klup.rollback_mode=unsafe_reexpose" \
--       psql -X -v ON_ERROR_STOP=1 -f scripts/migrations/057_rollback.sql
--
-- Modes:
--   (unset)             -> REFUSE. Nothing changes. This is the default.
--   unpin_search_path   -> SAFE. Only un-pins listings_ingestion_identity()'s
--                          search_path. Archives stay locked down. Use this if
--                          the pinned search_path is ever suspected of causing
--                          a behavioural problem.
--   unsafe_reexpose     -> Full reversal: RLS off and anon/authenticated
--                          privileges restored. Re-exposes archive data.
--
-- Recovery access (postgres / service_role) never depended on this migration,
-- so a refused rollback never blocks a 053/054/056 rollback.

BEGIN;

DO $$
DECLARE
  v_tables text[] := ARRAY[
    'kg_arch_product_053', 'kg_arch_identifier_053', 'kg_arch_synonym_053',
    'kg_arch_relation_053', 'kg_arch_lpm_053', 'kg_arch_mkt_daily_053',
    'kg_repoint_053', 'kg_arch_identifier_054', 'kg_added_identifier_054'
  ];
  v_mode    text := coalesce(current_setting('klup.rollback_mode', true), '');
  v_present int;
  t         text;
BEGIN
  SELECT count(*) INTO v_present
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(v_tables);

  IF v_present = 0 THEN
    RAISE NOTICE '057_rollback: no archive tables present — nothing to do. No-op.';
    RETURN;
  END IF;

  IF v_mode = 'unpin_search_path' THEN
    EXECUTE 'ALTER FUNCTION listings_ingestion_identity() RESET search_path';
    RAISE NOTICE '057_rollback: search_path un-pinned. Archive tables REMAIN locked down (RLS on, no anon/authenticated grants).';
    RETURN;
  END IF;

  IF v_mode <> 'unsafe_reexpose' THEN
    RAISE EXCEPTION E'057_rollback REFUSED.\n'
      '  Reversing this migration would re-expose % archive table(s) through PostgREST\n'
      '  with anon/authenticated INSERT/UPDATE/DELETE, allowing anonymous destruction of\n'
      '  the 053/054 rollback evidence.\n'
      '  Recovery access (postgres, service_role) does NOT depend on this migration, so\n'
      '  a refusal here never blocks any other rollback.\n'
      '  To un-pin only the function search_path (safe):\n'
      '    PGOPTIONS="-c klup.rollback_mode=unpin_search_path"\n'
      '  To force full re-exposure (UNSAFE, requires a deliberate decision):\n'
      '    PGOPTIONS="-c klup.rollback_mode=unsafe_reexpose"', v_present;
  END IF;

  -- ── unsafe_reexpose from here ────────────────────────────────────────────
  RAISE WARNING '057_rollback: UNSAFE MODE — re-exposing % archive table(s) to anon/authenticated.', v_present;

  FOREACH t IN ARRAY v_tables LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r') THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO anon', t);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO authenticated', t);
    END IF;
  END LOOP;

  EXECUTE 'ALTER FUNCTION listings_ingestion_identity() RESET search_path';

  RAISE WARNING '057_rollback: reversal complete. Archive tables are PUBLICLY READABLE AND WRITABLE again.';
END $$;

COMMIT;
