-- 067_rollback.sql
--
-- Reverses 067_active_listing_counts_materialized.sql: the projection
-- aggregates `active_listing_count` on every read again (the 061 body, with
-- 062's security_invoker restated), the pg_cron job is unscheduled and the
-- matview is dropped. Nothing else is touched; no row is written.
--
-- ── FAIL CLOSED ───────────────────────────────────────────────────────────
--   PRE   the projection joins active_listing_counts_mv (067 applied): restore
--         the 061 body, drop the job and the matview, assert the body in the
--         same transaction.
--   POST  the projection does not reference the matview and the matview is
--         absent: an explicit successful no-op.
--   DRIFT the view references the matview but it is absent, or vice versa, or
--         the column list has moved: raise before any change.

BEGIN;

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
  v_actual text[];
  v_def    text;
  v_mv     boolean;
  v_joins  boolean;
BEGIN
  IF to_regclass('public.browse_product_projection') IS NULL THEN
    RAISE EXCEPTION '067_rollback ABORT: view browse_product_projection does not exist.';
  END IF;

  SELECT array_agg(column_name::text ORDER BY ordinal_position) INTO v_actual
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'browse_product_projection';
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION E'067_rollback ABORT: browse_product_projection has drifted from the 036/058 shape.\n'
      '  expected: %\n  actual:   %\n  Reconcile by hand.',
      array_to_string(v_expected, ', '), array_to_string(coalesce(v_actual, '{}'::text[]), ', ');
  END IF;

  v_def   := pg_get_viewdef('public.browse_product_projection'::regclass, true);
  v_mv    := to_regclass('public.active_listing_counts_mv') IS NOT NULL;
  v_joins := position('active_listing_counts_mv' in v_def) > 0;

  IF NOT v_mv AND NOT v_joins THEN
    RAISE NOTICE '067_rollback: state=POST — the projection aggregates on every read and no matview exists. No-op.';
    RETURN;
  END IF;
  IF v_mv <> v_joins THEN
    RAISE EXCEPTION E'067_rollback ABORT: drifted state. matview present: %; view joins it: %.\n'
      '  Expected both (PRE) or neither (POST). Reconcile by hand.', v_mv, v_joins;
  END IF;

  RAISE NOTICE '067_rollback: state=PRE — restoring the per-read aggregate.';
END $$;

-- ── The 061 body, security_invoker restated (062) ──────────────────────────
CREATE OR REPLACE VIEW public.browse_product_projection WITH (security_invoker = on) AS
WITH active_listing_counts AS (
  SELECT
    lpm.product_id,
    COUNT(*)::integer AS active_listing_count
  FROM public.listing_product_match lpm
  JOIN public.listings l
    ON l.id = lpm.listing_id
  WHERE l.is_active = true
    AND lpm.is_valid IS NOT FALSE
  GROUP BY lpm.product_id
)
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
LEFT JOIN active_listing_counts alc
  ON alc.product_id = p.id
LEFT JOIN LATERAL (
  SELECT COALESCE(
    NULLIF(btrim(COALESCE(p.hero_image_url, '')), ''),
    NULLIF(btrim(COALESCE(p.image_url, '')), '')
  ) AS url
) image_resolved ON true;

COMMENT ON VIEW public.browse_product_projection IS
  'Canonical browse projection (migration 036). image_url and has_image both read one resolved value: hero_image_url (curated) wins, image_url (ingested) is the fallback, blank counts as absent — migration 058, PAN-133. The same sentence in TypeScript is resolveProductImage() in frontend/lib/product-image-source.ts. active_listing_count and supply_state count active listings whose match is not rejected (is_valid IS NOT FALSE) — migration 061, PAN-197; the same rule as .not(''is_valid'', ''is'', false) on the product and family pages.';

-- ── The schedule and the matview ───────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh_active_listing_counts') THEN
    PERFORM cron.unschedule('refresh_active_listing_counts');
    RAISE NOTICE '067_rollback: pg_cron job refresh_active_listing_counts unscheduled.';
  END IF;
END $$;

DROP MATERIALIZED VIEW IF EXISTS public.active_listing_counts_mv;

-- ── Pre-commit assertions ──────────────────────────────────────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_viewdef('public.browse_product_projection'::regclass, true);
  IF position('active_listing_counts_mv' in v_def) > 0 THEN
    RAISE EXCEPTION '067_rollback ABORT: the projection still references the matview.';
  END IF;
  IF position('is_valid IS NOT FALSE' in v_def) = 0 OR position('listing_product_match' in v_def) = 0 THEN
    RAISE EXCEPTION '067_rollback ABORT: the restored body does not aggregate listing_product_match with is_valid IS NOT FALSE.';
  END IF;
  IF to_regclass('public.active_listing_counts_mv') IS NOT NULL THEN
    RAISE EXCEPTION '067_rollback ABORT: active_listing_counts_mv still exists.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
           LATERAL pg_options_to_table(c.reloptions) o
     WHERE n.nspname = 'public' AND c.relname = 'browse_product_projection'
       AND o.option_name = 'security_invoker' AND lower(o.option_value) IN ('on', 'true', 'yes', '1')
  ) THEN
    RAISE EXCEPTION '067_rollback ABORT: browse_product_projection lost security_invoker.';
  END IF;
  IF has_table_privilege('anon', 'public.browse_product_projection', 'SELECT')
     OR has_table_privilege('authenticated', 'public.browse_product_projection', 'SELECT') THEN
    RAISE EXCEPTION '067_rollback ABORT: anon/authenticated regained SELECT on browse_product_projection.';
  END IF;
  RAISE NOTICE '067_rollback: committed — active_listing_count is aggregated on every read again.';
END $$;

COMMIT;
