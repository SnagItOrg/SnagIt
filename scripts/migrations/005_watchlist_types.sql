-- Step 5: Support monitoring specific listings (by URL) in addition to search queries

ALTER TABLE watchlists
  ADD COLUMN type text NOT NULL DEFAULT 'query' CHECK (type IN ('query', 'listing')),
  ADD COLUMN source_url text;
