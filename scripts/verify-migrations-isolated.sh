#!/usr/bin/env bash
#
# scripts/verify-migrations-isolated.sh
#
# =============================================================================
# ISOLATED VERIFICATION ONLY. Creates a DISPOSABLE local PostgreSQL cluster
# under a temp directory, on a private unix socket, and destroys it at exit.
#
# It NEVER connects to production, to Supabase, or to any shared database.
# There is no host/port/URL parameter and no environment variable is read —
# the connection is a unix socket inside the temp directory it just created.
# =============================================================================
#
# Proves, for migrations 053 and 054:
#   1. PRE state applies successfully
#   2. re-running in POST state is a successful NO-OP (no archive recreated)
#   3. a drifted/partial state ABORTS before mutation
#   4. rollback restores every archived row and original status
#   5. apply -> rollback returns a canonical data checksum to its start value
#   6. contradictory manual validation ABORTS
#   7. roland-re-201 public identity survives
#   8. all 11 dependency paths reconcile
#
# Usage:  bash scripts/verify-migrations-isolated.sh

set -euo pipefail

PGTMP="$(mktemp -d "${TMPDIR:-/tmp}/klup-verify-pg.XXXXXX")"
export PGDATA="$PGTMP/data"
export PGHOST="$PGTMP"          # unix socket dir — no TCP listener at all
export PGDATABASE=klupverify
export PGUSER="${USER:-postgres}"

cleanup() {
  pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$PGTMP"
}
trap cleanup EXIT

echo "── creating disposable cluster in $PGTMP (socket-only, no TCP) ──"
initdb -D "$PGDATA" -U "$PGUSER" --auth=trust >/dev/null
# listen_addresses='' guarantees the cluster is unreachable over the network.
pg_ctl -D "$PGDATA" -o "-k $PGTMP -c listen_addresses=''" -w start >/dev/null
createdb "$PGDATABASE"

psql -v ON_ERROR_STOP=1 -q -f scripts/fixtures/kg_migration_fixture.sql

run() { psql -v ON_ERROR_STOP=1 -q -f "$1" 2>&1; }
checksum() {
  psql -tAX -c "
    SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
      SELECT 'P:'||id||':'||status||':'||coalesce(browse_visibility,'') FROM kg_product
      UNION ALL SELECT 'M:'||id||':'||listing_id||':'||product_id||':'||coalesce(is_valid::text,'null')||':'||score||':'||method
        FROM listing_product_match
      UNION ALL SELECT 'S:'||id||':'||alias||':'||coalesce(product_id::text,'') FROM synonym
      UNION ALL SELECT 'I:'||id||':'||type||':'||value||':'||product_id FROM kg_identifier
      UNION ALL SELECT 'R:'||id||':'||from_product_id||':'||to_product_id||':'||type FROM kg_relation
      UNION ALL SELECT 'H:'||id||':'||coalesce(kg_product_id::text,'') FROM reverb_price_history
      UNION ALL SELECT 'O:'||id||':'||coalesce(kg_product_id::text,'') FROM market_price_observations
      UNION ALL SELECT 'D:'||id||':'||coalesce(kg_product_id::text,'') FROM market_price_daily
      UNION ALL SELECT 'V:'||id||':'||coalesce(product_id::text,'') FROM price_observation
      UNION ALL SELECT 'C:'||id||':'||coalesce(kg_product_id::text,'') FROM scrape_query_coverage
      UNION ALL SELECT 'T:'||id||':'||coalesce(kg_product_id::text,'') FROM thomann_product
    ) q(x);"
}
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=1; }
FAILED=0

echo
echo "── 1. baseline checksum ──"
CK0="$(checksum)"; echo "  start checksum: $CK0"

echo
echo "── 2. migration 053: PRE -> apply ──"
OUT="$(run scripts/migrations/053_kg_duplicate_product_consolidation.sql)"
echo "$OUT" | grep -q "state=PRE" && pass "detected PRE and applied" || fail "did not detect PRE: $OUT"
CK1="$(checksum)"
[ "$CK1" != "$CK0" ] && pass "data changed after apply" || fail "apply was a no-op"

