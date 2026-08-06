-- 043_promote_scrape_run_transactional
--
-- Purpose: Make promotion one atomic transaction (promote_scrape_run); add source_has_established_coverage.
-- Depends on: 042
-- Kind: function / RPC
-- Applied in production: YES (version 20260806130936, applied 2026-08-05/06 via Supabase MCP)
--
-- Extracted verbatim from supabase_migrations.schema_migrations: this is the
-- exact SQL that ran in production. Re-running it against production is NOT
-- required and is not idempotent where noted below.

-- ── ATOMIC PROMOTION ────────────────────────────────────────────────────
-- "Only promoteRun() writes" is not the same as atomic. The TypeScript
-- version issued several independent round-trips; a crash after the listings
-- upsert but before events/lifecycle would leave a half-promoted run —
-- published listings with no price history, or worse, lifecycle applied
-- against a partial universe.
--
-- Everything now happens inside ONE Postgres function = ONE transaction.
-- Any failure rolls the whole thing back. Re-promoting the same run_id is a
-- no-op, enforced by the promoted_at claim under FOR UPDATE.
--
-- p_fail_after_listings exists solely to prove rollback: it raises AFTER the
-- listings upsert, so a passing test must show listings unchanged.

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
  v_now           timestamptz := now();
  v_published     int := 0;
  v_first_seen    int := 0;
  v_price_changes int := 0;
  v_unchanged     int := 0;
  v_delisted      int := 0;
  v_reactivated   int := 0;
  v_missed        int := 0;
BEGIN
  -- 1. Claim the run. FOR UPDATE serialises concurrent promotion attempts.
  SELECT source, status, promoted_at
    INTO v_source, v_status, v_promoted_at
  FROM scrape_run WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'scrape_run % not found', p_run_id;
  END IF;

  -- 2. Only a passed run may publish; promotion is exactly-once.
  IF v_status <> 'passed' THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'status_not_passed', 'status', v_status);
  END IF;
  IF v_promoted_at IS NOT NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_promoted', 'promoted_at', v_promoted_at);
  END IF;

  -- 3. Price-history events BEFORE the listings upsert, so "previous price"
  --    still reflects the pre-run state.
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
  ),
  ins AS (
    INSERT INTO market_price_observations
      (kg_product_id, source, country, price_type, price_raw, currency,
       price_dkk, listing_url, listing_title, external_id, observed_at)
    SELECT NULL, source, COALESCE(country, 'DK'), 'asking', price,
           COALESCE(currency, 'DKK'), price_dkk, url, title, external_id, v_now
    FROM to_write
    ON CONFLICT DO NOTHING
    RETURNING (SELECT prev_price FROM to_write t WHERE t.external_id = market_price_observations.external_id) AS prev
  )
  SELECT count(*) FILTER (WHERE prev IS NULL), count(*) FILTER (WHERE prev IS NOT NULL)
    INTO v_first_seen, v_price_changes
  FROM ins;

  SELECT count(*) INTO v_unchanged
  FROM listing_staging st
  WHERE st.run_id = p_run_id AND st.external_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM market_price_observations o
      WHERE o.source = v_source AND o.external_id = st.external_id
        AND o.price_type = 'asking' AND o.price_dkk = st.price_dkk
        AND o.observed_at < v_now
    );

  -- 4. Publish listings. first_seen_at is preserved for rows we already knew.
  WITH staged AS (
    SELECT DISTINCT ON (external_id) *
    FROM listing_staging
    WHERE run_id = p_run_id AND external_id IS NOT NULL
    ORDER BY external_id, id DESC
  ),
  up AS (
    INSERT INTO listings
      (title, price, currency, price_dkk, url, image_url, location, source,
       country, normalized_text, platform, external_id, scraped_at,
       last_seen_at, first_seen_at, is_active, consecutive_misses, last_miss_run_id, delisted_at)
    SELECT title, price, currency, price_dkk, url, image_url, location, source,
           country, normalized_text, platform, external_id, v_now,
           v_now, v_now, true, 0, NULL, NULL
    FROM staged
    ON CONFLICT (external_id, source) DO UPDATE SET
      title            = EXCLUDED.title,
      price            = EXCLUDED.price,
      currency         = EXCLUDED.currency,
      price_dkk        = EXCLUDED.price_dkk,
      url              = EXCLUDED.url,
      image_url        = EXCLUDED.image_url,
      location         = EXCLUDED.location,
      country          = EXCLUDED.country,
      normalized_text  = EXCLUDED.normalized_text,
      scraped_at       = EXCLUDED.scraped_at,
      last_seen_at     = EXCLUDED.last_seen_at,
      -- keep the original first sighting; do not reset time-on-market
      first_seen_at    = COALESCE(listings.first_seen_at, EXCLUDED.first_seen_at),
      is_active        = true,
      consecutive_misses = 0,
      last_miss_run_id = NULL,
      delisted_at      = NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_published FROM up;

  -- 5. Rollback proof hook.
  IF p_fail_after_listings THEN
    RAISE EXCEPTION 'injected failure after listings upsert (rollback test)';
  END IF;

  -- 6. Lifecycle. Requires BOTH documented complete coverage AND an already
  --    established universe. On a source's first complete run we publish and
  --    record coverage but do NOT count misses — otherwise pre-existing rows
  --    that were never inside a documented coverage universe would start
  --    accruing misses immediately, and three identical coverage faults could
  --    still fabricate a mass delisting.
  IF p_coverage_complete AND p_lifecycle_enabled THEN
    WITH seen AS (
      SELECT DISTINCT external_id FROM listing_staging
      WHERE run_id = p_run_id AND external_id IS NOT NULL
    ),
    missing AS (
      SELECT l.id, COALESCE(l.consecutive_misses, 0) + 1 AS misses
      FROM listings l
      WHERE l.source = v_source
        AND l.is_active IS DISTINCT FROM false
        AND l.external_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM seen s WHERE s.external_id = l.external_id)
        -- at most one miss per unique run
        AND (l.last_miss_run_id IS DISTINCT FROM p_run_id)
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
      INTO v_missed, v_delisted
    FROM upd;
  END IF;

  -- 7. Seal the run.
  UPDATE scrape_run
     SET published_count = v_published,
         promoted_at     = v_now
   WHERE id = p_run_id;

  RETURN jsonb_build_object(
    'skipped', false,
    'published', v_published,
    'first_seen', v_first_seen,
    'price_changes', v_price_changes,
    'unchanged', v_unchanged,
    'missed', v_missed,
    'delisted', v_delisted,
    'reactivated', v_reactivated,
    'lifecycle_applied', (p_coverage_complete AND p_lifecycle_enabled)
  );
END $$;

COMMENT ON FUNCTION promote_scrape_run IS
  'Atomically promotes a passed scrape run from listing_staging into listings + market_price_observations + lifecycle. One transaction: any failure rolls back everything. Re-promotion of the same run_id is a no-op. Lifecycle requires both documented coverage AND an established universe (p_lifecycle_enabled) so a source''s first complete run cannot fabricate delistings.';

-- Has this source ever had a complete, passed, promoted run? Until it has,
-- lifecycle miss-counting stays off.
CREATE OR REPLACE FUNCTION source_has_established_coverage(p_source text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scrape_run
    WHERE source = p_source
      AND status = 'passed'
      AND coverage_complete = true
      AND promoted_at IS NOT NULL
  );
$$;
