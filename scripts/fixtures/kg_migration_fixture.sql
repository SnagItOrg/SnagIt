-- kg_migration_fixture.sql
--
-- Minimal but FAITHFUL schema + seed for isolated verification of migrations
-- 053 and 054. Loaded only by scripts/verify-migrations-isolated.sh into a
-- disposable local cluster. Never applied to production.
--
-- Faithfulness that matters to the migrations under test:
--   * the same 29 duplicate product rows, with their PRODUCTION UUIDs and slugs
--   * UNIQUE (listing_id, product_id) on listing_product_match
--   * UNIQUE (alias, product_id) on synonym
--   * kg_identifier with NO unique index on value (as in production)
--   * UNIQUE (snapshot_date, kg_product_id, source, country, price_type)
--     on market_price_daily
--   * all 11 FK-bearing dependency tables
--   * the exact identifier rows migration 054 targets

CREATE TABLE kg_brand (id uuid PRIMARY KEY, name text NOT NULL);

CREATE TABLE kg_product (
  id uuid PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  canonical_name text NOT NULL,
  model_name text,
  brand_id uuid REFERENCES kg_brand(id),
  status text NOT NULL DEFAULT 'active',
  browse_visibility text DEFAULT 'qa_only',
  reverb_csp_id integer,
  tier text DEFAULT 'standard'
);

-- Enough of the real `listings` shape for migration 055's ingestion-identity
-- contract: the (external_id, source) conflict target every scraper upserts on,
-- plus the columns those upserts write.
CREATE TABLE listings (
  id uuid PRIMARY KEY,
  title text,
  url text,
  source text,
  external_id text,
  scraped_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true
);
CREATE UNIQUE INDEX listings_external_id_source ON listings (external_id, source);

CREATE TABLE listing_product_match (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id),
  product_id uuid NOT NULL REFERENCES kg_product(id),
  method text NOT NULL, score smallint NOT NULL,
  explain jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_valid boolean, rejected_reason text
);
CREATE UNIQUE INDEX lpm_listing_product_unique ON listing_product_match (listing_id, product_id);

CREATE TABLE synonym (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias text NOT NULL, canonical_query text, product_id uuid REFERENCES kg_product(id),
  category_id uuid, lang text NOT NULL DEFAULT 'da',
  match_type text NOT NULL DEFAULT 'alias', priority integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX synonym_alias_product_unique ON synonym (alias, product_id);

-- NOTE: no unique index on value — production has only a plain btree(lower(value)).
CREATE TABLE kg_identifier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES kg_product(id),
  type text NOT NULL CHECK (type IN ('EAN','SKU','MODEL','PART_NUMBER')),
  value text NOT NULL, confidence smallint, source text
);
CREATE INDEX kg_identifier_value ON kg_identifier (lower(value));

CREATE TABLE kg_relation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_product_id uuid NOT NULL REFERENCES kg_product(id),
  to_product_id uuid NOT NULL REFERENCES kg_product(id),
  type text NOT NULL, weight numeric, notes text
);

CREATE TABLE reverb_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kg_product_id uuid REFERENCES kg_product(id) ON DELETE SET NULL,
  listing_url text, watchlist_id uuid, price numeric, sold_at timestamptz
);
CREATE TABLE market_price_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kg_product_id uuid REFERENCES kg_product(id),
  source text, external_id text, price_type text, observed_at timestamptz
);
CREATE TABLE market_price_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kg_product_id uuid REFERENCES kg_product(id),
  snapshot_date date, source text, country text, price_type text,
  UNIQUE (snapshot_date, kg_product_id, source, country, price_type)
);
CREATE TABLE price_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES kg_product(id), listing_id uuid
);
CREATE TABLE scrape_query_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kg_product_id uuid REFERENCES kg_product(id), run_id uuid, query text
);
CREATE TABLE thomann_product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kg_product_id uuid REFERENCES kg_product(id) ON DELETE SET NULL,
  thomann_url text UNIQUE
);

