-- 058_browse_projection_resolves_curated_image.sql
--
-- PAN-133. `browse_product_projection` learns the precedence the product page
-- has always used: THE CURATED IMAGE WINS, THE INGESTED ONE IS THE FALLBACK.
--
-- ── WHAT IS WRONG TODAY ────────────────────────────────────────────────────
-- `kg_product` carries two image columns that mean different things:
--
--     hero_image_url   CURATED  — an operator chose it via /admin/image
--     image_url        INGESTED — a Reverb CSP pull or a storage upload
--
-- The product page renders `hero_image_url ?? image_url`. The projection
-- defined by migration 036 selects `p.image_url` alone (line 66) and derives
-- `has_image` from that same column alone (line 67). So `/browse`, `/search`,
-- the homepage shelves and every product card read a column the curation flow
-- never writes.
--
-- Measured on production 2026-09-23, over the 50 public products:
--     16 carry a hero_image_url — ALL 16 are wrong on every card
--     13 of those have NO image_url  -> the card renders nothing,
--                                       and has_image is FALSE for a row
--                                       that demonstrably has an image
--      3 of those have a DIFFERENT image_url -> the card renders the stale one
--     14 of the 16 carry attributes.image_provenance (curated through admin)
--
-- PAN-110 was the same defect pointing the other way: a TR-909 re-pull wrote
-- `image_url` while the page read `hero_image_url`. Two columns encoding one
-- concept, with each surface holding its own opinion about precedence, will
-- keep producing this in both directions.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
-- Redefines the view so `image_url` and `has_image` both read one resolved
-- value, computed once in an `image_resolved` LATERAL. Everything else in the
-- 036 definition is reproduced verbatim.
--
-- The precedence now exists in exactly two places, saying the same sentence:
--     SQL        this file's `image_resolved` LATERAL
--     TypeScript frontend/lib/product-image-source.ts  (resolveProductImage)
-- `scripts/lib/product-image-authority.test.ts` fails closed if a third
-- appears.
--
-- Blank is not a value. `NULLIF(btrim(...), '')` is applied to BOTH columns,
-- so a cleared admin field or a whitespace-polluted import falls through to
-- the other column instead of resolving to an empty string. Migration 036
-- already did this for `image_url` inside `has_image`; it is now the rule for
-- both columns and for the returned URL as well.
--
-- ── WHAT THIS MIGRATION DOES *NOT* DO ──────────────────────────────────────
-- NO DML. No backfill, no UPDATE, no INSERT, no data write of any kind. That
-- is the entire point of resolving at read time: the 16 `hero_image_url`
-- values are already in the table and become visible the moment the view
-- changes. Nothing is re-curated and nothing is copied between columns.
--
-- NEITHER COLUMN IS RETIRED. They mean different things, and PAN-42's
-- provenance work is what will make that distinction legible. Collapsing them
-- now would destroy information before there is anywhere to record it. What
-- stops existing is each surface having an opinion, not the columns.
--
-- Creates no table, so the `public` default-privilege hazard in
-- scripts/CLAUDE.md P0 does not arise.
--
-- ── CREATE OR REPLACE, NEVER DROP + CREATE ─────────────────────────────────
-- `CREATE OR REPLACE VIEW` preserves the object's oid and therefore its GRANTs.
-- Dropping and recreating would silently strip the anon/authenticated SELECT
-- that PostgREST needs and blank /browse for every visitor. It also means the
-- replacement must keep the same 27 output columns, in the same order, with
-- the same types — which the drift guard below asserts BEFORE mutating.
--
-- PRE / POST / DRIFT: PRE applies, POST is an explicit successful no-op,
-- DRIFT raises before any mutation. Idempotent and re-runnable.
-- Rollback: 058_rollback.sql (restores the 036 definition exactly).

BEGIN;

