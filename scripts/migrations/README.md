# Migrations

These are raw `.sql` files applied manually via the Supabase Studio SQL editor
(no automated migration tooling in this repo).

## How to apply

1. Open the [Supabase Studio SQL editor][studio] for the project.
2. Paste the contents of the next pending file in numeric order.
3. Run. Each file is idempotent (`IF NOT EXISTS` guards), so re-running is safe.
4. Verify the change in the Tables view, then commit no code changes — the
   `.sql` file is the record.

[studio]: https://supabase.com/dashboard/project/_/sql/new

## 030–035 — Reverb-anchor cleanup (2026-04-27) — HISTORICAL

> **These are applied. This section is a record, not a queue.** It was headed
> "Active queue" until 2026-08-13; the heading was wrong and is corrected here.
> The current pending queue is **053–056** (see the end of this file).

| File | Action | Notes |
|---|---|---|
| `030_kg_product_reverb_csp_id.sql` | DDL | Adds `kg_product.reverb_csp_id` integer + index. Pure schema, safe anytime. |
| `031_reverb_price_history_kg_product_id.sql` | DDL | Adds `reverb_price_history.kg_product_id` uuid FK + index. Safe anytime. |
| → run `npm run enrich-from-reverb-csp` | data | Populates `kg_product.attributes.reverb_csp` (jsonb carrier) for all active products. ~2.5h for full 3,840 rows; can be batched with `--limit=N`. |
| `032_promote_reverb_csp_from_attributes.sql` | DML | Copies high/medium-confidence csp_ids out of jsonb into the typed column. Idempotent. |
| `033_kg_category_reverb_uuid.sql` | DDL | Adds `kg_category.reverb_uuid` uuid + unique partial index. Safe anytime. |
| → run `npm run backfill-category-uuids` (TBD) | data | Populates `kg_category.reverb_uuid` from `data/reverb-categories.json`. |

## Recommended order

```
030
031
033
(run enrich-from-reverb-csp.ts in batches)
032
(run backfill-category-uuids.ts)
```

030, 031, 033 are independent DDL — apply them all up front. The data scripts
can run before or after but are most useful once the columns exist.

## 034 — authored 2026-04-27

`034_backfill_reverb_price_history_kg_product_id.sql` — pure DML, idempotent.
Maps `reverb_price_history.query` to `kg_product.canonical_name` via a
two-sided alphanumeric-only normalised match. Skips ambiguous (≥2 matches)
and unmatched rows.

Verified dry-run hit rate at authoring time: ~37% of the 927 rows.
The remainder are legacy design-furniture queries (deprioritised vertical),
generic terms ("Reverb", "Jazz guitar"), or queries for products not yet
in the KG. Looser query matching is not the answer for these — a follow-up
script that resolves `listing_url → Reverb listing → csp_id → kg_product`
is the deterministic path for the long tail.

Preview the impact before running:

```sql
SELECT
  COUNT(*) FILTER (WHERE match_count = 1) AS will_map,
  COUNT(*) FILTER (WHERE match_count > 1) AS ambiguous,
  COUNT(*) FILTER (WHERE match_count = 0) AS no_match
FROM (
  SELECT
    rph.id,
    (SELECT COUNT(*) FROM kg_product kp
      WHERE regexp_replace(lower(rph.query),     '[^a-z0-9]+', '', 'g')
          = regexp_replace(lower(kp.canonical_name), '[^a-z0-9]+', '', 'g')
    ) AS match_count
  FROM reverb_price_history rph
  WHERE rph.kg_product_id IS NULL AND rph.query IS NOT NULL
) t;
```

## Followup not yet authored

- `035_*.sql` — backfill the long-tail of `reverb_price_history.kg_product_id`
  via `listing_url → Reverb listing → csp_id → kg_product.reverb_csp_id`.
  Needs a small enrichment script that hits the Reverb listing API per row
  to extract its CSP. Worth doing only after demand-driven curation has
  reduced the dirty-query population.

---

## 039-048 — scrape quality gate & coverage_v2 (2026-08-05/06)

**Already applied in production.** These were applied via the Supabase MCP
`apply_migration` tool during development, then extracted verbatim from
`supabase_migrations.schema_migrations` into this directory. The files are the
exact SQL that ran — they are the record, not a plan.