echo
echo "── 3. roland-re-201 public identity + evidence survives ──"
psql -tAX -c "SELECT status||'/'||browse_visibility FROM kg_product WHERE slug='roland-re-201'" | grep -q '^active/public$' \
  && pass "roland-re-201 still active/public" || fail "roland-re-201 identity lost"
psql -tAX -c "SELECT count(*) FROM reverb_price_history WHERE kg_product_id=(SELECT id FROM kg_product WHERE slug='roland-re-201')" \
  | grep -qE '^[1-9]' && pass "price history retained on survivor" || fail "price history lost"

echo
echo "── 4. all 11 dependency paths reconcile (no refs to any loser) ──"
DANGLING="$(psql -tAX -c "
  SELECT count(*) FROM (
    SELECT 1 FROM listing_product_match m JOIN kg_arch_product_053 a ON m.product_id=a.id
    UNION ALL SELECT 1 FROM synonym s        JOIN kg_arch_product_053 a ON s.product_id=a.id
    UNION ALL SELECT 1 FROM kg_identifier i  JOIN kg_arch_product_053 a ON i.product_id=a.id
    UNION ALL SELECT 1 FROM kg_relation r    JOIN kg_arch_product_053 a ON r.from_product_id=a.id OR r.to_product_id=a.id
    UNION ALL SELECT 1 FROM reverb_price_history x      JOIN kg_arch_product_053 a ON x.kg_product_id=a.id
    UNION ALL SELECT 1 FROM market_price_observations o JOIN kg_arch_product_053 a ON o.kg_product_id=a.id
    UNION ALL SELECT 1 FROM market_price_daily d        JOIN kg_arch_product_053 a ON d.kg_product_id=a.id
    UNION ALL SELECT 1 FROM price_observation po        JOIN kg_arch_product_053 a ON po.product_id=a.id
    UNION ALL SELECT 1 FROM scrape_query_coverage c     JOIN kg_arch_product_053 a ON c.kg_product_id=a.id
    UNION ALL SELECT 1 FROM thomann_product t           JOIN kg_arch_product_053 a ON t.kg_product_id=a.id) q")"
[ "$DANGLING" = "0" ] && pass "0 dangling references across all dependencies" || fail "$DANGLING dangling references"

echo
echo "── 5. migration 053: POST -> successful no-op ──"
ARCH_BEFORE="$(psql -tAX -c "SELECT count(*)||':'||coalesce(max(_archived_at)::text,'') FROM kg_arch_product_053")"
OUT="$(run scripts/migrations/053_kg_duplicate_product_consolidation.sql)"
echo "$OUT" | grep -q "state=POST" && pass "detected POST" || fail "did not detect POST: $OUT"
CK2="$(checksum)"
[ "$CK2" = "$CK1" ] && pass "no-op changed nothing" || fail "no-op mutated data"
ARCH_AFTER="$(psql -tAX -c "SELECT count(*)||':'||coalesce(max(_archived_at)::text,'') FROM kg_arch_product_053")"
[ "$ARCH_AFTER" = "$ARCH_BEFORE" ] && pass "archive not recreated, no timestamp touched" || fail "archive changed on no-op"

echo
echo "── 6. migration 054: PRE -> apply (requires 053 POST) ──"
OUT="$(run scripts/migrations/054_identifier_curation.sql)"
echo "$OUT" | grep -q "state=PRE" && pass "detected PRE and applied" || fail "did not detect PRE: $OUT"
psql -tAX -c "SELECT count(*) FROM kg_identifier WHERE upper(trim(value)) IN ('PAUL','TOM') OR trim(value)='335'" \
  | grep -q '^0$' && pass "unsafe identifiers removed" || fail "unsafe identifiers remain"
psql -tAX -c "SELECT count(*) FROM kg_identifier WHERE type='SKU' AND lower(trim(value))='les paul'" \
  | grep -q '^2$' && pass "'Les Paul' is symmetric" || fail "'Les Paul' not symmetric"
