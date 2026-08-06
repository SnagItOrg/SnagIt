-- 045_listing_scope_provenance
--
-- Purpose: Add scope provenance to listings/listing_staging; rebuild promote_scrape_run with scope-restricted misses.
-- Depends on: 044
-- Kind: schema migration + function
-- Applied in production: YES (version 20260806132211, applied 2026-08-05/06 via Supabase MCP)
--
-- Extracted verbatim from supabase_migrations.schema_migrations: this is the
-- exact SQL that ran in production. Re-running it against production is NOT
-- required and is not idempotent where noted below.

-- ── SCOPE PROVENANCE ON LISTINGS ────────────────────────────────────────
-- Misses must only reach listings attributable to the COVERED query scope.
-- Comparing on source name alone is insufficient: a complete run over a
-- smaller product universe would otherwise mark listings from an earlier,
-- larger universe as missing — and three such runs would delist them.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS coverage_scope_hash text,
  ADD COLUMN IF NOT EXISTS source_query        text;

CREATE INDEX IF NOT EXISTS idx_listings_scope
  ON listings (source, coverage_scope_hash);

COMMENT ON COLUMN listings.coverage_scope_hash IS
  'The coverage scope that last observed this listing. A run may only accrue misses against listings sharing its own scope hash — never against listings belonging to a different (e.g. larger, earlier) universe.';
COMMENT ON COLUMN listings.source_query IS
  'The query/product that surfaced this listing, for provenance and debugging.';

ALTER TABLE listing_staging
  ADD COLUMN IF NOT EXISTS source_query text;

-- Rebuild promotion with scope-restricted lifecycle.
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
  v_now           timestamptz := now();
  v_published     int := 0;
  v_first_seen    int := 0;
  v_price_changes int := 0;
  v_unchanged     int := 0;
  v_delisted      int := 0;
  v_missed        int := 0;
  v_lifecycle_ok  boolean := false;
BEGIN
  SELECT source, status, promoted_at, coverage_scope_hash
    INTO v_source, v_status, v_promoted_at, v_scope
  FROM scrape_run WHERE id = p_run_id
  FOR UPDATE;   -- serialises concurrent promotion of the same run

  IF NOT FOUND THEN
    RAISE EXCEPTION 'scrape_run % not found', p_run_id;
  END IF;
  IF v_status <> 'passed' THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'status_not_passed', 'status', v_status);
  END IF;
  IF v_promoted_at IS NOT NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_promoted', 'promoted_at', v_promoted_at);
  END IF;

  -- Price events before the upsert so "previous price" is the pre-run state.
  WITH staged AS (
    SELECT DISTINCT ON (external_id)
           external_id, source, country, price, currency, price_dkk, url, title
    FROM listing_staging
    WHERE run_id = p_run_id AND external_id IS NOT NULL AND price_dkk IS NOT NULL
    ORDER BY external_id, id DESC
  ),
  latest AS (
    SELECT DISTINCT ON (o.external_id) o.external_id, o.price_dkk
    FROM market_price_observations o
    WHERE o.source = v_source AND o.price_type = 'asking'
      AND o.external_id IN (SELECT external_id FROM staged)
    ORDER BY o.external_id, o.observed_at DESC
  ),
  to_write AS (
    SELECT s.*, l.price_dkk AS prev_price
    FROM staged s LEFT JOIN latest l USING (external_id)
    WHERE l.price_dkk IS NULL OR l.price_dkk <> s.price_dkk
  )
  INSERT INTO market_price_observations
    (kg_product_id, source, country, price_type, price_raw, currency,
     price_dkk, listing_url, listing_title, external_id, observed_at)
  SELECT NULL, source, COALESCE(country,'DK'), 'asking', price,
         COALESCE(currency,'DKK'), price_dkk, url, title, external_id, v_now
  FROM to_write
  ON CONFLICT DO NOTHING;

  SELECT count(*) FILTER (WHERE prev IS NULL),
         count(*) FILTER (WHERE prev IS NOT NULL)
    INTO v_first_seen, v_price_changes
  FROM (
    SELECT (SELECT o.price_dkk FROM market_price_observations o
             WHERE o.source = v_source AND o.external_id = st.external_id
               AND o.price_type='asking' AND o.observed_at < v_now
             ORDER BY o.observed_at DESC LIMIT 1) AS prev
    FROM (SELECT DISTINCT external_id FROM listing_staging
          WHERE run_id = p_run_id AND external_id IS NOT NULL) st
  ) x;

  -- Publish, stamping scope provenance.
  WITH staged AS (
    SELECT DISTINCT ON (external_id) * FROM listing_staging
    WHERE run_id = p_run_id AND external_id IS NOT NULL
    ORDER BY external_id, id DESC
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
    is_active=true, consecutive_misses=0, last_miss_run_id=NULL,
    delisted_at=NULL, coverage_scope_hash=EXCLUDED.coverage_scope_hash,
    source_query=EXCLUDED.source_query;

  GET DIAGNOSTICS v_published = ROW_COUNT;

  IF p_fail_after_listings THEN
    RAISE EXCEPTION 'injected failure after listings upsert (rollback test)';
  END IF;

  -- Lifecycle: coverage evaluated INSIDE this transaction, and restricted to
  -- listings belonging to this run's own scope.
  v_lifecycle_ok := p_coverage_complete
                    AND p_lifecycle_enabled
                    AND run_has_lifecycle_coverage(p_run_id);

  IF v_lifecycle_ok AND v_scope IS NOT NULL THEN
    WITH seen AS (
      SELECT DISTINCT external_id FROM listing_staging
      WHERE run_id = p_run_id AND external_id IS NOT NULL
    ),
    missing AS (
      SELECT l.id, COALESCE(l.consecutive_misses,0) + 1 AS misses
      FROM listings l
      WHERE l.source = v_source
        AND l.coverage_scope_hash = v_scope   -- scope-restricted
        AND l.is_active IS DISTINCT FROM false
        AND l.external_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM seen s WHERE s.external_id = l.external_id)
        AND l.last_miss_run_id IS DISTINCT FROM p_run_id
    ),
    upd AS (
      UPDATE listings l SET
        consecutive_misses = m.misses,
        last_miss_run_id   = p_run_id,
        is_active   = CASE WHEN m.misses >= p_delist_threshold THEN false ELSE l.is_active END,
        delisted_at = CASE WHEN m.misses >= p_delist_threshold THEN v_now ELSE l.delisted_at END
      FROM missing m WHERE l.id = m.id
      RETURNING m.misses
    )
    SELECT count(*), count(*) FILTER (WHERE misses >= p_delist_threshold)
      INTO v_missed, v_delisted FROM upd;
  END IF;

  UPDATE scrape_run
     SET published_count = v_published, promoted_at = v_now
   WHERE id = p_run_id;

  RETURN jsonb_build_object(
    'skipped', false, 'published', v_published,
    'first_seen', v_first_seen, 'price_changes', v_price_changes,
    'unchanged', v_unchanged, 'missed', v_missed, 'delisted', v_delisted,
    'lifecycle_applied', v_lifecycle_ok
  );
END $$;
