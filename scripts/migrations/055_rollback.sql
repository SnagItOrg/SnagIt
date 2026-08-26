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
-- Restores the migration-052 promotion contract EXACTLY: five-argument identity,
-- RETURNS jsonb, the 051 six-field cohort-identity guard and the 052 GROUP BY l.id
-- de-duplication. It differs from the 055 version by one thing only: it does not
-- stamp listings.ingestion_batch_id, because the columns are going away.
--
-- This block previously restored a RETURNS TABLE function. That was the same
-- release defect as in 055 itself: against production's jsonb function it fails
-- with "cannot change return type", and if forced it would revert the 051 guard
-- and break scripts/lib/publish.ts, which reads a single jsonb object.
CREATE OR REPLACE FUNCTION promote_scrape_run(
  p_run_id                uuid,
  p_coverage_complete     boolean DEFAULT false,
  p_delist_threshold      int     DEFAULT 3,
  p_lifecycle_enabled     boolean DEFAULT false,
  p_fail_after_listings   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_source        text;
  v_status        text;
  v_promoted_at   timestamptz;
  v_scope         text;
  v_expected_dig  text;
  v_actual_dig    text;
  v_cov_version   text;
  v_scraper_ver   text;
  v_parser_ver    text;
  v_pagination    text;
  v_run_scope     text;
  v_missing       text[];
  v_now           timestamptz := now();
  v_published     int := 0;
  v_first_seen    int := 0;
  v_delisted      int := 0;
  v_missed        int := 0;
  v_lifecycle_ok  boolean := false;
BEGIN
  SELECT source, status, promoted_at, coverage_scope_hash, staging_digest,
         coverage_version, scraper_version, parser_version, pagination_strategy, run_scope
    INTO v_source, v_status, v_promoted_at, v_scope, v_expected_dig,
         v_cov_version, v_scraper_ver, v_parser_ver, v_pagination, v_run_scope
  FROM scrape_run WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'scrape_run % not found', p_run_id; END IF;
  IF v_status <> 'passed' THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'status_not_passed', 'status', v_status);
  END IF;
  IF v_promoted_at IS NOT NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_promoted', 'promoted_at', v_promoted_at);
  END IF;

  v_missing := ARRAY(SELECT f FROM (VALUES
      ('coverage_scope_hash', v_scope),
      ('coverage_version',    v_cov_version),
      ('scraper_version',     v_scraper_ver),
      ('parser_version',      v_parser_ver),
      ('pagination_strategy', v_pagination),
      ('run_scope',           v_run_scope)
    ) AS t(f, v) WHERE v IS NULL OR v = '');
  IF array_length(v_missing, 1) > 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'cohort_identity_missing',
                              'missing', to_jsonb(v_missing));
  END IF;

  IF v_expected_dig IS NOT NULL THEN
    v_actual_dig := compute_staging_digest(p_run_id);
    IF v_actual_dig IS DISTINCT FROM v_expected_dig THEN
      RETURN jsonb_build_object('skipped', true, 'reason', 'staging_mutated',
                                'expected', v_expected_dig, 'actual', v_actual_dig);
    END IF;
  END IF;

  WITH staged AS (
    SELECT DISTINCT ON (external_id)
           external_id, source, country, price, currency, price_dkk, url, title
    FROM listing_staging
    WHERE run_id = p_run_id AND external_id IS NOT NULL AND price_dkk IS NOT NULL
    ORDER BY external_id, source_query NULLS LAST, id
  ),
  latest AS (
    SELECT DISTINCT ON (o.external_id) o.external_id, o.price_dkk
    FROM market_price_observations o
    WHERE o.source = v_source AND o.price_type = 'asking'
      AND o.external_id IN (SELECT external_id FROM staged)
    ORDER BY o.external_id, o.observed_at DESC
  )
  INSERT INTO market_price_observations
    (kg_product_id, source, country, price_type, price_raw, currency,
     price_dkk, listing_url, listing_title, external_id, observed_at)
  SELECT NULL, s.source, COALESCE(s.country,'DK'), 'asking', s.price,
         COALESCE(s.currency,'DKK'), s.price_dkk, s.url, s.title, s.external_id, v_now
  FROM staged s LEFT JOIN latest l USING (external_id)
  WHERE l.price_dkk IS NULL OR l.price_dkk <> s.price_dkk
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_first_seen = ROW_COUNT;

  WITH staged AS (
    SELECT DISTINCT ON (external_id) * FROM listing_staging
    WHERE run_id = p_run_id AND external_id IS NOT NULL
    ORDER BY external_id, source_query NULLS LAST, id
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

  -- THE FIX. GROUP BY collapses cross-query duplicates to exactly one row per
  -- listing before the upsert sees them. scope_hash, source, run id and
  -- timestamp are plpgsql variables (constant for the whole statement), so
  -- grouping by l.id alone guarantees one row per (listing_id, scope_hash).
  INSERT INTO listing_coverage_scopes
    (listing_id, scope_hash, source, source_query, first_seen_run_id, last_seen_run_id, last_seen_at)
  SELECT l.id, v_scope, v_source, min(st.source_query), p_run_id, p_run_id, v_now
  FROM listing_staging st
  JOIN listings l ON l.external_id = st.external_id AND l.source = st.source
  WHERE st.run_id = p_run_id AND st.external_id IS NOT NULL AND v_scope IS NOT NULL
  GROUP BY l.id
  ON CONFLICT (listing_id, scope_hash) DO UPDATE
    SET last_seen_run_id = EXCLUDED.last_seen_run_id,
        last_seen_at     = EXCLUDED.last_seen_at;

  IF p_fail_after_listings THEN
    RAISE EXCEPTION 'injected failure after listings upsert (rollback test)';
  END IF;

  v_lifecycle_ok := p_coverage_complete AND p_lifecycle_enabled
                    AND run_has_lifecycle_coverage(p_run_id);

  IF v_lifecycle_ok AND v_scope IS NOT NULL THEN
    WITH seen AS (
      SELECT DISTINCT external_id FROM listing_staging
      WHERE run_id = p_run_id AND external_id IS NOT NULL
    ),
    missing AS (
      SELECT l.id, COALESCE(l.consecutive_misses,0) + 1 AS misses
      FROM listings l
      JOIN listing_coverage_scopes lcs
        ON lcs.listing_id = l.id AND lcs.scope_hash = v_scope
      WHERE l.source = v_source
        AND l.is_active IS DISTINCT FROM false
        AND l.external_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM seen s WHERE s.external_id = l.external_id)
        AND l.last_miss_run_id IS DISTINCT FROM p_run_id
    ),
    upd AS (
      UPDATE listings l SET
        consecutive_misses = m.misses, last_miss_run_id = p_run_id,
        is_active   = CASE WHEN m.misses >= p_delist_threshold THEN false ELSE l.is_active END,
        delisted_at = CASE WHEN m.misses >= p_delist_threshold THEN v_now ELSE l.delisted_at END
      FROM missing m WHERE l.id = m.id
      RETURNING m.misses
    )
    SELECT count(*), count(*) FILTER (WHERE misses >= p_delist_threshold)
      INTO v_missed, v_delisted FROM upd;
  END IF;

  UPDATE scrape_run SET published_count = v_published, promoted_at = v_now
   WHERE id = p_run_id;

  RETURN jsonb_build_object('skipped', false, 'published', v_published,
    'first_seen', v_first_seen, 'missed', v_missed, 'delisted', v_delisted,
    'lifecycle_applied', v_lifecycle_ok);
END $$;

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
