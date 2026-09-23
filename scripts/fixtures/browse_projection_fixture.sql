-- browse_projection_fixture.sql
--
-- Minimal but FAITHFUL schema + seed for isolated verification of migration
-- 058 (PAN-133). Loaded only by scripts/verify-migrations-isolated.sh, into
-- its own database inside the disposable local cluster. Never applied to
-- production.
--
-- WHY A SECOND FIXTURE. `kg_migration_fixture.sql` was written for migrations
-- 053-056. Its `kg_product` has no `image_url`, no `hero_image_url`, no
-- `category_id` and no `subcategory_id`; there is no `kg_category` table and no
-- `browse_product_projection` view, so migration 036 cannot even be applied
-- against it. Extending it would also perturb the 053/054 rollback checksum,
-- because 036 UPDATEs `browse_visibility` for classic/legendary rows. A
-- separate database keeps the two state machines from touching each other.
--
-- Faithfulness that matters to the migration under test:
--   * both image columns on kg_product, both nullable, both plain text
--   * the kg_category shape the 036 view joins (slug, name_da, name_en,
--     domain, parent_id) and the self-referencing root/sub hierarchy
--   * kg_brand with the `slug` and `name` the view selects
--   * listings / listing_product_match, so active_listing_count is real
--   * the exact five image states the precedence has to distinguish
--
-- The five seeded products ARE the truth table. Each is named for its state.

CREATE TABLE kg_brand (
  id   uuid PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  name text NOT NULL
);

CREATE TABLE kg_category (
  id        uuid PRIMARY KEY,
  slug      text UNIQUE NOT NULL,
  name_da   text NOT NULL,
  name_en   text NOT NULL,
  domain    text,
  parent_id uuid REFERENCES kg_category(id)
);

CREATE TABLE kg_product (
  id             uuid PRIMARY KEY,
  slug           text UNIQUE NOT NULL,
  canonical_name text NOT NULL,
  brand_id       uuid REFERENCES kg_brand(id),
  category_id    uuid REFERENCES kg_category(id),
  subcategory_id uuid REFERENCES kg_category(id),
  status         text NOT NULL DEFAULT 'active',
  tier           text DEFAULT 'standard',
  -- The two columns the whole ticket is about. INGESTED and CURATED.
  image_url      text,
  hero_image_url text
);
-- `browse_visibility` is deliberately absent: migration 036 adds it, and the
-- rehearsal applies 036 for real rather than assuming its effects.

CREATE TABLE listings (
  id        uuid PRIMARY KEY,
  title     text,
  is_active boolean DEFAULT true
);

CREATE TABLE listing_product_match (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id),
  product_id uuid NOT NULL REFERENCES kg_product(id)
);

-- ── Seed ───────────────────────────────────────────────────────────────────

INSERT INTO kg_brand (id, slug, name) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'rhodes', 'Rhodes');

INSERT INTO kg_category (id, slug, name_da, name_en, domain, parent_id) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'keyboards-and-synths',
   'Keyboards og synthesizere', 'Keyboards and Synths', 'music', NULL);
INSERT INTO kg_category (id, slug, name_da, name_en, domain, parent_id) VALUES
  ('c0000000-0000-0000-0000-000000000002', 'keyboards-and-synths/electric-pianos',
   'Elektriske klaverer', 'Electric Pianos', 'music',
   'c0000000-0000-0000-0000-000000000001');

-- The five image states, one product each.
INSERT INTO kg_product
  (id, slug, canonical_name, brand_id, category_id, subcategory_id, status, tier,
   image_url, hero_image_url)
VALUES
  -- 1. CURATED ONLY — 13 of the 16 affected production rows look like this.
  --    Before 058 the card shows nothing and has_image lies.
  ('a0000000-0000-0000-0000-000000000001', 'hero-only', 'Hero Only',
   'b0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
   'active', 'legendary', NULL, 'https://cdn.example/hero-only.webp'),

  -- 2. INGESTED ONLY — the majority of the catalogue. Must not change.
  ('a0000000-0000-0000-0000-000000000002', 'ingested-only', 'Ingested Only',
   'b0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
   'active', 'legendary', 'https://cdn.example/ingested-only.webp', NULL),

  -- 3. BOTH, DIFFERING — the 3 production rows showing a stale picture.
  ('a0000000-0000-0000-0000-000000000003', 'both-differ', 'Both Differ',
   'b0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
   'active', 'classic', 'https://cdn.example/stale.webp', 'https://cdn.example/curated.webp'),

  -- 4. BLANK HERO — a cleared admin field. Must fall THROUGH to the ingested
  --    image, not resolve to an empty string.
  ('a0000000-0000-0000-0000-000000000004', 'blank-hero', 'Blank Hero',
   'b0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
   'active', 'classic', 'https://cdn.example/fallback.webp', '   '),

  -- 5. NEITHER — genuinely image-less. has_image must stay false throughout.
  ('a0000000-0000-0000-0000-000000000005', 'no-image', 'No Image',
   'b0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
   'active', 'standard', NULL, NULL);

INSERT INTO listings (id, title, is_active) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'A live listing', true);
INSERT INTO listing_product_match (listing_id, product_id) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');
