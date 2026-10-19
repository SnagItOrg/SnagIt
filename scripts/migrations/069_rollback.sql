-- 069_rollback.sql
--
-- Reverses 069_watchlist_product.sql: drops the unique index, the pair CHECK
-- and the column, and restores the two-value type CHECK from 005.
--
-- It REFUSES while any product watchlist exists. Such a row is a user's
-- watch, and the column is the only place it is recorded; delete or convert
-- those rows on purpose first.
--
-- Idempotent: an absent column is an explicit no-op.

BEGIN;

DO $$
DECLARE
  v_rows bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.watchlists'::regclass AND attname = 'product_id' AND NOT attisdropped
  ) THEN
    RAISE NOTICE '069_rollback: watchlists.product_id absent — 069 was never applied. No-op.';
    RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM public.watchlists WHERE product_id IS NOT NULL' INTO v_rows;
  IF v_rows > 0 THEN
    RAISE EXCEPTION '069_rollback ABORT: % product watchlist(s) exist. Delete or convert them on purpose first.', v_rows;
  END IF;
  DROP INDEX IF EXISTS public.watchlists_product_user_unique;
  ALTER TABLE public.watchlists
    DROP CONSTRAINT IF EXISTS watchlists_product_type_check,
    DROP CONSTRAINT watchlists_type_check,
    DROP COLUMN product_id;
  ALTER TABLE public.watchlists
    ADD CONSTRAINT watchlists_type_check CHECK (type IN ('query', 'listing'));
  RAISE NOTICE '069_rollback: watchlists.product_id dropped, type CHECK restored.';
END $$;

COMMIT;
