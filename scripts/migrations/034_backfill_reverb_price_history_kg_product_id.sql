-- Migration 034: backfill reverb_price_history.kg_product_id from query text
--
-- Migration 031 added the FK column. Existing rows are query-keyed (free text
-- from the owning watchlist). This migration deterministically maps each row
-- to a kg_product where the row's query, after stripping all non-alphanumeric
-- characters and lowercasing, equals the kg_product's canonical_name under
-- the same normalisation.
--
-- Examples that match (all → kg_product "Roland Juno-60" / id):
--   "Roland Juno-60"  → "rolandjuno60"
--   "Roland Juno 60"  → "rolandjuno60"
--   "roland juno-60"  → "rolandjuno60"
--   kg_product canonical_name "Roland Juno-60" → "rolandjuno60"
--
-- Strategy:
--   - Skip rows already mapped (re-runnable, idempotent).
--   - Skip rows where the normalized query matches ≥ 2 kg_products
--     (ambiguous — leave for human / follow-up listing_url enrichment).
--   - Skip rows where there is no normalized match.
--
-- Expected hit rate at time of authoring (2026-04-27): ~37% of 927 rows.
-- The remainder are legacy design-furniture queries (deprioritised vertical),
-- generic noise ("Reverb", "Jazz guitar"), or products not yet in the KG.
-- A future listing_url-based enrichment is the right path for those, not
-- looser query matching.
--
-- Preview before running:
--   SELECT
--     COUNT(*) FILTER (WHERE match_count = 1) AS will_map,
--     COUNT(*) FILTER (WHERE match_count > 1) AS ambiguous,
--     COUNT(*) FILTER (WHERE match_count = 0) AS no_match
--   FROM (
--     SELECT
--       rph.id,
--       (SELECT COUNT(*) FROM kg_product kp
--         WHERE regexp_replace(lower(rph.query),     '[^a-z0-9]+', '', 'g')
--             = regexp_replace(lower(kp.canonical_name), '[^a-z0-9]+', '', 'g')
--       ) AS match_count
--     FROM reverb_price_history rph
--     WHERE rph.kg_product_id IS NULL AND rph.query IS NOT NULL
--   ) t;

UPDATE reverb_price_history rph
SET kg_product_id = (
  SELECT kp.id
  FROM kg_product kp
  WHERE regexp_replace(lower(rph.query),         '[^a-z0-9]+', '', 'g')
      = regexp_replace(lower(kp.canonical_name), '[^a-z0-9]+', '', 'g')
  LIMIT 1
)
WHERE rph.kg_product_id IS NULL
  AND rph.query IS NOT NULL
  AND (
    SELECT COUNT(*) FROM kg_product kp
    WHERE regexp_replace(lower(rph.query),         '[^a-z0-9]+', '', 'g')
        = regexp_replace(lower(kp.canonical_name), '[^a-z0-9]+', '', 'g')
  ) = 1;
