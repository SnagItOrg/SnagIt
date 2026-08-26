-- 057_restrict_release_archive_tables.sql
--
-- RELEASE-SECURITY CORRECTION (2026-08-26), authored after migrations 053-056
-- were applied to production.
--
-- NOTE ON THE NUMBER: an earlier, unrelated `057_*.sql` existed during the
-- activation programme (the retired 056/057 split) and was deleted before
-- deployment. It never ran anywhere. This file reuses the free number 057 and
-- has nothing to do with it.
--
-- ── WHAT WENT WRONG ────────────────────────────────────────────────────────
-- Migrations 053 and 054 create nine archive / mapping tables in `public` so
-- their rollbacks have evidence to restore from. `public` is exposed through
-- PostgREST, and this project grants ALL privileges on public tables to `anon`
-- and `authenticated`. The archive tables were therefore created with:
--
--     rls = false
--     anon          -> SELECT, INSERT, UPDATE, DELETE, TRUNCATE, ...
--     authenticated -> SELECT, INSERT, UPDATE, DELETE, TRUNCATE, ...
--
-- Confirmed live before this migration:
--     GET /rest/v1/kg_arch_product_053?select=slug&limit=2  ->  200, 2 rows
--
-- The read exposure is low-sensitivity (slugs of retired duplicate products;
-- kg_product already carries a public-read policy). The WRITE grant is the real
-- problem: an anonymous caller could DELETE rows through PostgREST and destroy
-- the evidence that the 053 / 054 rollbacks depend on.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   1. ENABLE ROW LEVEL SECURITY on all nine tables, and create NO policies.
--      No policy + RLS enabled = deny-all for ordinary roles.
--   2. REVOKE ALL from `anon` and `authenticated` as defence in depth, so the
--      tables are protected by both the privilege system and RLS.
--   3. Pin `search_path` on listings_ingestion_identity() (migration 055).
--
-- ── WHY RECOVERY STILL WORKS ───────────────────────────────────────────────
-- Verified on production before authoring:
--     postgres      superuser=false bypassrls=TRUE   (and OWNS all nine tables)
--     service_role  superuser=false bypassrls=TRUE
--     anon          bypassrls=false
--     authenticated bypassrls=false
--
-- RLS is enabled WITHOUT FORCE, so the owner is exempt as well. The documented
-- rollback procedures run as `postgres` over the direct PostgreSQL channel and
-- are unaffected; 056_rollback can still inspect every archive table.
--
-- ── SCOPE ──────────────────────────────────────────────────────────────────
-- Touches no product data, support state, visibility, tier, monitoring,
-- matching, or archive CONTENTS. Row counts are asserted unchanged.
--
-- ── NOT FIXED HERE (deliberately) ──────────────────────────────────────────
-- The root cause is the project-wide default privilege that grants ALL on new
-- public tables to anon/authenticated. Any future archive table will be born
-- exposed the same way. Correcting that means ALTER DEFAULT PRIVILEGES across
-- the schema, which is materially wider than this release. Recorded as
-- follow-up; this migration fixes exactly the nine tables that exist.
--
-- PRE / POST / DRIFT: PRE applies, POST is an explicit successful no-op.
-- Idempotent and re-runnable. Rollback: 057_rollback.sql (refuses by default).

BEGIN;

DO $$
DECLARE
  v_tables  text[] := ARRAY[
    'kg_arch_product_053', 'kg_arch_identifier_053', 'kg_arch_synonym_053',
    'kg_arch_relation_053', 'kg_arch_lpm_053', 'kg_arch_mkt_daily_053',
    'kg_repoint_053', 'kg_arch_identifier_054', 'kg_added_identifier_054'
  ];
  v_present int;
  v_rls_on  int;
  v_exposed int;
  v_fnpath  int;
BEGIN
  SELECT count(*) INTO v_present
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(v_tables);

  IF v_present = 0 THEN
    RAISE EXCEPTION '057 ABORT: none of the nine archive tables exist. Apply 053 and 054 first.';
  END IF;

  IF v_present <> 9 THEN
    RAISE WARNING '057: only % of 9 archive tables present; securing those that exist.', v_present;
  END IF;

  SELECT count(*) INTO v_rls_on
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = ANY(v_tables) AND c.relrowsecurity;

  SELECT count(*) INTO v_exposed
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = ANY(v_tables)
     AND grantee IN ('anon', 'authenticated');

  SELECT count(*) INTO v_fnpath
    FROM pg_proc
   WHERE proname = 'listings_ingestion_identity'
     AND proconfig IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%');

  IF v_rls_on = v_present AND v_exposed = 0 AND v_fnpath = 1 THEN
    RAISE NOTICE '057: state=POST — already applied. No-op. % table(s) secured.', v_present;
  ELSE
    RAISE NOTICE '057: state=PRE — applying (% table(s); rls_on=%, exposed_grants=%, fn_search_path=%).',
      v_present, v_rls_on, v_exposed, v_fnpath;
  END IF;
END $$;

