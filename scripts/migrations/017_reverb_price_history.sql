-- Migration 017: reverb_price_history
-- Stores sold listing prices fetched from Reverb for each watchlist query.
-- Provides market-value intelligence ("what did similar items actually sell for?").
-- Written by fetch-reverb-prices script via service role; readable by watchlist owner.

CREATE TABLE reverb_price_history (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid        REFERENCES watchlists(id) ON DELETE CASCADE,
  query        text        NOT NULL,
  source       text        NOT NULL DEFAULT 'reverb',
  price        numeric     NOT NULL,
  currency     text        NOT NULL DEFAULT 'USD',
  condition    text,
  listing_url  text,
  listing_title text,
  sold_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Deduplicate by listing URL per query (same sold listing can match multiple queries)
  UNIQUE (listing_url, watchlist_id)
);

CREATE INDEX rph_watchlist_id ON reverb_price_history(watchlist_id);
CREATE INDEX rph_query        ON reverb_price_history(query);
CREATE INDEX rph_created_at   ON reverb_price_history(created_at DESC);

ALTER TABLE reverb_price_history ENABLE ROW LEVEL SECURITY;

-- Watchlist owners can read their own price history
CREATE POLICY "Users can read their own reverb_price_history"
  ON reverb_price_history
  FOR SELECT
  TO authenticated
  USING (
    watchlist_id IN (
      SELECT id FROM watchlists WHERE user_id = auth.uid()
    )
  );

-- No client INSERT — script writes via service role (bypasses RLS).
