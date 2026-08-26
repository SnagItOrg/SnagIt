-- 055_rollback.sql
--
-- ============================================================================
-- NOT EXECUTED against production or any shared database. Verified only
-- against the disposable local cluster in scripts/verify-migrations-isolated.sh.
--
-- Reverses 055_listing_ingestion_identity.sql.
-- ============================================================================
--
-- REFUSES TO DESTROY POST-ACTIVATION EVIDENCE.
--
-- Once activation begins, `ingestion_batch_id` is the ONLY durable record of
-- which listings entered Klup after the boundary. Dropping the columns would
-- erase that permanently and make the distinction unrecoverable — legacy rows
-- and post-activation rows would become indistinguishable again.
--
-- So this script refuses by default whenever any row carries an identity.
-- Two explicit, deliberate escapes exist:
--
--   PGOPTIONS="-c klup.rollback_mode=drop_with_evidence"
--        accept the loss and drop the columns anyway
--   PGOPTIONS="-c klup.rollback_mode=keep_columns"
--        remove enforcement + promotion support only, LEAVING the columns and
--        their data intact
--
-- Neither is set by default, so a plain run on an activated database aborts.

BEGIN;

SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  v_cols     int;
  v_nonnull  bigint := 0;
  -- Mode is passed as a session GUC so this file needs no psql-specific
  -- meta-commands and behaves identically from any client:
  --   PGOPTIONS="-c klup.rollback_mode=keep_columns"       psql -f 055_rollback.sql
  --   PGOPTIONS="-c klup.rollback_mode=drop_with_evidence" psql -f 055_rollback.sql
  v_mode     text    := coalesce(current_setting('klup.rollback_mode', true), '');
  v_drop_ok  boolean := (v_mode = 'drop_with_evidence');
  v_keep     boolean := (v_mode = 'keep_columns');
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema='public' AND table_name='listings'
     AND column_name IN ('ingestion_batch_id','ingested_at');

  IF v_cols = 0 THEN
    RAISE NOTICE '055_rollback: columns absent — 055 was never applied. No-op.';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM listings WHERE ingestion_batch_id IS NOT NULL' INTO v_nonnull;

  IF v_nonnull > 0 AND NOT v_drop_ok AND NOT v_keep THEN
    RAISE EXCEPTION
      '055_rollback ABORT: % listing(s) carry post-activation ingestion identity. '
      'Dropping the columns would destroy the only durable record of which rows are new inflow. '
      'Re-run with -v drop_with_evidence=1 to accept that loss, or -v keep_columns=1 to '
      'remove enforcement only and preserve the data.', v_nonnull;
  END IF;

  IF v_nonnull > 0 THEN
    RAISE NOTICE '055_rollback: proceeding with % identity row(s) present (mode=%).',
      v_nonnull, CASE WHEN v_keep THEN 'keep_columns' ELSE 'drop_with_evidence' END;
  END IF;
END $$;

-- ── 1. Restore the migration-052 promotion function ─────────────────────────
-- Identical to 052 apart from removing the ingestion_batch_id column/value, so
-- a rolled-back database promotes exactly as it did before 055.
CREATE OR REPLACE FUNCTION promote_scrape_run(
  p_run_id                uuid,
  p_coverage_complete     boolean DEFAULT false,
  p_delist_threshold      int     DEFAULT 3,
  p_lifecycle_enabled     boolean DEFAULT false,
  p_fail_after_listings   boolean DEFAULT false
)
RETURNS TABLE (
  published int, new_listings int, price_changes int, unchanged int,
  missed int, delisted int, lifecycle_applied boolean
)
LANGUAGE plpgsql
AS $promote$
DECLARE
  v_now       timestamptz := now();
  v_source    text;  v_scope text;  v_status text;
  v_promoted  timestamptz;  v_digest text;  v_live text;
  v_published int := 0; v_new int := 0; v_changed int := 0; v_unchanged int := 0;
  v_missed    int := 0; v_delisted int := 0; v_lifecycle boolean := false;