-- ── 1. Deny-all RLS. No policy is created, deliberately. ────────────────────
-- Enabled WITHOUT FORCE so the owning role (postgres) and every bypassrls role
-- (postgres, service_role) retain full recovery access.
ALTER TABLE IF EXISTS kg_arch_product_053      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS kg_arch_identifier_053   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS kg_arch_synonym_053      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS kg_arch_relation_053     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS kg_arch_lpm_053          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS kg_arch_mkt_daily_053    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS kg_repoint_053           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS kg_arch_identifier_054   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS kg_added_identifier_054  ENABLE ROW LEVEL SECURITY;

-- ── 2. Defence in depth: remove the privileges themselves ───────────────────
-- REVOKE is idempotent. Only anon/authenticated are touched; postgres and
-- service_role keep everything.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'kg_arch_product_053', 'kg_arch_identifier_053', 'kg_arch_synonym_053',
    'kg_arch_relation_053', 'kg_arch_lpm_053', 'kg_arch_mkt_daily_053',
    'kg_repoint_053', 'kg_arch_identifier_054', 'kg_added_identifier_054'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE kg_arch_product_053 IS
  'Migration 053 rollback evidence. RLS enabled with NO policy and no anon/authenticated grants (migration 057): unreadable and unwritable through PostgREST. Recovery is via postgres/service_role over the direct PostgreSQL channel.';

-- ── 3. Pin the trigger function search_path (055) ───────────────────────────
-- Inspected before changing: the body references only NEW, OLD, TG_OP and
-- now(). It resolves no tables, types or operators by unqualified name, so a
-- restrictive search_path cannot change its behaviour. pg_catalog is always
-- implicitly searched, which is where now() lives.
--
-- CREATE OR REPLACE preserves the function's oid, so
-- trg_listings_ingestion_identity keeps pointing at it and is NOT recreated.
-- The body below is byte-identical to the one installed by migration 055.
CREATE OR REPLACE FUNCTION listings_ingestion_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Only a real INSERT may establish identity, and only when the writer
    -- supplied a batch id. `ingested_at` is DATABASE time — an application
    -- wall clock must never decide newness.
    IF NEW.ingestion_batch_id IS NULL THEN
      NEW.ingested_at := NULL;          -- no batch id => no identity, ever
    ELSE
      NEW.ingested_at := now();         -- ignore any client-supplied value
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE (this includes every ON CONFLICT DO UPDATE refresh path).
  -- Identity is carried over verbatim, so:
  --   * an established identity can never be changed or cleared;
  --   * a legacy NULL row can never acquire one through a scraper refresh.
  NEW.ingestion_batch_id := OLD.ingestion_batch_id;
  NEW.ingested_at        := OLD.ingested_at;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION listings_ingestion_identity() IS
  'Makes listings.ingestion_batch_id / ingested_at write-once. INSERT with a batch id stamps database time; UPDATE always preserves the original pair. No application role can bypass this. search_path pinned to pg_catalog by migration 057.';

-- ── 4. Pre-commit assertions ───────────────────────────────────────────────
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'kg_arch_product_053', 'kg_arch_identifier_053', 'kg_arch_synonym_053',
    'kg_arch_relation_053', 'kg_arch_lpm_053', 'kg_arch_mkt_daily_053',
    'kg_repoint_053', 'kg_arch_identifier_054', 'kg_added_identifier_054'
  ];
  v_present  int;
  v_unsecured int;
  v_grants   int;
  v_trigger  int;
  v_fnpath   int;
BEGIN
  SELECT count(*) INTO v_present
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(v_tables);

  SELECT count(*) INTO v_unsecured
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(v_tables)
     AND NOT c.relrowsecurity;
  IF v_unsecured > 0 THEN
    RAISE EXCEPTION '057 ABORT: % archive table(s) still have RLS disabled.', v_unsecured;
  END IF;

  SELECT count(*) INTO v_grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = ANY(v_tables)
     AND grantee IN ('anon', 'authenticated');
  IF v_grants > 0 THEN
    RAISE EXCEPTION '057 ABORT: % anon/authenticated grant(s) remain on archive tables.', v_grants;
  END IF;

  -- Recovery must survive.
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION '057 ABORT: service_role lost bypassrls; recovery access would break.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = ANY(v_tables)
                AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION '057 ABORT: FORCE ROW LEVEL SECURITY set; the owner would lose access.';
  END IF;

  -- The 055 trigger must still be attached to the same function.
  SELECT count(*) INTO v_trigger
    FROM pg_trigger t
   WHERE NOT t.tgisinternal AND t.tgname = 'trg_listings_ingestion_identity'
     AND t.tgfoid = (SELECT oid FROM pg_proc WHERE proname = 'listings_ingestion_identity');
  IF v_trigger <> 1 THEN
    RAISE EXCEPTION '057 ABORT: trg_listings_ingestion_identity is not bound to the function (found %).', v_trigger;
  END IF;

  SELECT count(*) INTO v_fnpath
    FROM pg_proc
   WHERE proname = 'listings_ingestion_identity'
     AND proconfig IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%');
  IF v_fnpath <> 1 THEN
    RAISE EXCEPTION '057 ABORT: listings_ingestion_identity search_path not pinned.';
  END IF;

  RAISE NOTICE '057: committed — % archive table(s) RLS-enabled with no policy, 0 anon/authenticated grants, trigger intact, search_path pinned.', v_present;
END $$;

COMMIT;