| File | Kind | Idempotent? |
|---|---|---|
| `039_market_price_observations.sql` | table + indexes + RLS + view | **No** — bare `CREATE TABLE`/`CREATE VIEW` |
| `039b_rename_market_price_observations.sql` | rename | **No** — bare `ALTER ... RENAME` |
| `039c_market_price_observations_dedup_index.sql` | index | Yes (`DROP IF EXISTS` + create) |
| `040_listing_lifecycle_tracking.sql` | columns + index | Yes (`IF NOT EXISTS`) |
| `041_scrape_run_health_and_market_price_daily.sql` | tables + columns + RLS | Partly — `CREATE TABLE` is bare, column adds guarded |
| `042_listing_staging_fail_closed.sql` | table + columns | Partly — same pattern |
| `043_promote_scrape_run_transactional.sql` | function / RPC | Yes (`CREATE OR REPLACE`) |
| `044_coverage_v2_manifest.sql` | table + columns + functions | Partly — `CREATE TABLE` bare, functions `OR REPLACE` |
| `045_listing_scope_provenance.sql` | columns + function | Yes |
| `046_listing_coverage_scopes_relation.sql` | table + backfill + function | Partly — `CREATE TABLE` bare |
| `047_staging_digest_guard.sql` | column + functions | Yes |
| `048_retire_unscoped_coverage_function.sql` | function retirement | Yes |

**Ordering matters.** 043 → 045 → 046 → 047 each redefine `promote_scrape_run`;
only the 047 version is current. 048 retires
`source_has_established_coverage()` introduced in 043.

**Applying to a clean database:** run 039 → 048 in filename order. No file
DROPs a data-bearing table, and no file deletes rows. `039b` renames a table
created by `039`; `046` backfills `listing_coverage_scopes` from the column it
supersedes.

### 049 — retroactive record

`049_lpm_listing_product_unique.sql` documents an index that already existed
in production but had no migration file: the SQL was printed by
`scripts/cleanup-listing-product-match.ts` for manual copy-paste, so schema
lived in a `console.log`. The file is a no-op against production and exists so
a clean database gets the same constraint.

### 050–051 — baseline cohort scoping (2026-08-07)

Both applied in production 2026-08-07 via Supabase MCP `apply_migration`.

| File | Kind | Idempotent? |
|---|---|---|
| `050_baseline_cohort_scoping.sql` | columns + constraints + index + comments | Yes — verified by applying it twice |
| `051_promote_requires_cohort_identity.sql` | function / RPC | Yes (`CREATE OR REPLACE`) |

`050` adds the baseline cohort identity (`parser_version`,
`pagination_strategy`, `run_scope`) plus `global_unique_listings` and
`baseline_status`. **No backfill by design** — existing rows keep a NULL cohort
identity, which disqualifies them from every baseline. That is the point: a run
whose parser and scope provenance was never recorded cannot be retroactively
declared comparable, and run `43f27632-…` stays untouched.

`051` redefines `promote_scrape_run` so it **refuses** any run missing cohort
identity, naming the missing fields. Ordering now matters: 043 → 045 → 046 →
047 → **051**, and only the 051 version is current. Without it, a run with a
NULL `coverage_scope_hash` would publish listings outside the coverage universe
and silently skip the `listing_coverage_scopes` insert.

Pre-migration state of `scrape_run` is recorded in
`snapshots/050_pre_scrape_run.sql`, including a rollback script.

### 052 — P0 promotion fix (2026-08-11)

`052_promote_dedupe_coverage_scopes.sql` — applied in production 2026-08-11.
Redefines `promote_scrape_run` so the `listing_coverage_scopes` upsert collapses
cross-query duplicates (`GROUP BY l.id`, `min(source_query)`) instead of feeding
duplicate conflict keys into one statement, and makes the two pre-existing
`DISTINCT ON` blocks deterministic. **Ordering is now 043 → 045 → 046 → 047 →
051 → 052; only the 052 version is current.**

Re-run safe: one `CREATE OR REPLACE FUNCTION` plus two `COMMENT ON`. No DML, no
schema change, nothing to apply twice.

**Verified after applying:** 42 → 47 columns, all five nullable with no
defaults; both CHECK constraints `convalidated`; 12 rows before and after with
zero rows carrying a new value; runs `43f27632-…` and `7eea3caa-…`
byte-identical. Promotion guard proven against the live function: no identity →
refused listing all six fields, partial identity → refused naming exactly the
two missing, full identity → proceeds; `listings` unchanged throughout.

**Not represented here:** ad-hoc DML run during the session (the
`price_fetch_queue` status resets, the `listings.external_id` backfill, the
141 duplicate-row cleanup, and `DROP TABLE price_snapshots_old`). Those were
one-off data operations, not schema contract — see CLAUDE.md → Reliability
fixes for what they did and why.

---

## 053–056 — PENDING. This is the current queue. (2026-08-13)

**None of these has been applied.** All four are `PRE`. They are the reviewed
activation package and must be applied **strictly in order**, only after the
operator prerequisites in
[`../../docs/klup-foundation-handover.md`](../../docs/klup-foundation-handover.md)
are met.

| # | File | Rollback | Scope |
|---|---|---|---|
| 053 | `053_kg_duplicate_product_consolidation.sql` | `053_rollback.sql` | 14 duplicate `(brand, model_name)` groups / 29 rows; archives into `kg_arch_*_053` |
| 054 | `054_identifier_curation.sql` | `054_rollback.sql` | removes unsafe identifiers `PAUL`, `TOM`, `335`; makes `Les Paul` / `ES-335` symmetric |
| 055 | `055_listing_ingestion_identity.sql` | `055_rollback.sql` | `listings.ingestion_batch_id` / `ingested_at`, trigger-enforced write-once |
| 056 | `056_activation_package.sql` | `056_rollback.sql` | **atomic**: `kg_product.support_state` + 34 brands + 142 products + exactly 48 support promotions + pre-commit assertions |

