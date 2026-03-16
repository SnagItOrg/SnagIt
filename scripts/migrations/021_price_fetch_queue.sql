-- Migration 021: price_fetch_queue
-- Demand-driven queue for fetching Reverb sold prices per product.
-- Mac Mini worker picks up pending rows and fetches price data.
-- No user-facing RLS — service role only.

CREATE TABLE price_fetch_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_slug text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(product_slug, status)
);

ALTER TABLE price_fetch_queue ENABLE ROW LEVEL SECURITY;
