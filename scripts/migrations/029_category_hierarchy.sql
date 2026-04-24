-- Migration 029: Two-level category hierarchy
-- Adds domain + parent_id to kg_category for music/design/other scoping,
-- and subcategory_id to kg_product for leaf-level classification.

-- ── kg_category additions ─────────────────────────────────────────────────────

ALTER TABLE kg_category
  ADD COLUMN domain    text NOT NULL DEFAULT 'music'
    CHECK (domain IN ('music', 'design', 'other')),
  ADD COLUMN parent_id uuid REFERENCES kg_category(id);

-- Backfill domain on the four original coarse categories
UPDATE kg_category SET domain = 'music'  WHERE slug = 'music-gear';
UPDATE kg_category SET domain = 'design' WHERE slug = 'danish-modern';
UPDATE kg_category SET domain = 'other'  WHERE slug = 'photography';
UPDATE kg_category SET domain = 'other'  WHERE slug = 'tech';

-- ── kg_product additions ──────────────────────────────────────────────────────

ALTER TABLE kg_product
  ADD COLUMN subcategory_id          uuid REFERENCES kg_category(id),
  ADD COLUMN subcategory_confidence  smallint,
  ADD COLUMN reverb_root_slug        text,
  ADD COLUMN reverb_sub_slug         text;

-- Sparse index to drive the classification review queue
CREATE INDEX idx_kg_product_subcategory_null
  ON kg_product(subcategory_id)
  WHERE subcategory_id IS NULL;
