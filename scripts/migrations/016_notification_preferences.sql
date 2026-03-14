CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_enabled  boolean DEFAULT true,
  push_enabled   boolean DEFAULT false,
  price_drops    boolean DEFAULT true,
  new_listings   boolean DEFAULT true,
  updated_at     timestamptz DEFAULT now()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own notification preferences"
  ON notification_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
