CREATE TABLE kg_product_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  brand_id uuid REFERENCES kg_brand(id),
  brand_name text,
  category_id uuid REFERENCES kg_category(id),
  source text DEFAULT 'expand-script',
  listing_count integer DEFAULT 0,
  status text DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  notes text
);

CREATE UNIQUE INDEX kg_product_suggestions_name_brand
  ON kg_product_suggestions (canonical_name, brand_id);

ALTER TABLE kg_product_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins only" ON kg_product_suggestions
  USING (auth.uid() IN (
    SELECT user_id FROM user_preferences WHERE is_admin = true
  ));
