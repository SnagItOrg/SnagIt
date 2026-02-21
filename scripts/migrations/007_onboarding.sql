-- Step 7: Onboarding support
-- Adds max_price filter to watchlists and a user_preferences table
-- for storing category/brand selections and onboarding state.

-- ── watchlists ─────────────────────────────────────────────────────────────
ALTER TABLE watchlists ADD COLUMN IF NOT EXISTS max_price integer;

-- ── user_preferences ───────────────────────────────────────────────────────
CREATE TABLE user_preferences (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        REFERENCES auth.users NOT NULL UNIQUE,
  categories           text[]      NOT NULL DEFAULT '{}',
  brands               text[]      NOT NULL DEFAULT '{}',
  onboarding_completed boolean     NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read their own preferences
CREATE POLICY "Users can read own preferences"
  ON user_preferences FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can insert their own preferences
CREATE POLICY "Users can insert own preferences"
  ON user_preferences FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can update their own preferences
CREATE POLICY "Users can update own preferences"
  ON user_preferences FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- ── Supabase Storage ────────────────────────────────────────────────────────
-- Create a PUBLIC bucket named: onboarding-assets
-- Run in the Supabase dashboard → Storage → New bucket, or via SQL:
--
--   INSERT INTO storage.buckets (id, name, public)
--   VALUES ('onboarding-assets', 'onboarding-assets', true);
--
-- Asset URL pattern:
--   {SUPABASE_URL}/storage/v1/object/public/onboarding-assets/{filename}
--
-- Example (category tile images):
--   {SUPABASE_URL}/storage/v1/object/public/onboarding-assets/categories/photography.jpg
--   {SUPABASE_URL}/storage/v1/object/public/onboarding-assets/categories/music.jpg
--   {SUPABASE_URL}/storage/v1/object/public/onboarding-assets/categories/furniture.jpg
--   {SUPABASE_URL}/storage/v1/object/public/onboarding-assets/categories/fashion.jpg
--   {SUPABASE_URL}/storage/v1/object/public/onboarding-assets/categories/tech.jpg