BEGIN
  SELECT source, coverage_scope_hash, status, promoted_at, staging_digest
    INTO v_source, v_scope, v_status, v_promoted, v_digest
  FROM scrape_run WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'promote_scrape_run: unknown run %', p_run_id; END IF;
  IF v_status IS DISTINCT FROM 'passed' THEN
    RAISE EXCEPTION 'promote_scrape_run: run % has status %, refusing to publish', p_run_id, v_status;
  END IF;
  IF v_promoted IS NOT NULL THEN
    RAISE EXCEPTION 'promote_scrape_run: run % already promoted at %', p_run_id, v_promoted;
  END IF;
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'promote_scrape_run: run % has no coverage_scope_hash', p_run_id;
  END IF;

  SELECT md5(string_agg(external_id || '|' || coalesce(price::text,'') , E'\n' ORDER BY external_id))
    INTO v_live FROM listing_staging WHERE run_id = p_run_id;
  IF v_digest IS DISTINCT FROM v_live THEN
    RAISE EXCEPTION 'promote_scrape_run: staging digest mismatch for run % (staging mutated after the gate)', p_run_id;
  END IF;

  WITH staged AS (
    SELECT DISTINCT ON (external_id) * FROM listing_staging
     WHERE run_id = p_run_id AND external_id IS NOT NULL ORDER BY external_id, id
  )
  INSERT INTO listings
    (title, price, currency, price_dkk, url, image_url, location, source,
     country, normalized_text, platform, external_id, scraped_at,
     last_seen_at, first_seen_at, is_active, consecutive_misses,
     last_miss_run_id, delisted_at, coverage_scope_hash, source_query)
  SELECT title, price, currency, price_dkk, url, image_url, location, source,
         country, normalized_text, platform, external_id, v_now, v_now, v_now,
         true, 0, NULL, NULL, v_scope, source_query
  FROM staged
  ON CONFLICT (external_id, source) DO UPDATE SET
    title=EXCLUDED.title, price=EXCLUDED.price, currency=EXCLUDED.currency,
    price_dkk=EXCLUDED.price_dkk, url=EXCLUDED.url, image_url=EXCLUDED.image_url,
    location=EXCLUDED.location, country=EXCLUDED.country,
    normalized_text=EXCLUDED.normalized_text, scraped_at=EXCLUDED.scraped_at,
    last_seen_at=EXCLUDED.last_seen_at,
    first_seen_at=COALESCE(listings.first_seen_at, EXCLUDED.first_seen_at),
    is_active=true, consecutive_misses=0, last_miss_run_id=NULL, delisted_at=NULL,
    coverage_scope_hash=EXCLUDED.coverage_scope_hash,
    source_query=EXCLUDED.source_query;
  GET DIAGNOSTICS v_published = ROW_COUNT;

  INSERT INTO listing_coverage_scopes
    (listing_id, scope_hash, source, source_query, first_seen_run_id, last_seen_run_id, last_seen_at)
  SELECT l.id, v_scope, v_source, min(st.source_query), p_run_id, p_run_id, v_now
  FROM listing_staging st
  JOIN listings l ON l.external_id = st.external_id AND l.source = st.source
  WHERE st.run_id = p_run_id AND st.external_id IS NOT NULL AND v_scope IS NOT NULL
  GROUP BY l.id
  ON CONFLICT (listing_id, scope_hash) DO UPDATE
    SET last_seen_run_id = EXCLUDED.last_seen_run_id, last_seen_at = EXCLUDED.last_seen_at;

  IF p_fail_after_listings THEN
    RAISE EXCEPTION 'promote_scrape_run: simulated crash after listings upsert';
  END IF;

  SELECT count(*) FILTER (WHERE o.kind='first_seen'),
         count(*) FILTER (WHERE o.kind='price_change'),
         count(*) FILTER (WHERE o.kind='unchanged')
    INTO v_new, v_changed, v_unchanged
  FROM record_price_observations(p_run_id) o;

  IF p_coverage_complete AND p_lifecycle_enabled THEN
    v_lifecycle := true;
    UPDATE listings l SET consecutive_misses = l.consecutive_misses + 1, last_miss_run_id = p_run_id
     WHERE l.source = v_source AND l.is_active
       AND coalesce(l.last_miss_run_id, '00000000-0000-0000-0000-000000000000') <> p_run_id
       AND EXISTS (SELECT 1 FROM listing_coverage_scopes lcs
                    WHERE lcs.listing_id = l.id AND lcs.scope_hash = v_scope)
       AND NOT EXISTS (SELECT 1 FROM listing_staging st
                        WHERE st.run_id = p_run_id AND st.external_id = l.external_id);
    GET DIAGNOSTICS v_missed = ROW_COUNT;
    UPDATE listings SET is_active = false, delisted_at = v_now
     WHERE source = v_source AND is_active AND consecutive_misses >= p_delist_threshold;
    GET DIAGNOSTICS v_delisted = ROW_COUNT;
  END IF;

  UPDATE scrape_run SET promoted_at = v_now, published_count = v_published WHERE id = p_run_id;
  RETURN QUERY SELECT v_published, v_new, v_changed, v_unchanged, v_missed, v_delisted, v_lifecycle;
END;
$promote$;

-- ── 2. Remove enforcement ───────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_listings_ingestion_identity ON listings;
DROP FUNCTION IF EXISTS listings_ingestion_identity();

-- ── 3. Drop columns — only when not preserving evidence ─────────────────────
DO $$
DECLARE
  v_mode text := coalesce(current_setting('klup.rollback_mode', true), '');
BEGIN
  IF v_mode = 'keep_columns' THEN
    RAISE NOTICE '055_rollback: keep_columns — enforcement removed, columns and data PRESERVED.';
    RETURN;
  END IF;
  EXECUTE 'DROP INDEX IF EXISTS idx_listings_ingestion_batch';
  EXECUTE 'ALTER TABLE listings DROP COLUMN IF EXISTS ingested_at';
  EXECUTE 'ALTER TABLE listings DROP COLUMN IF EXISTS ingestion_batch_id';
  RAISE NOTICE '055_rollback: columns dropped.';
END $$;

COMMIT;
