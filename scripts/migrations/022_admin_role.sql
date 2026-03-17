-- Admin flag on user_preferences
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;

-- MSRP + Thomann URL on kg_product
ALTER TABLE kg_product ADD COLUMN IF NOT EXISTS msrp_dkk integer;
ALTER TABLE kg_product ADD COLUMN IF NOT EXISTS thomann_url text;
