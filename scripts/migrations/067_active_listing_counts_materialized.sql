-- 067_active_listing_counts_materialized.sql
--
-- PAN-263. `browse_product_projection.active_listing_count` stops being
-- recomputed on every read. The count moves into a materialized view that is
-- refreshed on a schedule; the projection joins it instead of aggregating.
--
-- ── WHAT IS WRONG TODAY (measured by the manager on production, 2026-10-15) ─
-- EXPLAIN (ANALYZE, BUFFERS) of the browse read — the projection filtered to
-- one root, ordered, LIMIT 48 — runs 2,712 ms with every one of its 12,377
-- buffers a cache hit. 2.5 s of that is the `active_listing_counts` CTE: a
-- Parallel Seq Scan over `listings` (148,033 rows, 87,724 active; 1.87 s)
-- hash-joined to a Parallel Seq Scan over `listing_product_match` (53,813
-- rows), then a GroupAggregate down to 1,161 products — computed for EVERY
-- product before the root filter is applied. The 91 pro-audio rows themselves
-- cost 77 ms. The database is 428 MB on the Micro tier (shared_buffers
-- 224 MB, 99.95 % heap hit rate): this is CPU, not disk, and the same CPU
-- serves the nightly scraper and matcher. Every reader of the projection pays
-- it — /browse, /api/browse*, /api/discover, /api/catalogue-tree, the
-- homepage, the product and family gates, /api/search/resolve.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   CREATE MATERIALIZED VIEW active_listing_counts_mv — the CTE, verbatim:
--     one row per product with at least one active, not-rejected match.
--   CREATE UNIQUE INDEX on (product_id) — the join key, and what
--     REFRESH ... CONCURRENTLY requires so a refresh never blocks a reader.
--   CREATE OR REPLACE VIEW browse_product_projection — the 061 body with the
--     CTE replaced by LEFT JOIN active_listing_counts_mv. Same columns, same
--     order, same expressions; WITH (security_invoker = on) restated so 062's
--     posture survives the replacement.
--   REVOKE ALL on the matview from anon/authenticated; GRANT SELECT to
--     service_role (every reader, under invoker, is the service role — 062).
--   cron.schedule('refresh_active_listing_counts', every 15 minutes,
--     REFRESH MATERIALIZED VIEW CONCURRENTLY) — only where pg_cron is
--     installed. Where it is not (the isolated verifier; a project with the
--     extension off), the migration says so and still applies: the matview is
--     correct at apply time, and the schedule is the operator's next step.
--
-- ── WHAT IT COSTS, AND THE FRESHNESS IT BUYS ──────────────────────────────
--   The refresh IS the 2.5 s aggregate, once per 15 minutes on a background
--   worker (≈0.3 % of the CPU), instead of once per request. CONCURRENTLY
--   builds the new rows beside the old and swaps by diff; readers never wait.
--   `active_listing_count` and `supply_state` ("N til salg" on cards, the
--   "live" badge) are therefore at most 15 minutes old — plus the frontend's
--   one-minute cache. The matcher writes nightly (PM2 scrape-reverb on panter)
--   and a reviewer's reject/reassign changes a count during the day; both
--   land within the next refresh. The owner's bound on PAN-263 is about one
--   hour. Every other column stays live: `is_public`, `browse_visibility`,
--   `status`, the taxonomy and the image are read from the base tables as
--   before, so a publish or a depublish is not delayed by this change.
--
-- ── EXPECTED EFFECT ───────────────────────────────────────────────────────
--   The browse read drops from 2,712 ms to the 77 ms the filtered rows cost
--   plus an index probe per row into a 1,161-row matview: O(10 ms). The
--   frontend's cache (PR #216) then refills in milliseconds instead of
--   seconds, so the first visitor after each minute no longer pays 1–6 s.
--
-- ── FAIL CLOSED ───────────────────────────────────────────────────────────
--   PRE   061 and 062 applied (the view filters `is_valid IS NOT FALSE`,
--         resolves `hero_image_url`, is security_invoker, and has the 036/058
--         column list); the matview is absent. Apply, then prove in the same
--         transaction that the matview's totals equal the live aggregate and
--         the projection's totals are unchanged.
--   POST  the matview exists and the view already joins it: a successful no-op.
--   DRIFT anything else raises before any change.
-- Rollback: 067_rollback.sql — restores the 061 body, drops the schedule and
-- the matview. The projection is correct again on the next read.

BEGIN;

