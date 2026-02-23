-- Migration 008: Knowledge Graph — Phase 0
-- Creates kg_category, kg_brand, kg_product, kg_identifier, kg_relation, synonym
-- and seeds data from data/knowledge-graph.json + data/synonyms.json
--
-- Run in Supabase SQL Editor (or via supabase db push)

-- ── kg_category ───────────────────────────────────────────────────────────────
CREATE TABLE kg_category (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug     text UNIQUE NOT NULL,
  name_da  text NOT NULL,
  name_en  text NOT NULL
);

-- ── kg_brand ──────────────────────────────────────────────────────────────────
CREATE TABLE kg_brand (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  category_id uuid REFERENCES kg_category NOT NULL
);

-- ── kg_product ────────────────────────────────────────────────────────────────
CREATE TABLE kg_product (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text        UNIQUE NOT NULL,
  canonical_name text        NOT NULL,
  model_name     text,
  brand_id       uuid        REFERENCES kg_brand     NOT NULL,
  category_id    uuid        REFERENCES kg_category  NOT NULL,
  attributes     jsonb       NOT NULL DEFAULT '{}',
  price_min_dkk  int,
  price_max_dkk  int,
  era            text,
  reference_url  text,
  status         text        NOT NULL DEFAULT 'active',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── kg_identifier ─────────────────────────────────────────────────────────────
CREATE TABLE kg_identifier (
  id         uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid     REFERENCES kg_product NOT NULL,
  type       text     NOT NULL CHECK (type IN ('EAN','SKU','MODEL','PART_NUMBER')),
  value      text     NOT NULL,
  confidence smallint NOT NULL DEFAULT 80,
  source     text     NOT NULL DEFAULT 'seed'
);

-- ── kg_relation ───────────────────────────────────────────────────────────────
CREATE TABLE kg_relation (
  id              uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  from_product_id uuid     REFERENCES kg_product NOT NULL,
  to_product_id   uuid     REFERENCES kg_product NOT NULL,
  type            text     NOT NULL CHECK (type IN ('sibling','successor','predecessor','clone','alternative','compatible')),
  weight          smallint NOT NULL DEFAULT 50,
  notes           text
);

-- ── synonym ───────────────────────────────────────────────────────────────────
CREATE TABLE synonym (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias           text NOT NULL,
  canonical_query text,
  product_id      uuid REFERENCES kg_product,
  category_id     uuid REFERENCES kg_category,
  lang            text NOT NULL DEFAULT 'da',
  match_type      text NOT NULL CHECK (match_type IN ('exact','alias','abbrev')),
  priority        int  NOT NULL DEFAULT 50
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX kg_brand_category_id     ON kg_brand     (category_id);
CREATE INDEX kg_product_brand_id      ON kg_product   (brand_id);
CREATE INDEX kg_product_category_id   ON kg_product   (category_id);
CREATE INDEX kg_identifier_product_id ON kg_identifier (product_id);
CREATE INDEX kg_identifier_value      ON kg_identifier (lower(value));
CREATE INDEX kg_relation_from         ON kg_relation  (from_product_id);
CREATE INDEX kg_relation_to           ON kg_relation  (to_product_id);
CREATE INDEX synonym_alias            ON synonym      (lower(alias));
CREATE INDEX synonym_canonical        ON synonym      (lower(canonical_query));

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE kg_category  ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_brand     ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_product   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_identifier ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_relation  ENABLE ROW LEVEL SECURITY;
ALTER TABLE synonym      ENABLE ROW LEVEL SECURITY;

-- KG tables are public read (used for search enrichment)
CREATE POLICY "Public read" ON kg_category   FOR SELECT USING (true);
CREATE POLICY "Public read" ON kg_brand      FOR SELECT USING (true);
CREATE POLICY "Public read" ON kg_product    FOR SELECT USING (true);
CREATE POLICY "Public read" ON kg_identifier FOR SELECT USING (true);
CREATE POLICY "Public read" ON kg_relation   FOR SELECT USING (true);
CREATE POLICY "Public read" ON synonym       FOR SELECT USING (true);

-- ── Seed: Categories ──────────────────────────────────────────────────────────
INSERT INTO kg_category (slug, name_da, name_en) VALUES
  ('music-gear',    'Musikudstyr',  'Music Gear'),
  ('danish-modern', 'Dansk Design', 'Danish Modern'),
  ('photography',   'Fotografi',    'Photography'),
  ('tech',          'Teknologi',    'Technology');

-- ── Seed: Brands ──────────────────────────────────────────────────────────────
INSERT INTO kg_brand (slug, name, category_id) VALUES
  -- music-gear
  ('roland',          'Roland',                   (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('moog',            'Moog',                     (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('sequential',      'Sequential',               (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('teenage-engineering', 'Teenage Engineering',  (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('behringer',       'Behringer',                (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('fender',          'Fender',                   (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('gibson',          'Gibson',                   (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('emu',             'E-mu',                     (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('elektron',        'Elektron',                 (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('jomox',           'JoMoX',                    (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('novation',        'Novation',                 (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('oberheim',        'Oberheim',                 (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('propellerhead',   'Propellerhead',            (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('epiphone',        'Epiphone',                 (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('boss',            'Boss',                     (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('akai',            'Akai',                     (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('ssl',             'SSL',                      (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('api',             'API',                      (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('neve',            'Neve',                     (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('tube-tech',       'Tube-Tech',                (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('neumann',         'Neumann',                  (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('manley',          'Manley',                   (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('kush-audio',      'Kush Audio',               (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('ua',              'Universal Audio',          (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('warm-audio',      'Warm Audio',               (SELECT id FROM kg_category WHERE slug='music-gear')),
  ('bae',             'BAE Audio',                (SELECT id FROM kg_category WHERE slug='music-gear')),
  -- danish-modern
  ('poul-kjærholm',   'Poul Kjærholm',            (SELECT id FROM kg_category WHERE slug='danish-modern')),
  ('hans-j-wegner',   'Hans J. Wegner',           (SELECT id FROM kg_category WHERE slug='danish-modern')),
  ('arne-jacobsen',   'Arne Jacobsen',            (SELECT id FROM kg_category WHERE slug='danish-modern')),
  -- photography
  ('leica',           'Leica',                    (SELECT id FROM kg_category WHERE slug='photography')),
  ('hasselblad',      'Hasselblad',               (SELECT id FROM kg_category WHERE slug='photography')),
  ('canon',           'Canon',                    (SELECT id FROM kg_category WHERE slug='photography')),
  ('sony',            'Sony',                     (SELECT id FROM kg_category WHERE slug='photography')),
  -- tech
  ('apple',           'Apple',                    (SELECT id FROM kg_category WHERE slug='tech')),
  ('nvidia',          'Nvidia',                   (SELECT id FROM kg_category WHERE slug='tech')),
  ('lenovo',          'Lenovo',                   (SELECT id FROM kg_category WHERE slug='tech')),
  ('hp',              'HP',                       (SELECT id FROM kg_category WHERE slug='tech')),
  ('dell',            'Dell',                     (SELECT id FROM kg_category WHERE slug='tech'));

-- ── Seed: Products — Roland ───────────────────────────────────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, price_min_dkk, price_max_dkk, era, reference_url) VALUES
  ('roland-jp-4',   'Roland JP-4 (Jupiter 4)',         'JP-4',   (SELECT id FROM kg_brand WHERE slug='roland'), (SELECT id FROM kg_category WHERE slug='music-gear'), 8000,  18000, '1978-1981', 'https://www.vintagesynth.com/roland/jupiter-4'),
  ('roland-jp-6',   'Roland JP-6 (Jupiter 6)',         'JP-6',   (SELECT id FROM kg_brand WHERE slug='roland'), (SELECT id FROM kg_category WHERE slug='music-gear'), 10000, 22000, '1983-1984', 'https://www.vintagesynth.com/roland/jupiter-6'),
  ('roland-jp-8',   'Roland JP-8 (Jupiter 8)',         'JP-8',   (SELECT id FROM kg_brand WHERE slug='roland'), (SELECT id FROM kg_category WHERE slug='music-gear'), 35000, 70000, '1981-1985', 'https://www.vintagesynth.com/roland/jupiter-8'),
  ('roland-juno-60',  'Roland Juno-60',                'Juno-60', (SELECT id FROM kg_brand WHERE slug='roland'), (SELECT id FROM kg_category WHERE slug='music-gear'), 6000,  12000, '1982-1984', NULL),
  ('roland-juno-106', 'Roland Juno-106',               'Juno-106',(SELECT id FROM kg_brand WHERE slug='roland'), (SELECT id FROM kg_category WHERE slug='music-gear'), 5000,  10000, '1984-1985', NULL),
  ('roland-sh-101',  'Roland SH-101',                  'SH-101', (SELECT id FROM kg_brand WHERE slug='roland'), (SELECT id FROM kg_category WHERE slug='music-gear'), 4000,  9000,  '1982-1986', NULL),
  ('roland-tr-808',  'Roland TR-808 (Rhythm Composer)', 'TR-808', (SELECT id FROM kg_brand WHERE slug='roland'), (SELECT id FROM kg_category WHERE slug='music-gear'), NULL,  NULL,  '1981-1984', 'https://www.vintagesynth.com/roland/tr-808'),
  ('roland-tr-909',  'Roland TR-909',                  'TR-909', (SELECT id FROM kg_brand WHERE slug='roland'), (SELECT id FROM kg_category WHERE slug='music-gear'), NULL,  NULL,  '1983-1984', 'https://www.vintagesynth.com/roland/tr-909'),
  ('roland-tr-606',  'Roland TR-606',                  'TR-606', (SELECT id FROM kg_brand WHERE slug='roland'), (SELECT id FROM kg_category WHERE slug='music-gear'), NULL,  NULL,  '1981-1984', 'https://www.vintagesynth.com/roland/tr-606'),
  ('roland-tr-707',  'Roland TR-707',                  'TR-707', (SELECT id FROM kg_brand WHERE slug='roland'), (SELECT id FROM kg_category WHERE slug='music-gear'), NULL,  NULL,  '1984-1986', 'https://www.vintagesynth.com/roland/tr-707'),
  ('roland-tr-505',  'Roland TR-505',                  'TR-505', (SELECT id FROM kg_brand WHERE slug='roland'), (SELECT id FROM kg_category WHERE slug='music-gear'), NULL,  NULL,  '1986-1989', 'https://www.vintagesynth.com/roland/tr-505'),
  ('roland-re-201',  'Roland RE-201 (Space Echo)',      'RE-201', (SELECT id FROM kg_brand WHERE slug='roland'), (SELECT id FROM kg_category WHERE slug='music-gear'), NULL,  NULL,  '1974-1980s','https://www.vintagesynth.com/roland/re-201'),
  ('roland-re-501',  'Roland RE-501 (Chorus Echo)',     'RE-501', (SELECT id FROM kg_brand WHERE slug='roland'), (SELECT id FROM kg_category WHERE slug='music-gear'), NULL,  NULL,  '1970s-1980s','https://www.vintagesynth.com/roland/re-501'),
  ('roland-tr-09',   'Roland TR-09 (Boutique)',         'TR-09',  (SELECT id FROM kg_brand WHERE slug='roland'), (SELECT id FROM kg_category WHERE slug='music-gear'), NULL,  NULL,  '2016-',     'https://www.roland.com/');

-- ── Seed: Products — Moog ─────────────────────────────────────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, price_min_dkk, price_max_dkk, era, reference_url) VALUES
  ('moog-minimoog-model-d', 'Moog Minimoog Model D', 'Minimoog', (SELECT id FROM kg_brand WHERE slug='moog'), (SELECT id FROM kg_category WHERE slug='music-gear'), 12000, 35000, '1970-1981', 'https://www.vintagesynth.com/moog/minimoog.php'),
  ('moog-subsequent-37',    'Moog Subsequent 37',    'Sub 37',   (SELECT id FROM kg_brand WHERE slug='moog'), (SELECT id FROM kg_category WHERE slug='music-gear'), 8000,  14000, NULL,        NULL);

-- ── Seed: Products — Sequential ───────────────────────────────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, price_min_dkk, price_max_dkk, era, reference_url) VALUES
  ('sequential-prophet-5',   'Sequential Prophet-5',           'Prophet-5',  (SELECT id FROM kg_brand WHERE slug='sequential'), (SELECT id FROM kg_category WHERE slug='music-gear'), 20000, 50000, '1978-1984', NULL),
  ('sequential-prophet-6',   'Sequential Prophet-6',           'Prophet-6',  (SELECT id FROM kg_brand WHERE slug='sequential'), (SELECT id FROM kg_category WHERE slug='music-gear'), 12000, 20000, NULL,        NULL),
  ('sequential-drumtraks',   'Sequential Circuits DrumTraks',  'DrumTraks',  (SELECT id FROM kg_brand WHERE slug='sequential'), (SELECT id FROM kg_category WHERE slug='music-gear'), NULL,  NULL,  '1984',      'https://www.vintagesynth.com/sequential/drumtraks'),
  ('sequential-tom',         'Sequential Circuits TOM',        'TOM',        (SELECT id FROM kg_brand WHERE slug='sequential'), (SELECT id FROM kg_category WHERE slug='music-gear'), NULL,  NULL,  '1985',      'https://www.vintagesynth.com/sequential/tom');

-- ── Seed: Products — Teenage Engineering ──────────────────────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, price_min_dkk, price_max_dkk, era) VALUES
  ('te-op-1',       'Teenage Engineering OP-1',       'OP-1',       (SELECT id FROM kg_brand WHERE slug='teenage-engineering'), (SELECT id FROM kg_category WHERE slug='music-gear'), 5000, 9000,  NULL),
  ('te-op-1-field', 'Teenage Engineering OP-1 Field', 'OP-1 Field', (SELECT id FROM kg_brand WHERE slug='teenage-engineering'), (SELECT id FROM kg_category WHERE slug='music-gear'), 8000, 13000, NULL),
  ('te-op-z',       'Teenage Engineering OP-Z',       'OP-Z',       (SELECT id FROM kg_brand WHERE slug='teenage-engineering'), (SELECT id FROM kg_category WHERE slug='music-gear'), 3500, 6000,  NULL);

-- ── Seed: Products — Behringer ────────────────────────────────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, price_min_dkk, price_max_dkk) VALUES
  ('behringer-ju-06',   'Behringer JU-06 (Juno-klon)',      'JU-06',   (SELECT id FROM kg_brand WHERE slug='behringer'), (SELECT id FROM kg_category WHERE slug='music-gear'), 1500, 3500),
  ('behringer-model-d', 'Behringer Model D (Minimoog-klon)','Model D',  (SELECT id FROM kg_brand WHERE slug='behringer'), (SELECT id FROM kg_category WHERE slug='music-gear'), 1200, 2500);

-- ── Seed: Products — Fender ───────────────────────────────────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, price_min_dkk, price_max_dkk) VALUES
  ('fender-stratocaster',   'Fender Stratocaster',   'Stratocaster',   (SELECT id FROM kg_brand WHERE slug='fender'), (SELECT id FROM kg_category WHERE slug='music-gear'), 3000,  25000),
  ('fender-telecaster',     'Fender Telecaster',     'Telecaster',     (SELECT id FROM kg_brand WHERE slug='fender'), (SELECT id FROM kg_category WHERE slug='music-gear'), 3000,  22000),
  ('fender-jazzmaster',     'Fender Jazzmaster',     'Jazzmaster',     (SELECT id FROM kg_brand WHERE slug='fender'), (SELECT id FROM kg_category WHERE slug='music-gear'), 4000,  30000),
  ('fender-jaguar',         'Fender Jaguar',         'Jaguar',         (SELECT id FROM kg_brand WHERE slug='fender'), (SELECT id FROM kg_category WHERE slug='music-gear'), 4000,  28000),
  ('fender-precision-bass', 'Fender Precision Bass', 'Precision Bass', (SELECT id FROM kg_brand WHERE slug='fender'), (SELECT id FROM kg_category WHERE slug='music-gear'), 3500,  25000),
  ('fender-jazz-bass',      'Fender Jazz Bass',      'Jazz Bass',      (SELECT id FROM kg_brand WHERE slug='fender'), (SELECT id FROM kg_category WHERE slug='music-gear'), 3500,  26000);

-- ── Seed: Products — Gibson + Epiphone ───────────────────────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, price_min_dkk, price_max_dkk) VALUES
  ('gibson-les-paul', 'Gibson Les Paul', 'Les Paul', (SELECT id FROM kg_brand WHERE slug='gibson'), (SELECT id FROM kg_category WHERE slug='music-gear'), 6000,  40000),
  ('gibson-es-335',   'Gibson ES-335',   'ES-335',   (SELECT id FROM kg_brand WHERE slug='gibson'), (SELECT id FROM kg_category WHERE slug='music-gear'), 8000,  35000),
  ('gibson-sg',       'Gibson SG',       'SG',       (SELECT id FROM kg_brand WHERE slug='gibson'), (SELECT id FROM kg_category WHERE slug='music-gear'), 6000,  25000),
  ('gibson-j-45',     'Gibson J-45',     'J-45',     (SELECT id FROM kg_brand WHERE slug='gibson'), (SELECT id FROM kg_category WHERE slug='music-gear'), 8000,  28000),
  ('epiphone-les-paul','Epiphone Les Paul','Les Paul',(SELECT id FROM kg_brand WHERE slug='epiphone'),(SELECT id FROM kg_category WHERE slug='music-gear'), 2000,  9000),
  ('epiphone-es-335', 'Epiphone ES-335', 'ES-335',   (SELECT id FROM kg_brand WHERE slug='epiphone'),(SELECT id FROM kg_category WHERE slug='music-gear'), 2500,  9000),
  ('epiphone-sg',     'Epiphone SG',     'SG',       (SELECT id FROM kg_brand WHERE slug='epiphone'),(SELECT id FROM kg_category WHERE slug='music-gear'), 2000,  7000),
  ('epiphone-j-45',   'Epiphone J-45',   'J-45',     (SELECT id FROM kg_brand WHERE slug='epiphone'),(SELECT id FROM kg_category WHERE slug='music-gear'), 2500,  8000);

-- ── Seed: Products — E-mu, Elektron, JoMoX, Novation, Oberheim, Propellerhead ─
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, era, reference_url) VALUES
  ('emu-sp-1200',           'E-mu SP-1200',              'SP-1200',      (SELECT id FROM kg_brand WHERE slug='emu'),          (SELECT id FROM kg_category WHERE slug='music-gear'), '1987',      'https://www.vintagesynth.com/e-mu/sp-1200'),
  ('elektron-machinedrum',  'Elektron Machinedrum SPS-1','SPS-1',        (SELECT id FROM kg_brand WHERE slug='elektron'),     (SELECT id FROM kg_category WHERE slug='music-gear'), '2001-',     'https://www.vintagesynth.com/elektron/machinedrum-sps-1'),
  ('jomox-airbase-99',      'JoMoX AirBase 99',          'AirBase 99',   (SELECT id FROM kg_brand WHERE slug='jomox'),        (SELECT id FROM kg_category WHERE slug='music-gear'), '1990s',     'https://www.vintagesynth.com/jomox/airbase-99'),
  ('jomox-xbase-09',        'JoMoX XBase 09',            'XBase 09',     (SELECT id FROM kg_brand WHERE slug='jomox'),        (SELECT id FROM kg_category WHERE slug='music-gear'), '1998-',     'https://www.vintagesynth.com/jomox/xbase-09'),
  ('novation-drum-station', 'Novation Drum Station',     'Drum Station', (SELECT id FROM kg_brand WHERE slug='novation'),     (SELECT id FROM kg_category WHERE slug='music-gear'), '1990s',     'https://www.vintagesynth.com/novation/drum-station'),
  ('novation-d-station',    'Novation D-Station',        'D-Station',    (SELECT id FROM kg_brand WHERE slug='novation'),     (SELECT id FROM kg_category WHERE slug='music-gear'), '1990s',     'https://www.vintagesynth.com/novation/d-station'),
  ('oberheim-dmx',          'Oberheim DMX',              'DMX',          (SELECT id FROM kg_brand WHERE slug='oberheim'),     (SELECT id FROM kg_category WHERE slug='music-gear'), '1981-1983', 'https://www.vintagesynth.com/oberheim/dmx'),
  ('oberheim-dx',           'Oberheim DX',               'DX',           (SELECT id FROM kg_brand WHERE slug='oberheim'),     (SELECT id FROM kg_category WHERE slug='music-gear'), '1983-1985', 'https://www.vintagesynth.com/oberheim/dx'),
  ('propellerhead-rebirth', 'Propellerhead ReBirth RB-338','RB-338',     (SELECT id FROM kg_brand WHERE slug='propellerhead'),(SELECT id FROM kg_category WHERE slug='music-gear'), '1997-',     'https://www.vintagesynth.com/propellerhead/rebirth-rb-338');

-- ── Seed: Products — Boss ─────────────────────────────────────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, era, reference_url) VALUES
  ('boss-re-20', 'Boss RE-20 (Space Echo)', 'RE-20', (SELECT id FROM kg_brand WHERE slug='boss'), (SELECT id FROM kg_category WHERE slug='music-gear'), '2007-', 'https://www.boss.info/');

-- ── Seed: Products — Akai ─────────────────────────────────────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, era) VALUES
  ('akai-mpc60',      'Akai MPC60',      'MPC60',     (SELECT id FROM kg_brand WHERE slug='akai'), (SELECT id FROM kg_category WHERE slug='music-gear'), '1988'),
  ('akai-mpc3000',    'Akai MPC3000',    'MPC3000',   (SELECT id FROM kg_brand WHERE slug='akai'), (SELECT id FROM kg_category WHERE slug='music-gear'), '1994'),
  ('akai-mpc2000',    'Akai MPC2000',    'MPC2000',   (SELECT id FROM kg_brand WHERE slug='akai'), (SELECT id FROM kg_category WHERE slug='music-gear'), '1997'),
  ('akai-mpc2000xl',  'Akai MPC2000XL',  'MPC2000XL', (SELECT id FROM kg_brand WHERE slug='akai'), (SELECT id FROM kg_category WHERE slug='music-gear'), '1999'),
  ('akai-mpc-one',    'Akai MPC One',    'MPC One',   (SELECT id FROM kg_brand WHERE slug='akai'), (SELECT id FROM kg_category WHERE slug='music-gear'), '2020-'),
  ('akai-mpc-live-ii','Akai MPC Live II', 'MPC Live II',(SELECT id FROM kg_brand WHERE slug='akai'), (SELECT id FROM kg_category WHERE slug='music-gear'), '2020-'),
  ('akai-mpc-x',      'Akai MPC X',      'MPC X',     (SELECT id FROM kg_brand WHERE slug='akai'), (SELECT id FROM kg_category WHERE slug='music-gear'), '2017-');

-- ── Seed: Products — SSL, API, Neve ───────────────────────────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, era) VALUES
  ('ssl-six',      'SSL SiX',            'SiX',     (SELECT id FROM kg_brand WHERE slug='ssl'),  (SELECT id FROM kg_category WHERE slug='music-gear'), '2019-'),
  ('ssl-fusion',   'SSL Fusion',         'Fusion',  (SELECT id FROM kg_brand WHERE slug='ssl'),  (SELECT id FROM kg_category WHERE slug='music-gear'), '2018-'),
  ('ssl-vhd-pre',  'SSL VHD Pre',        'VHD Pre', (SELECT id FROM kg_brand WHERE slug='ssl'),  (SELECT id FROM kg_category WHERE slug='music-gear'), '2000s-'),
  ('api-500-6b',   'API 500-6B Lunchbox','500-6B',  (SELECT id FROM kg_brand WHERE slug='api'),  (SELECT id FROM kg_category WHERE slug='music-gear'), '2000s-'),
  ('api-500-8b',   'API 500-8B Lunchbox','500-8B',  (SELECT id FROM kg_brand WHERE slug='api'),  (SELECT id FROM kg_category WHERE slug='music-gear'), '2000s-'),
  ('api-512c',     'API 512c',           '512c',    (SELECT id FROM kg_brand WHERE slug='api'),  (SELECT id FROM kg_category WHERE slug='music-gear'), 'classic'),
  ('api-550a',     'API 550A',           '550A',    (SELECT id FROM kg_brand WHERE slug='api'),  (SELECT id FROM kg_category WHERE slug='music-gear'), 'classic'),
  ('neve-1073',    'Neve 1073',          '1073',    (SELECT id FROM kg_brand WHERE slug='neve'), (SELECT id FROM kg_category WHERE slug='music-gear'), '1970s-'),
  ('neve-1073lb',  'Neve 1073LB',        '1073LB',  (SELECT id FROM kg_brand WHERE slug='neve'), (SELECT id FROM kg_category WHERE slug='music-gear'), 'modern');

-- ── Seed: Products — Tube-Tech, Neumann, Manley, Kush, UA, Warm Audio, BAE ───
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, era) VALUES
  ('tube-tech-cl1b',   'Tube-Tech CL 1B',           'CL 1B',              (SELECT id FROM kg_brand WHERE slug='tube-tech'),   (SELECT id FROM kg_category WHERE slug='music-gear'), '1990s-'),
  ('tube-tech-cl2a',   'Tube-Tech CL 2A',           'CL 2A',              (SELECT id FROM kg_brand WHERE slug='tube-tech'),   (SELECT id FROM kg_category WHERE slug='music-gear'), '1990s-'),
  ('neumann-u87ai',    'Neumann U 87 Ai',           'U 87 Ai',            (SELECT id FROM kg_brand WHERE slug='neumann'),     (SELECT id FROM kg_category WHERE slug='music-gear'), '1967-'),
  ('neumann-u47',      'Neumann U 47',              'U 47',               (SELECT id FROM kg_brand WHERE slug='neumann'),     (SELECT id FROM kg_category WHERE slug='music-gear'), '1947-'),
  ('manley-ref-c',     'Manley Reference Cardioid', 'Reference Cardioid', (SELECT id FROM kg_brand WHERE slug='manley'),      (SELECT id FROM kg_category WHERE slug='music-gear'), '1990s-'),
  ('manley-ref-gold',  'Manley Reference Gold',     'Reference Gold',     (SELECT id FROM kg_brand WHERE slug='manley'),      (SELECT id FROM kg_category WHERE slug='music-gear'), '1990s-'),
  ('manley-voxbox',    'Manley VOXBOX',             'VOXBOX',             (SELECT id FROM kg_brand WHERE slug='manley'),      (SELECT id FROM kg_category WHERE slug='music-gear'), '1990s-'),
  ('manley-elop',      'Manley ELOP',               'ELOP',               (SELECT id FROM kg_brand WHERE slug='manley'),      (SELECT id FROM kg_category WHERE slug='music-gear'), '1990s-'),
  ('kush-clariphonic', 'Kush Audio Clariphonic',    'Clariphonic',        (SELECT id FROM kg_brand WHERE slug='kush-audio'),  (SELECT id FROM kg_category WHERE slug='music-gear'), '2010s-'),
  ('ua-1176ln',        'Universal Audio 1176LN',    '1176LN',             (SELECT id FROM kg_brand WHERE slug='ua'),          (SELECT id FROM kg_category WHERE slug='music-gear'), '1960s-'),
  ('ua-la-2a',         'Universal Audio LA-2A',     'LA-2A',              (SELECT id FROM kg_brand WHERE slug='ua'),          (SELECT id FROM kg_category WHERE slug='music-gear'), '1960s-'),
  ('ua-6176',          'Universal Audio 6176',      '6176',               (SELECT id FROM kg_brand WHERE slug='ua'),          (SELECT id FROM kg_category WHERE slug='music-gear'), '2000s-'),
  ('warm-audio-wa73',  'Warm Audio WA73',           'WA73',               (SELECT id FROM kg_brand WHERE slug='warm-audio'),  (SELECT id FROM kg_category WHERE slug='music-gear'), '2010s-'),
  ('warm-audio-wa76',  'Warm Audio WA76',           'WA76',               (SELECT id FROM kg_brand WHERE slug='warm-audio'),  (SELECT id FROM kg_category WHERE slug='music-gear'), '2010s-'),
  ('warm-audio-wa2a',  'Warm Audio WA-2A',          'WA-2A',              (SELECT id FROM kg_brand WHERE slug='warm-audio'),  (SELECT id FROM kg_category WHERE slug='music-gear'), '2010s-'),
  ('warm-audio-wa87',  'Warm Audio WA-87',          'WA-87',              (SELECT id FROM kg_brand WHERE slug='warm-audio'),  (SELECT id FROM kg_category WHERE slug='music-gear'), '2010s-'),
  ('warm-audio-wa47',  'Warm Audio WA-47',          'WA-47',              (SELECT id FROM kg_brand WHERE slug='warm-audio'),  (SELECT id FROM kg_category WHERE slug='music-gear'), '2010s-'),
  ('bae-1073',         'BAE 1073',                  '1073',               (SELECT id FROM kg_brand WHERE slug='bae'),         (SELECT id FROM kg_category WHERE slug='music-gear'), '2000s-');

-- ── Seed: Products — Poul Kjærholm ───────────────────────────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, price_min_dkk, price_max_dkk, era) VALUES
  ('pk22', 'Poul Kjærholm PK22', 'PK22', (SELECT id FROM kg_brand WHERE slug='poul-kjærholm'), (SELECT id FROM kg_category WHERE slug='danish-modern'), 8000,  35000, '1956-'),
  ('pk31', 'Poul Kjærholm PK31', 'PK31', (SELECT id FROM kg_brand WHERE slug='poul-kjærholm'), (SELECT id FROM kg_category WHERE slug='danish-modern'), 15000, 60000, NULL),
  ('pk20', 'Poul Kjærholm PK20', 'PK20', (SELECT id FROM kg_brand WHERE slug='poul-kjærholm'), (SELECT id FROM kg_category WHERE slug='danish-modern'), 10000, 40000, NULL);

-- ── Seed: Products — Hans J. Wegner (Carl Hansen series) ─────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, price_min_dkk, price_max_dkk, era, reference_url) VALUES
  ('ch20',  'Hans J. Wegner CH20 (Elbow Chair)', 'CH20',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1956',  'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch22',  'Hans J. Wegner CH22',               'CH22',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1950',  'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch24',  'Hans J. Wegner CH24 (Y-stolen)',     'CH24',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), 2000,  8000,  '1950-', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch25',  'Hans J. Wegner CH25',               'CH25',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1950',  'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch26',  'Hans J. Wegner CH26',               'CH26',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1950',  'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch28',  'Hans J. Wegner CH28',               'CH28',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1951',  'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch29',  'Hans J. Wegner CH29 (Savbuksstolen)','CH29', (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1952',  'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch33',  'Hans J. Wegner CH33',               'CH33',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1957',  'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch36',  'Hans J. Wegner CH36',               'CH36',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1962',  'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch37',  'Hans J. Wegner CH37',               'CH37',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1962',  'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch44',  'Hans J. Wegner CH44',               'CH44',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), 6000,  20000, NULL,    'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch46',  'Hans J. Wegner CH46',               'CH46',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1965',  'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch47',  'Hans J. Wegner CH47',               'CH47',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1965',  'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch56',  'Hans J. Wegner CH56 (Barstol)',      'CH56',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1985',  'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch58',  'Hans J. Wegner CH58 (Barstol)',      'CH58',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1985',  'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch88',  'Hans J. Wegner CH88',               'CH88',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1955',  'https://www.wegnerdesign.dk/wegner-stole'),
  ('ch111', 'Hans J. Wegner CH111',              'CH111', (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1970',  'https://www.wegnerdesign.dk/wegner-stole');

-- ── Seed: Products — Hans J. Wegner (PP Møbler series) ───────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, price_min_dkk, price_max_dkk, era, reference_url) VALUES
  ('pp52',   'Hans J. Wegner PP52',                     'PP52',   (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1975', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp56',   'Hans J. Wegner PP56 (Kinastolen variant)', 'PP56',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1989', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp58',   'Hans J. Wegner PP58',                     'PP58',   (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1987', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp58-3', 'Hans J. Wegner PP58/3',                   'PP58/3', (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1988', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp62',   'Hans J. Wegner PP62',                     'PP62',   (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1975', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp66',   'Hans J. Wegner PP66 (Kinastolen)',         'PP66',   (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1945', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp68',   'Hans J. Wegner PP68',                     'PP68',   (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1987', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp201',  'Hans J. Wegner PP201',                    'PP201',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1969', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp203',  'Hans J. Wegner PP203',                    'PP203',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1969', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp240',  'Hans J. Wegner PP240 (Konferencestol)',   'PP240',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1990', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp250',  'Hans J. Wegner PP250 (Jakkens Hvile)',    'PP250',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1953', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp501',  'Hans J. Wegner PP501 (The Chair)',        'PP501',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), 15000, 50000, NULL,   'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp502',  'Hans J. Wegner PP502 (Kontordrejestolen)','PP502',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1955', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp503',  'Hans J. Wegner PP503 (The Chair, polstret)','PP503',(SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1950', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp505',  'Hans J. Wegner PP505 (Kohornstolen)',     'PP505',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1952', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp518',  'Hans J. Wegner PP518 (Tyrestolen)',       'PP518',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1961', 'https://www.wegnerdesign.dk/wegner-stole'),
  ('pp701',  'Hans J. Wegner PP701',                   'PP701',  (SELECT id FROM kg_brand WHERE slug='hans-j-wegner'), (SELECT id FROM kg_category WHERE slug='danish-modern'), NULL,  NULL,  '1965', 'https://www.wegnerdesign.dk/wegner-stole');

-- ── Seed: Products — Arne Jacobsen ───────────────────────────────────────────
INSERT INTO kg_product (slug, canonical_name, brand_id, category_id, price_min_dkk, price_max_dkk, era) VALUES
  ('syverstolen', 'Arne Jacobsen 7''er Stol (Serie 7)', (SELECT id FROM kg_brand WHERE slug='arne-jacobsen'), (SELECT id FROM kg_category WHERE slug='danish-modern'), 1500,  6000,  '1955-'),
  ('aegget',      'Arne Jacobsen Ægget',                (SELECT id FROM kg_brand WHERE slug='arne-jacobsen'), (SELECT id FROM kg_category WHERE slug='danish-modern'), 20000, 60000, '1958-'),
  ('svanen',      'Arne Jacobsen Svanen',               (SELECT id FROM kg_brand WHERE slug='arne-jacobsen'), (SELECT id FROM kg_category WHERE slug='danish-modern'), 15000, 45000, NULL);

-- ── Seed: Products — Photography ─────────────────────────────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, price_min_dkk, price_max_dkk, era) VALUES
  ('leica-m6',          'Leica M6',          'M6',        (SELECT id FROM kg_brand WHERE slug='leica'),      (SELECT id FROM kg_category WHERE slug='photography'), 15000, 35000, NULL),
  ('leica-m7',          'Leica M7',          'M7',        (SELECT id FROM kg_brand WHERE slug='leica'),      (SELECT id FROM kg_category WHERE slug='photography'), 18000, 40000, NULL),
  ('hasselblad-500cm',  'Hasselblad 500C/M', '500C/M',   (SELECT id FROM kg_brand WHERE slug='hasselblad'), (SELECT id FROM kg_category WHERE slug='photography'), 8000,  20000, NULL),
  ('canon-ae-1',        'Canon AE-1',        'AE-1',      (SELECT id FROM kg_brand WHERE slug='canon'),      (SELECT id FROM kg_category WHERE slug='photography'), 800,   3000,  NULL),
  ('canon-eos-r5',      'Canon EOS R5',      'EOS R5',    (SELECT id FROM kg_brand WHERE slug='canon'),      (SELECT id FROM kg_category WHERE slug='photography'), 15000, 28000, NULL),
  ('sony-a7-iii',       'Sony A7 III',       'ILCE-7M3',  (SELECT id FROM kg_brand WHERE slug='sony'),       (SELECT id FROM kg_category WHERE slug='photography'), 8000,  16000, '2018-'),
  ('sony-a7-iv',        'Sony A7 IV',        'ILCE-7M4',  (SELECT id FROM kg_brand WHERE slug='sony'),       (SELECT id FROM kg_category WHERE slug='photography'), 12000, 22000, '2021-'),
  ('sony-a7-v',         'Sony Alpha 7 V',    'ILCE-7M5',  (SELECT id FROM kg_brand WHERE slug='sony'),       (SELECT id FROM kg_category WHERE slug='photography'), 18000, 32000, '2025-'),
  ('sony-a7s-iii',      'Sony Alpha 7S III', 'ILCE-7SM3', (SELECT id FROM kg_brand WHERE slug='sony'),       (SELECT id FROM kg_category WHERE slug='photography'), 16000, 30000, '2020-'),
  ('sony-a7s-ii',       'Sony Alpha 7S II',  'ILCE-7SM2', (SELECT id FROM kg_brand WHERE slug='sony'),       (SELECT id FROM kg_category WHERE slug='photography'), 4500,  9000,  '2015-'),
  ('sony-a7r-v',        'Sony Alpha 7R V',   'ILCE-7RM5', (SELECT id FROM kg_brand WHERE slug='sony'),       (SELECT id FROM kg_category WHERE slug='photography'), 18000, 32000, '2022-'),
  ('sony-a7r-iv',       'Sony Alpha 7R IV',  'ILCE-7RM4', (SELECT id FROM kg_brand WHERE slug='sony'),       (SELECT id FROM kg_category WHERE slug='photography'), 12000, 22000, '2019-'),
  ('sony-a6700',        'Sony Alpha 6700',   'ILCE-6700', (SELECT id FROM kg_brand WHERE slug='sony'),       (SELECT id FROM kg_category WHERE slug='photography'), 9000,  15000, '2023-'),
  ('sony-a6600',        'Sony Alpha 6600',   'ILCE-6600', (SELECT id FROM kg_brand WHERE slug='sony'),       (SELECT id FROM kg_category WHERE slug='photography'), 7000,  12000, '2019-'),
  ('sony-fx3',          'Sony FX3',          'ILME-FX3',  (SELECT id FROM kg_brand WHERE slug='sony'),       (SELECT id FROM kg_category WHERE slug='photography'), 20000, 40000, '2021-'),
  ('sony-fx30',         'Sony FX30',         'ILME-FX30', (SELECT id FROM kg_brand WHERE slug='sony'),       (SELECT id FROM kg_category WHERE slug='photography'), 12000, 25000, '2022-'),
  ('sony-a7c',          'Sony A7C',          'ILCE-7C',   (SELECT id FROM kg_brand WHERE slug='sony'),       (SELECT id FROM kg_category WHERE slug='photography'), 9000,  18000, '2020-');

-- ── Seed: Products — Tech (Apple) ─────────────────────────────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id, price_min_dkk, price_max_dkk, era, reference_url) VALUES
  ('mac-mini-m4',      'Apple Mac Mini M4',      'Mac Mini M4',      (SELECT id FROM kg_brand WHERE slug='apple'), (SELECT id FROM kg_category WHERE slug='tech'), 5000,  9000,  '2024-', NULL),
  ('macbook-pro-m3',   'Apple MacBook Pro M3',   'MacBook Pro M3',   (SELECT id FROM kg_brand WHERE slug='apple'), (SELECT id FROM kg_category WHERE slug='tech'), 10000, 25000, '2023-', 'https://www.apple.com/macbook-pro/'),
  ('mac-pro',          'Apple Mac Pro',           'Mac Pro',          (SELECT id FROM kg_brand WHERE slug='apple'), (SELECT id FROM kg_category WHERE slug='tech'), 25000, 100000,'2019-', 'https://www.apple.com/mac-pro/'),
  ('mac-studio',       'Apple Mac Studio',        'Mac Studio',       (SELECT id FROM kg_brand WHERE slug='apple'), (SELECT id FROM kg_category WHERE slug='tech'), 12000, 45000, '2022-', 'https://www.apple.com/mac-studio/'),
  ('pro-display-xdr',  'Apple Pro Display XDR',   'Pro Display XDR',  (SELECT id FROM kg_brand WHERE slug='apple'), (SELECT id FROM kg_category WHERE slug='tech'), 30000, 60000, '2019-', NULL);

-- ── Seed: Products — Tech (Nvidia, Lenovo, HP, Dell) ─────────────────────────
INSERT INTO kg_product (slug, canonical_name, model_name, brand_id, category_id) VALUES
  ('nvidia-rtx-4090',      'Nvidia GeForce RTX 4090',    'RTX 4090',    (SELECT id FROM kg_brand WHERE slug='nvidia'),  (SELECT id FROM kg_category WHERE slug='tech')),
  ('nvidia-rtx-4080-super','Nvidia GeForce RTX 4080 Super','RTX 4080 Super',(SELECT id FROM kg_brand WHERE slug='nvidia'),(SELECT id FROM kg_category WHERE slug='tech')),
  ('nvidia-rtx-6000-ada',  'Nvidia RTX 6000 Ada',         'RTX 6000 Ada',(SELECT id FROM kg_brand WHERE slug='nvidia'),  (SELECT id FROM kg_category WHERE slug='tech')),
  ('lenovo-thinkstation-p620','Lenovo ThinkStation P620', 'ThinkStation P620',(SELECT id FROM kg_brand WHERE slug='lenovo'),(SELECT id FROM kg_category WHERE slug='tech')),
  ('hp-z8-workstation',    'HP Z8 Workstation',           'Z8',          (SELECT id FROM kg_brand WHERE slug='hp'),     (SELECT id FROM kg_category WHERE slug='tech')),
  ('dell-precision-7865',  'Dell Precision 7865',         'Precision 7865',(SELECT id FROM kg_brand WHERE slug='dell'), (SELECT id FROM kg_category WHERE slug='tech'));

-- ── Seed: Identifiers (SKUs / EANs) ──────────────────────────────────────────
INSERT INTO kg_identifier (product_id, type, value) VALUES
  -- Roland drum machines
  ((SELECT id FROM kg_product WHERE slug='roland-tr-808'),  'SKU',   'TR-808'),
  ((SELECT id FROM kg_product WHERE slug='roland-tr-909'),  'SKU',   'TR-909'),
  ((SELECT id FROM kg_product WHERE slug='roland-tr-606'),  'SKU',   'TR-606'),
  ((SELECT id FROM kg_product WHERE slug='roland-tr-707'),  'SKU',   'TR-707'),
  ((SELECT id FROM kg_product WHERE slug='roland-tr-505'),  'SKU',   'TR-505'),
  ((SELECT id FROM kg_product WHERE slug='roland-re-201'),  'SKU',   'RE-201'),
  ((SELECT id FROM kg_product WHERE slug='roland-re-501'),  'SKU',   'RE-501'),
  ((SELECT id FROM kg_product WHERE slug='roland-tr-09'),   'SKU',   'TR-09'),
  -- Fender
  ((SELECT id FROM kg_product WHERE slug='fender-stratocaster'),   'SKU', 'Stratocaster'),
  ((SELECT id FROM kg_product WHERE slug='fender-telecaster'),     'SKU', 'TELECASTER'),
  ((SELECT id FROM kg_product WHERE slug='fender-jazzmaster'),     'SKU', 'Jazzmaster'),
  ((SELECT id FROM kg_product WHERE slug='fender-jaguar'),         'SKU', 'Jaguar'),
  ((SELECT id FROM kg_product WHERE slug='fender-precision-bass'), 'SKU', 'Precision Bass'),
  ((SELECT id FROM kg_product WHERE slug='fender-precision-bass'), 'SKU', 'P Bass'),
  ((SELECT id FROM kg_product WHERE slug='fender-jazz-bass'),      'SKU', 'Jazz Bass'),
  ((SELECT id FROM kg_product WHERE slug='fender-jazz-bass'),      'SKU', 'J Bass'),
  -- Gibson
  ((SELECT id FROM kg_product WHERE slug='gibson-les-paul'), 'SKU', 'PAUL'),
  ((SELECT id FROM kg_product WHERE slug='gibson-es-335'),   'SKU', '335'),
  ((SELECT id FROM kg_product WHERE slug='gibson-sg'),       'SKU', 'SG'),
  ((SELECT id FROM kg_product WHERE slug='gibson-j-45'),     'SKU', 'J-45'),
  -- Akai
  ((SELECT id FROM kg_product WHERE slug='akai-mpc60'),      'SKU', 'MPC60'),
  ((SELECT id FROM kg_product WHERE slug='akai-mpc3000'),    'SKU', 'MPC3000'),
  ((SELECT id FROM kg_product WHERE slug='akai-mpc2000'),    'SKU', 'MPC2000'),
  ((SELECT id FROM kg_product WHERE slug='akai-mpc2000xl'),  'SKU', 'MPC2000XL'),
  ((SELECT id FROM kg_product WHERE slug='akai-mpc-one'),    'SKU', 'MPC One'),
  ((SELECT id FROM kg_product WHERE slug='akai-mpc-live-ii'),'SKU', 'MPC Live II'),
  ((SELECT id FROM kg_product WHERE slug='akai-mpc-x'),      'SKU', 'MPC X'),
  -- Neve
  ((SELECT id FROM kg_product WHERE slug='neve-1073'),       'SKU', '1073'),
  ((SELECT id FROM kg_product WHERE slug='neve-1073lb'),     'SKU', '1073LB'),
  -- Tube-Tech
  ((SELECT id FROM kg_product WHERE slug='tube-tech-cl1b'),  'SKU', 'CL 1B'),
  ((SELECT id FROM kg_product WHERE slug='tube-tech-cl2a'),  'SKU', 'CL 2A'),
  -- Neumann
  ((SELECT id FROM kg_product WHERE slug='neumann-u87ai'),   'SKU', 'U87Ai'),
  ((SELECT id FROM kg_product WHERE slug='neumann-u87ai'),   'SKU', 'U 87 Ai'),
  ((SELECT id FROM kg_product WHERE slug='neumann-u47'),     'SKU', 'U47'),
  -- UA
  ((SELECT id FROM kg_product WHERE slug='ua-1176ln'),       'SKU', '1176LN'),
  ((SELECT id FROM kg_product WHERE slug='ua-1176ln'),       'SKU', '1176'),
  ((SELECT id FROM kg_product WHERE slug='ua-la-2a'),        'SKU', 'LA-2A'),
  ((SELECT id FROM kg_product WHERE slug='ua-la-2a'),        'SKU', 'LA2A'),
  -- Warm Audio
  ((SELECT id FROM kg_product WHERE slug='warm-audio-wa2a'), 'SKU', 'WA-2A'),
  ((SELECT id FROM kg_product WHERE slug='warm-audio-wa2a'), 'SKU', 'WA2A'),
  ((SELECT id FROM kg_product WHERE slug='warm-audio-wa87'), 'SKU', 'WA-87'),
  ((SELECT id FROM kg_product WHERE slug='warm-audio-wa87'), 'SKU', 'WA87'),
  ((SELECT id FROM kg_product WHERE slug='warm-audio-wa47'), 'SKU', 'WA-47'),
  ((SELECT id FROM kg_product WHERE slug='warm-audio-wa47'), 'SKU', 'WA47'),
  -- Wegner CH series
  ((SELECT id FROM kg_product WHERE slug='ch24'),  'SKU', 'CH24'),
  ((SELECT id FROM kg_product WHERE slug='ch44'),  'SKU', 'CH44'),
  ((SELECT id FROM kg_product WHERE slug='ch88'),  'SKU', 'CH88'),
  ((SELECT id FROM kg_product WHERE slug='ch26'),  'SKU', 'CH26'),
  ((SELECT id FROM kg_product WHERE slug='ch33'),  'SKU', 'CH33'),
  ((SELECT id FROM kg_product WHERE slug='ch20'),  'SKU', 'CH20'),
  ((SELECT id FROM kg_product WHERE slug='ch29'),  'SKU', 'CH29'),
  ((SELECT id FROM kg_product WHERE slug='ch36'),  'SKU', 'CH36'),
  ((SELECT id FROM kg_product WHERE slug='ch37'),  'SKU', 'CH37'),
  ((SELECT id FROM kg_product WHERE slug='ch46'),  'SKU', 'CH46'),
  ((SELECT id FROM kg_product WHERE slug='ch47'),  'SKU', 'CH47'),
  ((SELECT id FROM kg_product WHERE slug='ch56'),  'SKU', 'CH56'),
  ((SELECT id FROM kg_product WHERE slug='ch58'),  'SKU', 'CH58'),
  ((SELECT id FROM kg_product WHERE slug='ch111'), 'SKU', 'CH111'),
  ((SELECT id FROM kg_product WHERE slug='ch25'),  'SKU', 'CH25'),
  ((SELECT id FROM kg_product WHERE slug='ch22'),  'SKU', 'CH22'),
  ((SELECT id FROM kg_product WHERE slug='ch28'),  'SKU', 'CH28'),
  -- Wegner PP series
  ((SELECT id FROM kg_product WHERE slug='pp501'),  'SKU', 'PP501'),
  ((SELECT id FROM kg_product WHERE slug='pp503'),  'SKU', 'PP503'),
  ((SELECT id FROM kg_product WHERE slug='pp505'),  'SKU', 'PP505'),
  ((SELECT id FROM kg_product WHERE slug='pp250'),  'SKU', 'PP250'),
  ((SELECT id FROM kg_product WHERE slug='pp502'),  'SKU', 'PP502'),
  ((SELECT id FROM kg_product WHERE slug='pp518'),  'SKU', 'PP518'),
  ((SELECT id FROM kg_product WHERE slug='pp701'),  'SKU', 'PP701'),
  ((SELECT id FROM kg_product WHERE slug='pp201'),  'SKU', 'PP201'),
  ((SELECT id FROM kg_product WHERE slug='pp203'),  'SKU', 'PP203'),
  ((SELECT id FROM kg_product WHERE slug='pp52'),   'SKU', 'PP52'),
  ((SELECT id FROM kg_product WHERE slug='pp62'),   'SKU', 'PP62'),
  ((SELECT id FROM kg_product WHERE slug='pp58'),   'SKU', 'PP58'),
  ((SELECT id FROM kg_product WHERE slug='pp68'),   'SKU', 'PP68'),
  ((SELECT id FROM kg_product WHERE slug='pp58-3'), 'SKU', 'PP58/3'),
  ((SELECT id FROM kg_product WHERE slug='pp240'),  'SKU', 'PP240'),
  ((SELECT id FROM kg_product WHERE slug='pp56'),   'SKU', 'PP56'),
  ((SELECT id FROM kg_product WHERE slug='pp66'),   'SKU', 'PP66'),
  -- Sony (EANs + SKUs)
  ((SELECT id FROM kg_product WHERE slug='sony-a7-iii'),  'SKU', 'ILCE-7M3'),
  ((SELECT id FROM kg_product WHERE slug='sony-a7-iv'),   'SKU', 'ILCE-7M4'),
  ((SELECT id FROM kg_product WHERE slug='sony-a7-v'),    'SKU', 'ILCE-7M5'),
  ((SELECT id FROM kg_product WHERE slug='sony-a7-v'),    'EAN', '4548736173811'),
  ((SELECT id FROM kg_product WHERE slug='sony-a7s-iii'), 'SKU', 'ILCE-7SM3'),
  ((SELECT id FROM kg_product WHERE slug='sony-a7s-iii'), 'EAN', '4548736119154'),
  ((SELECT id FROM kg_product WHERE slug='sony-a7s-ii'),  'SKU', 'ILCE-7SM2'),
  ((SELECT id FROM kg_product WHERE slug='sony-a7s-ii'),  'EAN', '4548736018839'),
  ((SELECT id FROM kg_product WHERE slug='sony-a7r-v'),   'SKU', 'ILCE-7RM5'),
  ((SELECT id FROM kg_product WHERE slug='sony-a7r-v'),   'EAN', '4548736145603'),
  ((SELECT id FROM kg_product WHERE slug='sony-a7r-iv'),  'SKU', 'ILCE-7RM4'),
  ((SELECT id FROM kg_product WHERE slug='sony-a6700'),   'SKU', 'ILCE-6700'),
  ((SELECT id FROM kg_product WHERE slug='sony-a6700'),   'EAN', '4548736146624'),
  ((SELECT id FROM kg_product WHERE slug='sony-a6600'),   'SKU', 'ILCE-6600'),
  ((SELECT id FROM kg_product WHERE slug='sony-fx3'),     'SKU', 'ILME-FX3'),
  ((SELECT id FROM kg_product WHERE slug='sony-fx30'),    'SKU', 'ILME-FX30'),
  ((SELECT id FROM kg_product WHERE slug='sony-a7c'),     'SKU', 'ILCE-7C');

-- ── Seed: Relations ───────────────────────────────────────────────────────────
-- sibling = related models in same family; clone = cheaper clone of original
INSERT INTO kg_relation (from_product_id, to_product_id, type) VALUES
  -- Roland synths
  ((SELECT id FROM kg_product WHERE slug='roland-jp-4'),   (SELECT id FROM kg_product WHERE slug='roland-jp-6'),   'sibling'),
  ((SELECT id FROM kg_product WHERE slug='roland-jp-4'),   (SELECT id FROM kg_product WHERE slug='roland-jp-8'),   'sibling'),
  ((SELECT id FROM kg_product WHERE slug='roland-jp-4'),   (SELECT id FROM kg_product WHERE slug='roland-juno-60'),'sibling'),
  ((SELECT id FROM kg_product WHERE slug='roland-jp-6'),   (SELECT id FROM kg_product WHERE slug='roland-jp-8'),   'sibling'),
  ((SELECT id FROM kg_product WHERE slug='roland-juno-60'),(SELECT id FROM kg_product WHERE slug='roland-juno-106'),'sibling'),
  -- Roland drum machines
  ((SELECT id FROM kg_product WHERE slug='roland-tr-808'), (SELECT id FROM kg_product WHERE slug='roland-tr-909'), 'sibling'),
  ((SELECT id FROM kg_product WHERE slug='roland-tr-808'), (SELECT id FROM kg_product WHERE slug='roland-tr-606'), 'sibling'),
  ((SELECT id FROM kg_product WHERE slug='roland-tr-808'), (SELECT id FROM kg_product WHERE slug='roland-tr-707'), 'sibling'),
  ((SELECT id FROM kg_product WHERE slug='roland-tr-808'), (SELECT id FROM kg_product WHERE slug='roland-tr-505'), 'sibling'),
  ((SELECT id FROM kg_product WHERE slug='roland-tr-909'), (SELECT id FROM kg_product WHERE slug='roland-tr-09'),  'predecessor'),
  -- Roland echoes
  ((SELECT id FROM kg_product WHERE slug='roland-re-201'), (SELECT id FROM kg_product WHERE slug='roland-re-501'), 'sibling'),
  ((SELECT id FROM kg_product WHERE slug='roland-re-201'), (SELECT id FROM kg_product WHERE slug='boss-re-20'),    'predecessor'),
  -- Behringer clones
  ((SELECT id FROM kg_product WHERE slug='behringer-ju-06'),   (SELECT id FROM kg_product WHERE slug='roland-juno-60'),  'clone'),
  ((SELECT id FROM kg_product WHERE slug='behringer-ju-06'),   (SELECT id FROM kg_product WHERE slug='roland-juno-106'), 'clone'),
  ((SELECT id FROM kg_product WHERE slug='behringer-model-d'), (SELECT id FROM kg_product WHERE slug='moog-minimoog-model-d'), 'clone'),
  -- Moog
  ((SELECT id FROM kg_product WHERE slug='moog-minimoog-model-d'),(SELECT id FROM kg_product WHERE slug='moog-subsequent-37'),'sibling'),
  -- Sequential
  ((SELECT id FROM kg_product WHERE slug='sequential-prophet-5'),(SELECT id FROM kg_product WHERE slug='sequential-prophet-6'),'sibling'),
  -- TE
  ((SELECT id FROM kg_product WHERE slug='te-op-1'),       (SELECT id FROM kg_product WHERE slug='te-op-1-field'), 'predecessor'),
  ((SELECT id FROM kg_product WHERE slug='te-op-1'),       (SELECT id FROM kg_product WHERE slug='te-op-z'),       'sibling'),
  -- Fender
  ((SELECT id FROM kg_product WHERE slug='fender-stratocaster'), (SELECT id FROM kg_product WHERE slug='fender-telecaster'),     'sibling'),
  ((SELECT id FROM kg_product WHERE slug='fender-jazzmaster'),   (SELECT id FROM kg_product WHERE slug='fender-jaguar'),         'sibling'),
  ((SELECT id FROM kg_product WHERE slug='fender-precision-bass'),(SELECT id FROM kg_product WHERE slug='fender-jazz-bass'),     'sibling'),
  -- Gibson clones
  ((SELECT id FROM kg_product WHERE slug='epiphone-les-paul'), (SELECT id FROM kg_product WHERE slug='gibson-les-paul'), 'clone'),
  ((SELECT id FROM kg_product WHERE slug='epiphone-es-335'),   (SELECT id FROM kg_product WHERE slug='gibson-es-335'),   'clone'),
  ((SELECT id FROM kg_product WHERE slug='epiphone-sg'),       (SELECT id FROM kg_product WHERE slug='gibson-sg'),       'clone'),
  ((SELECT id FROM kg_product WHERE slug='epiphone-j-45'),     (SELECT id FROM kg_product WHERE slug='gibson-j-45'),     'clone'),
  -- Gibson siblings
  ((SELECT id FROM kg_product WHERE slug='gibson-les-paul'),   (SELECT id FROM kg_product WHERE slug='gibson-es-335'),   'sibling'),
  -- Akai MPC family
  ((SELECT id FROM kg_product WHERE slug='akai-mpc60'),        (SELECT id FROM kg_product WHERE slug='akai-mpc3000'),    'predecessor'),
  ((SELECT id FROM kg_product WHERE slug='akai-mpc3000'),      (SELECT id FROM kg_product WHERE slug='akai-mpc2000xl'),  'sibling'),
  ((SELECT id FROM kg_product WHERE slug='akai-mpc2000'),      (SELECT id FROM kg_product WHERE slug='akai-mpc2000xl'),  'predecessor'),
  ((SELECT id FROM kg_product WHERE slug='akai-mpc-one'),      (SELECT id FROM kg_product WHERE slug='akai-mpc-live-ii'),'sibling'),
  ((SELECT id FROM kg_product WHERE slug='akai-mpc-one'),      (SELECT id FROM kg_product WHERE slug='akai-mpc-x'),      'sibling'),
  -- Studio gear
  ((SELECT id FROM kg_product WHERE slug='neve-1073'),   (SELECT id FROM kg_product WHERE slug='warm-audio-wa73'), 'predecessor'),
  ((SELECT id FROM kg_product WHERE slug='neve-1073'),   (SELECT id FROM kg_product WHERE slug='bae-1073'),        'predecessor'),
  ((SELECT id FROM kg_product WHERE slug='ua-1176ln'),   (SELECT id FROM kg_product WHERE slug='warm-audio-wa76'), 'predecessor'),
  ((SELECT id FROM kg_product WHERE slug='ua-la-2a'),    (SELECT id FROM kg_product WHERE slug='warm-audio-wa2a'), 'predecessor'),
  ((SELECT id FROM kg_product WHERE slug='neumann-u87ai'),(SELECT id FROM kg_product WHERE slug='warm-audio-wa87'),'predecessor'),
  ((SELECT id FROM kg_product WHERE slug='neumann-u47'), (SELECT id FROM kg_product WHERE slug='warm-audio-wa47'), 'predecessor'),
  ((SELECT id FROM kg_product WHERE slug='ua-1176ln'),   (SELECT id FROM kg_product WHERE slug='ua-la-2a'),        'sibling'),
  ((SELECT id FROM kg_product WHERE slug='tube-tech-cl1b'),(SELECT id FROM kg_product WHERE slug='tube-tech-cl2a'),'sibling'),
  ((SELECT id FROM kg_product WHERE slug='neumann-u87ai'),(SELECT id FROM kg_product WHERE slug='neumann-u47'),    'sibling'),
  -- SSL
  ((SELECT id FROM kg_product WHERE slug='ssl-six'),     (SELECT id FROM kg_product WHERE slug='ssl-fusion'),      'sibling'),
  -- API lunchboxes
  ((SELECT id FROM kg_product WHERE slug='api-500-6b'),  (SELECT id FROM kg_product WHERE slug='api-500-8b'),      'sibling'),
  -- Kjærholm
  ((SELECT id FROM kg_product WHERE slug='pk22'),  (SELECT id FROM kg_product WHERE slug='pk31'),  'sibling'),
  ((SELECT id FROM kg_product WHERE slug='pk22'),  (SELECT id FROM kg_product WHERE slug='pk20'),  'sibling'),
  -- Wegner CH
  ((SELECT id FROM kg_product WHERE slug='ch24'),  (SELECT id FROM kg_product WHERE slug='ch44'),  'sibling'),
  ((SELECT id FROM kg_product WHERE slug='ch24'),  (SELECT id FROM kg_product WHERE slug='ch25'),  'sibling'),
  ((SELECT id FROM kg_product WHERE slug='ch20'),  (SELECT id FROM kg_product WHERE slug='ch33'),  'sibling'),
  ((SELECT id FROM kg_product WHERE slug='ch20'),  (SELECT id FROM kg_product WHERE slug='ch88'),  'sibling'),
  ((SELECT id FROM kg_product WHERE slug='ch29'),  (SELECT id FROM kg_product WHERE slug='ch28'),  'sibling'),
  ((SELECT id FROM kg_product WHERE slug='ch36'),  (SELECT id FROM kg_product WHERE slug='ch37'),  'sibling'),
  ((SELECT id FROM kg_product WHERE slug='ch46'),  (SELECT id FROM kg_product WHERE slug='ch47'),  'sibling'),
  ((SELECT id FROM kg_product WHERE slug='ch56'),  (SELECT id FROM kg_product WHERE slug='ch58'),  'sibling'),
  -- Wegner PP
  ((SELECT id FROM kg_product WHERE slug='pp501'), (SELECT id FROM kg_product WHERE slug='pp503'), 'sibling'),
  ((SELECT id FROM kg_product WHERE slug='pp501'), (SELECT id FROM kg_product WHERE slug='pp505'), 'sibling'),
  ((SELECT id FROM kg_product WHERE slug='pp505'), (SELECT id FROM kg_product WHERE slug='pp518'), 'sibling'),
  ((SELECT id FROM kg_product WHERE slug='pp52'),  (SELECT id FROM kg_product WHERE slug='pp62'),  'sibling'),
  ((SELECT id FROM kg_product WHERE slug='pp58'),  (SELECT id FROM kg_product WHERE slug='pp68'),  'sibling'),
  ((SELECT id FROM kg_product WHERE slug='pp58'),  (SELECT id FROM kg_product WHERE slug='pp58-3'),'sibling'),
  ((SELECT id FROM kg_product WHERE slug='pp56'),  (SELECT id FROM kg_product WHERE slug='pp66'),  'sibling'),
  ((SELECT id FROM kg_product WHERE slug='pp201'), (SELECT id FROM kg_product WHERE slug='pp203'), 'sibling'),
  ((SELECT id FROM kg_product WHERE slug='pp701'), (SELECT id FROM kg_product WHERE slug='pp201'), 'sibling'),
  -- Jacobsen
  ((SELECT id FROM kg_product WHERE slug='syverstolen'),(SELECT id FROM kg_product WHERE slug='aegget'),'sibling'),
  ((SELECT id FROM kg_product WHERE slug='syverstolen'),(SELECT id FROM kg_product WHERE slug='svanen'),'sibling'),
  -- Leica
  ((SELECT id FROM kg_product WHERE slug='leica-m6'), (SELECT id FROM kg_product WHERE slug='leica-m7'), 'predecessor'),
  -- Sony cameras
  ((SELECT id FROM kg_product WHERE slug='sony-a7-iii'),  (SELECT id FROM kg_product WHERE slug='sony-a7-iv'),   'predecessor'),
  ((SELECT id FROM kg_product WHERE slug='sony-a7-iv'),   (SELECT id FROM kg_product WHERE slug='sony-a7-v'),    'predecessor'),
  ((SELECT id FROM kg_product WHERE slug='sony-a7s-ii'),  (SELECT id FROM kg_product WHERE slug='sony-a7s-iii'), 'predecessor'),
  ((SELECT id FROM kg_product WHERE slug='sony-a7r-iv'),  (SELECT id FROM kg_product WHERE slug='sony-a7r-v'),   'predecessor'),
  ((SELECT id FROM kg_product WHERE slug='sony-a6600'),   (SELECT id FROM kg_product WHERE slug='sony-a6700'),   'predecessor'),
  ((SELECT id FROM kg_product WHERE slug='sony-a7s-iii'), (SELECT id FROM kg_product WHERE slug='sony-fx3'),     'sibling'),
  ((SELECT id FROM kg_product WHERE slug='sony-a6700'),   (SELECT id FROM kg_product WHERE slug='sony-fx30'),    'sibling'),
  ((SELECT id FROM kg_product WHERE slug='sony-fx3'),     (SELECT id FROM kg_product WHERE slug='sony-fx30'),    'sibling'),
  -- Apple tech
  ((SELECT id FROM kg_product WHERE slug='mac-mini-m4'),  (SELECT id FROM kg_product WHERE slug='mac-studio'),   'sibling'),
  ((SELECT id FROM kg_product WHERE slug='mac-studio'),   (SELECT id FROM kg_product WHERE slug='mac-pro'),       'sibling'),
  ((SELECT id FROM kg_product WHERE slug='mac-pro'),      (SELECT id FROM kg_product WHERE slug='pro-display-xdr'),'compatible');

-- ── Seed: Synonyms ────────────────────────────────────────────────────────────
-- alias = search term user might type; canonical_query = normalized canonical
INSERT INTO synonym (alias, canonical_query, match_type, lang) VALUES
  -- Roland JP-4
  ('jupiter 4',        'roland jp-4', 'alias', 'da'),
  ('jp4',              'roland jp-4', 'abbrev','da'),
  ('roland jupiter 4', 'roland jp-4', 'alias', 'da'),
  ('jupiter-4',        'roland jp-4', 'alias', 'da'),
  -- Roland JP-6
  ('jupiter 6',        'roland jp-6', 'alias', 'da'),
  ('jp6',              'roland jp-6', 'abbrev','da'),
  ('roland jupiter 6', 'roland jp-6', 'alias', 'da'),
  ('jupiter-6',        'roland jp-6', 'alias', 'da'),
  -- Roland JP-8
  ('jupiter 8',        'roland jp-8', 'alias', 'da'),
  ('jp8',              'roland jp-8', 'abbrev','da'),
  ('roland jupiter 8', 'roland jp-8', 'alias', 'da'),
  ('jupiter-8',        'roland jp-8', 'alias', 'da'),
  -- Roland Juno-60
  ('juno 60',          'roland juno-60', 'alias', 'da'),
  ('juno60',           'roland juno-60', 'abbrev','da'),
  ('roland juno 60',   'roland juno-60', 'alias', 'da'),
  -- Roland Juno-106
  ('juno 106',         'roland juno-106','alias', 'da'),
  ('juno106',          'roland juno-106','abbrev','da'),
  ('roland juno 106',  'roland juno-106','alias', 'da'),
  -- Roland SH-101
  ('sh101',            'roland sh-101', 'abbrev','da'),
  ('roland sh 101',    'roland sh-101', 'alias', 'da'),
  -- Moog Minimoog
  ('mini moog',            'moog minimoog', 'alias', 'da'),
  ('minimoog model d',     'moog minimoog', 'alias', 'da'),
  ('moog model d',         'moog minimoog', 'alias', 'da'),
  -- Moog Subsequent 37
  ('sub 37',           'moog subsequent 37', 'alias', 'da'),
  ('subsequent37',     'moog subsequent 37', 'abbrev','da'),
  ('moog sub 37',      'moog subsequent 37', 'alias', 'da'),
  -- Sequential Prophet-5
  ('prophet 5',        'sequential prophet-5', 'alias', 'da'),
  ('prophet5',         'sequential prophet-5', 'abbrev','da'),
  ('p5',               'sequential prophet-5', 'abbrev','da'),
  -- Sequential Prophet-6
  ('prophet 6',        'sequential prophet-6', 'alias', 'da'),
  ('prophet6',         'sequential prophet-6', 'abbrev','da'),
  -- Teenage Engineering OP-1
  ('op1',              'teenage engineering op-1', 'abbrev','da'),
  ('op-1',             'teenage engineering op-1', 'alias', 'da'),
  ('te op-1',          'teenage engineering op-1', 'alias', 'da'),
  -- Teenage Engineering OP-Z
  ('opz',              'teenage engineering op-z', 'abbrev','da'),
  ('op-z',             'teenage engineering op-z', 'alias', 'da'),
  ('te op-z',          'teenage engineering op-z', 'alias', 'da'),
  -- Fender Stratocaster
  ('strat',            'fender stratocaster', 'abbrev','da'),
  ('stratocaster',     'fender stratocaster', 'alias', 'da'),
  ('fender strat',     'fender stratocaster', 'alias', 'da'),
  -- Fender Telecaster
  ('tele',             'fender telecaster', 'abbrev','da'),
  ('telecaster',       'fender telecaster', 'alias', 'da'),
  ('fender tele',      'fender telecaster', 'alias', 'da'),
  -- Gibson Les Paul
  ('les paul',         'gibson les paul', 'alias', 'da'),
  ('lp',               'gibson les paul', 'abbrev','da'),
  ('gibson lp',        'gibson les paul', 'abbrev','da'),
  -- Gibson ES-335
  ('es335',            'gibson es-335', 'abbrev','da'),
  ('es 335',           'gibson es-335', 'alias', 'da'),
  ('gibson 335',       'gibson es-335', 'alias', 'da'),
  -- Poul Kjærholm PK22
  ('pk 22',            'poul kjærholm pk22', 'alias', 'da'),
  ('pk22',             'poul kjærholm pk22', 'abbrev','da'),
  ('kjærholm pk22',    'poul kjærholm pk22', 'alias', 'da'),
  -- Poul Kjærholm PK31
  ('pk 31',            'poul kjærholm pk31', 'alias', 'da'),
  ('pk31',             'poul kjærholm pk31', 'abbrev','da'),
  ('kjærholm pk31',    'poul kjærholm pk31', 'alias', 'da'),
  -- Wegner CH44
  ('ch 44',            'hans j. wegner ch44', 'alias', 'da'),
  ('ch44',             'hans j. wegner ch44', 'abbrev','da'),
  ('wegner ch44',      'hans j. wegner ch44', 'alias', 'da'),
  -- Wegner CH24 (Y-stolen)
  ('y-stol',           'hans j. wegner ch24', 'alias', 'da'),
  ('wishbone chair',   'hans j. wegner ch24', 'alias', 'en'),
  ('ch 24',            'hans j. wegner ch24', 'alias', 'da'),
  ('wegner y stol',    'hans j. wegner ch24', 'alias', 'da'),
  ('ch24',             'hans j. wegner ch24', 'abbrev','da'),
  ('y stolen',         'hans j. wegner ch24', 'alias', 'da'),
  ('y-stolen',         'hans j. wegner ch24', 'alias', 'da'),
  ('wishbone',         'hans j. wegner ch24', 'alias', 'en'),
  ('wegner y-stol',    'hans j. wegner ch24', 'alias', 'da'),
  ('wegner ch24',      'hans j. wegner ch24', 'alias', 'da'),
  -- Arne Jacobsen 7'er
  ('syverstolen',      'arne jacobsen 7''er stol', 'alias', 'da'),
  ('serie 7',          'arne jacobsen 7''er stol', 'alias', 'da'),
  ('7er stol',         'arne jacobsen 7''er stol', 'alias', 'da'),
  ('jacobsen 7',       'arne jacobsen 7''er stol', 'alias', 'da'),
  -- Arne Jacobsen Ægget
  ('ægget',            'arne jacobsen ægget', 'alias', 'da'),
  ('the egg',          'arne jacobsen ægget', 'alias', 'en'),
  ('jacobsen ægget',   'arne jacobsen ægget', 'alias', 'da'),
  -- Leica M6
  ('leica m 6',        'leica m6', 'alias', 'da'),
  ('m6 ttl',           'leica m6', 'alias', 'da'),
  -- Hasselblad 500C/M
  ('hasselblad 500 cm','hasselblad 500cm', 'alias', 'da'),
  ('500cm',            'hasselblad 500cm', 'abbrev','da'),
  -- Apple Mac Mini M4
  ('mac mini m4',      'apple mac mini m4', 'alias', 'da'),
  ('mac mini 2024',    'apple mac mini m4', 'alias', 'da'),
  ('m4 mac mini',      'apple mac mini m4', 'alias', 'da'),
  -- Apple MacBook Pro M3
  ('macbook m3',       'apple macbook pro m3', 'alias', 'da'),
  ('mbp m3',           'apple macbook pro m3', 'abbrev','da'),
  ('macbook pro 14 m3','apple macbook pro m3', 'alias', 'da'),
  ('macbook pro 16 m3','apple macbook pro m3', 'alias', 'da'),
  -- Wegner CH88
  ('ch88',             'hans j. wegner ch88', 'abbrev','da'),
  ('ch 88',            'hans j. wegner ch88', 'alias', 'da'),
  ('wegner ch88',      'hans j. wegner ch88', 'alias', 'da'),
  -- Wegner CH26
  ('ch26',             'hans j. wegner ch26', 'abbrev','da'),
  ('ch 26',            'hans j. wegner ch26', 'alias', 'da'),
  ('wegner ch26',      'hans j. wegner ch26', 'alias', 'da'),
  -- Wegner CH33
  ('ch33',             'hans j. wegner ch33', 'abbrev','da'),
  ('ch 33',            'hans j. wegner ch33', 'alias', 'da'),
  ('wegner ch33',      'hans j. wegner ch33', 'alias', 'da'),
  -- Wegner CH20
  ('ch20',             'hans j. wegner ch20', 'abbrev','da'),
  ('ch 20',            'hans j. wegner ch20', 'alias', 'da'),
  ('elbow chair',      'hans j. wegner ch20', 'alias', 'en'),
  ('wegner elbow chair','hans j. wegner ch20','alias', 'en'),
  ('wegner ch20',      'hans j. wegner ch20', 'alias', 'da'),
  -- Wegner CH29
  ('ch29',             'hans j. wegner ch29', 'abbrev','da'),
  ('ch 29',            'hans j. wegner ch29', 'alias', 'da'),
  ('savbuksstolen',    'hans j. wegner ch29', 'alias', 'da'),
  ('savbukstolen',     'hans j. wegner ch29', 'alias', 'da'),
  ('wegner ch29',      'hans j. wegner ch29', 'alias', 'da'),
  -- Wegner CH36
  ('ch36',             'hans j. wegner ch36', 'abbrev','da'),
  ('ch 36',            'hans j. wegner ch36', 'alias', 'da'),
  ('wegner ch36',      'hans j. wegner ch36', 'alias', 'da'),
  -- Wegner CH37
  ('ch37',             'hans j. wegner ch37', 'abbrev','da'),
  ('ch 37',            'hans j. wegner ch37', 'alias', 'da'),
  ('wegner ch37',      'hans j. wegner ch37', 'alias', 'da'),
  -- Wegner CH46
  ('ch46',             'hans j. wegner ch46', 'abbrev','da'),
  ('ch 46',            'hans j. wegner ch46', 'alias', 'da'),
  ('wegner ch46',      'hans j. wegner ch46', 'alias', 'da'),
  -- Wegner CH47
  ('ch47',             'hans j. wegner ch47', 'abbrev','da'),
  ('ch 47',            'hans j. wegner ch47', 'alias', 'da'),
  ('wegner ch47',      'hans j. wegner ch47', 'alias', 'da'),
  -- Wegner CH56
  ('ch56',             'hans j. wegner ch56', 'abbrev','da'),
  ('ch 56',            'hans j. wegner ch56', 'alias', 'da'),
  ('wegner ch56',      'hans j. wegner ch56', 'alias', 'da'),
  -- Wegner CH58
  ('ch58',             'hans j. wegner ch58', 'abbrev','da'),
  ('ch 58',            'hans j. wegner ch58', 'alias', 'da'),
  ('wegner ch58',      'hans j. wegner ch58', 'alias', 'da'),
  -- Wegner CH111
  ('ch111',            'hans j. wegner ch111', 'abbrev','da'),
  ('ch 111',           'hans j. wegner ch111', 'alias', 'da'),
  ('wegner ch111',     'hans j. wegner ch111', 'alias', 'da'),
  -- Wegner PP501
  ('pp501',            'hans j. wegner pp501', 'abbrev','da'),
  ('pp 501',           'hans j. wegner pp501', 'alias', 'da'),
  ('the chair',        'hans j. wegner pp501', 'alias', 'en'),
  ('den runde stol',   'hans j. wegner pp501', 'alias', 'da'),
  ('wegner the chair', 'hans j. wegner pp501', 'alias', 'en'),
  ('wegner pp501',     'hans j. wegner pp501', 'alias', 'da'),
  -- Wegner PP503
  ('pp503',            'hans j. wegner pp503', 'abbrev','da'),
  ('pp 503',           'hans j. wegner pp503', 'alias', 'da'),
  ('the chair polstret','hans j. wegner pp503','alias', 'da'),
  ('wegner pp503',     'hans j. wegner pp503', 'alias', 'da'),
  -- Wegner PP505
  ('pp505',            'hans j. wegner pp505', 'abbrev','da'),
  ('pp 505',           'hans j. wegner pp505', 'alias', 'da'),
  ('kohornstolen',     'hans j. wegner pp505', 'alias', 'da'),
  ('kohorn stolen',    'hans j. wegner pp505', 'alias', 'da'),
  ('wegner pp505',     'hans j. wegner pp505', 'alias', 'da'),
  -- Wegner PP250
  ('pp250',            'hans j. wegner pp250', 'abbrev','da'),
  ('pp 250',           'hans j. wegner pp250', 'alias', 'da'),
  ('jakkens hvile',    'hans j. wegner pp250', 'alias', 'da'),
  ('wegner pp250',     'hans j. wegner pp250', 'alias', 'da'),
  -- Wegner PP502
  ('pp502',            'hans j. wegner pp502', 'abbrev','da'),
  ('pp 502',           'hans j. wegner pp502', 'alias', 'da'),
  ('kontordrejestolen','hans j. wegner pp502',  'alias', 'da'),
  ('office swivel chair wegner','hans j. wegner pp502','alias','en'),
  ('wegner pp502',     'hans j. wegner pp502', 'alias', 'da'),
  -- Wegner PP518
  ('pp518',            'hans j. wegner pp518', 'abbrev','da'),
  ('pp 518',           'hans j. wegner pp518', 'alias', 'da'),
  ('tyrestolen',       'hans j. wegner pp518', 'alias', 'da'),
  ('bull chair',       'hans j. wegner pp518', 'alias', 'en'),
  ('wegner pp518',     'hans j. wegner pp518', 'alias', 'da'),
  -- Wegner PP701
  ('pp701',            'hans j. wegner pp701', 'abbrev','da'),
  ('pp 701',           'hans j. wegner pp701', 'alias', 'da'),
  ('wegner pp701',     'hans j. wegner pp701', 'alias', 'da'),
  -- Wegner PP201
  ('pp201',            'hans j. wegner pp201', 'abbrev','da'),
  ('pp 201',           'hans j. wegner pp201', 'alias', 'da'),
  ('wegner pp201',     'hans j. wegner pp201', 'alias', 'da'),
  -- Wegner PP203
  ('pp203',            'hans j. wegner pp203', 'abbrev','da'),
  ('pp 203',           'hans j. wegner pp203', 'alias', 'da'),
  ('wegner pp203',     'hans j. wegner pp203', 'alias', 'da'),
  -- Wegner PP52
  ('pp52',             'hans j. wegner pp52',  'abbrev','da'),
  ('pp 52',            'hans j. wegner pp52',  'alias', 'da'),
  ('wegner pp52',      'hans j. wegner pp52',  'alias', 'da'),
  -- Wegner PP62
  ('pp62',             'hans j. wegner pp62',  'abbrev','da'),
  ('pp 62',            'hans j. wegner pp62',  'alias', 'da'),
  ('wegner pp62',      'hans j. wegner pp62',  'alias', 'da'),
  -- Wegner PP58
  ('pp58',             'hans j. wegner pp58',  'abbrev','da'),
  ('pp 58',            'hans j. wegner pp58',  'alias', 'da'),
  ('wegner pp58',      'hans j. wegner pp58',  'alias', 'da'),
  -- Wegner PP68
  ('pp68',             'hans j. wegner pp68',  'abbrev','da'),
  ('pp 68',            'hans j. wegner pp68',  'alias', 'da'),
  ('wegner pp68',      'hans j. wegner pp68',  'alias', 'da'),
  -- Wegner PP58/3
  ('pp58/3',           'hans j. wegner pp58/3','abbrev','da'),
  ('pp 58/3',          'hans j. wegner pp58/3','alias', 'da'),
  ('pp58 3',           'hans j. wegner pp58/3','alias', 'da'),
  ('wegner pp58/3',    'hans j. wegner pp58/3','alias', 'da'),
  -- Wegner PP240
  ('pp240',            'hans j. wegner pp240', 'abbrev','da'),
  ('pp 240',           'hans j. wegner pp240', 'alias', 'da'),
  ('konferencestol wegner','hans j. wegner pp240','alias','da'),
  ('wegner pp240',     'hans j. wegner pp240', 'alias', 'da'),
  -- Wegner PP56
  ('pp56',             'hans j. wegner pp56',  'abbrev','da'),
  ('pp 56',            'hans j. wegner pp56',  'alias', 'da'),
  ('kinastolen pp56',  'hans j. wegner pp56',  'alias', 'da'),
  ('wegner pp56',      'hans j. wegner pp56',  'alias', 'da'),
  -- Wegner PP66
  ('pp66',             'hans j. wegner pp66',  'abbrev','da'),
  ('pp 66',            'hans j. wegner pp66',  'alias', 'da'),
  ('kinastolen',       'hans j. wegner pp66',  'alias', 'da'),
  ('china chair',      'hans j. wegner pp66',  'alias', 'en'),
  ('wegner kinastolen','hans j. wegner pp66',  'alias', 'da'),
  ('wegner pp66',      'hans j. wegner pp66',  'alias', 'da'),
  -- Wegner CH25
  ('ch25',             'hans j. wegner ch25',  'abbrev','da'),
  ('ch 25',            'hans j. wegner ch25',  'alias', 'da'),
  ('wegner ch25',      'hans j. wegner ch25',  'alias', 'da'),
  -- Wegner CH22
  ('ch22',             'hans j. wegner ch22',  'abbrev','da'),
  ('ch 22',            'hans j. wegner ch22',  'alias', 'da'),
  ('wegner ch22',      'hans j. wegner ch22',  'alias', 'da'),
  -- Wegner CH28
  ('ch28',             'hans j. wegner ch28',  'abbrev','da'),
  ('ch 28',            'hans j. wegner ch28',  'alias', 'da'),
  ('wegner ch28',      'hans j. wegner ch28',  'alias', 'da'),
  -- Roland TR-808
  ('tr808',            'roland tr-808', 'abbrev','da'),
  ('tr 808',           'roland tr-808', 'alias', 'da'),
  ('808',              'roland tr-808', 'abbrev','da'),
  ('roland 808',       'roland tr-808', 'alias', 'da'),
  ('roland tr808',     'roland tr-808', 'abbrev','da'),
  ('rhythm composer',  'roland tr-808', 'alias', 'en'),
  ('tr-808',           'roland tr-808', 'alias', 'da'),
  -- Roland TR-909
  ('tr909',            'roland tr-909', 'abbrev','da'),
  ('tr 909',           'roland tr-909', 'alias', 'da'),
  ('909',              'roland tr-909', 'abbrev','da'),
  ('roland 909',       'roland tr-909', 'alias', 'da'),
  ('tr-909',           'roland tr-909', 'alias', 'da'),
  -- Roland TR-606
  ('tr606',            'roland tr-606', 'abbrev','da'),
  ('tr 606',           'roland tr-606', 'alias', 'da'),
  ('606',              'roland tr-606', 'abbrev','da'),
  ('roland 606',       'roland tr-606', 'alias', 'da'),
  ('tr-606',           'roland tr-606', 'alias', 'da'),
  -- Roland TR-707
  ('tr707',            'roland tr-707', 'abbrev','da'),
  ('tr 707',           'roland tr-707', 'alias', 'da'),
  ('707',              'roland tr-707', 'abbrev','da'),
  ('roland 707',       'roland tr-707', 'alias', 'da'),
  ('tr-707',           'roland tr-707', 'alias', 'da'),
  -- Roland TR-505
  ('tr505',            'roland tr-505', 'abbrev','da'),
  ('tr 505',           'roland tr-505', 'alias', 'da'),
  ('505',              'roland tr-505', 'abbrev','da'),
  ('roland 505',       'roland tr-505', 'alias', 'da'),
  ('tr-505',           'roland tr-505', 'alias', 'da'),
  -- Roland RE-201
  ('re201',            'roland re-201', 'abbrev','da'),
  ('re 201',           'roland re-201', 'alias', 'da'),
  ('space echo',       'roland re-201', 'alias', 'en'),
  ('roland space echo','roland re-201', 'alias', 'en'),
  ('re-201',           'roland re-201', 'alias', 'da'),
  -- Roland RE-501
  ('re501',            'roland re-501', 'abbrev','da'),
  ('re 501',           'roland re-501', 'alias', 'da'),
  ('chorus echo',      'roland re-501', 'alias', 'en'),
  ('re-501',           'roland re-501', 'alias', 'da'),
  -- Boss RE-20
  ('re20',             'boss re-20', 'abbrev','da'),
  ('re 20',            'boss re-20', 'alias', 'da'),
  ('space echo pedal', 'boss re-20', 'alias', 'en'),
  ('re-20',            'boss re-20', 'alias', 'da'),
  -- Fender Jazzmaster
  ('jazzmaster',       'fender jazzmaster', 'alias', 'da'),
  ('jm',               'fender jazzmaster', 'abbrev','da'),
  -- Fender Jaguar
  ('jaguar guitar',    'fender jaguar', 'alias', 'da'),
  -- Fender Precision Bass
  ('p bass',           'fender precision bass', 'alias', 'da'),
  ('pbass',            'fender precision bass', 'abbrev','da'),
  ('precision bass',   'fender precision bass', 'alias', 'da'),
  ('fender p bass',    'fender precision bass', 'alias', 'da'),
  -- Fender Jazz Bass
  ('j bass',           'fender jazz bass', 'alias', 'da'),
  ('jbass',            'fender jazz bass', 'abbrev','da'),
  ('jazz bass',        'fender jazz bass', 'alias', 'da'),
  -- Gibson SG
  ('sg',               'gibson sg', 'abbrev','da'),
  -- Gibson J-45
  ('j45',              'gibson j-45', 'abbrev','da'),
  ('j-45',             'gibson j-45', 'alias', 'da'),
  ('gibson j45',       'gibson j-45', 'alias', 'da'),
  -- Akai MPC60
  ('mpc60',            'akai mpc60',     'abbrev','da'),
  ('mpc 60',           'akai mpc60',     'alias', 'da'),
  -- Akai MPC3000
  ('mpc3000',          'akai mpc3000',   'abbrev','da'),
  ('mpc 3000',         'akai mpc3000',   'alias', 'da'),
  -- Akai MPC2000
  ('mpc2000',          'akai mpc2000',   'abbrev','da'),
  ('mpc 2000',         'akai mpc2000',   'alias', 'da'),
  -- Akai MPC2000XL
  ('mpc2000xl',        'akai mpc2000xl', 'abbrev','da'),
  ('mpc 2000xl',       'akai mpc2000xl', 'alias', 'da'),
  -- Akai MPC Live II
  ('mpc live 2',       'akai mpc live ii','alias', 'da'),
  ('mpc live ii',      'akai mpc live ii','alias', 'da'),
  -- Akai MPC One
  ('mpc one',          'akai mpc one',   'alias', 'da'),
  -- Akai MPC X
  ('mpc x',            'akai mpc x',     'alias', 'da'),
  -- Neve 1073
  ('1073',             'neve 1073',          'abbrev','da'),
  ('neve1073',         'neve 1073',          'abbrev','da'),
  ('1073 preamp',      'neve 1073',          'alias', 'da'),
  ('1073 pre',         'neve 1073',          'alias', 'da'),
  -- Tube-Tech CL 1B
  ('cl1b',             'tube-tech cl 1b',    'abbrev','da'),
  ('cl 1b',            'tube-tech cl 1b',    'alias', 'da'),
  ('tube tech cl1b',   'tube-tech cl 1b',    'alias', 'da'),
  ('tubetech cl1b',    'tube-tech cl 1b',    'alias', 'da'),
  -- Neumann U87
  ('u87',              'neumann u87 ai',     'abbrev','da'),
  ('u 87',             'neumann u87 ai',     'alias', 'da'),
  ('u87ai',            'neumann u87 ai',     'abbrev','da'),
  ('neumann u87',      'neumann u87 ai',     'alias', 'da'),
  -- Neumann U47
  ('u47',              'neumann u47',        'abbrev','da'),
  ('u 47',             'neumann u47',        'alias', 'da'),
  -- Manley Reference Cardioid
  ('manley ref c',     'manley reference cardioid','alias','da'),
  ('ref c',            'manley reference cardioid','abbrev','da'),
  ('manley reference c','manley reference cardioid','alias','da'),
  ('reference cardioid','manley reference cardioid','alias','en'),
  -- Kush Audio Clariphonic
  ('clariphonic',      'kush audio clariphonic','alias','da'),
  ('kush clariphonic', 'kush audio clariphonic','alias','da'),
  -- API 500 Lunchbox
  ('api lunchbox',     'api 500 lunchbox', 'alias', 'da'),
  ('500 series lunchbox','api 500 lunchbox','alias','da'),
  ('api 500-6b',       'api 500 lunchbox', 'alias', 'da'),
  ('api 500-8b',       'api 500 lunchbox', 'alias', 'da'),
  -- SSL Six
  ('six mixer',        'ssl six', 'alias', 'da'),
  ('solid state logic six','ssl six','alias','da'),
  -- Sony A7 V
  ('a7v',              'sony a7 v',    'abbrev','da'),
  ('a7 v',             'sony a7 v',    'alias', 'da'),
  ('alpha 7 v',        'sony a7 v',    'alias', 'da'),
  ('ilce-7m5',         'sony a7 v',    'alias', 'da'),
  ('ilce7m5',          'sony a7 v',    'abbrev','da'),
  -- Sony A7S III
  ('a7siii',           'sony a7s iii', 'abbrev','da'),
  ('a7s iii',          'sony a7s iii', 'alias', 'da'),
  ('a7s3',             'sony a7s iii', 'abbrev','da'),
  ('alpha 7s iii',     'sony a7s iii', 'alias', 'da'),
  ('ilce-7sm3',        'sony a7s iii', 'alias', 'da'),
  ('ilce7sm3',         'sony a7s iii', 'abbrev','da'),
  -- Sony A7S II
  ('a7sii',            'sony a7s ii',  'abbrev','da'),
  ('a7s ii',           'sony a7s ii',  'alias', 'da'),
  ('alpha 7s ii',      'sony a7s ii',  'alias', 'da'),
  ('ilce-7sm2',        'sony a7s ii',  'alias', 'da'),
  ('ilce7sm2',         'sony a7s ii',  'abbrev','da'),
  -- Sony A7R V
  ('a7rv',             'sony a7r v',   'abbrev','da'),
  ('a7r v',            'sony a7r v',   'alias', 'da'),
  ('alpha 7r v',       'sony a7r v',   'alias', 'da'),
  ('ilce-7rm5',        'sony a7r v',   'alias', 'da'),
  ('ilce7rm5',         'sony a7r v',   'abbrev','da'),
  -- Sony Alpha 6700
  ('a6700',            'sony alpha 6700', 'abbrev','da'),
  ('alpha 6700',       'sony alpha 6700', 'alias', 'da'),
  ('sony a6700',       'sony alpha 6700', 'alias', 'da'),
  ('ilce-6700',        'sony alpha 6700', 'alias', 'da'),
  ('ilce6700',         'sony alpha 6700', 'abbrev','da'),
  -- Sony FX3
  ('fx3',              'sony fx3',  'abbrev','da'),
  ('ilme-fx3',         'sony fx3',  'alias', 'da'),
  -- Sony FX30
  ('fx30',             'sony fx30', 'abbrev','da'),
  ('ilme-fx30',        'sony fx30', 'alias', 'da'),
  -- Apple Mac Pro
  ('mac pro',          'apple mac pro',     'alias', 'da'),
  ('macpro',           'apple mac pro',     'abbrev','da'),
  -- Apple Mac Studio
  ('mac studio',       'apple mac studio',  'alias', 'da'),
  ('macstudio',        'apple mac studio',  'abbrev','da'),
  -- Apple Pro Display XDR
  ('pro display xdr',  'apple pro display xdr','alias','da'),
  ('apple xdr',        'apple pro display xdr','alias','da'),
  ('xdr display',      'apple pro display xdr','alias','da'),
  -- Nvidia RTX 4090
  ('rtx4090',          'nvidia rtx 4090',       'abbrev','da'),
  ('rtx 4090',         'nvidia rtx 4090',       'alias', 'da'),
  ('geforce 4090',     'nvidia rtx 4090',       'alias', 'da'),
  -- Nvidia RTX 4080 Super
  ('rtx4080 super',    'nvidia rtx 4080 super', 'abbrev','da'),
  ('4080 super',       'nvidia rtx 4080 super', 'alias', 'da'),
  -- Nvidia RTX 6000 Ada
  ('rtx 6000 ada',     'nvidia rtx 6000 ada',   'alias', 'da'),
  ('rtx6000 ada',      'nvidia rtx 6000 ada',   'abbrev','da'),
  -- Lenovo ThinkStation P620
  ('thinkstation p620','lenovo thinkstation p620','alias','da'),
  ('lenovo p620',      'lenovo thinkstation p620','alias','da'),
  -- HP Z8
  ('hp z8',            'hp z8 workstation','alias','da'),
  ('z8 workstation',   'hp z8 workstation','alias','da'),
  -- Dell Precision 7865
  ('precision 7865',   'dell precision 7865','alias','da'),
  ('dell 7865',        'dell precision 7865','alias','da');