-- ── Brands ────────────────────────────────────────────────────────────────
INSERT INTO kg_brand (id, name) VALUES
 ('11111111-0000-0000-0000-000000000001','Elektron'),
 ('11111111-0000-0000-0000-000000000002','HP'),
 ('11111111-0000-0000-0000-000000000003','JoMoX'),
 ('11111111-0000-0000-0000-000000000004','Manley'),
 ('11111111-0000-0000-0000-000000000005','Moog'),
 ('11111111-0000-0000-0000-000000000006','Novation'),
 ('11111111-0000-0000-0000-000000000007','Propellerhead'),
 ('11111111-0000-0000-0000-000000000008','Roland'),
 ('11111111-0000-0000-0000-000000000009','Teenage Engineering'),
 ('11111111-0000-0000-0000-00000000000a','Teisco'),
 ('11111111-0000-0000-0000-00000000000b','Gibson'),
 ('11111111-0000-0000-0000-00000000000c','Epiphone'),
 ('11111111-0000-0000-0000-00000000000d','Sequential');

-- ── The 29 duplicate rows, production UUIDs ───────────────────────────────
INSERT INTO kg_product (id, slug, canonical_name, model_name, brand_id, status, browse_visibility, reverb_csp_id, tier) VALUES
 ('3845393d-00ad-473a-bdad-af69fe9a886e','elektron-analogrytmMKII','Elektron Analog Rytm MKII','Analog Rytm MKII','11111111-0000-0000-0000-000000000001','active','qa_only',81886,'standard'),
 ('76e1995a-3c03-4a8f-a19a-d342da7bc48f','elektron-elektron-analog-rytm-mkii','Elektron Analog Rytm MKII','Analog Rytm MKII','11111111-0000-0000-0000-000000000001','active','qa_only',81886,'standard'),
 ('aaae5cda-7738-4a53-afdd-3cd493d4dab4','elektron-machinedrum-sps-1','Elektron Machinedrum SPS-1','SPS-1','11111111-0000-0000-0000-000000000001','active','qa_only',5358,'standard'),
 ('923a8381-1887-4edb-acc5-2e72db6e6821','elektron-machinedrum','Elektron Machinedrum SPS-1','SPS-1','11111111-0000-0000-0000-000000000001','active','qa_only',5358,'standard'),
 -- Both HP Z8 rows are ALREADY inactive in production; the fixture matches.
 ('7e90858b-1652-4a6a-a07b-544bbf38b1f3','hp-z8','HP Z8 (Workstation)','Z8','11111111-0000-0000-0000-000000000002','inactive','qa_only',NULL,'standard'),
 ('6e6dd995-d4c9-43ac-8ad0-9dbde6116fa1','hp-z8-workstation','HP Z8 Workstation','Z8','11111111-0000-0000-0000-000000000002','inactive','qa_only',NULL,'standard'),
 ('6d6bd2ee-89e9-4469-afb1-10a4982e20f0','jomox-airbase-99','JoMoX AirBase 99','AirBase 99','11111111-0000-0000-0000-000000000003','active','qa_only',NULL,'standard'),
 ('f96d61dc-cf81-463b-8bf1-d9beffb0e1d5','jomox-jomox-airbase-99','JoMox Airbase 99','Airbase 99','11111111-0000-0000-0000-000000000003','active','qa_only',NULL,'standard'),
 ('92982f65-e9eb-448a-b647-2cc81f23af4c','manley-core','Manley CORE','CORE','11111111-0000-0000-0000-000000000004','active','qa_only',1982,'standard'),
 ('a08c0c96-c842-496e-8fa7-d7fc97cbe658','manley-manley-core','Manley CORE','CORE','11111111-0000-0000-0000-000000000004','active','qa_only',1982,'standard'),
 ('6aeb4f2a-357d-4a2b-8cb2-cd87d0c470ac','manley-ref-c','Manley Reference Cardioid','Reference Cardioid','11111111-0000-0000-0000-000000000004','active','qa_only',1865,'standard'),
 ('3bfa3be3-fc54-4698-a1e8-bb2c488ba63c','manley-reference-cardioid','Manley Reference Cardioid','Reference Cardioid','11111111-0000-0000-0000-000000000004','active','qa_only',1865,'standard'),
 ('185521d4-c2bc-45e1-a42c-85fadd2248e7','manley-manley-reference-cardioid','Manley Reference Cardioid','Reference Cardioid','11111111-0000-0000-0000-000000000004','active','qa_only',1865,'standard'),
 ('b921847d-4513-4206-8902-f1c7616ca6ac','manley-reference-gold','Manley Reference Gold','Reference Gold','11111111-0000-0000-0000-000000000004','active','qa_only',6070,'standard'),
 ('37e806b8-0c43-423c-b5eb-89ca10aa5360','manley-ref-gold','Manley Reference Gold','Reference Gold','11111111-0000-0000-0000-000000000004','active','qa_only',6070,'standard'),
 ('40355ea0-81f8-4df4-a2c9-fc788197a146','moog-slim-phatty','Moog Slim Phatty','Slim Phatty','11111111-0000-0000-0000-000000000005','active','qa_only',1174,'standard'),
 ('950e7f3b-a902-4602-9632-2702a755f03a','moog-moog-slim-phatty','Moog Slim Phatty','Slim Phatty','11111111-0000-0000-0000-000000000005','active','qa_only',1174,'standard'),
 ('46509b95-ce08-4727-85ea-c237d594413d','moog-moog-subsequent-37','Moog Subsequent 37','Subsequent 37','11111111-0000-0000-0000-000000000005','active','qa_only',68963,'standard'),
 ('15f32b11-fab0-4007-a1ce-ff7cb2aafb49','moog-subsequent-37','Moog Subsequent 37','Subsequent 37','11111111-0000-0000-0000-000000000005','active','qa_only',68963,'standard'),
 ('666dc5e3-7a50-4f55-90ff-fef267ca9db0','novation-novation-bass-station-ii','Novation Bass Station II','Bass Station II','11111111-0000-0000-0000-000000000006','active','qa_only',1137,'standard'),
 ('cef40460-946f-45ac-a7a7-c1aba9770ad4','novation-bass_station2','Novation Bass Station II','Bass Station II','11111111-0000-0000-0000-000000000006','active','qa_only',1137,'standard'),
 ('a452be02-2649-4c95-9b77-c19fbb353c4f','propellerhead-rebirth-rb-338','Propellerhead ReBirth RB-338','RB-338','11111111-0000-0000-0000-000000000007','active','qa_only',NULL,'standard'),
 ('56e302b8-892a-4948-89e3-ff07d944d64f','propellerhead-rebirth','Propellerhead ReBirth RB-338','RB-338','11111111-0000-0000-0000-000000000007','active','qa_only',NULL,'standard'),
 ('07cc1ac5-a0c9-4707-99ed-c4440a1f9563','roland-re-201','Roland RE-201 (Space Echo)','RE-201','11111111-0000-0000-0000-000000000008','active','public',740,'legendary'),
 ('26fd7032-0d6c-4162-b0c0-a5b74755b0f5','roland-re-201-space-echo','Roland RE-201 Space Echo','RE-201','11111111-0000-0000-0000-000000000008','active','qa_only',740,'standard'),
 ('40000232-c58e-4ffa-948f-8de9b90b3285','teenage-engineering-teenage-engineering-ep-133-k-o-ii','TEENAGE ENGINEERING EP-133 K.O. II','EP-133 K.O. II','11111111-0000-0000-0000-000000000009','active','qa_only',173303,'standard'),
 ('d6b5172d-2cd3-4398-801f-d1d4e57f30dd','teenage-engineering-ep-133-ko-ii','Teenage Engineering EP-133 K.O. II','EP-133 K.O. II','11111111-0000-0000-0000-000000000009','active','qa_only',NULL,'standard'),
 ('958685c7-deb4-40cf-87e0-0514f6ded940','teisco-synthesizer-110f','Teisco Synthesizer 110F','Synthesizer 110F','11111111-0000-0000-0000-00000000000a','active','qa_only',NULL,'standard'),
 ('0782e37c-c6ad-4045-aeef-b578c5849e75','teisco-synthesizer-110f-0','Teisco Synthesizer 110F','Synthesizer 110F','11111111-0000-0000-0000-00000000000a','active','qa_only',NULL,'standard');

