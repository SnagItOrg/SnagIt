-- Migration 038: add match-quality review columns to listing_product_match
--
-- is_valid:        null = unreviewed, true = confirmed, false = rejected
-- rejected_reason: optional free-text, populated when is_valid = false

ALTER TABLE listing_product_match
  ADD COLUMN IF NOT EXISTS is_valid boolean;

ALTER TABLE listing_product_match
  ADD COLUMN IF NOT EXISTS rejected_reason text;
