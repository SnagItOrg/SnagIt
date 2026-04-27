-- Migration 033: kg_category.reverb_uuid
-- Today kg_category joins are keyed by slug. Reverb's /api/categories/flat
-- exposes stable UUIDs that don't break if Reverb ever renames a slug.
-- Adding the uuid column lets us migrate the join progressively without
-- breaking existing slug-based lookups.
--
-- Backfill is performed by scripts/backfill-category-uuids.ts which reads
-- data/reverb-categories.json (the source of truth used by
-- seed-reverb-categories.ts).

ALTER TABLE kg_category
  ADD COLUMN IF NOT EXISTS reverb_uuid uuid;

COMMENT ON COLUMN kg_category.reverb_uuid IS
  'Stable UUID from Reverb /api/categories/flat. Source: data/reverb-categories.json. '
  'Slug remains the human-readable handle; uuid is the durable join key for '
  'integrations and analytics.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_category_reverb_uuid
  ON kg_category(reverb_uuid)
  WHERE reverb_uuid IS NOT NULL;
