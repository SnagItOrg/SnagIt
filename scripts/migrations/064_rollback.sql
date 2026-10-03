-- 064_rollback.sql — reverses 064_cocreation_claims.sql.
--
-- Drops the five co-creation tables and the four functions, but ONLY while
-- every table is empty: a claim, a vote, a flag or a history row is user data,
-- and this file never destroys any. Absent tables are a no-op.

BEGIN;

DO $$
DECLARE
  v_tables text[] := ARRAY['product_claim', 'claim_vote', 'claim_flag', 'claim_event', 'cocreation_user'];
  v_t text; v_present int := 0; v_n bigint; v_rows bigint := 0;
BEGIN
  FOREACH v_t IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_t) IS NOT NULL THEN
      v_present := v_present + 1;
      EXECUTE format('SELECT count(*) FROM public.%I', v_t) INTO v_n;
      v_rows := v_rows + v_n;
    END IF;
  END LOOP;
  IF v_present = 0 THEN
    RAISE NOTICE '064 rollback: no co-creation table exists. No-op.';
    RETURN;
  END IF;
  IF v_rows > 0 THEN
    RAISE EXCEPTION '064 rollback ABORT: the co-creation tables hold % row(s); they are user data and are not dropped.', v_rows;
  END IF;
  DROP TABLE IF EXISTS public.claim_vote, public.claim_flag, public.claim_event, public.cocreation_user, public.product_claim;
  DROP FUNCTION IF EXISTS public.cocreation_on_vote(), public.cocreation_on_flag(), public.cocreation_on_claim(), public.cocreation_recount(uuid);
  RAISE NOTICE '064 rollback: dropped % empty table(s) and the functions.', v_present;
END $$;

COMMIT;
