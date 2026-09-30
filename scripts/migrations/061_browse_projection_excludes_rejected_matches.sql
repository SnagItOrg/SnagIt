-- 061_browse_projection_excludes_rejected_matches.sql
--
-- PAN-197. `browse_product_projection.active_listing_count` stops counting
-- matches a curator or the AI pass has REJECTED (`is_valid = false`).
--
-- ── WHAT IS WRONG TODAY ────────────────────────────────────────────────────
-- The count is "active listings matched to this product", and it counts every
-- `listing_product_match` row, including the ones adjudicated as a part, an
-- accessory or the wrong product. Public cards print it as "N til salg". The
-- product page and the family page never render a rejected match:
--
--     frontend/app/api/product/[slug]/route.ts     .not('is_valid', 'is', false)
--     frontend/app/(shell)/family/[slug]/page.tsx  .not('is_valid', 'is', false)
--
-- So the card promises a number its own destination cannot show. Measured
-- read-only on production 2026-09-30, over the 80 products that render a
-- public card:
--
--     43 of 80 cards overstate;  3,675 advertised  ->  2,121 renderable
--     gibson-j-45          374 -> 126      gibson-hummingbird   255 ->  47
--     gibson-les-paul-custom 177 -> 22     gibson-les-paul-special 153 -> 39
--     yamaha-dx7           158 ->  56      roland-juno-106      146 ->  86
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
-- ONE predicate is added to the `active_listing_counts` CTE:
--
--     AND lpm.is_valid IS NOT FALSE
--
-- That is the SQL spelling of the product and family pages'
-- `.not('is_valid', 'is', false)`: it keeps NULL (an unreviewed automatic
-- match, which those pages render) and TRUE, and drops only the explicit
-- rejection. It is deliberately NOT `is_valid = true` — that is the
-- statistics contract (`isPriceEvidence()`), not the wall, and a card counts
-- what the wall shows.
--
-- `supply_state` reads the same CTE, so it follows automatically. Measured:
-- no public product flips from `live` to `no_live_listings`; 75 non-public
-- rows (none supported, none `browse_visibility = public`) do.
--
-- Everything else is migration 058's definition, which is production's
-- definition as read with pg_get_viewdef on 2026-09-30, reproduced verbatim —
-- including the PAN-133 image LATERAL. A view cannot be redefined in part, so
-- that LATERAL is necessarily restated here; the precedence it encodes is
-- unchanged and its TypeScript twin is still `resolveProductImage()`.
--
-- ── WHAT IT DOES *NOT* DO ──────────────────────────────────────────────────
-- NO DML. No `is_valid` is written, no match is deleted: rejections are
-- evidence, and the view simply stops counting them.
-- It does NOT de-duplicate across products (PAN-98's second half). Per product
-- the count is already distinct, because `(listing_id, product_id)` is unique
-- (migration 049); a listing matched to two products still counts once on each.
-- It does NOT gate `is_public` on `support_state` (PAN-98 defect 1). That
-- removes rows from the projection and needs its own owner decision.
-- Creates no table, so the `public` default-privilege hazard in
-- scripts/CLAUDE.md P0 does not arise.
--
-- ── CREATE OR REPLACE, NEVER DROP + CREATE ─────────────────────────────────
-- `CREATE OR REPLACE VIEW` keeps the view's oid and therefore its GRANTs;
-- DROP + CREATE would strip the anon/authenticated SELECT PostgREST needs and
-- blank /browse. It requires the same 27 output columns in the same order with
-- the same types, which the guard asserts BEFORE mutating. The ACL is captured
-- before and compared after.
--
-- PRE / POST / DRIFT: PRE applies, POST is an explicit successful no-op,
-- DRIFT raises before any mutation. Idempotent and re-runnable.
-- Requires 038 (`is_valid`) and 058 (the image LATERAL) to be applied.
-- Rollback: 061_rollback.sql (restores the 058 definition exactly).

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
    RAISE EXCEPTION '061 ABORT: view browse_product_projection does not exist. Apply migrations 036 and 058 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'listing_product_match'
       AND column_name = 'is_valid' AND data_type = 'boolean'
  ) THEN
    RAISE EXCEPTION '061 ABORT: listing_product_match.is_valid (boolean) does not exist. Apply migration 038 first.';
  END IF;

  SELECT array_agg(column_name::text ORDER BY ordinal_position) INTO v_actual
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'browse_product_projection';

  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION E'061 ABORT: browse_product_projection has drifted from the 036/058 shape.\n'
      '  expected: %\n  actual:   %\n  Reconcile by hand; CREATE OR REPLACE VIEW would fail mid-migration.',
      array_to_string(v_expected, ', '), array_to_string(coalesce(v_actual, '{}'::text[]), ', ');
  END IF;

  v_def := pg_get_viewdef('public.browse_product_projection'::regclass, true);

  -- This file restates 058's image LATERAL. On a database where 058 is not
  -- applied, running it would silently apply 058 as well. Refuse instead.
  IF position('hero_image_url' in v_def) = 0 THEN
    RAISE EXCEPTION '061 ABORT: the projection does not resolve hero_image_url, so migration 058 is not applied. Apply 058 first.';
  END IF;

  IF position('is_valid IS NOT FALSE' in v_def) > 0 THEN
    RAISE NOTICE '061: state=POST — active_listing_count already excludes rejected matches. No-op.';
  ELSIF position('is_valid' in v_def) > 0 THEN
    RAISE EXCEPTION E'061 ABORT: the projection already references is_valid, but not as "is_valid IS NOT FALSE".\n'
      '  Someone has hand-edited the count. Reconcile by hand.';
  ELSE
    RAISE NOTICE '061: state=PRE — applying; active_listing_count counts rejected matches.';
  END IF;

  -- Captured for the post-commit ACL comparison below. Transaction-local.
  PERFORM set_config(
    'klup.m061_acl',
    coalesce((SELECT relacl::text FROM pg_class WHERE oid = 'public.browse_product_projection'::regclass), '<null>'),
    true
  );
