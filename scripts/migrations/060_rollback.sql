-- 060_rollback.sql
--
-- Reverses 060_reverb_price_history_categories.sql: drops
-- reverb_price_history.reverb_categories.
--
-- BEFORE running it, revert the PAN-170 code and redeploy (and `git pull` on
-- the Mac Mini): the product route selects the column and both Reverb
-- sold-price writers write it, so PostgREST fails those queries once it is
-- gone.
--
-- What is lost: the recorded categories. They are not curation — they are a
-- copy of what Reverb returns and can be re-fetched by
-- scripts/backfill-reverb-sold-categories.ts — so this script drops without
-- asking, and reports how many rows carried a value.
--
-- Idempotent: an absent column is an explicit no-op.

BEGIN;

DO $$
DECLARE
  v_has_col boolean;
  v_nonnull bigint := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'reverb_price_history' AND column_name = 'reverb_categories'
  ) INTO v_has_col;

  IF NOT v_has_col THEN
    RAISE NOTICE '060_rollback: reverb_categories absent — 060 was never applied. No-op.';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.reverb_price_history WHERE reverb_categories IS NOT NULL' INTO v_nonnull;
  IF v_nonnull > 0 THEN
    RAISE WARNING '060_rollback: dropping reverb_categories carried by % row(s); re-fetchable from Reverb.', v_nonnull;
  END IF;

  ALTER TABLE public.reverb_price_history DROP COLUMN reverb_categories;

  RAISE NOTICE '060_rollback: committed — reverb_price_history.reverb_categories removed.';
END $$;

COMMIT;
