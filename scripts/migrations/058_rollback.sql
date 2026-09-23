-- 058_rollback.sql
--
-- Reverses 058_browse_projection_resolves_curated_image.sql by restoring the
-- projection definition from migration 036 verbatim.
--
-- ── THIS ROLLBACK DOES NOT REFUSE ──────────────────────────────────────────
-- Unlike 055_rollback and 057_rollback, there is no evidence to destroy and no
-- security posture to undo here. Migration 058 wrote no rows, so its reversal
-- writes none either: it swaps one read-time expression for another. The cost
-- of running it is that 16 public products go back to showing nothing or a
-- stale picture on every card — a visible regression, not a dangerous one.
--
-- It is therefore safe to run, and safe to run twice.
--
-- ── WHAT IT RESTORES ───────────────────────────────────────────────────────
--     image_url  ->  p.image_url
--     has_image  ->  (NULLIF(btrim(COALESCE(p.image_url, '')), '') IS NOT NULL)
-- and drops the `image_resolved` LATERAL. Every other part of the definition
-- is unchanged, because 058 did not change it either.
--
-- CREATE OR REPLACE, never DROP + CREATE: the view's GRANTs must survive, or
-- PostgREST loses the anon/authenticated SELECT that /browse depends on.
--
-- PRE / POST / DRIFT: PRE (058 applied) reverts, POST (already reverted) is an
-- explicit successful no-op, DRIFT raises before any mutation.

BEGIN;

DO $$
DECLARE
  v_def text;
BEGIN
  IF to_regclass('public.browse_product_projection') IS NULL THEN
    RAISE EXCEPTION '058_rollback ABORT: view browse_product_projection does not exist. Nothing to revert; apply 036.';
  END IF;

  v_def := pg_get_viewdef('public.browse_product_projection'::regclass, true);

  IF position('hero_image_url' in v_def) = 0 THEN
    RAISE NOTICE '058_rollback: state=POST — the projection already reads image_url alone. No-op.';
  ELSE
    RAISE NOTICE '058_rollback: state=PRE — reverting to the migration 036 definition.';
  END IF;
END $$;

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
  p.image_url,
  (NULLIF(btrim(COALESCE(p.image_url, '')), '') IS NOT NULL) AS has_image,
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
  ON alc.product_id = p.id;

COMMENT ON VIEW browse_product_projection IS
  'Canonical browse projection (migration 036). image_url and has_image read kg_product.image_url alone; a curated hero_image_url is INVISIBLE here — reverted by 058_rollback.';

DO $$
DECLARE
  v_def  text;
  v_cols int;
BEGIN
  v_def := pg_get_viewdef('public.browse_product_projection'::regclass, true);
  IF position('hero_image_url' in v_def) > 0 THEN
    RAISE EXCEPTION '058_rollback ABORT: the projection still references hero_image_url.';
  END IF;

  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'browse_product_projection';
  IF v_cols <> 27 THEN
    RAISE EXCEPTION '058_rollback ABORT: the projection now has % columns, expected 27.', v_cols;
  END IF;

  RAISE NOTICE '058_rollback: committed — the projection reads image_url alone again. No rows were written.';
END $$;

COMMIT;
