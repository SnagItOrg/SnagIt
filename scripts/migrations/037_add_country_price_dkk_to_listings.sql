-- Migration 037: add country + price_dkk columns to listings

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS country char(2);

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS price_dkk numeric;

-- Backfill: rows already in DKK get country='DK' and price_dkk = price.
UPDATE listings
SET country = 'DK',
    price_dkk = price::numeric
WHERE country IS NULL
  AND currency = 'DKK';