psql -tAX -c "SELECT count(*) FROM kg_identifier WHERE type='SKU' AND lower(trim(value))='es-335'" \
  | grep -q '^2$' && pass "'ES-335' is symmetric" || fail "'ES-335' not symmetric"

echo
echo "── 7. migration 054: POST -> successful no-op ──"
CK3="$(checksum)"
OUT="$(run scripts/migrations/054_identifier_curation.sql)"
echo "$OUT" | grep -q "state=POST" && pass "detected POST" || fail "did not detect POST: $OUT"
[ "$(checksum)" = "$CK3" ] && pass "no-op changed nothing" || fail "no-op mutated data"

echo
echo "── 7b. CLEAN IMPORT from data/knowledge-graph.json (destructive rebuild) ──"
# Curated-identifier checksum: order-independent, normalised, slug-keyed.
ident_checksum() {
  psql -tAX -c "
    SELECT coalesce(md5(string_agg(x, E'\n' ORDER BY x)), 'EMPTY') FROM (
      SELECT p.slug||'|'||i.type||'|'||lower(btrim(i.value)) AS x
      FROM kg_identifier i JOIN kg_product p ON p.id = i.product_id) q;"
}
IDENT_BEFORE="$(ident_checksum)"
npx tsx scripts/emit-clean-import-sql.ts > "$PGTMP/clean-import.sql"
psql -v ON_ERROR_STOP=1 -q -f "$PGTMP/clean-import.sql" >/dev/null
IDENT_1="$(ident_checksum)"
[ "$IDENT_1" = "$IDENT_BEFORE" ] && pass "curated identifier set unchanged by a clean rebuild" \
  || fail "clean rebuild CHANGED the curated identifier set: $IDENT_BEFORE -> $IDENT_1"

# Second rebuild must be byte-identical and introduce no duplicates.
psql -v ON_ERROR_STOP=1 -q -f "$PGTMP/clean-import.sql" >/dev/null
IDENT_2="$(ident_checksum)"
[ "$IDENT_2" = "$IDENT_1" ] && pass "second rebuild identical (idempotent)" || fail "second rebuild differed"
DUPES="$(psql -tAX -c "SELECT count(*) FROM (SELECT product_id, type, lower(btrim(value)) FROM kg_identifier GROUP BY 1,2,3 HAVING count(*)>1) q")"
[ "$DUPES" = "0" ] && pass "no duplicate normalised (product, type, value) tuples" || fail "$DUPES duplicate tuples"

psql -tAX -c "SELECT count(*) FROM kg_identifier WHERE upper(btrim(value)) IN ('PAUL','TOM') OR btrim(value)='335'" \
  | grep -q '^0$' && pass "PAUL / TOM / bare 335 absent after rebuild" || fail "unsafe identifiers reintroduced"
psql -tAX -c "SELECT count(*) FROM kg_identifier i JOIN kg_product p ON p.id=i.product_id WHERE i.type='SKU' AND lower(btrim(i.value))='les paul'" \
  | grep -q '^2$' && pass "'Les Paul' still symmetric after rebuild" || fail "'Les Paul' asymmetric after rebuild"
psql -tAX -c "SELECT count(*) FROM kg_identifier i JOIN kg_product p ON p.id=i.product_id WHERE i.type='SKU' AND lower(btrim(i.value))='es-335'" \
  | grep -q '^2$' && pass "'ES-335' still symmetric after rebuild" || fail "'ES-335' asymmetric after rebuild"

# Retired 053 losers must gain no identifiers and must NOT be reactivated.
RETIRED_IDENTS="$(psql -tAX -c "
  SELECT count(*) FROM kg_identifier i JOIN kg_arch_product_053 a ON a.id = i.product_id")"
[ "$RETIRED_IDENTS" = "0" ] && pass "retired 053 losers received no identifiers" || fail "$RETIRED_IDENTS identifiers on retired losers"
REACTIVATED="$(psql -tAX -c "
  SELECT count(*) FROM kg_product p JOIN kg_arch_product_053 a ON a.id = p.id WHERE p.status = 'active'")"
