-- Step 3: Watchlists table + listings linked to watchlists

-- 1. Create watchlists table
CREATE TABLE watchlists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  active     boolean NOT NULL DEFAULT true
);

ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;

-- Users can only see and manage their own watchlists
CREATE POLICY "Users manage their own watchlists"
  ON watchlists FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 2. Add watchlist_id to listings
ALTER TABLE listings
  ADD COLUMN watchlist_id uuid REFERENCES watchlists(id) ON DELETE CASCADE;

-- 3. Replace the url-only unique constraint with a composite one.
--    NULLS NOT DISTINCT means (url, NULL) and (url, NULL) still conflict,
--    so manual scrapes (watchlist_id = NULL) are still deduplicated by url.
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_url_key;

ALTER TABLE listings
  ADD CONSTRAINT listings_url_watchlist_unique
  UNIQUE NULLS NOT DISTINCT (url, watchlist_id);

-- 4. Tighten listings RLS: users can only read listings tied to their own watchlists
DROP POLICY IF EXISTS "Authenticated users can read listings" ON listings;

CREATE POLICY "Users can read their own listings"
  ON listings FOR SELECT
  TO authenticated
  USING (
    watchlist_id IN (
      SELECT id FROM watchlists WHERE user_id = auth.uid()
    )
  );
