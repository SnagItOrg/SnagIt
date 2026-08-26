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

-- ═══════════════════════════════════════════════════════════════════════════
-- PRODUCTION-ERA PROMOTION CONTRACT (added 2026-08-26)
--
-- Migration 055 redefines promote_scrape_run. Until this block existed the
-- fixture contained no such function, so 055's CREATE OR REPLACE created it
-- from nothing and every rehearsal passed — while against real production
-- (which carries the migration-052 jsonb function) the same statement fails
-- with "cannot change return type of existing function".
--
-- The tables and the function below are the PRODUCTION shape, captured from
-- the live database with pg_dump --schema-only and migration 052. They exist
-- so the harness exercises 055 against what production actually has.
-- ═══════════════════════════════════════════════════════════════════════════

\restrict IEBkPNAdPFQPBjrwpGGIHk8BRyveT7DHCJwS74iVz3e6IOTK7dcHN9pQxAH2OsD
CREATE TABLE listing_coverage_scopes (
    listing_id uuid NOT NULL,
    scope_hash text NOT NULL,
    source text NOT NULL,
    source_query text,
    first_seen_run_id uuid,
    last_seen_run_id uuid,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE listing_staging (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    external_id text,
    title text,
    price integer,
    currency text,
    price_dkk numeric,
    url text,
    image_url text,
    location text,
    source text NOT NULL,
    country character(2),
    normalized_text text,
    platform text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_query text
);
CREATE TABLE scrape_run (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    status text DEFAULT 'running'::text NOT NULL,
    products_attempted integer DEFAULT 0 NOT NULL,
    products_failed integer DEFAULT 0 NOT NULL,
    listings_fetched integer DEFAULT 0 NOT NULL,
    listings_saved integer DEFAULT 0 NOT NULL,
    unique_external_ids integer DEFAULT 0 NOT NULL,
    duplicate_rate numeric,
    null_price integer DEFAULT 0 NOT NULL,
    null_currency integer DEFAULT 0 NOT NULL,
    null_price_dkk integer DEFAULT 0 NOT NULL,
    null_url integer DEFAULT 0 NOT NULL,
    null_title integer DEFAULT 0 NOT NULL,
    price_min_dkk numeric,
    price_median_dkk numeric,
    price_max_dkk numeric,
    new_listings integer DEFAULT 0 NOT NULL,
    price_changes integer DEFAULT 0 NOT NULL,
    refound_listings integer DEFAULT 0 NOT NULL,
    delisted_listings integer DEFAULT 0 NOT NULL,
    volume_delta_pct numeric,
    violations jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    expected_products integer,
    covered_products integer,
    expected_pages integer,
    fetched_pages integer,
    coverage_complete boolean DEFAULT false NOT NULL,
    gate_version text,
    scraper_version text,
    baseline jsonb,
    raw_count integer,
    staged_count integer,
    published_count integer,
    promoted_at timestamp with time zone,
    coverage_version text,
    coverage_scope_hash text,
    parse_error_count integer DEFAULT 0 NOT NULL,
    staging_digest text,
    parser_version text,
    pagination_strategy text,
    run_scope text,
    global_unique_listings integer,
    baseline_status text,
    CONSTRAINT scrape_run_baseline_status_check CHECK (((baseline_status IS NULL) OR (baseline_status = ANY (ARRAY['available'::text, 'unavailable'::text])))),
    CONSTRAINT scrape_run_run_scope_check CHECK (((run_scope IS NULL) OR (run_scope = ANY (ARRAY['complete'::text, 'targeted'::text])))),
    CONSTRAINT scrape_run_status_check CHECK ((status = ANY (ARRAY['running'::text, 'passed'::text, 'quarantined'::text, 'failed'::text])))
);
ALTER TABLE ONLY listing_coverage_scopes
    ADD CONSTRAINT listing_coverage_scopes_pkey PRIMARY KEY (listing_id, scope_hash);
ALTER TABLE ONLY listing_staging
    ADD CONSTRAINT listing_staging_pkey PRIMARY KEY (id);
ALTER TABLE ONLY scrape_run
    ADD CONSTRAINT scrape_run_pkey PRIMARY KEY (id);
CREATE INDEX idx_lcs_listing ON listing_coverage_scopes USING btree (listing_id);
CREATE INDEX idx_lcs_scope ON listing_coverage_scopes USING btree (source, scope_hash);
CREATE INDEX idx_listing_staging_run ON listing_staging USING btree (run_id);
CREATE INDEX idx_scrape_run_baseline_cohort ON scrape_run USING btree (source, coverage_scope_hash, coverage_version, scraper_version, parser_version, pagination_strategy, started_at DESC);
CREATE INDEX idx_scrape_run_source_time ON scrape_run USING btree (source, started_at DESC);
CREATE INDEX idx_scrape_run_status ON scrape_run USING btree (source, status, started_at DESC);
ALTER TABLE ONLY listing_coverage_scopes
    ADD CONSTRAINT listing_coverage_scopes_first_seen_run_id_fkey FOREIGN KEY (first_seen_run_id) REFERENCES scrape_run(id);
ALTER TABLE ONLY listing_coverage_scopes
    ADD CONSTRAINT listing_coverage_scopes_last_seen_run_id_fkey FOREIGN KEY (last_seen_run_id) REFERENCES scrape_run(id);
ALTER TABLE ONLY listing_coverage_scopes
    ADD CONSTRAINT listing_coverage_scopes_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;
ALTER TABLE ONLY listing_staging
    ADD CONSTRAINT listing_staging_run_id_fkey FOREIGN KEY (run_id) REFERENCES scrape_run(id) ON DELETE CASCADE;
ALTER TABLE listing_coverage_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_run ENABLE ROW LEVEL SECURITY;
\unrestrict IEBkPNAdPFQPBjrwpGGIHk8BRyveT7DHCJwS74iVz3e6IOTK7dcHN9pQxAH2OsD

CREATE OR REPLACE FUNCTION promote_scrape_run(
  p_run_id                uuid,
  p_coverage_complete     boolean DEFAULT false,
  p_delist_threshold      int     DEFAULT 3,
  p_lifecycle_enabled     boolean DEFAULT false,
  p_fail_after_listings   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_source        text;
  v_status        text;
  v_promoted_at   timestamptz;
  v_scope         text;
  v_expected_dig  text;
  v_actual_dig    text;
  v_cov_version   text;
  v_scraper_ver   text;
  v_parser_ver    text;
  v_pagination    text;
  v_run_scope     text;
  v_missing       text[];
  v_now           timestamptz := now();
  v_published     int := 0;
  v_first_seen    int := 0;
  v_delisted      int := 0;
  v_missed        int := 0;
  v_lifecycle_ok  boolean := false;
BEGIN
  SELECT source, status, promoted_at, coverage_scope_hash, staging_digest,
         coverage_version, scraper_version, parser_version, pagination_strategy, run_scope
    INTO v_source, v_status, v_promoted_at, v_scope, v_expected_dig,
         v_cov_version, v_scraper_ver, v_parser_ver, v_pagination, v_run_scope
  FROM scrape_run WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'scrape_run % not found', p_run_id; END IF;
  IF v_status <> 'passed' THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'status_not_passed', 'status', v_status);
  END IF;
  IF v_promoted_at IS NOT NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_promoted', 'promoted_at', v_promoted_at);
  END IF;

  v_missing := ARRAY(SELECT f FROM (VALUES
      ('coverage_scope_hash', v_scope),
      ('coverage_version',    v_cov_version),
      ('scraper_version',     v_scraper_ver),
      ('parser_version',      v_parser_ver),
      ('pagination_strategy', v_pagination),
      ('run_scope',           v_run_scope)
    ) AS t(f, v) WHERE v IS NULL OR v = '');
  IF array_length(v_missing, 1) > 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'cohort_identity_missing',
                              'missing', to_jsonb(v_missing));
  END IF;

  IF v_expected_dig IS NOT NULL THEN
    v_actual_dig := compute_staging_digest(p_run_id);
    IF v_actual_dig IS DISTINCT FROM v_expected_dig THEN
      RETURN jsonb_build_object('skipped', true, 'reason', 'staging_mutated',
                                'expected', v_expected_dig, 'actual', v_actual_dig);
    END IF;
  END IF;

  WITH staged AS (
    SELECT DISTINCT ON (external_id)
           external_id, source, country, price, currency, price_dkk, url, title
    FROM listing_staging
    WHERE run_id = p_run_id AND external_id IS NOT NULL AND price_dkk IS NOT NULL
    ORDER BY external_id, source_query NULLS LAST, id
  ),
  latest AS (
    SELECT DISTINCT ON (o.external_id) o.external_id, o.price_dkk
    FROM market_price_observations o
    WHERE o.source = v_source AND o.price_type = 'asking'
      AND o.external_id IN (SELECT external_id FROM staged)
    ORDER BY o.external_id, o.observed_at DESC
  )
  INSERT INTO market_price_observations
    (kg_product_id, source, country, price_type, price_raw, currency,
     price_dkk, listing_url, listing_title, external_id, observed_at)
  SELECT NULL, s.source, COALESCE(s.country,'DK'), 'asking', s.price,
         COALESCE(s.currency,'DKK'), s.price_dkk, s.url, s.title, s.external_id, v_now
  FROM staged s LEFT JOIN latest l USING (external_id)
  WHERE l.price_dkk IS NULL OR l.price_dkk <> s.price_dkk
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_first_seen = ROW_COUNT;

  WITH staged AS (
    SELECT DISTINCT ON (external_id) * FROM listing_staging
    WHERE run_id = p_run_id AND external_id IS NOT NULL
    ORDER BY external_id, source_query NULLS LAST, id
  )
  INSERT INTO listings
    (title, price, currency, price_dkk, url, image_url, location, source,
     country, normalized_text, platform, external_id, scraped_at,
     last_seen_at, first_seen_at, is_active, consecutive_misses,
     last_miss_run_id, delisted_at, coverage_scope_hash, source_query)
  SELECT title, price, currency, price_dkk, url, image_url, location, source,
         country, normalized_text, platform, external_id, v_now, v_now, v_now,
         true, 0, NULL, NULL, v_scope, source_query
  FROM staged
  ON CONFLICT (external_id, source) DO UPDATE SET
    title=EXCLUDED.title, price=EXCLUDED.price, currency=EXCLUDED.currency,
    price_dkk=EXCLUDED.price_dkk, url=EXCLUDED.url, image_url=EXCLUDED.image_url,
    location=EXCLUDED.location, country=EXCLUDED.country,
    normalized_text=EXCLUDED.normalized_text, scraped_at=EXCLUDED.scraped_at,
    last_seen_at=EXCLUDED.last_seen_at,
    first_seen_at=COALESCE(listings.first_seen_at, EXCLUDED.first_seen_at),
    is_active=true, consecutive_misses=0, last_miss_run_id=NULL, delisted_at=NULL,
    coverage_scope_hash=EXCLUDED.coverage_scope_hash,
    source_query=EXCLUDED.source_query;
  GET DIAGNOSTICS v_published = ROW_COUNT;

  -- THE FIX. GROUP BY collapses cross-query duplicates to exactly one row per
  -- listing before the upsert sees them. scope_hash, source, run id and
  -- timestamp are plpgsql variables (constant for the whole statement), so
  -- grouping by l.id alone guarantees one row per (listing_id, scope_hash).
  INSERT INTO listing_coverage_scopes
    (listing_id, scope_hash, source, source_query, first_seen_run_id, last_seen_run_id, last_seen_at)
  SELECT l.id, v_scope, v_source, min(st.source_query), p_run_id, p_run_id, v_now
  FROM listing_staging st
  JOIN listings l ON l.external_id = st.external_id AND l.source = st.source
  WHERE st.run_id = p_run_id AND st.external_id IS NOT NULL AND v_scope IS NOT NULL
  GROUP BY l.id
  ON CONFLICT (listing_id, scope_hash) DO UPDATE
    SET last_seen_run_id = EXCLUDED.last_seen_run_id,
        last_seen_at     = EXCLUDED.last_seen_at;

  IF p_fail_after_listings THEN
    RAISE EXCEPTION 'injected failure after listings upsert (rollback test)';
  END IF;

  v_lifecycle_ok := p_coverage_complete AND p_lifecycle_enabled
                    AND run_has_lifecycle_coverage(p_run_id);

  IF v_lifecycle_ok AND v_scope IS NOT NULL THEN
    WITH seen AS (
      SELECT DISTINCT external_id FROM listing_staging
      WHERE run_id = p_run_id AND external_id IS NOT NULL
    ),
    missing AS (
      SELECT l.id, COALESCE(l.consecutive_misses,0) + 1 AS misses
      FROM listings l
      JOIN listing_coverage_scopes lcs
        ON lcs.listing_id = l.id AND lcs.scope_hash = v_scope
      WHERE l.source = v_source
        AND l.is_active IS DISTINCT FROM false
        AND l.external_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM seen s WHERE s.external_id = l.external_id)
        AND l.last_miss_run_id IS DISTINCT FROM p_run_id
    ),
    upd AS (
      UPDATE listings l SET
        consecutive_misses = m.misses, last_miss_run_id = p_run_id,
        is_active   = CASE WHEN m.misses >= p_delist_threshold THEN false ELSE l.is_active END,
        delisted_at = CASE WHEN m.misses >= p_delist_threshold THEN v_now ELSE l.delisted_at END
      FROM missing m WHERE l.id = m.id
      RETURNING m.misses
    )
    SELECT count(*), count(*) FILTER (WHERE misses >= p_delist_threshold)
      INTO v_missed, v_delisted FROM upd;
  END IF;

  UPDATE scrape_run SET published_count = v_published, promoted_at = v_now
   WHERE id = p_run_id;

  RETURN jsonb_build_object('skipped', false, 'published', v_published,
    'first_seen', v_first_seen, 'missed', v_missed, 'delisted', v_delisted,
    'lifecycle_applied', v_lifecycle_ok);
END $$;