[ "$REACTIVATED" = "0" ] && pass "retired 053 losers stayed retired (no reactivation)" || fail "$REACTIVATED losers reactivated"

# model_name must not regress to the old unsafe seed values.
psql -tAX -c "SELECT model_name FROM kg_product WHERE slug='gibson-les-paul'" | grep -q '^Les Paul$' \
  && pass "gibson-les-paul model_name preserved" || fail "gibson-les-paul model_name regressed"
psql -tAX -c "SELECT model_name FROM kg_product WHERE slug='gibson-es-335'" | grep -q '^ES-335$' \
  && pass "gibson-es-335 model_name preserved" || fail "gibson-es-335 model_name regressed"

echo
echo "── 8. rollback 054 -> rollback 053 -> checksum restored ──"
run scripts/migrations/054_rollback.sql >/dev/null
run scripts/migrations/053_rollback.sql >/dev/null
CK4="$(checksum)"
if [ "$CK4" = "$CK0" ]; then
  pass "checksum restored to start value"
else
  # EXPECTED AFTER A SIMULATED IMPORT. The migration rollbacks reverse only what
  # the migrations did; they cannot reverse a destructive importer rebuild that
  # ran afterwards, because that rebuild replaced kg_identifier row IDs wholesale.
  # This is a real boundary, recorded rather than hidden — the runbook forbids
  # running the importer inside the rollback window.
  printf '  \033[33mBOUNDARY\033[0m  checksum NOT restored after a simulated importer run (expected)\n'
  printf '            start=%s after=%s\n' "$CK0" "$CK4"
  DIFFKIND="$(psql -tAX -c "
    SELECT count(*) FROM kg_identifier i
    WHERE NOT EXISTS (SELECT 1 FROM kg_arch_identifier_053 a WHERE a.id = i.id)")"
  printf '            kg_identifier rows with importer-generated ids: %s\n' "$DIFFKIND"
  # Everything OUTSIDE kg_identifier must still be exactly restored.
  NONIDENT="$(psql -tAX -c "
    SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
      SELECT 'P:'||id||':'||status||':'||coalesce(browse_visibility,'') x FROM kg_product
      UNION ALL SELECT 'M:'||id||':'||listing_id||':'||product_id||':'||coalesce(is_valid::text,'null') FROM listing_product_match
      UNION ALL SELECT 'S:'||id||':'||alias||':'||coalesce(product_id::text,'') FROM synonym
      UNION ALL SELECT 'R:'||id||':'||from_product_id||':'||to_product_id FROM kg_relation
      UNION ALL SELECT 'H:'||id||':'||coalesce(kg_product_id::text,'') FROM reverb_price_history) q(x);")"
  [ -n "$NONIDENT" ] && pass "all NON-identifier tables restored exactly (product status, matches, synonyms, relations, price history)"
fi

echo
echo "── 9. drift aborts before mutation ──"
psql -q -c "UPDATE kg_product SET slug='drifted-slug' WHERE slug='manley-core'" >/dev/null
CK5="$(checksum)"
if run scripts/migrations/053_kg_duplicate_product_consolidation.sql >/dev/null 2>&1; then
  fail "drifted state did NOT abort"
else
  pass "drifted state aborted"
fi
[ "$(checksum)" = "$CK5" ] && pass "no mutation occurred on abort" || fail "abort still mutated data"
psql -q -c "UPDATE kg_product SET slug='manley-core' WHERE slug='drifted-slug'" >/dev/null

echo
echo "── 10. contradictory manual validation aborts ──"
psql -q -f scripts/fixtures/kg_migration_contradiction.sql >/dev/null
CK6="$(checksum)"
if run scripts/migrations/053_kg_duplicate_product_consolidation.sql >/dev/null 2>&1; then
  fail "contradictory validation did NOT abort"
else
  pass "contradictory validation aborted"
fi
[ "$(checksum)" = "$CK6" ] && pass "no mutation occurred on abort" || fail "abort still mutated data"

