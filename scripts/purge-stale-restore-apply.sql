-- purge-stale-restore-apply.sql — PAN-264, step 3 of restoring listings that scripts/purge-stale.ts deleted.
-- Run after purge-stale-restore.ts --apply has loaded and verified the holding tables.
-- One transaction: listings is locked against writes; every user trigger on listings (among them
-- trg_listings_ingestion_identity, which would stamp ingested_at = now()) is switched off for the insert and on
-- again before the end; the coverage scope rows the delete cascaded go back; the holding tables are dropped.
-- PRE: no holding id is in listings → restore.  POST: no holding tables → no-op.
-- DRIFT, raised before any write: empty holding table, some but not all ids already back, a user trigger that was
-- already disabled, or rows already back that differ from the holding rows.
-- Postflight in the transaction: the restored rows and scope rows are byte-identical to the holding rows (md5 over
-- the full row text), every user trigger is enabled again, and the counts moved by exactly the holding counts.

BEGIN;
SET LOCAL statement_timeout = '300s';
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
  v_n bigint; v_s bigint; v_back bigint; v_disabled int;
  v_hold_md5 text; v_live_md5 text; v_hold_s_md5 text; v_live_s_md5 text;
  v_total0 bigint; v_total1 bigint; v_scopes0 bigint; v_scopes1 bigint;
BEGIN
  IF to_regclass('public.purge_restore_listings') IS NULL AND to_regclass('public.purge_restore_lcs') IS NULL THEN
    RAISE NOTICE 'purge-stale restore apply: state=POST, no holding tables. No-op.';
    RETURN;
  END IF;
  IF to_regclass('public.purge_restore_listings') IS NULL OR to_regclass('public.purge_restore_lcs') IS NULL THEN
    RAISE EXCEPTION 'purge-stale restore apply ABORT: state=DRIFT, only one holding table exists';
  END IF;

  LOCK TABLE public.listings, public.listing_coverage_scopes IN SHARE ROW EXCLUSIVE MODE;

  EXECUTE 'SELECT count(*) FROM public.purge_restore_listings' INTO v_n;
  EXECUTE 'SELECT count(*) FROM public.purge_restore_lcs' INTO v_s;
  EXECUTE 'SELECT count(*) FROM public.listings l JOIN public.purge_restore_listings h ON h.id = l.id' INTO v_back;
  SELECT count(*) INTO v_disabled FROM pg_trigger
   WHERE tgrelid = 'public.listings'::regclass AND NOT tgisinternal AND tgenabled <> 'O';
  EXECUTE 'SELECT md5(string_agg(h::text, E''\n'' ORDER BY h.id)) FROM public.purge_restore_listings h' INTO v_hold_md5;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'purge-stale restore apply ABORT: state=DRIFT, the holding table is empty (run purge-stale-restore.ts --apply first)';
  END IF;
  IF v_disabled <> 0 THEN
    RAISE EXCEPTION 'purge-stale restore apply ABORT: state=DRIFT, % user trigger(s) on listings are not enabled; this file would enable them', v_disabled;
  END IF;
  IF v_back = v_n THEN
    EXECUTE 'SELECT md5(string_agg(l::text, E''\n'' ORDER BY l.id)) FROM public.listings l
              WHERE l.id IN (SELECT id FROM public.purge_restore_listings)' INTO v_live_md5;
    IF v_live_md5 IS DISTINCT FROM v_hold_md5 THEN
      RAISE EXCEPTION 'purge-stale restore apply ABORT: state=DRIFT, all % ids are back but differ from the holding rows', v_n;
    END IF;
    RAISE NOTICE 'purge-stale restore apply: state=POST, all % rows are back and identical. Dropping the holding tables.', v_n;
    DROP TABLE public.purge_restore_lcs, public.purge_restore_listings;
    RETURN;
  END IF;
  IF v_back <> 0 THEN
    RAISE EXCEPTION 'purge-stale restore apply ABORT: state=DRIFT, % of % ids are already in listings', v_back, v_n;
  END IF;

  SELECT count(*) INTO v_total0 FROM public.listings;
  SELECT count(*) INTO v_scopes0 FROM public.listing_coverage_scopes;
  RAISE NOTICE 'purge-stale restore apply: state=PRE, restoring % listings and % coverage scope rows.', v_n, v_s;

  ALTER TABLE public.listings DISABLE TRIGGER USER;
  EXECUTE 'INSERT INTO public.listings SELECT * FROM public.purge_restore_listings';
  ALTER TABLE public.listings ENABLE TRIGGER USER;
  EXECUTE 'INSERT INTO public.listing_coverage_scopes SELECT * FROM public.purge_restore_lcs';

  -- Postflight.
  SELECT count(*) INTO v_total1 FROM public.listings;
  SELECT count(*) INTO v_scopes1 FROM public.listing_coverage_scopes;
  IF v_total1 - v_total0 <> v_n OR v_scopes1 - v_scopes0 <> v_s THEN
    RAISE EXCEPTION 'POSTFLIGHT FAIL: listings +% (expected +%), coverage scopes +% (expected +%)', v_total1 - v_total0, v_n, v_scopes1 - v_scopes0, v_s;
  END IF;
  EXECUTE 'SELECT md5(string_agg(l::text, E''\n'' ORDER BY l.id)) FROM public.listings l
            WHERE l.id IN (SELECT id FROM public.purge_restore_listings)' INTO v_live_md5;
  IF v_live_md5 IS DISTINCT FROM v_hold_md5 THEN
    RAISE EXCEPTION 'POSTFLIGHT FAIL: restored listings differ from the holding rows (md5 % vs %)', v_live_md5, v_hold_md5;
  END IF;
  EXECUTE 'SELECT md5(string_agg(h::text, E''\n'' ORDER BY h.listing_id, h.scope_hash)) FROM public.purge_restore_lcs h' INTO v_hold_s_md5;
  EXECUTE 'SELECT md5(string_agg(s::text, E''\n'' ORDER BY s.listing_id, s.scope_hash)) FROM public.listing_coverage_scopes s
            WHERE (s.listing_id, s.scope_hash) IN (SELECT listing_id, scope_hash FROM public.purge_restore_lcs)' INTO v_live_s_md5;
  IF v_live_s_md5 IS DISTINCT FROM v_hold_s_md5 THEN
    RAISE EXCEPTION 'POSTFLIGHT FAIL: restored coverage scopes differ from the holding rows';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.listings'::regclass AND NOT tgisinternal AND tgenabled <> 'O') THEN
    RAISE EXCEPTION 'POSTFLIGHT FAIL: a user trigger on listings is still disabled';
  END IF;

  DROP TABLE public.purge_restore_lcs, public.purge_restore_listings;
  RAISE NOTICE 'purge-stale restore apply: restored % listings and % coverage scope rows, byte-identical; holding tables dropped.', v_n, v_s;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
