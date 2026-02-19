-- Step 2: Lock listings to authenticated users only
-- The cron job uses the service-role (admin) client which bypasses RLS, so it is unaffected.

-- Drop the old anonymous-read policy (name may vary; drop both common names to be safe)
DROP POLICY IF EXISTS "Public read access" ON listings;
DROP POLICY IF EXISTS "Allow public read" ON listings;
DROP POLICY IF EXISTS "Enable read access for all users" ON listings;

-- Allow authenticated users to read all listings
-- (Step 3 will narrow this further to only the user's own data via user_id)
CREATE POLICY "Authenticated users can read listings"
  ON listings FOR SELECT
  TO authenticated
  USING (true);