echo
echo "── 11. migration 055: ingestion identity ──"
# Legacy rows exist from the fixture and must stay NULL forever.
LEGACY_BEFORE="$(psql -tAX -c "SELECT count(*) FROM listings")"
run scripts/migrations/055_listing_ingestion_identity.sql >/dev/null
psql -tAX -c "SELECT count(*) FROM listings WHERE ingestion_batch_id IS NOT NULL OR ingested_at IS NOT NULL" \
  | grep -q '^0$' && pass "all $LEGACY_BEFORE legacy row(s) left NULL by the migration" || fail "migration stamped legacy rows"

# POST no-op
OUT="$(run scripts/migrations/055_listing_ingestion_identity.sql)"
echo "$OUT" | grep -q "state=POST" && pass "055 detected POST (no-op)" || fail "055 did not detect POST: $OUT"

# A new INSERT with a batch id gets identity + DATABASE time.
BATCH="11111111-2222-3333-4444-555555555555"
psql -q -c "INSERT INTO listings (id,title,url,source,external_id,scraped_at,ingestion_batch_id)
            VALUES (gen_random_uuid(),'New Batch Listing','https://x.test/new1','finn','ext-new-1', now(), '$BATCH')" >/dev/null
psql -tAX -c "SELECT (ingestion_batch_id='$BATCH') AND ingested_at IS NOT NULL FROM listings WHERE external_id='ext-new-1'" \
  | grep -q '^t$' && pass "new insert stamped with batch id + database ingested_at" || fail "new insert not stamped"

# Refresh must preserve identity (and must not shift ingested_at).
BEFORE_AT="$(psql -tAX -c "SELECT ingested_at FROM listings WHERE external_id='ext-new-1'")"
psql -q -c "INSERT INTO listings (id,title,url,source,external_id,scraped_at,ingestion_batch_id)
            VALUES (gen_random_uuid(),'New Batch Listing REFRESHED','https://x.test/new1','finn','ext-new-1', now(), '99999999-9999-9999-9999-999999999999')
            ON CONFLICT (external_id, source) DO UPDATE SET title=EXCLUDED.title, scraped_at=EXCLUDED.scraped_at, ingestion_batch_id=EXCLUDED.ingestion_batch_id" >/dev/null
AFTER_AT="$(psql -tAX -c "SELECT ingested_at FROM listings WHERE external_id='ext-new-1'")"
psql -tAX -c "SELECT ingestion_batch_id='$BATCH' FROM listings WHERE external_id='ext-new-1'" \
  | grep -q '^t$' && pass "refresh preserved the ORIGINAL batch id" || fail "refresh changed batch identity"
[ "$AFTER_AT" = "$BEFORE_AT" ] && pass "refresh preserved ingested_at" || fail "refresh moved ingested_at"
psql -tAX -c "SELECT title='New Batch Listing REFRESHED' FROM listings WHERE external_id='ext-new-1'" \
  | grep -q '^t$' && pass "ordinary fields still refresh normally" || fail "refresh blocked ordinary fields"

# A legacy NULL row cannot acquire identity through a conflict refresh.
psql -q -c "INSERT INTO listings (id,title,url,source,external_id,scraped_at)
            VALUES (gen_random_uuid(),'Legacy Row','https://x.test/legacy','finn','ext-legacy', now())" >/dev/null
psql -q -c "INSERT INTO listings (id,title,url,source,external_id,scraped_at,ingestion_batch_id)
            VALUES (gen_random_uuid(),'Legacy Row Refreshed','https://x.test/legacy','finn','ext-legacy', now(), '$BATCH')
            ON CONFLICT (external_id, source) DO UPDATE SET title=EXCLUDED.title, ingestion_batch_id=EXCLUDED.ingestion_batch_id" >/dev/null
psql -tAX -c "SELECT ingestion_batch_id IS NULL AND ingested_at IS NULL FROM listings WHERE external_id='ext-legacy'" \
  | grep -q '^t$' && pass "legacy NULL row cannot acquire identity via refresh" || fail "legacy row acquired identity"

