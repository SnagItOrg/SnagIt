-- Migration 026: thomann_product
--
-- Stores Thomann retail products fetched on-demand when users search klup.dk.
-- Each search scrapes Thomann live and upserts here — building price history
-- over time as queries accumulate. Future: once this table has critical mass,
-- serve results directly instead of always hitting Thomann live.
--
-- thomann_url is the stable dedup key (product URLs don't change on Thomann).
-- kg_product_id is nullable — future matching step will link to the KG.

CREATE TABLE thomann_product (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thomann_url    text        NOT NULL UNIQUE,
  canonical_name text        NOT NULL,
  image_url      text,
  price_dkk      integer,
  scraped_at     timestamptz NOT NULL DEFAULT now(),
  kg_product_id  uuid        REFERENCES kg_product(id) ON DELETE SET NULL
);

ALTER TABLE thomann_product ENABLE ROW LEVEL SECURITY;

-- Full-text search index on canonical_name for future KG-first serving
CREATE INDEX thomann_product_name_fts_idx ON thomann_product
  USING gin(to_tsvector('simple', canonical_name));

-- Recency index for staleness-based refresh (future phase)
CREATE INDEX thomann_product_scraped_at_idx ON thomann_product (scraped_at DESC);