-- Products migration 054 curates. Their model_names are UNIQUE per brand, so
-- they add no duplicate group (the count stays at 14).
INSERT INTO kg_product (id, slug, canonical_name, model_name, brand_id, status, browse_visibility, tier) VALUES
 ('776dff2d-15eb-42fe-8202-471f0feebbb6','gibson-les-paul','Gibson Les Paul','Les Paul','11111111-0000-0000-0000-00000000000b','active','public','legendary'),
 ('8f372868-e008-4a0e-b6fd-0b9fcd901fbd','epiphone-les-paul','Epiphone Les Paul','Les Paul EPI','11111111-0000-0000-0000-00000000000c','active','qa_only','standard'),
 ('c716d85e-a9b1-4ccf-b96c-387589a73d49','gibson-es-335','Gibson ES-335','ES-335','11111111-0000-0000-0000-00000000000b','active','public','legendary'),
 ('d47d5b8b-aa49-4a2e-8888-b167da141b99','epiphone-es-335','Epiphone ES-335','ES-335 EPI','11111111-0000-0000-0000-00000000000c','active','qa_only','standard'),
 ('b43d7b32-b58e-4ab1-8d47-a565cf448a65','sequential-tom','Sequential Circuits TOM','TOM','11111111-0000-0000-0000-00000000000d','active','qa_only','standard');