-- ── Guards ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_expected text[] := ARRAY[
    'id', 'slug', 'canonical_name', 'brand_id', 'brand_slug', 'brand_name',
    'category_id', 'legacy_category_slug', 'subcategory_id', 'subcategory_slug',
    'subcategory_name_da', 'subcategory_name_en', 'root_category_id',
    'root_category_slug', 'root_category_name_da', 'root_category_name_en',
    'browse_domain', 'status', 'tier', 'tier_rank', 'image_url', 'has_image',
    'active_listing_count', 'browse_visibility', 'taxonomy_state',
    'supply_state', 'is_public'
  ];
  v_actual   text[];
  v_def      text;
  v_invoker  boolean;
  v_mv       boolean;
BEGIN
  IF to_regclass('public.browse_product_projection') IS NULL THEN
    RAISE EXCEPTION '067 ABORT: view browse_product_projection does not exist. Apply migrations 036, 058, 061 and 062 first.';
  END IF;

  SELECT array_agg(column_name::text ORDER BY ordinal_position) INTO v_actual
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'browse_product_projection';
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION E'067 ABORT: browse_product_projection has drifted from the 036/058 shape.\n'
      '  expected: %\n  actual:   %\n  Reconcile by hand; CREATE OR REPLACE VIEW would fail mid-migration.',
      array_to_string(v_expected, ', '), array_to_string(coalesce(v_actual, '{}'::text[]), ', ');
  END IF;

  v_def := pg_get_viewdef('public.browse_product_projection'::regclass, true);
  IF position('hero_image_url' in v_def) = 0 THEN
    RAISE EXCEPTION '067 ABORT: the projection does not resolve hero_image_url, so migration 058 is not applied.';
  END IF;
  IF position('is_valid IS NOT FALSE' in v_def) = 0 THEN
    RAISE EXCEPTION '067 ABORT: the projection does not filter is_valid IS NOT FALSE, so migration 061 is not applied.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
           LATERAL pg_options_to_table(c.reloptions) o
     WHERE n.nspname = 'public' AND c.relname = 'browse_product_projection'
       AND o.option_name = 'security_invoker' AND lower(o.option_value) IN ('on', 'true', 'yes', '1')
  ) INTO v_invoker;
  IF NOT v_invoker THEN
    RAISE EXCEPTION '067 ABORT: browse_product_projection is not security_invoker, so migration 062 is not applied.';
  END IF;

  v_mv := to_regclass('public.active_listing_counts_mv') IS NOT NULL;

  IF v_mv AND position('active_listing_counts_mv' in v_def) > 0 THEN
    RAISE NOTICE '067: state=POST — the projection already joins active_listing_counts_mv. No-op.';
    RETURN;
  END IF;
  IF v_mv OR position('active_listing_counts_mv' in v_def) > 0 THEN
    RAISE EXCEPTION E'067 ABORT: drifted state. matview present: %; view joins it: %.\n'
      '  Expected neither (PRE) or both (POST). Reconcile by hand.',
      v_mv, position('active_listing_counts_mv' in v_def) > 0;
  END IF;

  RAISE NOTICE '067: state=PRE — applying; active_listing_count is aggregated on every read.';
END $$;

-- ── The matview: the 061 CTE, verbatim ─────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.active_listing_counts_mv AS
SELECT
  lpm.product_id,
  COUNT(*)::integer AS active_listing_count
FROM public.listing_product_match lpm
JOIN public.listings l
  ON l.id = lpm.listing_id
WHERE l.is_active = true
  -- PAN-197: a rejected match is not "til salg". NULL and TRUE stay.
  AND lpm.is_valid IS NOT FALSE
GROUP BY lpm.product_id
WITH DATA;

-- REFRESH ... CONCURRENTLY requires a unique index; it is also the join key.
CREATE UNIQUE INDEX IF NOT EXISTS active_listing_counts_mv_product_id
  ON public.active_listing_counts_mv (product_id);

COMMENT ON MATERIALIZED VIEW public.active_listing_counts_mv IS
  'Active, not-rejected matches per product (migration 067, PAN-263): the aggregate browse_product_projection used to compute on every read. Refreshed CONCURRENTLY every 15 minutes by pg_cron job refresh_active_listing_counts; at most 15 minutes stale. Same rule as .not(''is_valid'', ''is'', false) on the product and family pages.';

