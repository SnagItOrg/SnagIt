-- Migration 027: thomann_price_updated_at on kg_product
--
-- Tracks when thomann_price_dkk was last fetched so we can do bi-weekly
-- staleness-based refresh instead of only filling NULL prices.

ALTER TABLE kg_product ADD COLUMN IF NOT EXISTS thomann_price_updated_at timestamptz;
