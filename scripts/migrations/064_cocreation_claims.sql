-- 064_cocreation_claims.sql
--
-- PAN-239. The co-creation foundation: one generic CLAIM about a product, votes
-- on it, flags against it, an append-only history, and a per-user moderation
-- row. NOT APPLIED: the owner decides when this goes live.
--
-- WHY ONE MODEL. "Played by" (PAN-237), "Known from" (PAN-238) and specs
-- (PAN-236) are the same thing — a fact about a product with a source and a
-- status — so they are three `type` values of one table, and every later
-- feature (fair_price, thomann_link, similar) is a new value, not a new table.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   product_claim     the fact: product, type, value (jsonb), source_url,
--                     author (NULL = seeded by Klup), status, score, flags.
--   claim_vote        one row per user and claim, +1 or -1, changeable.
--   claim_flag        one row per user and claim: spam | wrong | offensive.
--   claim_event       append-only history of every change (the wiki property).
--   cocreation_user   role, shadow_banned, reputation (phase-2 columns ready).
--   cocreation_recount(claim)  score and flag_count from votes and flags of
--                     users who are not shadow-banned, then the two automatic
--                     transitions: pending -> accepted at score >= 3,
--                     accepted -> hidden at score <= -3 or 3+ flags.
--   Rate limits in the database: 10 claims and 60 votes per user per 24 h.
--   RLS on every table; P0 revokes for anon and authenticated; then the
--   narrowest grants: anyone reads accepted claims; a signed-in user reads
--   their own pending claims, votes and flags, and writes only their own;
--   history and moderation rows are service-role only (the admin routes).
--
-- ── WHAT IT DOES *NOT* DO ──────────────────────────────────────────────────
-- NO DML. It seeds nothing and reads nothing from `kg_product.attributes`.
-- Reputation, curator invitations and the other claim types are columns and
-- CHECK values waiting for phase 2.
--
-- PRE / POST / DRIFT: PRE applies when none of the five tables exists; POST is
-- an explicit successful no-op when all five exist in this shape with RLS on
-- and nothing reachable by anon beyond accepted claims; DRIFT (some but not all
-- tables, another shape, or an open table) raises before any mutation.
-- Rollback: 064_rollback.sql (refuses while any table holds a row).

BEGIN;

DO $$
DECLARE
  v_tables text[] := ARRAY['product_claim', 'claim_vote', 'claim_flag', 'claim_event', 'cocreation_user'];
  v_present int := 0; v_t text; v_cols text; v_open int := 0;
BEGIN
  FOREACH v_t IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_t) IS NOT NULL THEN v_present := v_present + 1; END IF;
  END LOOP;
  IF v_present = 0 THEN
    RAISE NOTICE '064 cocreation: state=PRE, creating 5 tables.';
    RETURN;
  END IF;
  IF v_present < 5 THEN
    RAISE EXCEPTION '064 cocreation ABORT: state=DRIFT: % of 5 tables exist', v_present;
  END IF;
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'product_claim';
  IF v_cols IS DISTINCT FROM 'id,product_id,type,value,source_url,author_id,status,score,flag_count,created_at,updated_at' THEN
    RAISE EXCEPTION '064 cocreation ABORT: state=DRIFT: product_claim has columns %', v_cols;
  END IF;
  FOREACH v_t IN ARRAY v_tables LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_t)::regclass) THEN v_open := v_open + 1; END IF;
    IF v_t <> 'product_claim' AND has_table_privilege('anon', 'public.' || v_t, 'SELECT') THEN v_open := v_open + 1; END IF;
  END LOOP;
  IF v_open > 0 THEN
    RAISE EXCEPTION '064 cocreation ABORT: state=DRIFT: % table(s) without RLS or readable by anon', v_open;
  END IF;
  RAISE NOTICE '064 cocreation: state=POST (already applied). No-op.';
  PERFORM set_config('klup.m064_post', 'on', true);
END $$;

