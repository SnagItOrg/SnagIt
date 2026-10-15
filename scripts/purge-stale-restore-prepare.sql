-- purge-stale-restore-prepare.sql — PAN-264, step 1 of restoring listings that scripts/purge-stale.ts deleted.
-- Creates two empty holding tables shaped like listings and listing_coverage_scopes, for
-- scripts/purge-stale-restore.ts to load. P0 (scripts/CLAUDE.md): a new public table is born open to anon and
-- authenticated, so RLS is enabled and their privileges revoked in the same transaction.
-- PRE creates both; POST (both present and empty) is a no-op; DRIFT (one present, or rows in either) raises.
-- Step 3, purge-stale-restore-apply.sql, drops them again.

BEGIN;
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_l regclass := to_regclass('public.purge_restore_listings');
  v_s regclass := to_regclass('public.purge_restore_lcs');
  v_rows bigint;
BEGIN
  IF v_l IS NOT NULL AND v_s IS NOT NULL THEN
    EXECUTE 'SELECT (SELECT count(*) FROM public.purge_restore_listings) + (SELECT count(*) FROM public.purge_restore_lcs)' INTO v_rows;
    IF v_rows = 0 THEN
      RAISE NOTICE 'purge-stale restore prepare: state=POST, both holding tables exist and are empty. No-op.';
      RETURN;
    END IF;
    RAISE EXCEPTION 'purge-stale restore prepare ABORT: state=DRIFT, the holding tables already hold % rows (an earlier restore?)', v_rows;
  ELSIF v_l IS NOT NULL OR v_s IS NOT NULL THEN
    RAISE EXCEPTION 'purge-stale restore prepare ABORT: state=DRIFT, only one holding table exists';
  END IF;

  -- LIKE copies columns, types and NOT NULL, and no defaults, so a loaded row keeps every value it was exported with.
  CREATE TABLE public.purge_restore_listings (LIKE public.listings);
  CREATE TABLE public.purge_restore_lcs (LIKE public.listing_coverage_scopes);
  ALTER TABLE public.purge_restore_listings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.purge_restore_lcs ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.purge_restore_listings, public.purge_restore_lcs FROM anon, authenticated;
  GRANT ALL ON public.purge_restore_listings, public.purge_restore_lcs TO service_role;
  COMMENT ON TABLE public.purge_restore_listings IS 'PAN-264: transient holding table for a purge-stale restore. Dropped by purge-stale-restore-apply.sql.';
  COMMENT ON TABLE public.purge_restore_lcs IS 'PAN-264: transient holding table for a purge-stale restore. Dropped by purge-stale-restore-apply.sql.';

  -- Postflight: nobody but service_role and the owner can reach them.
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema = 'public' AND table_name IN ('purge_restore_listings', 'purge_restore_lcs')
                AND grantee IN ('anon', 'authenticated')) THEN
    RAISE EXCEPTION 'POSTFLIGHT FAIL: anon or authenticated can reach a holding table';
  END IF;
  RAISE NOTICE 'purge-stale restore prepare: state=PRE, holding tables created (RLS on, anon/authenticated revoked).';
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
