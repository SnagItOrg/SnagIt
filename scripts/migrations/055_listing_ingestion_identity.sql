-- 055_listing_ingestion_identity.sql
--
-- ============================================================================
-- NOT EXECUTED. Authored and reviewed only. No statement here has run against
-- production or any shared database. It has been executed ONLY against the
-- disposable local cluster created by scripts/verify-migrations-isolated.sh.
--
-- Run scripts/queries/verification/kg_migration_state.sql first and confirm
-- detected_state = 'PRE' for 055.
-- ============================================================================
--
-- PURPOSE
-- Give every listing a DURABLE, DATABASE-ENFORCED first-ingestion identity so
-- "new inflow" is a fact about the row, not an inference from timestamps.
--
-- WHY NOTHING EXISTING WORKS
--   * `scraped_at`     — overwritten by every scraper on every upsert.
--   * `first_seen_at`  — contains a historic bulk backfill (34,859 rows share
--                        one week); it cannot establish first ingestion and is
--                        NOT repurposed here. Its legacy meaning is untouched.
--   * returned upsert ids — Prompt 02F bounded the matcher to a run's own ids,
--                        but an upsert returns REFRESHED historical rows too:
--                        ~35,025 rows across five representative batches,
--                        ~32,544 of them Reverb. Those are not new inflow.
--
-- THE CONTRACT
--   ingestion_batch_id  uuid  NULL  -- the scraper run that FIRST inserted the row
--   ingested_at         timestamptz NULL -- DATABASE time of that first insert
--
--   * Legacy rows stay NULL forever. There is no backfill, and the column is
--     added without a DEFAULT so no existing row gains an apparent identity.
--   * Only a real INSERT that supplies a batch id may establish the pair.
--   * UPDATE — including every ON CONFLICT DO UPDATE refresh path — can never
--     change a non-null identity, and can never give a legacy NULL row one.
--   * Enforced by a trigger, not by application convention, so the DBA
--     promotion RPC, the five PM2 scrapers and the Vercel watchlist route are
--     all bound by the same rule.
--
-- Exact equality on `ingestion_batch_id` is then the ONLY automatic-matching
-- eligibility boundary for PM2 marketplace scrapers.
--
-- THREE-STATE CONTRACT: PRE -> apply | POST -> successful no-op | DRIFT -> abort.
-- REVERSAL: scripts/migrations/055_rollback.sql
-- Independent of migrations 053/054: 055 touches only `listings` and the
-- promotion function, and neither 053 nor 054 reads these columns.

BEGIN;

SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  v_state    text;
  v_fail     text := '';
  v_cols     int;
  v_trigger  int;
  v_nonnull  bigint;
  v_promote  int;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema='public' AND table_name='listings'
     AND column_name IN ('ingestion_batch_id','ingested_at');

  SELECT count(*) INTO v_trigger FROM pg_trigger
   WHERE tgrelid='public.listings'::regclass AND NOT tgisinternal
     AND tgname='trg_listings_ingestion_identity';

  -- Rows that already carry an identity. In PRE this must be 0 because the
  -- columns do not exist; in POST it is whatever activation has produced.
  IF v_cols = 2 THEN
    EXECUTE 'SELECT count(*) FROM listings WHERE ingestion_batch_id IS NOT NULL'
      INTO v_nonnull;
  ELSE
    v_nonnull := 0;
  END IF;

  SELECT count(*) INTO v_promote FROM pg_proc
   WHERE proname='promote_scrape_run'
     AND pg_get_functiondef(oid) LIKE '%ingestion_batch_id%';

  IF v_cols = 0 AND v_trigger = 0 AND v_promote = 0 THEN
    v_state := 'PRE';
  ELSIF v_cols = 2 AND v_trigger = 1 AND v_promote = 1 THEN
    v_state := 'POST';
  ELSE
    v_state := 'DRIFT';
  END IF;

  IF v_state = 'POST' THEN
    RAISE NOTICE '055: state=POST — already applied. No-op. % row(s) carry an ingestion identity.', v_nonnull;
    RETURN;
  END IF;

  IF v_state = 'DRIFT' THEN
    IF v_cols NOT IN (0,2)    THEN v_fail := v_fail || format(' columns=%s(expected 0 or 2);', v_cols); END IF;
    IF v_trigger NOT IN (0,1) THEN v_fail := v_fail || format(' triggers=%s;', v_trigger); END IF;
    IF v_promote NOT IN (0,1) THEN v_fail := v_fail || format(' promote_fn=%s;', v_promote); END IF;
    IF v_cols = 2 AND v_trigger = 0 THEN v_fail := v_fail || ' columns_without_trigger(identity_not_enforced);'; END IF;
    IF v_cols = 0 AND v_trigger = 1 THEN v_fail := v_fail || ' trigger_without_columns;'; END IF;
    IF v_cols = 2 AND v_promote = 0 THEN v_fail := v_fail || ' columns_without_promotion_support;'; END IF;
    RAISE EXCEPTION '055 ABORT: state=DRIFT. Failed predicates:%', v_fail;
  END IF;

  RAISE NOTICE '055: state=PRE — applying.';
