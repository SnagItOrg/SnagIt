-- 069_watchlist_product.sql
--
-- PAN-273. A watchlist can watch ONE canonical model under a price: the
-- nightly mail (PAN-12) fires when a listing the matcher attached to that
-- product appears under `max_price`. Free-text query watchlists keep their
-- rule; this adds the product kind beside them.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   ADD COLUMN watchlists.product_id uuid NULL REFERENCES kg_product(id).
--   The default NO ACTION on delete is deliberate: deleting a watched product
--   fails loudly rather than silently dropping a user's watch.
--
--   `type` admits 'product' (CHECK query | listing | product), and a second
--   CHECK ties the two: product_id is set exactly when type = 'product'. A
--   separate type keeps every reader that branches on type = 'query' (the
--   disabled Vercel cron, the edit page, the runner's query branch) away from
--   product rows.
--
--   UNIQUE (product_id, user_id): one watch per model per user — saving again
--   updates the price. Not partial, so the route's upsert can name it through
--   PostgREST, which cannot pass an index predicate. NULL product_ids never
--   collide, so query and listing rows are untouched. It also serves the FK
--   check and the runner's product lookup.
--
--   No row moves. No grant changes: `watchlists` keeps its RLS policy
--   (users manage their own rows), and the runner reads through the service
--   role. Whether a watched product is still canonical is decided at send
--   time by `isCanonical()`, not by the schema.
--
-- ── FAIL CLOSED ───────────────────────────────────────────────────────────
--   PRE   column absent and the type CHECK is the two-value one from 005:
--         add, then a postflight in this transaction.
--   POST  column, both CHECKs and the unique index present in this shape:
--         an explicit successful no-op.
--   DRIFT anything else raises before any change.
-- Rollback: 069_rollback.sql.

BEGIN;

DO $$
DECLARE
  c_type_old constant text := 'CHECK ((type = ANY (ARRAY[''query''::text, ''listing''::text])))';
  c_type_new constant text := 'CHECK ((type = ANY (ARRAY[''query''::text, ''listing''::text, ''product''::text])))';
  c_pair     constant text := 'CHECK (((type = ''product''::text) = (product_id IS NOT NULL)))';
  c_fk       constant text := 'FOREIGN KEY (product_id) REFERENCES kg_product(id)';
  c_idx      constant text := 'CREATE UNIQUE INDEX watchlists_product_user_unique ON public.watchlists USING btree (product_id, user_id)';
  v_has_col  boolean;
  v_type     text; v_pair text; v_fk text; v_idx text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.watchlists'::regclass AND attname = 'product_id' AND NOT attisdropped
  ) INTO v_has_col;
  SELECT pg_get_constraintdef(oid) INTO v_type
    FROM pg_constraint WHERE conrelid = 'public.watchlists'::regclass AND conname = 'watchlists_type_check';

  IF NOT v_has_col THEN
    IF v_type IS DISTINCT FROM c_type_old THEN
      RAISE EXCEPTION '069 ABORT: state=DRIFT: product_id absent but watchlists_type_check is [%]', v_type;
    END IF;

    ALTER TABLE public.watchlists
      ADD COLUMN product_id uuid REFERENCES public.kg_product(id);
    ALTER TABLE public.watchlists DROP CONSTRAINT watchlists_type_check;
    ALTER TABLE public.watchlists
      ADD CONSTRAINT watchlists_type_check CHECK (type IN ('query', 'listing', 'product')),
      ADD CONSTRAINT watchlists_product_type_check CHECK ((type = 'product') = (product_id IS NOT NULL));
    CREATE UNIQUE INDEX watchlists_product_user_unique ON public.watchlists (product_id, user_id);
    COMMENT ON COLUMN public.watchlists.product_id IS
      'PAN-273: the canonical kg_product a type=product watchlist watches. Hit = a non-rejected listing_product_match under max_price (scripts/lib/watchlist-hits.ts).';
    RAISE NOTICE '069: state=PRE, watchlists.product_id added, type admits product, one watch per (product, user).';
  ELSE
    RAISE NOTICE '069: watchlists.product_id already present; verifying.';
  END IF;

  -- The same check is the postflight after PRE and the recognition of POST.
  SELECT pg_get_constraintdef(oid) INTO v_type
    FROM pg_constraint WHERE conrelid = 'public.watchlists'::regclass AND conname = 'watchlists_type_check';
  SELECT pg_get_constraintdef(oid) INTO v_pair
    FROM pg_constraint WHERE conrelid = 'public.watchlists'::regclass AND conname = 'watchlists_product_type_check';
  SELECT pg_get_constraintdef(oid) INTO v_fk
    FROM pg_constraint WHERE conrelid = 'public.watchlists'::regclass AND conname = 'watchlists_product_id_fkey';
  SELECT indexdef INTO v_idx
    FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'watchlists_product_user_unique';
  IF v_type IS DISTINCT FROM c_type_new OR v_pair IS DISTINCT FROM c_pair
     OR v_fk IS DISTINCT FROM c_fk OR v_idx IS DISTINCT FROM c_idx THEN
    RAISE EXCEPTION '069 ABORT: state=DRIFT: type=[%] pair=[%] fk=[%] idx=[%]', v_type, v_pair, v_fk, v_idx;
  END IF;
  RAISE NOTICE '069: state=POST. Shape as authored.';
END $$;

COMMIT;
