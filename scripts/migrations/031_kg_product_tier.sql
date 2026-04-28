ALTER TABLE kg_product
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS year_released INT;

CREATE INDEX IF NOT EXISTS idx_kg_product_tier ON kg_product(tier);
CREATE INDEX IF NOT EXISTS idx_kg_product_tags ON kg_product USING GIN(tags);