END $$;

-- ── 1. Columns ──────────────────────────────────────────────────────────────
-- Deliberately NULLable and deliberately WITHOUT a DEFAULT. `ADD COLUMN …
-- DEFAULT now()` would stamp every one of the ~87,000 legacy rows with an
-- apparent ingestion time and destroy the very distinction this migration adds.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS ingestion_batch_id uuid;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS ingested_at        timestamptz;

COMMENT ON COLUMN listings.ingestion_batch_id IS
  'Scrape run that FIRST inserted this row. NULL for every pre-activation row. Immutable after insert (trg_listings_ingestion_identity). Exact equality is the automatic-matching eligibility boundary.';
COMMENT ON COLUMN listings.ingested_at IS
  'DATABASE time of first insertion. NULL for pre-activation rows. Never set by the application and never changed by an update. Distinct from scraped_at (last observation) and from first_seen_at (legacy, bulk-backfilled).';

-- ── 2. Immutability, enforced in the database ───────────────────────────────
CREATE OR REPLACE FUNCTION listings_ingestion_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Only a real INSERT may establish identity, and only when the writer
    -- supplied a batch id. `ingested_at` is DATABASE time — an application
    -- wall clock must never decide newness.
    IF NEW.ingestion_batch_id IS NULL THEN
      NEW.ingested_at := NULL;          -- no batch id => no identity, ever
    ELSE
      NEW.ingested_at := now();         -- ignore any client-supplied value
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE (this includes every ON CONFLICT DO UPDATE refresh path).
  -- Identity is carried over verbatim, so:
  --   * an established identity can never be changed or cleared;
  --   * a legacy NULL row can never acquire one through a scraper refresh.
  NEW.ingestion_batch_id := OLD.ingestion_batch_id;
  NEW.ingested_at        := OLD.ingested_at;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION listings_ingestion_identity() IS
  'Makes listings.ingestion_batch_id / ingested_at write-once. INSERT with a batch id stamps database time; UPDATE always preserves the original pair. No application role can bypass this.';

DROP TRIGGER IF EXISTS trg_listings_ingestion_identity ON listings;
CREATE TRIGGER trg_listings_ingestion_identity
  BEFORE INSERT OR UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION listings_ingestion_identity();

-- ── 3. Index for exact batch lookup ─────────────────────────────────────────
-- Partial: only rows with an identity are ever looked up this way, and this
-- keeps the index proportional to post-activation inflow rather than to the
-- whole ~87,000-row table.
CREATE INDEX IF NOT EXISTS idx_listings_ingestion_batch
  ON listings (ingestion_batch_id)
  WHERE ingestion_batch_id IS NOT NULL;

-- ── 4. DBA promotion: stamp identity on first insert only ───────────────────
-- The atomic promotion RPC is the only writer on the DBA path. `p_run_id` is
-- the natural batch identity, so no change to `listing_staging` is needed.
-- `ingestion_batch_id` is deliberately ABSENT from the DO UPDATE SET list; the
-- trigger enforces that regardless, this makes the intent explicit at the
-- call site. Every other clause is carried over from migration 052 unchanged.
CREATE OR REPLACE FUNCTION promote_scrape_run(
  p_run_id                uuid,
  p_coverage_complete     boolean DEFAULT false,
  p_delist_threshold      int     DEFAULT 3,
  p_lifecycle_enabled     boolean DEFAULT false,
  p_fail_after_listings   boolean DEFAULT false
)
RETURNS TABLE (
  published int, new_listings int, price_changes int, unchanged int,
  missed int, delisted int, lifecycle_applied boolean
)
LANGUAGE plpgsql
AS $promote$
DECLARE
  v_now       timestamptz := now();
  v_source    text;
  v_scope     text;
  v_status    text;
  v_promoted  timestamptz;
  v_digest    text;
  v_live      text;
  v_published int := 0;
  v_new       int := 0;
  v_changed   int := 0;
  v_unchanged int := 0;
  v_missed    int := 0;
  v_delisted  int := 0;
  v_lifecycle boolean := false;