-- ── Identifiers targeted by migration 054 (production ids) ────────────────
INSERT INTO kg_identifier (id, product_id, type, value, confidence, source) VALUES
 ('bb30eefe-e39c-486c-b73e-0517016da18f','776dff2d-15eb-42fe-8202-471f0feebbb6','SKU','PAUL',80,'seed'),
 ('65b12d19-9093-4a6f-a841-3b919f37e5dc','b43d7b32-b58e-4ab1-8d47-a565cf448a65','SKU','TOM',80,'seed'),
 ('b056bb68-0de4-4b5c-9d8f-0d667fe45a1a','c716d85e-a9b1-4ccf-b96c-387589a73d49','SKU','335',80,'seed'),
 ('8498a9b8-0efa-48a4-aa42-9d56404fa383','8f372868-e008-4a0e-b6fd-0b9fcd901fbd','SKU','Les Paul',80,'seed'),
 ('f22b5162-6af6-4efd-be72-02834da74c47','d47d5b8b-aa49-4a2e-8888-b167da141b99','SKU','ES-335',80,'seed');

-- Identifiers on duplicate rows: exercises the dedupe branch (both sides hold
-- the same normalised value, so one must be deleted and archived).
INSERT INTO kg_identifier (product_id, type, value, confidence, source) VALUES
 ('6aeb4f2a-357d-4a2b-8cb2-cd87d0c470ac','SKU','Reference Cardioid',80,'seed'),
 ('3bfa3be3-fc54-4698-a1e8-bb2c488ba63c','SKU','reference cardioid',80,'seed'),
 ('07cc1ac5-a0c9-4707-99ed-c4440a1f9563','SKU','RE-201',80,'seed');

-- Remaining seed-derived identifiers for fixture products, so the pre-import
-- state matches what data/knowledge-graph.json actually yields. Without these
-- a clean rebuild would appear to "gain" rows that were simply never seeded.
INSERT INTO kg_identifier (product_id, type, value, confidence, source) VALUES
 ('aaae5cda-7738-4a53-afdd-3cd493d4dab4','SKU','Machinedrum SPS-1',80,'seed'),
 ('aaae5cda-7738-4a53-afdd-3cd493d4dab4','SKU','SPS-1',80,'seed'),
 ('6d6bd2ee-89e9-4469-afb1-10a4982e20f0','SKU','AirBase 99',80,'seed'),
 ('a452be02-2649-4c95-9b77-c19fbb353c4f','SKU','RB-338',80,'seed'),
 -- On the LOSER manley-ref-gold, exactly as in production. Migration 053
 -- repoints it to the survivor; the seed entry was re-keyed to match, so a
 -- clean rebuild puts it back on the SAME surviving product.
 ('37e806b8-0c43-423c-b5eb-89ca10aa5360','SKU','Reference Gold',80,'seed');

