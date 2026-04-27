-- Migration 032: promote attributes.reverb_csp.csp_id → kg_product.reverb_csp_id
-- Idempotent. Run AFTER scripts/enrich-from-reverb-csp.ts has populated the
-- jsonb carrier on most kg_product rows AND after migration 030 has added
-- the typed column.
--
-- Strategy: copy the integer out of jsonb where confidence is `high` or
-- `medium`. Low / none stay in jsonb only — they are candidates for human
-- review or Haiku disambiguation, not deterministic anchors.
--
-- Run order:
--   030  → adds reverb_csp_id column
--   (run scripts/enrich-from-reverb-csp.ts to populate jsonb)
--   032  → this file, promotes high/medium-confidence values
--
-- Re-run safe: WHERE clause skips rows that already have reverb_csp_id set.

UPDATE kg_product
SET reverb_csp_id = (attributes->'reverb_csp'->>'csp_id')::integer
WHERE
  reverb_csp_id IS NULL
  AND attributes->'reverb_csp'->>'csp_id' IS NOT NULL
  AND (attributes->'reverb_csp'->>'confidence') IN ('high', 'medium');
