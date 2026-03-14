-- Migration 018: auctionet_price_history
-- Stores sold auction prices fetched from Auctionet for each watchlist query.
-- Includes estimate_low / estimate_high for price-range intelligence.
-- Written by fetch-auctionet-prices script via service role; readable by watchlist owner.

CREATE TABLE auctionet_price_history (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id  uuid        REFERENCES watchlists(id) ON DELETE CASCADE,
  query         text        NOT NULL,
  source        text        NOT NULL DEFAULT 'auctionet',
  price         numeric     NOT NULL,
  currency      text        NOT NULL DEFAULT 'DKK',
  condition     text,
  listing_url   text,
  listing_title text,
  estimate_low  numeric,
  estimate_high numeric,
  sold_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (listing_url, watchlist_id)
);

CREATE INDEX aph_watchlist_id ON auctionet_price_history(watchlist_id);
CREATE INDEX aph_query        ON auctionet_price_history(query);
CREATE INDEX aph_created_at   ON auctionet_price_history(created_at DESC);

ALTER TABLE auctionet_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own auctionet_price_history"
  ON auctionet_price_history
  FOR SELECT
  TO authenticated
  USING (
    watchlist_id IN (
      SELECT id FROM watchlists WHERE user_id = auth.uid()
    )
  );

-- No client INSERT — script writes via service role (bypasses RLS).
