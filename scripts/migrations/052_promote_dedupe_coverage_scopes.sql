-- 052_promote_dedupe_coverage_scopes
--
-- Purpose: P0 — promote_scrape_run() aborted on any full run because the listing_coverage_scopes upsert fed duplicate conflict keys into one statement.
-- Depends on: 051 (current promote_scrape_run), 046 (listing_coverage_scopes)
-- Kind: function / RPC (bug fix)
-- Applied in production: YES (2026-08-11 via Supabase MCP apply_migration).
--
-- Idempotent: CREATE OR REPLACE FUNCTION. No DML, no schema change.

-- ── THE FAULT ───────────────────────────────────────────────────────────
-- Four consecutive nightly DBA runs (2026-08-07 .. 2026-08-10) passed the
-- quality gate and then failed promotion with:
--
--   ON CONFLICT DO UPDATE command cannot affect row a second time
--
-- The listing_coverage_scopes INSERT selected straight from listing_staging
-- with no de-duplication, while the two INSERTs above it both use
-- DISTINCT ON (external_id). listing_coverage_scopes is keyed
-- (listing_id, scope_hash), so a listing found by more than one product query
-- produces several source rows that all resolve to the SAME conflict key —
-- which Postgres refuses within a single statement.
--
-- This is normal, correct scraper output, not a data fault: on 2026-08-10,
-- 768 staged rows resolved to 709 distinct listings, and one guitar listing
-- was returned by the "Fender Stratocaster", "Fender Telecaster" AND
-- "Gibson Les Paul" searches at once.
--
-- Why it only surfaced now: targeted --product runs return no cross-query
-- duplicates (6 raw = 6 unique), and before baseline cohort scoping every full
-- run was quarantined on a false volume_swing and never reached promotion. The
-- defect has been latent since migration 046.
--
-- ── DE-DUPLICATION SEMANTICS ────────────────────────────────────────────
-- Measured against the real staged data (50 duplicate groups in run
-- 7cc98c83-0b76-4b2f-8b86-e48631cd7c97): title, price, price_dkk, currency,
-- url, image_url, location, country, source and normalized_text are
-- BYTE-IDENTICAL across duplicates. Exactly one column differs —
-- `source_query` — because the difference IS which query found the listing.
--
-- So the only value needing an aggregation rule is source_query, and the rule
-- is `min(source_query)`: a deterministic representative.
--
--   * Deterministic — the same input always yields the same row, so a re-run
--     cannot churn the value and the result is reproducible for auditing.
--     (`id DESC` would NOT be: `id` is a random uuid.)
--   * Lossless where it matters — this column is documented as "for
--     provenance and debugging" (migration 045). It is a LABEL, not the
--     authoritative provenance record.
--   * Query-specific provenance is preserved in the tables that model it:
--     `listing_staging` keeps every (query x listing) row for the run, and
--     `scrape_query_coverage` keeps per-query pagination and counts. Neither
--     is de-duplicated. Staging is deliberately NOT globally de-duplicated at
--     write time — several product queries must remain able to document that
--     they each found the same advert.
--   * Scope MEMBERSHIP is unaffected: it keys on (listing_id, scope_hash)
--     only, so lifecycle eligibility does not depend on which query is named.
--
-- The same determinism is applied to the two pre-existing DISTINCT ON blocks,
-- which ordered by `id DESC` — harmless for the columns they select (all
-- identical across duplicates) but arbitrary, and arbitrary ordering is
-- exactly what must not decide which row wins.
--
-- Everything else is identical to the 051 definition.

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

COMMENT ON FUNCTION promote_scrape_run IS
  'Atomic fail-closed promotion of a staged scrape run. Refuses: status <> passed, already promoted, missing cohort identity, staging_digest mismatch. Cross-query duplicates in staging are collapsed deterministically (one row per external_id for listings, one row per (listing_id, scope_hash) for coverage scopes, source_query aggregated with min()); staging itself is never de-duplicated. Lifecycle reconciliation additionally requires coverage_complete + lifecycle_enabled + run_has_lifecycle_coverage().';

COMMENT ON COLUMN listing_coverage_scopes.source_query IS
  'A DETERMINISTIC REPRESENTATIVE (min) of the queries in this scope that found the listing — a debugging label, not the complete set. Several product queries legitimately find the same advert; the full per-query record lives in listing_staging (per run) and scrape_query_coverage. Scope membership keys on (listing_id, scope_hash) only, so lifecycle never depends on this value.';