BEGIN
  SELECT source, coverage_scope_hash, status, promoted_at, staging_digest
    INTO v_source, v_scope, v_status, v_promoted, v_digest
  FROM scrape_run WHERE id = p_run_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'promote_scrape_run: unknown run %', p_run_id; END IF;
  IF v_status IS DISTINCT FROM 'passed' THEN
    RAISE EXCEPTION 'promote_scrape_run: run % has status %, refusing to publish', p_run_id, v_status;
  END IF;
  IF v_promoted IS NOT NULL THEN
    RAISE EXCEPTION 'promote_scrape_run: run % already promoted at %', p_run_id, v_promoted;
  END IF;
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'promote_scrape_run: run % has no coverage_scope_hash', p_run_id;
  END IF;

  SELECT md5(string_agg(external_id || '|' || coalesce(price::text,'') , E'\n' ORDER BY external_id))
    INTO v_live FROM listing_staging WHERE run_id = p_run_id;
  IF v_digest IS DISTINCT FROM v_live THEN
    RAISE EXCEPTION 'promote_scrape_run: staging digest mismatch for run % (staging mutated after the gate)', p_run_id;
  END IF;

  WITH staged AS (
    SELECT DISTINCT ON (external_id) *
    FROM listing_staging WHERE run_id = p_run_id AND external_id IS NOT NULL
    ORDER BY external_id, id
  )
  INSERT INTO listings
    (title, price, currency, price_dkk, url, image_url, location, source,
     country, normalized_text, platform, external_id, scraped_at,
     last_seen_at, first_seen_at, is_active, consecutive_misses,
     last_miss_run_id, delisted_at, coverage_scope_hash, source_query,
     ingestion_batch_id)
  SELECT title, price, currency, price_dkk, url, image_url, location, source,
         country, normalized_text, platform, external_id, v_now, v_now, v_now,
         true, 0, NULL, NULL, v_scope, source_query,
         p_run_id                       -- first-ingestion identity
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
    -- ingestion_batch_id / ingested_at intentionally NOT updated here.
  GET DIAGNOSTICS v_published = ROW_COUNT;

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
    RAISE EXCEPTION 'promote_scrape_run: simulated crash after listings upsert';
  END IF;

  SELECT count(*) FILTER (WHERE o.kind='first_seen'),
         count(*) FILTER (WHERE o.kind='price_change'),
         count(*) FILTER (WHERE o.kind='unchanged')
    INTO v_new, v_changed, v_unchanged
  FROM record_price_observations(p_run_id) o;

  IF p_coverage_complete AND p_lifecycle_enabled THEN
    v_lifecycle := true;
    UPDATE listings l
       SET consecutive_misses = l.consecutive_misses + 1, last_miss_run_id = p_run_id
     WHERE l.source = v_source AND l.is_active
       AND coalesce(l.last_miss_run_id, '00000000-0000-0000-0000-000000000000') <> p_run_id
       AND EXISTS (SELECT 1 FROM listing_coverage_scopes lcs
                    WHERE lcs.listing_id = l.id AND lcs.scope_hash = v_scope)
       AND NOT EXISTS (SELECT 1 FROM listing_staging st
                        WHERE st.run_id = p_run_id AND st.external_id = l.external_id);
    GET DIAGNOSTICS v_missed = ROW_COUNT;

    UPDATE listings SET is_active = false, delisted_at = v_now
     WHERE source = v_source AND is_active AND consecutive_misses >= p_delist_threshold;
    GET DIAGNOSTICS v_delisted = ROW_COUNT;
  END IF;

  UPDATE scrape_run SET promoted_at = v_now, published_count = v_published WHERE id = p_run_id;

  RETURN QUERY SELECT v_published, v_new, v_changed, v_unchanged, v_missed, v_delisted, v_lifecycle;
END;
$promote$;

COMMIT;