-- ── Guard: PRE / POST / DRIFT, before anything is mutated ───────────────────
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
BEGIN
  IF to_regclass('public.browse_product_projection') IS NULL THEN
    RAISE EXCEPTION '058 ABORT: view browse_product_projection does not exist. Apply migration 036 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'kg_product' AND column_name = 'hero_image_url'
  ) THEN
    RAISE EXCEPTION '058 ABORT: kg_product.hero_image_url does not exist. Apply migration 028 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'kg_product' AND column_name = 'image_url'
  ) THEN
    RAISE EXCEPTION '058 ABORT: kg_product.image_url does not exist. Apply migration 025 first.';
  END IF;

  -- The replacement keeps the shape; if the shape has already drifted,
  -- CREATE OR REPLACE VIEW would fail mid-migration. Refuse first instead.
  SELECT array_agg(column_name::text ORDER BY ordinal_position) INTO v_actual
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'browse_product_projection';

  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION E'058 ABORT: browse_product_projection has drifted from the 036 shape.\n'
      '  expected: %\n  actual:   %\n'
      '  CREATE OR REPLACE VIEW cannot change the column list. Reconcile by hand.',
      array_to_string(v_expected, ', '), array_to_string(coalesce(v_actual, '{}'::text[]), ', ');
  END IF;

  v_def := pg_get_viewdef('public.browse_product_projection'::regclass, true);

  IF position('hero_image_url' in v_def) > 0 THEN
    RAISE NOTICE '058: state=POST — the projection already resolves the curated image. No-op.';
  ELSE
    RAISE NOTICE '058: state=PRE — applying; the projection reads image_url alone.';
  END IF;
END $$;

-- ── The projection, with the precedence resolved exactly once ───────────────
-- Reproduced from scripts/migrations/036_browse_visibility_projection.sql.
-- Two lines differ (036's `p.image_url` and its `has_image` expression) plus
-- the `image_resolved` LATERAL they now both read.
CREATE OR REPLACE VIEW browse_product_projection AS
WITH active_listing_counts AS (
  SELECT
    lpm.product_id,
    COUNT(*)::integer AS active_listing_count
  FROM listing_product_match lpm
  JOIN listings l
    ON l.id = lpm.listing_id
  WHERE l.is_active = true
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
FROM kg_product p
LEFT JOIN kg_brand b
  ON b.id = p.brand_id
LEFT JOIN kg_category legacy_cat
  ON legacy_cat.id = p.category_id
LEFT JOIN kg_category sub
  ON sub.id = p.subcategory_id
LEFT JOIN kg_category root
  ON root.id = sub.parent_id
LEFT JOIN active_listing_counts alc
  ON alc.product_id = p.id
-- PAN-133: THE PRECEDENCE. Curated first, ingested second, blank is neither.
-- It is written here once and read twice above, so `image_url` and `has_image`
-- are structurally incapable of disagreeing. Its twin is
-- `resolveProductImage()` in frontend/lib/product-image-source.ts.
LEFT JOIN LATERAL (
  SELECT COALESCE(
    NULLIF(btrim(COALESCE(p.hero_image_url, '')), ''),
    NULLIF(btrim(COALESCE(p.image_url, '')), '')
  ) AS url
) image_resolved ON true;

COMMENT ON VIEW browse_product_projection IS
  'Canonical browse projection (migration 036). image_url and has_image both read one resolved value: hero_image_url (curated) wins, image_url (ingested) is the fallback, blank counts as absent — migration 058, PAN-133. The same sentence in TypeScript is resolveProductImage() in frontend/lib/product-image-source.ts.';

-- ── Pre-commit assertions ──────────────────────────────────────────────────
DO $$
DECLARE
  v_def  text;
  v_cols int;
BEGIN
  v_def := pg_get_viewdef('public.browse_product_projection'::regclass, true);

  IF position('hero_image_url' in v_def) = 0 THEN
    RAISE EXCEPTION '058 ABORT: the replacement does not reference hero_image_url.';
  END IF;

  -- The shape must be untouched, or every consumer of the view breaks.
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'browse_product_projection';
  IF v_cols <> 27 THEN
    RAISE EXCEPTION '058 ABORT: the projection now has % columns, expected 27.', v_cols;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'browse_product_projection'
       AND column_name = 'has_image' AND data_type = 'boolean'
  ) THEN
    RAISE EXCEPTION '058 ABORT: has_image is missing or is no longer boolean.';
  END IF;

  RAISE NOTICE '058: committed — browse_product_projection resolves the curated image. No rows were written.';
END $$;

COMMIT;