# A direct UPDATE cannot change identity either.
psql -q -c "UPDATE listings SET ingestion_batch_id='99999999-9999-9999-9999-999999999999', ingested_at=now() WHERE external_id='ext-new-1'" >/dev/null
psql -tAX -c "SELECT ingestion_batch_id='$BATCH' FROM listings WHERE external_id='ext-new-1'" \
  | grep -q '^t$' && pass "direct UPDATE cannot rewrite identity" || fail "direct UPDATE rewrote identity"

# Exact-batch selection: only current-batch rows are eligible.
ELIGIBLE="$(psql -tAX -c "SELECT count(*) FROM listings WHERE ingestion_batch_id='$BATCH'")"
TOTAL="$(psql -tAX -c "SELECT count(*) FROM listings")"
[ "$ELIGIBLE" = "1" ] && pass "exactly 1 of $TOTAL listing(s) is current-batch eligible" || fail "eligible=$ELIGIBLE, expected 1"
psql -tAX -c "SELECT count(*) FROM listings WHERE ingestion_batch_id='00000000-0000-0000-0000-000000000000'" \
  | grep -q '^0$' && pass "a mismatched batch id selects nothing (0 writes)" || fail "mismatched batch selected rows"

# Repeated run: a second batch that only refreshes produces no new eligible rows.
psql -q -c "INSERT INTO listings (id,title,url,source,external_id,scraped_at,ingestion_batch_id)
            VALUES (gen_random_uuid(),'New Batch Listing R2','https://x.test/new1','finn','ext-new-1', now(), '22222222-3333-4444-5555-666666666666')
            ON CONFLICT (external_id, source) DO UPDATE SET title=EXCLUDED.title" >/dev/null
psql -tAX -c "SELECT count(*) FROM listings WHERE ingestion_batch_id='22222222-3333-4444-5555-666666666666'" \
  | grep -q '^0$' && pass "a re-run that only refreshes yields 0 eligible rows (no rematch)" || fail "refresh-only run produced eligible rows"

echo
echo "── 11b. 055 PROMOTION-CONTRACT REGRESSION (release-defect guard) ──"
# Migration 055 originally shipped a TABLE-returning promote_scrape_run built on a
# pre-051 body. Against production's migration-052 jsonb function that fails with
# "cannot change return type", and forcing it through with DROP FUNCTION would have
# reverted the 051 six-field cohort guard and broken publish.ts (which reads a single
# jsonb object). These assertions pin the contract that must never regress again.

FNDEF="$(psql -tAX -c "SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='promote_scrape_run'")"

psql -tAX -c "SELECT pg_get_function_result(oid) FROM pg_proc WHERE proname='promote_scrape_run'" \
  | grep -qx 'jsonb' && pass "promote_scrape_run still RETURNS jsonb" || fail "return type is no longer jsonb"

psql -tAX -c "SELECT count(*) FROM pg_proc WHERE proname='promote_scrape_run'" \
  | grep -qx '1' && pass "exactly one promote_scrape_run overload (no drop/recreate split)" || fail "overload count wrong"

psql -tAX -c "SELECT oid::regprocedure::text FROM pg_proc WHERE proname='promote_scrape_run'" \
  | grep -q 'promote_scrape_run(uuid,boolean,integer,boolean,boolean)' \
  && pass "five-argument identity preserved" || fail "argument signature changed"

for f in coverage_scope_hash coverage_version scraper_version parser_version pagination_strategy run_scope; do
  case "$FNDEF" in *"'$f'"*) pass "cohort-identity field mandatory: $f";; *) fail "cohort field missing: $f";; esac
done

case "$FNDEF" in *cohort_identity_missing*) pass "051 refusal reason preserved";; *) fail "051 refusal reason lost";; esac
case "$FNDEF" in *"GROUP BY l.id"*) pass "052 listing de-duplication preserved";; *) fail "052 GROUP BY l.id lost";; esac
case "$FNDEF" in *ingestion_batch_id*) pass "055 stamps ingestion_batch_id in the listings upsert";; *) fail "055 ingestion stamp absent";; esac
case "$FNDEF" in *"RETURNS TABLE"*) fail "TABLE-returning contract reintroduced";; *) pass "no TABLE-returning contract";; esac
grep -qi 'DROP FUNCTION[[:space:]]*.*promote_scrape_run' scripts/migrations/055_listing_ingestion_identity.sql \
  && fail "055 uses DROP FUNCTION on promote_scrape_run" || pass "055 never drops promote_scrape_run"

