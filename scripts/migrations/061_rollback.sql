-- 061_rollback.sql
--
-- Reverses 061_browse_projection_excludes_rejected_matches.sql by restoring
-- the projection definition from migration 058 verbatim (production's
-- definition before 061, as read with pg_get_viewdef on 2026-09-30).
--
-- ── THIS ROLLBACK DOES NOT REFUSE ──────────────────────────────────────────
-- Migration 061 wrote no rows, so its reversal writes none either: it removes
-- one predicate from a read-time count. No evidence is destroyed and no
-- security posture changes. The cost of running it is that public cards go
-- back to counting rejected matches ("146 til salg" on a Juno-106 whose page
-- renders 86) — a visible regression, not a dangerous one.
--
-- ── WHAT IT RESTORES ───────────────────────────────────────────────────────
-- The `active_listing_counts` CTE without `AND lpm.is_valid IS NOT FALSE`,
-- and 058's COMMENT. Every other part of the definition is unchanged, because
-- 061 did not change it either.
--
-- CREATE OR REPLACE, never DROP + CREATE: the view's GRANTs must survive, or
-- PostgREST loses the anon/authenticated SELECT that /browse depends on.
--
-- PRE / POST / DRIFT: PRE (061 applied) reverts, POST (already reverted) is an
-- explicit successful no-op, DRIFT raises before any mutation.

BEGIN;

DO $$
DECLARE
  v_def text;
BEGIN
  IF to_regclass('public.browse_product_projection') IS NULL THEN
    RAISE EXCEPTION '061_rollback ABORT: view browse_product_projection does not exist. Nothing to revert.';
  END IF;

  v_def := pg_get_viewdef('public.browse_product_projection'::regclass, true);

  -- Restoring 058's text on a database without 058 would apply 058. Refuse.
  IF position('hero_image_url' in v_def) = 0 THEN
    RAISE EXCEPTION '061_rollback ABORT: the projection does not resolve hero_image_url, so it is not in the 058/061 state. Reconcile by hand.';
  END IF;

  IF position('is_valid IS NOT FALSE' in v_def) > 0 THEN
    RAISE NOTICE '061_rollback: state=PRE — reverting to the migration 058 definition.';
  ELSIF position('is_valid' in v_def) > 0 THEN
    RAISE EXCEPTION E'061_rollback ABORT: the projection references is_valid, but not as "is_valid IS NOT FALSE".\n'
      '  This is not the 061 definition; someone has hand-edited the count. Reconcile by hand.';
  ELSE
    RAISE NOTICE '061_rollback: state=POST — active_listing_count already counts every active match. No-op.';
  END IF;

  PERFORM set_config(
    'klup.m061_rollback_acl',
    coalesce((SELECT relacl::text FROM pg_class WHERE oid = 'public.browse_product_projection'::regclass), '<null>'),
    true
  );
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
LEFT JOIN LATERAL (
  SELECT COALESCE(
    NULLIF(btrim(COALESCE(p.hero_image_url, '')), ''),
    NULLIF(btrim(COALESCE(p.image_url, '')), '')
  ) AS url
) image_resolved ON true;

COMMENT ON VIEW browse_product_projection IS
  'Canonical browse projection (migration 036). image_url and has_image both read one resolved value: hero_image_url (curated) wins, image_url (ingested) is the fallback, blank counts as absent — migration 058, PAN-133. The same sentence in TypeScript is resolveProductImage() in frontend/lib/product-image-source.ts.';

DO $$
DECLARE
  v_def  text;
  v_cols int;
  v_acl  text;
BEGIN
  v_def := pg_get_viewdef('public.browse_product_projection'::regclass, true);
  IF position('is_valid' in v_def) > 0 THEN
    RAISE EXCEPTION '061_rollback ABORT: the projection still references is_valid.';
  END IF;
  IF position('hero_image_url' in v_def) = 0 THEN
    RAISE EXCEPTION '061_rollback ABORT: the 058 image precedence was lost.';
  END IF;

  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'browse_product_projection';
  IF v_cols <> 27 THEN
    RAISE EXCEPTION '061_rollback ABORT: the projection now has % columns, expected 27.', v_cols;
  END IF;

  SELECT coalesce(relacl::text, '<null>') INTO v_acl
    FROM pg_class WHERE oid = 'public.browse_product_projection'::regclass;
  IF v_acl IS DISTINCT FROM current_setting('klup.m061_rollback_acl', true) THEN
    RAISE EXCEPTION '061_rollback ABORT: the view ACL changed: % -> %.', current_setting('klup.m061_rollback_acl', true), v_acl;
  END IF;

  RAISE NOTICE '061_rollback: committed — active_listing_count counts every active match again. No rows were written.';
END $$;

COMMIT;