**Every file has PRE / POST / DRIFT handling**: PRE applies, POST is an explicit
successful no-op, DRIFT raises before any mutation.

**056 is generated.** Do not hand-edit it — run
`npx tsx scripts/emit-activation-migration.ts` and review the diff.
`npm run validate-activation-migration` proves it still reproduces exactly.

**056 is one transaction.** Schema, additive data, promotion and the final
assertions share a single `BEGIN`/`COMMIT`, so there is no committable
intermediate state in which the matcher has zero supported products. An earlier
split (056 schema + 057 data + a psql wrapper) was **retired before deployment**
for exactly that reason; `057_*.sql` and `056_057_release.sql` no longer exist.


## 057 — release-security correction (2026-08-26). APPLIED? NO — pending.

`057_restrict_release_archive_tables.sql` closes an exposure created by 053/054
themselves. Their nine archive / mapping tables live in `public`, which is served
by PostgREST, and this project grants ALL on public tables to `anon` and
`authenticated`. The archives were therefore world-readable **and world-writable**:

    GET /rest/v1/kg_arch_product_053?select=slug&limit=2  ->  200, 2 rows

The read side is low-sensitivity (slugs of retired duplicates; `kg_product`
already has a public-read policy). The write side is the real risk: an anonymous
caller could `DELETE` the evidence that the 053 and 054 rollbacks restore from.

057 enables RLS on all nine with **no policy** (deny-all) and revokes
anon/authenticated privileges as defence in depth. RLS is enabled **without
FORCE**, and `postgres` (owner) and `service_role` both carry `bypassrls`, so
recovery and the documented rollbacks are unaffected — verified on a restored
snapshot. It also pins `search_path` on `listings_ingestion_identity()`
(migration 055), whose body resolves no unqualified tables.

`057_rollback.sql` **refuses by default**, because reversing it restores
anonymous write access to rollback evidence. Escapes:
`klup.rollback_mode=unpin_search_path` (safe, function only) and
`klup.rollback_mode=unsafe_reexpose` (full reversal).

**Root cause not fixed here:** the schema-wide default privilege that grants ALL
on new public tables to anon/authenticated. Any future archive table is born
exposed the same way. Correcting that is wider than this release — follow-up.

**The number 057 was previously used** by the retired 056/057 activation split,
deleted before deployment and never run. This file is unrelated to it.

### 055 promotion-contract correction (2026-08-26)

`055_listing_ingestion_identity.sql` and `055_rollback.sql` originally redefined
`promote_scrape_run` as a **`RETURNS TABLE`** function built on a pre-051 body.
Production carries the migration-052 **`RETURNS jsonb`** function, so
`CREATE OR REPLACE` failed with *"cannot change return type of existing
function"*. The error's own HINT (`DROP FUNCTION ... first`) was a trap: forcing
it through would have reverted the **051 six-field cohort-identity guard** and
broken `scripts/lib/publish.ts`, which reads the RPC result as a single jsonb
object (`r.skipped`) — a `TABLE` return arrives as an array of rows, so a refused
run would have been read as a successful publish.

Both files now carry migration 052's exact function, preserving the five-argument
identity, `RETURNS jsonb`, the six-field guard and the `GROUP BY l.id`
de-duplication. 055 adds only `listings.ingestion_batch_id = p_run_id` on first
insert; the rollback restores plain 052. Neither uses `DROP FUNCTION`.

**Why it was not caught earlier:** `scripts/fixtures/kg_migration_fixture.sql`
contained no `promote_scrape_run` at all, so the harness created it from nothing
and passed. The fixture now carries the production-era `scrape_run`,
`listing_staging`, `listing_coverage_scopes` and the 052 function, and harness
section **11b** pins the contract. Verified: the old 055 now fails against the
fixture and the corrected 055 passes.

**Rollbacks refuse destructive reversal by default.** 055 refuses while any row
carries an ingestion identity (`keep_columns` / `drop_with_evidence` escapes);
056 refuses while additive identities carry references (`keep_identities` /
`full` escapes).

**`npm run import-kg` is NOT the production path for these changes.** Migration
056 is the additive, identity-preserving upgrade. The importer full-replaces
identifiers, relations and synonyms and is valid only for seeding a fresh
database — see the superseded notice in
[`../../DEPLOYMENT_GUIDE.md`](../../DEPLOYMENT_GUIDE.md).

Verify the whole package against a disposable local cluster with
`bash scripts/verify-migrations-isolated.sh` (81 PASS + 1 documented BOUNDARY).
