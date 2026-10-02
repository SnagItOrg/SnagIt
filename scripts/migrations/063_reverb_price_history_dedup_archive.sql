-- 063_reverb_price_history_dedup_archive.sql
--
-- PAN-213. Creates `reverb_price_history_dedup_archive`: where duplicate
-- sold-price rows go, in full, before they are removed from
-- `reverb_price_history`, so the removal can be reversed byte for byte.
--
-- WHY. About 97,800 of the table's 100,000 rows (2026-10-02) are copies of a
-- few hundred sales: the reprocessing loop of May 2026 and the pre-PAN-210
-- queue worker, which wrote a sale again on every run. The owner authorised
-- the cleanup on PAN-213 on the condition that it is reversible, not a bare
-- delete.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   CREATE TABLE reverb_price_history_dedup_archive: the columns of
--   reverb_price_history (LIKE: names, types and NOT NULL; no defaults and no
--   foreign keys, so an archived row survives its product or watchlist), plus
--   `archived_at` and `archive_batch`. Primary key on the original `id`, so a
--   row cannot be archived twice.
--   RLS enabled with no policy, and every privilege revoked from `anon` and
--   `authenticated` in this transaction (scripts/CLAUDE.md P0: a new `public`
--   table is otherwise born world-readable and world-writable).
--
-- ── WHAT IT DOES *NOT* DO ──────────────────────────────────────────────────
-- NO DML. It moves no row. The archive-and-remove transaction and its rollback
-- are attached to PAN-213 (pan213-dedup-apply.sql, pan213-dedup-rollback.sql);
-- they need this table, and no application code reads it.
--
-- PRE / POST / DRIFT: PRE applies, POST is an explicit successful no-op,
-- DRIFT (the table exists in another shape, or anon or authenticated can reach
-- it) raises before any mutation. Rollback: 063_rollback.sql.

BEGIN;

DO $$
DECLARE
  v_src  regclass := to_regclass('public.reverb_price_history');
  v_arch regclass := to_regclass('public.reverb_price_history_dedup_archive');
  v_src_cols text; v_arch_cols text; v_rls boolean; v_open boolean;
BEGIN
  IF v_src IS NULL THEN
    RAISE EXCEPTION '063 ABORT: public.reverb_price_history does not exist. Apply migration 017 first.';
  END IF;

  IF v_arch IS NULL THEN
    CREATE TABLE public.reverb_price_history_dedup_archive (
      LIKE public.reverb_price_history,
      archived_at   timestamptz NOT NULL DEFAULT now(),
      archive_batch text NOT NULL
    );
    ALTER TABLE public.reverb_price_history_dedup_archive
      ADD CONSTRAINT reverb_price_history_dedup_archive_pkey PRIMARY KEY (id);
    ALTER TABLE public.reverb_price_history_dedup_archive ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.reverb_price_history_dedup_archive FROM anon, authenticated;
    COMMENT ON TABLE public.reverb_price_history_dedup_archive IS
      'PAN-213: duplicate reverb_price_history rows, archived in full before removal. Restored by pan213-dedup-rollback.sql.';
    v_arch := 'public.reverb_price_history_dedup_archive'::regclass;
    RAISE NOTICE '063: state=PRE, archive table created.';
  ELSE
    RAISE NOTICE '063: archive table already present; verifying its shape.';
  END IF;

  -- The same check proves a fresh create and recognises POST; anything else is DRIFT.
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull, ', ' ORDER BY a.attnum)
    INTO v_src_cols FROM pg_attribute a WHERE a.attrelid = v_src AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull, ', ' ORDER BY a.attnum)
    INTO v_arch_cols FROM pg_attribute a WHERE a.attrelid = v_arch AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT c.relrowsecurity INTO v_rls FROM pg_class c WHERE c.oid = v_arch;
  v_open := has_table_privilege('anon', v_arch, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR has_table_privilege('authenticated', v_arch, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  IF v_arch_cols IS DISTINCT FROM v_src_cols || ', archived_at timestamp with time zone true, archive_batch text true'
     OR NOT v_rls OR v_open THEN
    RAISE EXCEPTION '063 ABORT: state=DRIFT: archive columns [%] rls=% anon_or_authenticated_can_reach=%', v_arch_cols, v_rls, v_open;
  END IF;
  RAISE NOTICE '063: state=POST. Columns match reverb_price_history, RLS on, no anon or authenticated privilege.';
END $$;

COMMIT;
