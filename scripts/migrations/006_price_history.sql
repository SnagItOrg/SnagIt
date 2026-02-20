-- Step 6: Price snapshot history
-- Records the price of every listing each time the cron scrapes it.
-- Unlike the listings table (which upserts/deduplicates), this table
-- appends a new row on every scrape so price trends can be tracked over time.

CREATE TABLE price_snapshots (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_url  text        NOT NULL,
  watchlist_id uuid        REFERENCES watchlists(id) ON DELETE CASCADE,
  price        integer,
  currency     text        NOT NULL DEFAULT 'DKK',
  title        text        NOT NULL,
  scraped_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX price_snapshots_listing_url_idx  ON price_snapshots (listing_url);
CREATE INDEX price_snapshots_watchlist_id_idx ON price_snapshots (watchlist_id);
CREATE INDEX price_snapshots_scraped_at_idx   ON price_snapshots (scraped_at DESC);

ALTER TABLE price_snapshots ENABLE ROW LEVEL SECURITY;

-- Users can read snapshots for listings tied to their own watchlists
CREATE POLICY "Users can read their own price snapshots"
  ON price_snapshots FOR SELECT
  TO authenticated
  USING (
    watchlist_id IN (
      SELECT id FROM watchlists WHERE user_id = auth.uid()
    )
  );
