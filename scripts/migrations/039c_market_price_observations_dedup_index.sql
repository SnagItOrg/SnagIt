-- 039c_market_price_observations_dedup_index
--
-- Purpose: Rebuild the dedup index non-partial so ON CONFLICT can infer it.
-- Depends on: 039b
-- Kind: index
-- Applied in production: YES (version 20260806105337, applied 2026-08-05/06 via Supabase MCP)
--
-- Extracted verbatim from supabase_migrations.schema_migrations: this is the
-- exact SQL that ran in production. Re-running it against production is NOT
-- required and is not idempotent where noted below.

-- The dedup index was partial (WHERE external_id IS NOT NULL), which Postgres
-- cannot infer for an ON CONFLICT clause (and PostgREST's onConflict param
-- can't carry the predicate). Rebuild it non-partial so upserts can target it.
--
-- Rows with NULL external_id simply never collide (default NULLS DISTINCT);
-- the writer is responsible for only sending rows that have one.

DROP INDEX IF EXISTS market_price_observations_dedup;

CREATE UNIQUE INDEX market_price_observations_dedup
  ON market_price_observations (source, external_id, price_type, observed_at);