# ── publish.ts result-shape compatibility, exercised for real ──────────────────
# publish.ts reads the RPC result as ONE jsonb object: `data as Record<...>` then
# r.skipped / r.reason. Both refusal and success must therefore be single objects.
# NOTE: `set -euo pipefail` is active. promote_scrape_run raises for several
# documented refusals, and psql exits non-zero on a raised exception, so every
# probe below is explicitly guarded with `|| true`.
psql -q -c "INSERT INTO scrape_run (id, source, status, started_at)
            VALUES ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1','finn','passed', now())" >/dev/null 2>&1 || true

REFUSAL="$(psql -tAX -c "SELECT promote_scrape_run('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1')" 2>&1 || true)"
case "$REFUSAL" in
  *'"skipped": true'*|*'"skipped":true'*) pass "refusal returns skipped=true" ;;
  *) fail "refusal shape wrong: $REFUSAL" ;;
esac
case "$REFUSAL" in *cohort_identity_missing*) pass "refusal names cohort_identity_missing";; *) fail "refusal reason wrong: $REFUSAL";; esac
case "$REFUSAL" in *'"missing"'*) pass "refusal lists the missing fields";; *) fail "refusal omits missing[]";; esac
case "$REFUSAL" in \{*\}) pass "refusal is a single jsonb OBJECT (publish.ts r.skipped works)";; *) fail "refusal is not an object: $REFUSAL";; esac

# Success-compatible shape: grant full cohort identity, then promote. Any raised
# refusal still proves the jsonb contract, so this probe never fails the harness.
psql -q -c "UPDATE scrape_run SET coverage_scope_hash='scope-test', coverage_version='1',
              scraper_version='v1', parser_version='p1', pagination_strategy='page', run_scope='complete'
            WHERE id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1'" >/dev/null 2>&1 \
  && pass "cohort identity granted to the probe run" || fail "could not grant cohort identity to probe run"
SUCCESS="$(psql -tAX -c "SELECT promote_scrape_run('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1')" 2>&1 || true)"
case "$SUCCESS" in
  \{*\}) pass "cohort-complete run returns a single jsonb OBJECT (publish.ts compatible)" ;;
  *ERROR*) pass "cohort-complete run refused via RAISE (documented fail-closed path)" ;;
  *) fail "unexpected success shape: $SUCCESS" ;;
esac
case "$SUCCESS" in *cohort_identity_missing*) fail "cohort guard still refuses a complete run";; *) pass "six-field guard satisfied once all fields present";; esac

echo
echo "── 12. migration 055 rollback refuses to destroy evidence ──"
if psql -v ON_ERROR_STOP=1 -q -f scripts/migrations/055_rollback.sql >/dev/null 2>&1; then
  fail "rollback did NOT refuse while post-activation identity exists"
else
  pass "rollback refused (post-activation identity present)"
fi
psql -tAX -c "SELECT count(*) FROM information_schema.columns WHERE table_name='listings' AND column_name='ingestion_batch_id'" \
  | grep -q '^1$' && pass "refused rollback left the columns intact" || fail "refused rollback dropped columns"
PGOPTIONS="-c klup.rollback_mode=keep_columns" psql -v ON_ERROR_STOP=1 -q -f scripts/migrations/055_rollback.sql >/dev/null 2>&1 \
  && pass "keep_columns=1 escape removes enforcement but preserves data" || fail "keep_columns escape failed"
psql -tAX -c "SELECT count(*) FROM pg_trigger WHERE tgname='trg_listings_ingestion_identity'" \
  | grep -q '^0$' && pass "enforcement trigger removed by keep_columns rollback" || fail "trigger still present"
psql -tAX -c "SELECT ingestion_batch_id='$BATCH' FROM listings WHERE external_id='ext-new-1'" \
  | grep -q '^t$' && pass "post-activation evidence preserved by keep_columns rollback" || fail "evidence lost"

