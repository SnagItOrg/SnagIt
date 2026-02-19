-- Step 4: Track which listings have been emailed about
-- notified_at IS NULL  → new listing, not yet emailed
-- notified_at IS NOT NULL → already sent in a notification

ALTER TABLE listings ADD COLUMN notified_at timestamptz;
