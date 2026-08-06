-- 048_retire_unscoped_coverage_function
--
-- Purpose: Retire source_has_established_coverage(source) — it accepted any v2 run, so one targeted run established coverage for a whole source. Now RAISEs.
-- Depends on: 044
-- Kind: function / RPC (fail-closed retirement)
-- Applied in production: YES (version 20260806133758, applied 2026-08-05/06 via Supabase MCP)
--
-- Extracted verbatim from supabase_migrations.schema_migrations: this is the
-- exact SQL that ran in production. Re-running it against production is NOT
-- required and is not idempotent where noted below.

-- source_has_established_coverage(source) is unsafe by construction: it
-- accepts ANY v2 passed run, so a TARGETED single-product run establishes
-- "coverage" for the whole source. Observed live — a --product=juno-106 run
-- flipped it to true. Any caller trusting it could enable lifecycle against
-- a universe that was never fully covered.
--
-- Coverage is only ever meaningful for a specific scope, so this now fails
-- closed and points at the scoped function.

CREATE OR REPLACE FUNCTION source_has_established_coverage(p_source text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = 'source_has_established_coverage() is retired: coverage is scope-specific',
    HINT    = 'Use scope_has_established_coverage(source, scope_hash, scraper_version).';
END $$;

COMMENT ON FUNCTION source_has_established_coverage IS
  'RETIRED — always raises. A targeted run would otherwise establish coverage for an entire source. Use scope_has_established_coverage(source, scope_hash, scraper_version).';