-- The DDL runs only from PRE: in POST the guard above set klup.m064_post for this transaction.
DO $$
BEGIN
  IF coalesce(current_setting('klup.m064_post', true), '') = 'on' THEN RETURN; END IF;

  CREATE TABLE public.product_claim (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  uuid NOT NULL REFERENCES public.kg_product(id) ON DELETE CASCADE,
    type        text NOT NULL CHECK (type IN ('played_by', 'iconic_use', 'spec', 'fair_price', 'thomann_link', 'similar')),
    value       jsonb NOT NULL,
    source_url  text,
    -- NULL means seeded by Klup. ON DELETE SET NULL keeps the fact when the
    -- author deletes their account: the claim is anonymised, not lost.
    author_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'hidden', 'rejected')),
    score       integer NOT NULL DEFAULT 0,
    flag_count  integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX product_claim_product_accepted ON public.product_claim (product_id, type) WHERE status = 'accepted';
  CREATE INDEX product_claim_queue ON public.product_claim (status, created_at);
  CREATE INDEX product_claim_author ON public.product_claim (author_id, created_at);

  CREATE TABLE public.claim_vote (
    claim_id    uuid NOT NULL REFERENCES public.product_claim(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    value       smallint NOT NULL CHECK (value IN (-1, 1)),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (claim_id, user_id)
  );
  CREATE INDEX claim_vote_user ON public.claim_vote (user_id, created_at);

  CREATE TABLE public.claim_flag (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id    uuid NOT NULL REFERENCES public.product_claim(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reason      text NOT NULL CHECK (reason IN ('spam', 'wrong', 'offensive')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (claim_id, user_id)
  );

  -- Append-only. claim_id is deliberately not a foreign key: the history of a
  -- deleted claim is the record that it existed.
  CREATE TABLE public.claim_event (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    claim_id    uuid NOT NULL,
    actor_id    uuid,
    kind        text NOT NULL CHECK (kind IN ('created', 'voted', 'flagged', 'status_changed', 'edited')),
    before      jsonb,
    after       jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX claim_event_claim ON public.claim_event (claim_id, id);

  CREATE TABLE public.cocreation_user (
    user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role          text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'curator', 'admin')),
    shadow_banned boolean NOT NULL DEFAULT false,
    reputation    integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now()
  );

  -- P0: a new public table is born world-readable and world-writable.
  REVOKE ALL ON public.product_claim, public.claim_vote, public.claim_flag, public.claim_event, public.cocreation_user FROM anon, authenticated;
  ALTER TABLE public.product_claim   ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.claim_vote      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.claim_flag      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.claim_event     ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.cocreation_user ENABLE ROW LEVEL SECURITY;

  -- Reads: anyone sees accepted claims; a signed-in user also sees their own.
  GRANT SELECT ON public.product_claim TO anon, authenticated;
  CREATE POLICY product_claim_read_accepted ON public.product_claim FOR SELECT USING (status = 'accepted');
  CREATE POLICY product_claim_read_own ON public.product_claim FOR SELECT TO authenticated USING (author_id = auth.uid());
  -- Writes: a signed-in user adds a claim as themselves, always pending. No
  -- UPDATE or DELETE for users: edits and moderation go through the admin
  -- routes (service role), which is what keeps the history complete.
  GRANT INSERT ON public.product_claim TO authenticated;
  CREATE POLICY product_claim_insert_own ON public.product_claim FOR INSERT TO authenticated
    WITH CHECK (author_id = auth.uid() AND status = 'pending' AND type IN ('played_by', 'iconic_use', 'spec'));

  -- Votes and flags: a user reads and writes only their own rows. Nobody can
  -- list voters: the public sees `score`, never a vote row.
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.claim_vote TO authenticated;
  CREATE POLICY claim_vote_own ON public.claim_vote FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  GRANT SELECT, INSERT ON public.claim_flag TO authenticated;
  CREATE POLICY claim_flag_own ON public.claim_flag FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  -- claim_event and cocreation_user: no grant, no policy — service role only.
  -- A user may read their own moderation row (role; never another user's).
  GRANT SELECT ON public.cocreation_user TO authenticated;
  CREATE POLICY cocreation_user_own ON public.cocreation_user FOR SELECT TO authenticated USING (user_id = auth.uid());
END $$;

-- Functions are CREATE OR REPLACE, so POST reruns them harmlessly.

-- Score, flags and the two automatic transitions. SECURITY DEFINER so a user's
-- vote can recount a claim they may not update; search_path pinned.
CREATE OR REPLACE FUNCTION public.cocreation_recount(p_claim uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_score int; v_flags int; v_old text; v_new text; v_author uuid; v_banned boolean;
BEGIN
  SELECT coalesce(sum(v.value), 0) INTO v_score FROM claim_vote v
    LEFT JOIN cocreation_user u ON u.user_id = v.user_id
   WHERE v.claim_id = p_claim AND NOT coalesce(u.shadow_banned, false);
  SELECT count(*) INTO v_flags FROM claim_flag f
    LEFT JOIN cocreation_user u ON u.user_id = f.user_id
   WHERE f.claim_id = p_claim AND NOT coalesce(u.shadow_banned, false);
  SELECT c.status, c.author_id INTO v_old, v_author FROM product_claim c WHERE c.id = p_claim FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT coalesce(u.shadow_banned, false) INTO v_banned FROM cocreation_user u WHERE u.user_id = v_author;
  v_new := v_old;
  -- A shadow-banned author's claim never auto-accepts; it just stays pending.
  IF v_old = 'pending' AND v_score >= 3 AND NOT coalesce(v_banned, false) THEN v_new := 'accepted'; END IF;
  IF v_old = 'accepted' AND (v_score <= -3 OR v_flags >= 3) THEN v_new := 'hidden'; END IF;
  UPDATE product_claim SET score = v_score, flag_count = v_flags, status = v_new,
         updated_at = CASE WHEN v_new <> v_old THEN now() ELSE updated_at END
   WHERE id = p_claim;
  IF v_new <> v_old THEN
    INSERT INTO claim_event (claim_id, actor_id, kind, before, after)
    VALUES (p_claim, NULL, 'status_changed', jsonb_build_object('status', v_old), jsonb_build_object('status', v_new, 'score', v_score, 'flags', v_flags));
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cocreation_recount(uuid) FROM PUBLIC, anon, authenticated;

-- BEFORE INSERT: the rate limit. AFTER INSERT/UPDATE/DELETE: recount and log.
CREATE OR REPLACE FUNCTION public.cocreation_on_vote() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_WHEN = 'BEFORE' THEN
    IF (SELECT count(*) FROM claim_vote WHERE user_id = NEW.user_id AND created_at > now() - interval '24 hours') >= 60 THEN
      RAISE EXCEPTION 'cocreation: vote rate limit (60 per 24 h)' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- The vote is logged before the recount, so a status change reads after its cause.
  IF TG_OP = 'DELETE' THEN
    INSERT INTO claim_event (claim_id, actor_id, kind, before, after) VALUES (OLD.claim_id, OLD.user_id, 'voted', jsonb_build_object('value', OLD.value), NULL);
    PERFORM cocreation_recount(OLD.claim_id);
    RETURN OLD;
  END IF;
  INSERT INTO claim_event (claim_id, actor_id, kind, before, after)
  VALUES (NEW.claim_id, NEW.user_id, 'voted', CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('value', OLD.value) END, jsonb_build_object('value', NEW.value));
  PERFORM cocreation_recount(NEW.claim_id);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.cocreation_on_flag() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO claim_event (claim_id, actor_id, kind, after) VALUES (NEW.claim_id, NEW.user_id, 'flagged', jsonb_build_object('reason', NEW.reason));
  PERFORM cocreation_recount(NEW.claim_id);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.cocreation_on_claim() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.author_id IS NOT NULL AND (SELECT count(*) FROM product_claim WHERE author_id = NEW.author_id AND created_at > now() - interval '24 hours') >= 10 THEN
      RAISE EXCEPTION 'cocreation: claim rate limit (10 per 24 h)' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO claim_event (claim_id, actor_id, kind, after)
    VALUES (NEW.id, NEW.author_id, 'created', jsonb_build_object('type', NEW.type, 'value', NEW.value, 'source_url', NEW.source_url, 'status', NEW.status));
    RETURN NEW;
  END IF;
  -- An edit or a moderation decision by the admin routes (service role).
  IF NEW.value IS DISTINCT FROM OLD.value OR NEW.source_url IS DISTINCT FROM OLD.source_url THEN
    INSERT INTO claim_event (claim_id, actor_id, kind, before, after)
    VALUES (NEW.id, auth.uid(), 'edited', jsonb_build_object('value', OLD.value, 'source_url', OLD.source_url), jsonb_build_object('value', NEW.value, 'source_url', NEW.source_url));
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND pg_trigger_depth() = 1 THEN
    INSERT INTO claim_event (claim_id, actor_id, kind, before, after)
    VALUES (NEW.id, auth.uid(), 'status_changed', jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status));
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF coalesce(current_setting('klup.m064_post', true), '') = 'on' THEN RETURN; END IF;
  CREATE TRIGGER claim_vote_limit BEFORE INSERT ON public.claim_vote FOR EACH ROW EXECUTE FUNCTION public.cocreation_on_vote();
  CREATE TRIGGER claim_vote_recount AFTER INSERT OR UPDATE OR DELETE ON public.claim_vote FOR EACH ROW EXECUTE FUNCTION public.cocreation_on_vote();
  CREATE TRIGGER claim_flag_recount AFTER INSERT ON public.claim_flag FOR EACH ROW EXECUTE FUNCTION public.cocreation_on_flag();
  CREATE TRIGGER product_claim_history BEFORE INSERT OR UPDATE ON public.product_claim FOR EACH ROW EXECUTE FUNCTION public.cocreation_on_claim();
END $$;

COMMIT;
