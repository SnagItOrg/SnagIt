-- Diagnostic: unique indexes that are silently defeated by NULLs.
--
-- Kind: diagnostic query (READ-ONLY)
-- Related migrations: none (inspects pg_catalog)
--
-- Postgres treats NULLs as DISTINCT by default, so a unique index over a
-- nullable column enforces nothing for rows where that column is NULL.
-- This found reverb_price_history (listing_url, watchlist_id) with
-- watchlist_id NULL on 98.8% of rows -> 97,381 duplicates.
-- Correct pattern: a partial index (see kg_category.reverb_uuid) or
-- NULLS NOT DISTINCT.

SELECT
  ns.nspname AS schema,
  t.relname  AS table_name,
  i.relname  AS index_name,
  idx.indnullsnotdistinct AS nulls_not_distinct,
  pg_get_indexdef(idx.indexrelid) AS index_def
FROM pg_index idx
JOIN pg_class i     ON i.oid = idx.indexrelid
JOIN pg_class t     ON t.oid = idx.indrelid
JOIN pg_namespace ns ON ns.oid = t.relnamespace
WHERE idx.indisunique
  AND ns.nspname = 'public'
  AND EXISTS (
    SELECT 1 FROM unnest(idx.indkey::int[]) k(attnum)
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE NOT a.attnotnull AND k.attnum > 0
  )
ORDER BY t.relname;