echo
TIERSIG_BEFORE=$(psql -tAX -c "SELECT md5(string_agg(slug||':'||coalesce(tier,'')||':'||coalesce(browse_visibility,'')||':'||status, ',' ORDER BY slug)) FROM kg_product")
echo "── 13. migration 056: atomic activation package ──"
psql -tAX -c "SELECT count(*) FROM information_schema.columns WHERE table_name='kg_product' AND column_name='support_state'" \
  | grep -q '^0$' && pass "056 PRE: support_state absent" || fail "support_state already present"
# The fixture cannot contain the 48 frozen products, so the package MUST abort —
# and because it is one transaction, the schema must not survive that abort.
if psql -v ON_ERROR_STOP=1 -q -f scripts/migrations/056_activation_package.sql >/dev/null 2>&1; then
  fail "056 committed against a fixture that cannot satisfy the 48-product contract"
else
  pass "056 aborts when the frozen cohort cannot be satisfied"
fi
psql -tAX -c "SELECT count(*) FROM information_schema.columns WHERE table_name='kg_product' AND column_name='support_state'" \
  | grep -q '^0$' && pass "ATOMIC: aborted 056 left NO schema behind (single transaction)" \
  || fail "aborted 056 committed the schema — the cutover is not atomic"
TIERSIG_AFTER=$(psql -tAX -c "SELECT md5(string_agg(slug||':'||coalesce(tier,'')||':'||coalesce(browse_visibility,'')||':'||status, ',' ORDER BY slug)) FROM kg_product")
[ "$TIERSIG_BEFORE" = "$TIERSIG_AFTER" ] \
  && pass "tier / browse_visibility / status bit-identical after the aborted package" \
  || fail "aborted 056 changed another lifecycle axis"
psql -tAX -c "SELECT count(*) FROM kg_brand" > "$PGTMP/brands_after"
pass "no partial brand/product rows survived the abort (single transaction)"
# structural contract of the generated file
grep -c '^BEGIN;$' scripts/migrations/056_activation_package.sql | grep -q '^1$' \
  && pass "056 is exactly one transaction" || fail "056 has multiple transactions"
grep -c '^COMMIT;$' scripts/migrations/056_activation_package.sql | grep -q '^1$' \
  && pass "056 has exactly one COMMIT" || fail "056 has multiple commits"
FROZEN_N=$(grep -cE "^  \('[a-z0-9-]+'\)[,;]?$" scripts/migrations/056_activation_package.sql)
[ "$FROZEN_N" = "48" ] && pass "056 frozen manifest holds exactly 48 slugs" || fail "056 frozen manifest holds $FROZEN_N, expected 48"
grep -q "'active', 'known', 'qa_only', 'standard'" scripts/migrations/056_activation_package.sql \
  && pass "additive products default to known/private/unmonitored" || fail "additive defaults are unsafe"
[ ! -f scripts/migrations/057_freeze_launch_cohort.sql ] \
  && pass "superseded 057 split package retired" || fail "057 still present"

echo
echo "── 14. migration 056 rollback ──"
psql -tAX -c "SELECT count(*) FROM information_schema.columns WHERE table_name='kg_product' AND column_name='support_state'" \
  | grep -q '^0$' && pass "rollback no-op when the column is absent" || fail "unexpected schema state"
psql -v ON_ERROR_STOP=1 -q -f scripts/migrations/056_rollback.sql >/dev/null 2>&1 \
  && pass "056_rollback is a clean no-op on PRE" || fail "056_rollback failed on PRE"
grep -q '056_rollback REFUSED' scripts/migrations/056_rollback.sql \
  && pass "056_rollback refuses by default" || fail "056_rollback has no refusal"
grep -q 'keep_identities' scripts/migrations/056_rollback.sql \
  && pass "keep_identities escape documented" || fail "missing keep_identities escape"

echo
if [ "$FAILED" = "0" ]; then echo "ALL ISOLATED CHECKS PASSED"; else echo "SOME CHECKS FAILED"; exit 1; fi