-- ── Listings + matches ────────────────────────────────────────────────────
INSERT INTO listings (id, title)
SELECT ('22222222-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'fixture listing ' || g
FROM generate_series(1, 12) g;

-- Repoint-only matches (loser has a match, survivor does not).
INSERT INTO listing_product_match (listing_id, product_id, method, score, is_valid) VALUES
 ('22222222-0000-0000-0000-000000000001','923a8381-1887-4edb-acc5-2e72db6e6821','MODEL',70,TRUE),
 ('22222222-0000-0000-0000-000000000002','a08c0c96-c842-496e-8fa7-d7fc97cbe658','MODEL',70,NULL),
 ('22222222-0000-0000-0000-000000000003','26fd7032-0d6c-4162-b0c0-a5b74755b0f5','MODEL',70,FALSE);

-- COLLISION: same listing matched to BOTH sides of moog|subsequent 37, with
-- compatible validation (NULL + TRUE). Exercises the merge-then-delete branch
-- and the truth table's "confirmation beats unreviewed" rule.
INSERT INTO listing_product_match (listing_id, product_id, method, score, is_valid) VALUES
 ('22222222-0000-0000-0000-000000000004','46509b95-ce08-4727-85ea-c237d594413d','MODEL',70,NULL),
 ('22222222-0000-0000-0000-000000000004','15f32b11-fab0-4007-a1ce-ff7cb2aafb49','SKU', 95,TRUE);

-- COLLISION with a rejection on the loser: rejection must dominate.
-- Survivor is NULL (unreviewed), not TRUE — a TRUE/FALSE pair is a
-- CONTRADICTION and would (correctly) abort the whole migration.
INSERT INTO listing_product_match (listing_id, product_id, method, score, is_valid, rejected_reason) VALUES
 ('22222222-0000-0000-0000-000000000005','40355ea0-81f8-4df4-a2c9-fc788197a146','MODEL',70,NULL,NULL),
 ('22222222-0000-0000-0000-000000000005','950e7f3b-a902-4602-9632-2702a755f03a','MODEL',70,FALSE,'accessory');

-- ── Synonyms: one repoint, one alias collision (dedupe branch) ────────────
INSERT INTO synonym (alias, canonical_query, product_id) VALUES
 ('machinedrum','elektron-machinedrum-sps-1','923a8381-1887-4edb-acc5-2e72db6e6821'),
 ('slim phatty','moog-slim-phatty','40355ea0-81f8-4df4-a2c9-fc788197a146'),
 ('slim phatty','moog-slim-phatty','950e7f3b-a902-4602-9632-2702a755f03a');

-- ── Relations: cross-group, plus one that becomes a self-relation ─────────
INSERT INTO kg_relation (from_product_id, to_product_id, type) VALUES
 ('07cc1ac5-a0c9-4707-99ed-c4440a1f9563','26fd7032-0d6c-4162-b0c0-a5b74755b0f5','successor'),
 ('923a8381-1887-4edb-acc5-2e72db6e6821','92982f65-e9eb-448a-b647-2cc81f23af4c','alternative');

-- ── Price evidence: 20 rows on the public survivor + rows on losers ───────
INSERT INTO reverb_price_history (kg_product_id, listing_url, price)
SELECT '07cc1ac5-a0c9-4707-99ed-c4440a1f9563','https://reverb.test/'||g, 14000+g FROM generate_series(1,20) g;
INSERT INTO reverb_price_history (kg_product_id, listing_url, price) VALUES
 ('26fd7032-0d6c-4162-b0c0-a5b74755b0f5','https://reverb.test/loser-1',15000);

INSERT INTO market_price_observations (kg_product_id, source, external_id, price_type, observed_at) VALUES
 ('950e7f3b-a902-4602-9632-2702a755f03a','dba.dk','ext-1','asking', now());
INSERT INTO market_price_daily (kg_product_id, snapshot_date, source, country, price_type) VALUES
 ('15f32b11-fab0-4007-a1ce-ff7cb2aafb49', DATE '2026-08-01','dba.dk','DK','asking');
INSERT INTO price_observation (product_id, listing_id) VALUES
 ('a08c0c96-c842-496e-8fa7-d7fc97cbe658','22222222-0000-0000-0000-000000000002');
INSERT INTO scrape_query_coverage (kg_product_id, run_id, query) VALUES
 ('26fd7032-0d6c-4162-b0c0-a5b74755b0f5', gen_random_uuid(), 'Roland RE-201');
INSERT INTO thomann_product (kg_product_id, thomann_url) VALUES
 ('cef40460-946f-45ac-a7a7-c1aba9770ad4','https://thomann.test/bass-station');
