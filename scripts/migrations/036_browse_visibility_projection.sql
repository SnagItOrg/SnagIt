-- Migration 036: explicit browse visibility + canonical browse projection

ALTER TABLE kg_product
  ADD COLUMN IF NOT EXISTS browse_visibility text NOT NULL DEFAULT 'qa_only';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'kg_product_browse_visibility_check'
  ) THEN
    ALTER TABLE kg_product
      ADD CONSTRAINT kg_product_browse_visibility_check
      CHECK (browse_visibility IN ('public', 'qa_only', 'hidden'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_kg_product_browse_visibility
  ON kg_product(status, browse_visibility, subcategory_id);

UPDATE kg_product
SET browse_visibility = 'public'
WHERE
  status = 'active'
  AND subcategory_id IS NOT NULL
  AND tier IN ('classic', 'legendary')
  AND browse_visibility = 'qa_only';

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
