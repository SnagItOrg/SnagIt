-- 060_reverb_price_history_categories.sql
--
-- PAN-170. `reverb_price_history` records the Reverb categories each sold
-- listing was filed under, so parts and accessories sold for an instrument can
-- be told apart from the instrument itself.
--
-- WHY. Reverb's sold search for "Roland Juno-106" returns the synth AND the
-- knobs, sliders and caps sold for it. Measured on production 2026-09-28: 10 of
-- the Juno-106's 40 sold rows are parts at 47–1,093 kr, enough to pull Q1 to
-- 4,369 kr, below the Tukey fence's reach, so they sit inside the published
-- p25–p75. Reverb's category is a structured field chosen from a fixed
-- taxonomy ("Parts", "Keyboards and Synths / Keyboard and Synth Parts", …) and
-- separates them; the stored rows carried nothing of the kind until now.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   ADD COLUMN reverb_price_history.reverb_categories jsonb, nullable, no
--   default. The raw `categories` array from the Reverb listing, exactly as the
--   API returns it: [{ "uuid": …, "full_name": … }, …]. The raw fact is stored;
--   what counts as a part is derived at read time by
--   `isPartOrAccessoryListing()` in frontend/lib/price-populations.ts, so the
--   rule can change without rewriting rows. Metadata-only in PostgreSQL: no
--   table rewrite, no row is written.
--
-- ── WHAT IT DOES *NOT* DO ──────────────────────────────────────────────────
-- NO DML. Every existing row starts NULL, which the application reads as
-- "category unknown" and KEEPS — exactly today's behaviour. The rows that feed
-- product pages are populated by `scripts/backfill-reverb-sold-categories.ts`,
-- dry-run by default, run separately with product-owner authorisation.
-- Creates no table, so the `public` default-privilege hazard in
-- scripts/CLAUDE.md P0 does not arise.
--
-- PRE / POST / DRIFT: PRE applies, POST is an explicit successful no-op,
-- DRIFT raises before any mutation. Idempotent and re-runnable.
-- Rollback: 060_rollback.sql.
--
-- APPLICATION ORDER. The product route selects this column and both Reverb
-- sold-price writers (process-price-queue, fetch-reverb-prices) write it, so
-- PostgREST refuses those queries until it exists. Apply this file BEFORE the
-- PAN-170 code reaches `main` or the Mac Mini. The backfill may run any time
-- after this file.

BEGIN;

DO $$
DECLARE
  v_table    regclass;
  v_col_type text;
  v_nullable text;
  v_default  text;
BEGIN
  v_table := to_regclass('public.reverb_price_history');
  IF v_table IS NULL THEN
    RAISE EXCEPTION '060 ABORT: public.reverb_price_history does not exist. Apply migration 017 first.';
  END IF;

  SELECT data_type, is_nullable, column_default INTO v_col_type, v_nullable, v_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'reverb_price_history' AND column_name = 'reverb_categories';

  -- POST: present, in the shape this file creates.
  IF v_col_type = 'jsonb' AND v_nullable = 'YES' AND v_default IS NULL THEN
    RAISE NOTICE '060: state=POST — reverb_price_history.reverb_categories already exists. No-op.';
    RETURN;
  END IF;

  -- DRIFT: a column of that name in any other shape. Refuse before touching the table.
  IF v_col_type IS NOT NULL THEN
    RAISE EXCEPTION E'060 ABORT: drifted state.\n'
      '  reverb_categories: % (nullable: %, default: %)\n'
      '  Expected absent (PRE) or jsonb, nullable, no default (POST). Reconcile by hand.',
      v_col_type, v_nullable, coalesce(v_default, '<none>');
  END IF;

  -- PRE.
  RAISE NOTICE '060: state=PRE — adding reverb_price_history.reverb_categories.';

  ALTER TABLE public.reverb_price_history ADD COLUMN reverb_categories jsonb;

  COMMENT ON COLUMN public.reverb_price_history.reverb_categories IS
    'Raw Reverb listing categories [{uuid, full_name}] (PAN-170, migration 060). NULL = not recorded. '
    'Read by isPartOrAccessoryListing() in frontend/lib/price-populations.ts to keep parts and '
    'accessories out of the sold-price population.';

  RAISE NOTICE '060: committed — reverb_price_history.reverb_categories added. No rows were written.';
END $$;

COMMIT;
