-- 056_rollback.sql — reverse scripts/migrations/056_activation_package.sql
--
-- NOT EXECUTED against production. Disposable-cluster verification only.
--
-- The package committed three things atomically: a schema column, additive KG
-- identities, and the frozen-cohort promotion. They are reversed in the
-- opposite order, and each step is separately refusable, because they carry
-- different kinds of evidence:
--
--   promotion  -> product-owner decisions about which 48 are supported
--   identities -> KG rows that may already have matches, pages or content
--   schema     -> the axis itself
--
-- DEFAULT: refuse if any additive identity has acquired references, because
-- dropping it would orphan a match, a page or saved content. Escapes:
--
--   klup.rollback_mode=keep_identities  demote the 48 and drop the schema,
--                                       but KEEP every added product/brand as
--                                       an ordinary known identity (safest)
--   klup.rollback_mode=full             also delete additive rows that have NO
--                                       references; still refuses on any row
--                                       that is referenced
--
-- Nothing here ever deletes a pre-existing product, page, article, image or
-- match, and nothing changes browse_visibility, tier or status.

BEGIN;

SET LOCAL statement_timeout = '300s';

DO $$
DECLARE
  v_col int; v_mode text := coalesce(current_setting('klup.rollback_mode', true), '');
  v_referenced int; v_row record;
BEGIN
  SELECT count(*) INTO v_col FROM information_schema.columns
   WHERE table_schema='public' AND table_name='kg_product' AND column_name='support_state';
  IF v_col = 0 THEN
    RAISE NOTICE '056_rollback: support_state absent — nothing to reverse. No-op.';
    RETURN;
  END IF;

  -- Additive rows are recognised by the safe defaults the package gave them.
  CREATE TEMP TABLE _added ON COMMIT DROP AS
    SELECT p.id, p.slug FROM kg_product p
     WHERE p.support_state = 'known' AND p.browse_visibility = 'qa_only' AND p.tier = 'standard';

  SELECT count(*) INTO v_referenced
    FROM _added a WHERE EXISTS (SELECT 1 FROM listing_product_match m WHERE m.product_id = a.id);

  IF v_mode NOT IN ('keep_identities','full') THEN
    RAISE EXCEPTION '056_rollback REFUSED: reversing this package removes a product-owner decision (48 supported) and may orphan % additive identity/identities that already carry matches. Re-run with PGOPTIONS="-c klup.rollback_mode=keep_identities" (recommended: demote and drop the axis, keep every identity) or "...=full" (also delete UNREFERENCED additive rows).', v_referenced;
  END IF;

  -- 1. reverse the promotion (never touches visibility, tier, status or content)
  UPDATE kg_product SET support_state = 'known' WHERE support_state = 'supported';

  -- 2. optionally remove additive identities that nothing references
  IF v_mode = 'full' THEN
    IF v_referenced > 0 THEN
      RAISE NOTICE '056_rollback: keeping % referenced additive identity/identities —', v_referenced;
      FOR v_row IN SELECT a.slug FROM _added a
        WHERE EXISTS (SELECT 1 FROM listing_product_match m WHERE m.product_id=a.id) ORDER BY a.slug
      LOOP RAISE NOTICE '    %', v_row.slug; END LOOP;
    END IF;
    DELETE FROM kg_identifier i USING _added a WHERE i.product_id = a.id
      AND NOT EXISTS (SELECT 1 FROM listing_product_match m WHERE m.product_id = a.id);
    DELETE FROM kg_product p USING _added a WHERE p.id = a.id
      AND NOT EXISTS (SELECT 1 FROM listing_product_match m WHERE m.product_id = a.id);
  END IF;

  -- 3. drop the axis
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_kg_product_support_state') THEN
    EXECUTE 'DROP INDEX public.idx_kg_product_support_state';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.kg_product'::regclass
              AND conname='kg_product_support_state_check') THEN
    EXECUTE 'ALTER TABLE kg_product DROP CONSTRAINT kg_product_support_state_check';
  END IF;
  EXECUTE 'ALTER TABLE kg_product DROP COLUMN support_state';

  RAISE NOTICE '056_rollback: reversed (mode=%). Matcher eligibility reverts to status=''active'' alone — revert the matcher code in the same change.', v_mode;
END $$;

COMMIT;