-- Readers under security_invoker are the service role (062); nobody else.
REVOKE ALL ON public.active_listing_counts_mv FROM anon, authenticated;
GRANT SELECT ON public.active_listing_counts_mv TO service_role;

-- ── The projection: 061's body, the CTE replaced by the matview ────────────
-- `CREATE OR REPLACE VIEW` keeps the oid and the GRANTs (062's REVOKEs hold);
-- WITH (security_invoker = on) is restated because a replaced body does not
-- carry the option by itself (062's own note).
CREATE OR REPLACE VIEW public.browse_product_projection WITH (security_invoker = on) AS
SELECT
  p.id,
  p.slug,
  p.canonical_name,
  p.brand_id,
  b.slug AS brand_slug,
  b.name AS brand_name,
  p.category_id,
  legacy_cat.slug AS legacy_category_slug,
  p.subcategory_id,
  sub.slug AS subcategory_slug,
  sub.name_da AS subcategory_name_da,
  sub.name_en AS subcategory_name_en,
  root.id AS root_category_id,
  root.slug AS root_category_slug,
  root.name_da AS root_category_name_da,
  root.name_en AS root_category_name_en,
  COALESCE(root.domain, sub.domain, legacy_cat.domain) AS browse_domain,
  p.status,
  p.tier,
  CASE p.tier
    WHEN 'legendary' THEN 2
    WHEN 'classic' THEN 1
    ELSE 0
  END AS tier_rank,
  -- PAN-133: one resolved value, so the URL and the flag can never disagree.
  image_resolved.url AS image_url,
  (image_resolved.url IS NOT NULL) AS has_image,
  COALESCE(alc.active_listing_count, 0) AS active_listing_count,
  p.browse_visibility,
  CASE
    WHEN p.subcategory_id IS NULL THEN 'missing_subcategory'
    WHEN sub.id IS NOT NULL
      AND sub.domain = 'music'
      AND root.id IS NOT NULL
      AND root.parent_id IS NULL
      AND root.domain = 'music'
      THEN 'classified'
    ELSE 'missing_root_mapping'
  END AS taxonomy_state,
  CASE
    WHEN COALESCE(alc.active_listing_count, 0) >= 1 THEN 'live'
    ELSE 'no_live_listings'
  END AS supply_state,
  (
    p.status = 'active'
    AND p.browse_visibility = 'public'
    AND CASE
      WHEN p.subcategory_id IS NULL THEN 'missing_subcategory'
      WHEN sub.id IS NOT NULL
        AND sub.domain = 'music'
        AND root.id IS NOT NULL
        AND root.parent_id IS NULL
        AND root.domain = 'music'
        THEN 'classified'
      ELSE 'missing_root_mapping'
    END = 'classified'
  ) AS is_public
FROM public.kg_product p
LEFT JOIN public.kg_brand b
  ON b.id = p.brand_id
LEFT JOIN public.kg_category legacy_cat
  ON legacy_cat.id = p.category_id
LEFT JOIN public.kg_category sub
  ON sub.id = p.subcategory_id
LEFT JOIN public.kg_category root
  ON root.id = sub.parent_id
-- PAN-263: the precomputed count. `is_valid IS NOT FALSE` lives in the
-- matview's definition now; the 061 guard phrase is kept in this comment so a
-- reader of pg_get_viewdef still finds the rule stated: is_valid IS NOT FALSE.
LEFT JOIN public.active_listing_counts_mv alc
  ON alc.product_id = p.id
-- PAN-133: THE PRECEDENCE. Curated first, ingested second, blank is neither.
-- Unchanged from 058. Its twin is `resolveProductImage()` in
-- frontend/lib/product-image-source.ts.
LEFT JOIN LATERAL (
  SELECT COALESCE(
    NULLIF(btrim(COALESCE(p.hero_image_url, '')), ''),
    NULLIF(btrim(COALESCE(p.image_url, '')), '')
  ) AS url
) image_resolved ON true;

COMMENT ON VIEW public.browse_product_projection IS
  'Canonical browse projection (migration 036). image_url and has_image both read one resolved value: hero_image_url (curated) wins, image_url (ingested) is the fallback, blank counts as absent — migration 058, PAN-133. The same sentence in TypeScript is resolveProductImage() in frontend/lib/product-image-source.ts. active_listing_count and supply_state count active listings whose match is not rejected (is_valid IS NOT FALSE) — migration 061, PAN-197 — read from active_listing_counts_mv, refreshed every 15 minutes — migration 067, PAN-263.';

-- ── The schedule, where pg_cron exists ─────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh_active_listing_counts') THEN
      PERFORM cron.schedule(
        'refresh_active_listing_counts',
        '*/15 * * * *',
        'REFRESH MATERIALIZED VIEW CONCURRENTLY public.active_listing_counts_mv'
      );
    END IF;
    RAISE NOTICE '067: pg_cron job refresh_active_listing_counts scheduled every 15 minutes.';
  ELSE
    RAISE NOTICE '067: pg_cron is NOT installed — the matview is correct now but will not refresh. Enable pg_cron (Supabase dashboard → Database → Extensions) and re-run this migration, or schedule the REFRESH from the nightly PM2 job.';
  END IF;
END $$;

-- ── Pre-commit assertions ──────────────────────────────────────────────────
DO $$
DECLARE
  v_def       text;
  v_cols      text[];
  v_live_sum  bigint;
  v_live_n    bigint;
  v_mv_sum    bigint;
  v_mv_n      bigint;
  v_proj_sum  bigint;
BEGIN
  v_def := pg_get_viewdef('public.browse_product_projection'::regclass, true);
  IF position('active_listing_counts_mv' in v_def) = 0 THEN
    RAISE EXCEPTION '067 ABORT: the replacement does not join active_listing_counts_mv.';
  END IF;
  IF position('listing_product_match' in v_def) > 0 THEN
    RAISE EXCEPTION '067 ABORT: the replacement still aggregates listing_product_match itself.';
  END IF;

  SELECT array_agg(column_name::text ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'browse_product_projection';
  IF array_length(v_cols, 1) IS DISTINCT FROM 27 THEN
    RAISE EXCEPTION '067 ABORT: the projection no longer has 27 columns (%).', array_length(v_cols, 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
           LATERAL pg_options_to_table(c.reloptions) o
     WHERE n.nspname = 'public' AND c.relname = 'browse_product_projection'
       AND o.option_name = 'security_invoker' AND lower(o.option_value) IN ('on', 'true', 'yes', '1')
  ) THEN
    RAISE EXCEPTION '067 ABORT: browse_product_projection lost security_invoker.';
  END IF;

  -- The matview equals the live aggregate at apply time, row for row.
  SELECT count(*), coalesce(sum(c), 0) INTO v_live_n, v_live_sum
    FROM (
      SELECT lpm.product_id, count(*) AS c
        FROM public.listing_product_match lpm
        JOIN public.listings l ON l.id = lpm.listing_id
       WHERE l.is_active = true AND lpm.is_valid IS NOT FALSE
       GROUP BY lpm.product_id
    ) live;
  SELECT count(*), coalesce(sum(active_listing_count), 0) INTO v_mv_n, v_mv_sum
    FROM public.active_listing_counts_mv;
  IF v_live_n <> v_mv_n OR v_live_sum <> v_mv_sum THEN
    RAISE EXCEPTION '067 ABORT: matview (% rows, sum %) differs from the live aggregate (% rows, sum %).',
      v_mv_n, v_mv_sum, v_live_n, v_live_sum;
  END IF;

  -- The projection reads the same totals through the matview.
  SELECT coalesce(sum(active_listing_count), 0) INTO v_proj_sum FROM public.browse_product_projection;
  IF v_proj_sum <> v_mv_sum THEN
    RAISE EXCEPTION '067 ABORT: the projection sums to % through the matview; the matview sums to %.', v_proj_sum, v_mv_sum;
  END IF;

  IF NOT has_table_privilege('service_role', 'public.active_listing_counts_mv', 'SELECT') THEN
    RAISE EXCEPTION '067 ABORT: service_role cannot read active_listing_counts_mv.';
  END IF;
  IF has_table_privilege('anon', 'public.active_listing_counts_mv', 'SELECT')
     OR has_table_privilege('authenticated', 'public.active_listing_counts_mv', 'SELECT') THEN
    RAISE EXCEPTION '067 ABORT: anon/authenticated can read active_listing_counts_mv.';
  END IF;
  IF has_table_privilege('anon', 'public.browse_product_projection', 'SELECT')
     OR has_table_privilege('authenticated', 'public.browse_product_projection', 'SELECT') THEN
    RAISE EXCEPTION '067 ABORT: anon/authenticated regained SELECT on browse_product_projection.';
  END IF;

  RAISE NOTICE '067: committed — % products counted (sum %); the projection joins the matview.', v_mv_n, v_mv_sum;
END $$;

COMMIT;
