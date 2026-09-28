-- 059_kg_product_year_discontinued.sql
--
-- PAN-137. `kg_product` gains the last production year, so a product can state
-- a production range: `1960–1975`, or `1960–` while still in production.
-- Product-owner decision 2026-09-28: option B, one nullable column.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   1. ADD COLUMN kg_product.year_discontinued integer, nullable, no default.
--      Metadata-only in PostgreSQL: no table rewrite, no row is written.
--   2. ADD CONSTRAINT kg_product_year_discontinued_check:
--        year_discontinued IS NULL
--        OR (year_released IS NOT NULL AND year_discontinued >= year_released)
--      A discontinued year needs a release year and is not before it; an
--      equal pair (one production year) is allowed. The same rule is
--      `validateProductionYears()` in frontend/lib/production-years.ts, which
--      the admin forms and routes apply before any write reaches this CHECK.
--      Every existing row has year_discontinued NULL, so validation passes
--      trivially.
--
-- ── WHAT IT DOES *NOT* DO ──────────────────────────────────────────────────
-- NO DML. No backfill: every row starts NULL. Note what NULL will render as —
-- the application reads NULL as "still in production" (`1960–`). The rows that
-- already carry a year_released (11 on 2026-09-28, SELECT) will therefore read
-- as open-ended once the application flag KLUP_YEAR_DISCONTINUED is switched on,
-- unless someone sets their discontinued year first. Production years stay
-- ASSUMED until sourced (PAN-52 §11); this column records no provenance.
--
-- No range CHECK on the years themselves (1900–2030): year_released carries
-- none either, and the application refuses out-of-range values before a write.
-- Creates no table, so the `public` default-privilege hazard in
-- scripts/CLAUDE.md P0 does not arise.
--
-- PRE / POST / DRIFT: PRE applies, POST is an explicit successful no-op,
-- DRIFT raises before any mutation. Idempotent and re-runnable.
-- Rollback: 059_rollback.sql.
--
-- APPLICATION ORDER. The application reads and writes the column only when
-- KLUP_YEAR_DISCONTINUED=on (lib/production-years.ts), so the code may deploy
-- before or after this file. Apply this file FIRST, then set the flag.

BEGIN;

DO $$
DECLARE
  v_released_type text;
  v_col_type      text;
  v_col_nullable  text;
  v_check_def     text;
BEGIN
  SELECT data_type INTO v_released_type
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'kg_product' AND column_name = 'year_released';
  IF v_released_type IS NULL THEN
    RAISE EXCEPTION '059 ABORT: kg_product.year_released does not exist. Apply migration 031 first.';
  END IF;
  IF v_released_type <> 'integer' THEN
    RAISE EXCEPTION '059 ABORT: kg_product.year_released is %, expected integer. Reconcile by hand.', v_released_type;
  END IF;

  SELECT data_type, is_nullable INTO v_col_type, v_col_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'kg_product' AND column_name = 'year_discontinued';

  SELECT pg_get_constraintdef(c.oid) INTO v_check_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.kg_product'::regclass
     AND c.conname = 'kg_product_year_discontinued_check';

  -- POST: both present, in the shape this file creates.
  IF v_col_type = 'integer' AND v_col_nullable = 'YES'
     AND v_check_def IS NOT NULL
     AND position('year_released IS NOT NULL' in v_check_def) > 0
     AND position('year_discontinued >= year_released' in v_check_def) > 0 THEN
    RAISE NOTICE '059: state=POST — kg_product.year_discontinued and its CHECK already exist. No-op.';
    RETURN;
  END IF;

  -- DRIFT: anything partial or different. Refuse before touching the table.
  IF v_col_type IS NOT NULL OR v_check_def IS NOT NULL THEN
    RAISE EXCEPTION E'059 ABORT: partial or drifted state.\n'
      '  year_discontinued column: % (nullable: %)\n'
      '  kg_product_year_discontinued_check: %\n'
      '  Expected either neither (PRE) or both as 059 defines them (POST). Reconcile by hand.',
      coalesce(v_col_type, '<absent>'), coalesce(v_col_nullable, '-'), coalesce(v_check_def, '<absent>');
  END IF;

  -- PRE.
  RAISE NOTICE '059: state=PRE — adding kg_product.year_discontinued and its CHECK.';

  ALTER TABLE public.kg_product ADD COLUMN year_discontinued integer;

  ALTER TABLE public.kg_product
    ADD CONSTRAINT kg_product_year_discontinued_check
    CHECK (
      year_discontinued IS NULL
      OR (year_released IS NOT NULL AND year_discontinued >= year_released)
    );

  COMMENT ON COLUMN public.kg_product.year_discontinued IS
    'Last production year (PAN-137, migration 059). NULL = still in production, or not yet curated. '
    'Requires year_released and is >= it. Display metadata only: never read by matching, price '
    'populations or eligibility. ASSUMED until sourced (PAN-52 §11).';

  RAISE NOTICE '059: committed — kg_product.year_discontinued added. No rows were written.';
END $$;

COMMIT;