END $$;

-- ── The projection: 058's definition, plus one predicate ────────────────────
CREATE OR REPLACE VIEW browse_product_projection AS
WITH active_listing_counts AS (
  SELECT
    lpm.product_id,
    COUNT(*)::integer AS active_listing_count
  FROM listing_product_match lpm
  JOIN listings l
    ON l.id = lpm.listing_id
  WHERE l.is_active = true
    -- PAN-197: a rejected match is not "til salg". Same rule as the product
    -- and family pages' `.not('is_valid', 'is', false)`: NULL and TRUE stay.
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
-- Unchanged from 058. Its twin is `resolveProductImage()` in
-- frontend/lib/product-image-source.ts.
LEFT JOIN LATERAL (
  SELECT COALESCE(
    NULLIF(btrim(COALESCE(p.hero_image_url, '')), ''),
    NULLIF(btrim(COALESCE(p.image_url, '')), '')
  ) AS url
) image_resolved ON true;

COMMENT ON VIEW browse_product_projection IS
  'Canonical browse projection (migration 036). image_url and has_image both read one resolved value: hero_image_url (curated) wins, image_url (ingested) is the fallback, blank counts as absent — migration 058, PAN-133. The same sentence in TypeScript is resolveProductImage() in frontend/lib/product-image-source.ts. active_listing_count and supply_state count active listings whose match is not rejected (is_valid IS NOT FALSE) — migration 061, PAN-197; the same rule as .not(''is_valid'', ''is'', false) on the product and family pages.';

-- ── Pre-commit assertions ──────────────────────────────────────────────────
DO $$
DECLARE
  v_def  text;
  v_cols text[];
  v_acl  text;
BEGIN
  v_def := pg_get_viewdef('public.browse_product_projection'::regclass, true);

  IF position('is_valid IS NOT FALSE' in v_def) = 0 THEN
    RAISE EXCEPTION '061 ABORT: the replacement does not filter is_valid IS NOT FALSE.';
  END IF;

  IF position('hero_image_url' in v_def) = 0 THEN
    RAISE EXCEPTION '061 ABORT: the replacement lost the 058 image precedence.';
  END IF;

  -- The shape must be untouched, or every consumer of the view breaks.
  SELECT array_agg(column_name::text || ':' || data_type ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'browse_product_projection';
  IF array_length(v_cols, 1) <> 27 THEN
    RAISE EXCEPTION '061 ABORT: the projection now has % columns, expected 27.', array_length(v_cols, 1);
  END IF;
  IF v_cols[23] <> 'active_listing_count:integer' OR v_cols[26] <> 'supply_state:text' THEN
    RAISE EXCEPTION '061 ABORT: active_listing_count/supply_state moved or changed type: %, %.', v_cols[23], v_cols[26];
  END IF;

  -- GRANTs must survive the replacement, byte for byte.
  SELECT coalesce(relacl::text, '<null>') INTO v_acl
    FROM pg_class WHERE oid = 'public.browse_product_projection'::regclass;
  IF v_acl IS DISTINCT FROM current_setting('klup.m061_acl', true) THEN
    RAISE EXCEPTION '061 ABORT: the view ACL changed: % -> %.', current_setting('klup.m061_acl', true), v_acl;
  END IF;

  RAISE NOTICE '061: committed — active_listing_count excludes rejected matches. No rows were written.';
END $$;

COMMIT;
