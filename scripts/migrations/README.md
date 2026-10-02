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
> **Everything through 057 is applied** — see the 053–056 and 057 sections at
> the end of this file. **058, 059 and 060 are applied in production too**:
> verified read-only on 2026-09-30 (the live `pg_get_viewdef` of
> `browse_product_projection` carries 058's `image_resolved` LATERAL, and
> `kg_product.year_discontinued` and `reverb_price_history.reverb_categories`
> exist). Their sections below still read "NOT APPLIED" as written at authoring
> time. **061 is applied in production too**: verified read-only on 2026-09-30
> (the live view carries `lpm.is_valid IS NOT FALSE` and 061's `COMMENT`).
> **062 is applied in production**: 2026-10-02, on the owner's authorisation
> recorded on PAN-190. See the 062 section at the end of this file.
> **063 is applied in production**: 2026-10-02, on the owner's authorisation
> recorded on PAN-213. See the 063 section at the end of this file.

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

## 053–056 — APPLIED in production 2026-08-26. Record, not a queue.

**All four are `POST`.** They were applied strictly in order on 2026-08-26,
under the operator prerequisites recorded in
[`../../docs/klup-foundation-handover.md`](../../docs/klup-foundation-handover.md)
→ *Activation record — 2026-08-26*. Verified post-activation counts are in
[`../../docs/stage-3-v1-release-record.md`](../../docs/stage-3-v1-release-record.md) §4.

This section is the authoring and rollback record. Re-applying any of these is
an explicit `POST` no-op, but there is no reason to touch these files.

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
for exactly that reason; that split's `057_*.sql` and `056_057_release.sql` no
longer exist. The number 057 was later reused by an unrelated migration — see
*057* below.


## 057 — release-security correction. APPLIED in production 2026-08-26 — `POST`.

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
`bash scripts/verify-migrations-isolated.sh` (99 PASS + 1 documented BOUNDARY,
harness sections 1–15).


## 058 — curated images reach the browse surfaces. WRITTEN, REHEARSED, **NOT APPLIED**.

`058_browse_projection_resolves_curated_image.sql` (PAN-133) is the only
migration in this repository that has **not** been applied to production. It
needs an explicit product-owner authorisation, each time, like any other
production DDL.

`kg_product` carries two image columns that mean different things —
`hero_image_url` is CURATED (written by `/admin/image`) and `image_url` is
INGESTED (a Reverb pull or a storage upload). The product page renders
`hero_image_url ?? image_url`. The projection defined by migration 036 selects
`p.image_url` alone, and derives `has_image` from that column alone. So
`/browse`, `/search`, the homepage shelves and every card read a column the
curation flow never writes.

Measured on production 2026-09-23 over the 50 public products: **16 carry a
`hero_image_url` and all 16 are wrong on every card** — 13 have no `image_url`
at all (the card renders nothing, and `has_image` is FALSE for a row that
demonstrably has an image), 3 render a stale picture. 14 of the 16 are the
owner's own curation.

058 redefines the view so `image_url` and `has_image` both read one value
computed in an `image_resolved` LATERAL: the curated image wins, the ingested
one is the fallback, and a blank string counts as absent in both columns.

| Property | |
|---|---|
| DML | **none.** No backfill, no re-curation. The 16 values are already in the table and become visible the moment the view changes. |
| Columns retired | **none.** Curated and ingested mean different things; PAN-42's provenance work is what will make that legible. |
| Shape | unchanged — the same 27 output columns, asserted before and after. |
| Method | `CREATE OR REPLACE VIEW`, **never DROP + CREATE** — dropping would strip the anon/authenticated SELECT that PostgREST needs and blank `/browse`. |
| Rollback | `058_rollback.sql`, which restores the 036 definition verbatim. It does **not** refuse: there is no evidence to destroy and no security posture to undo. Running it simply puts the 16 products back to showing nothing or a stale picture. |

The precedence is now written exactly twice — the LATERAL in this migration and
`resolveProductImage()` in `frontend/lib/product-image-source.ts`.
`scripts/lib/product-image-authority.test.ts` fails closed if a third appears.

Harness section **15** rehearses it in its own database inside the disposable
cluster (fixture: `scripts/fixtures/browse_projection_fixture.sql`) and
**reproduces the defect before fixing it** — a curated-only row reports
`<null>/false` through the 036 projection and
`https://cdn.example/hero-only.webp/true` through the 058 one.

## 059 — `kg_product.year_discontinued`. WRITTEN, **NOT APPLIED**, **NOT REHEARSED**.

`059_kg_product_year_discontinued.sql` (PAN-137) adds one nullable integer
column and one CHECK, so a product can state a production range (`1960–1975`,
or `1960–` while still in production).

| Property | |
|---|---|
| DDL | `ADD COLUMN year_discontinued integer` (nullable, no default — no rewrite) and `kg_product_year_discontinued_check`: `year_discontinued IS NULL OR (year_released IS NOT NULL AND year_discontinued >= year_released)`. |
| DML | **none.** Every row starts NULL. |
| Guard | PRE applies; POST (column and CHECK both present as defined) is a no-op; anything partial raises before mutating. |
| Rollback | `059_rollback.sql`. Drops the CHECK and the column. **Refuses** if any row carries a value, unless `PGOPTIONS="-c klup.rollback_mode=drop_with_data"`. |
| Rehearsal | **Not run.** The machine that wrote it has no local PostgreSQL (`initdb`/`psql` absent), so `verify-migrations-isolated.sh` has no section for 059 yet. Rehearse before applying. |

**Application order.** The frontend reads and writes the column only when the
server env var `KLUP_YEAR_DISCONTINUED=on` (`frontend/lib/production-years.ts`),
so the code is safe to deploy before this file. Apply 059, then set the flag
and redeploy. To roll back, clear the flag and redeploy first.

**NULL means two things.** The application renders NULL as "still in
production", and it is also the value of every uncurated row. The 11 products
that already carry a `year_released` will read as open-ended (`1984–`) from the
moment the flag is on. Review them before flipping it.

## 060 — `reverb_price_history.reverb_categories`. WRITTEN, **NOT APPLIED**, **NOT REHEARSED**.

`060_reverb_price_history_categories.sql` (PAN-170) adds one nullable `jsonb`
column that holds the raw Reverb `categories` array of each sold listing, so
parts and accessories sold under a product stop entering its published
sold-price stats (`isPartOrAccessoryListing()` in
`frontend/lib/price-populations.ts`).

| Property | |
|---|---|
| DDL | `ADD COLUMN reverb_categories jsonb` (nullable, no default — no rewrite). |
| DML | **none.** Every row starts NULL, which the product route reads as "unknown" and keeps: today's behaviour. |
| Guard | PRE applies; POST (jsonb, nullable, no default) is a no-op; a column of that name in any other shape raises before mutating. |
| Rollback | `060_rollback.sql`. Drops the column without refusing — its contents are a copy of Reverb data and re-fetchable — and reports how many rows carried a value. |
| Rehearsal | **Not run.** The machine that wrote it has no local PostgreSQL (`initdb`/`psql` absent). Rehearse before applying. |

**Application order — hard.** There is no flag. The product route selects the
column, and `process-price-queue` / `fetch-reverb-prices` write it, so every
product page and both writers fail until it exists:

1. apply 060;
2. merge the PAN-170 code, and `git pull` on the Mac Mini;
3. `npx tsx scripts/backfill-reverb-sold-categories.ts` (dry run), then
   `--apply` with owner authorisation. It writes its rollback SQL first.

To roll back: revert the code and redeploy first, then run `060_rollback.sql`.

## 061 — the card count stops counting rejected matches. WRITTEN, REHEARSED (PGlite), **NOT APPLIED**.

`061_browse_projection_excludes_rejected_matches.sql` (PAN-197) adds one
predicate to the `active_listing_counts` CTE of `browse_product_projection`:
`AND lpm.is_valid IS NOT FALSE`. That is the SQL spelling of
`.not('is_valid', 'is', false)`, the rule the product page
(`frontend/app/api/product/[slug]/route.ts`) and the family page
(`frontend/app/(shell)/family/[slug]/page.tsx`) already render by: NULL
(unreviewed) and TRUE count, an explicit rejection does not. `supply_state`
reads the same CTE and follows.

Measured read-only on production 2026-09-30, by running the file's exact view
query beside the live view: 4,047 rows either way, **0 differences in any
column other than `active_listing_count` / `supply_state`**, 423 counts drop and
none rise. Of the 80 products that render a public card, 43 change (3,675 → 2,121
advertised listings); `roland-juno-106` 146 → 86, `roland-juno-60` 77 → 62,
`roland-juno-6` 20 → 17. No public product flips from `live` to
`no_live_listings`; 75 non-public, unsupported rows do.

| Property | |
|---|---|
| DML | **none.** No `is_valid` is written and no match is deleted. |
| Shape | unchanged — the same 27 columns in the same order, asserted before and after; the ACL is captured before and compared after. |
| Method | `CREATE OR REPLACE VIEW`, never DROP + CREATE. The rest of the body is 058 verbatim (production's definition). |
| Guard | PRE applies; POST (`is_valid IS NOT FALSE` present) is a no-op; DRIFT raises before mutating: shape drift, `is_valid` referenced any other way, or **058 not applied** — 061 restates 058's image LATERAL and must not apply it silently. |
| Rollback | `061_rollback.sql` restores the 058 definition and comment exactly. It does not refuse — no data is involved — except on the same DRIFT states. |
| Rehearsal | No local PostgreSQL on the authoring machine, so `verify-migrations-isolated.sh` was **not run**; its new section **16** covers 061. The same sequence (fixture → 038 → 036 → 058 → 061 → re-run → rollback → drift cases) was run in PGlite (PostgreSQL 16.4 in WASM, in-process): all checks pass. Production is PostgreSQL 17.6. |

Not in scope, deliberately: counting a listing matched to two products once
across a family (PAN-98's second half — per product the count is already
distinct, since `(listing_id, product_id)` is unique), and gating `is_public`
on `support_state` (PAN-98 defect 1, which removes rows and needs its own owner
decision).

## 062 — both advisor-flagged views become SECURITY INVOKER. **APPLIED 2026-10-02.**

Applied through Supabase MCP `apply_migration` (version `20261002124505`).
Verified the same minute: both advisor findings gone; `service_role` reads the
same md5 over all 4,325 projection rows before and after; ten anonymous
captures of the public surface (browse, product, search, Tjek prisen) are
byte-identical before and after. The text below is as written at authoring
time, 2026-09-30.

`062_security_invoker_views.sql` (PAN-190; PAN-191 is its duplicate) clears the
two ERROR-level `security_definer_view` findings in the Supabase advisor:
`browse_product_projection` and `market_price_observations_trusted`. Both are
owned by `postgres` (BYPASSRLS), sit in `public`, and carried ALL for `anon` and
`authenticated` from the default privilege in [`../CLAUDE.md`](../CLAUDE.md) P0.

**Exposure, measured read-only on production 2026-09-30** (`SET LOCAL ROLE anon`
inside `BEGIN READ ONLY`; writes only ever `EXPLAIN`ed, never executed):

| View | What anon could do | Evidence |
|---|---|---|
| `market_price_observations_trusted` | **write past RLS** — INSERT fabricated observations, UPDATE / DELETE trusted rows. The view is auto-updatable and a definer view checks base-table RLS as its owner. Reads: nothing extra (its WHERE equals the table's public SELECT policy). | `is_insertable_into = YES`; `EXPLAIN DELETE` as anon: table → `One-Time Filter: false`, view → plain index scan. 0 of 1,977 rows are currently trusted. |
| `browse_product_projection` | **read aggregate counts past RLS** — `active_listing_count` over `listings`, which anon cannot read (0 rows directly). No listing row, price or user. Not updatable. | as anon: `listings` 0 rows; view `sum(active_listing_count)` 10,091. |

**Readers.** Every `browse_product_projection` reader uses the service role
(`getSupabaseAdmin()`); 24h of edge logs show 457 requests, all `sb_secret_`.
`market_price_observations_trusted` has no reader in code or logs.

| Property | |
|---|---|
| DDL | `ALTER VIEW … SET (security_invoker = on)` on both; `REVOKE ALL … FROM anon, authenticated` on both; `GRANT SELECT` on the trusted view back to anon/authenticated (039's public read — under invoker it shows exactly what the table's own policy shows). |
| DML | **none.** No view body, column or base-table grant changes. |
| Readers | unchanged. service_role has BYPASSRLS, so it reads an identical projection: its defining query run as service_role hashes to the live view's md5 over all 4,150 rows. |
| Why anon loses the projection | under invoker, anon's `listings` RLS would give every public product `active_listing_count = 0` / `no_live_listings` — wrong rather than denied. Nothing reads it as anon. |
| Guard | PRE applies; POST (both invoker, grants narrowed) is a no-op; DRIFT raises before mutating: a half-applied state, an explicit `security_invoker=off`, service_role without BYPASSRLS, or a trusted-observations policy that no longer equals the view's WHERE (invoker would then change what it returns). A pre-commit block asserts the POST state and reads both views as `service_role`. |
| Rollback | `062_rollback.sql` **refuses by default** (full reversal re-opens anonymous writes). `klup.rollback_mode=restore_browse_read` restores only the projection's pre-062 state, for an anon reader 062 missed; `unsafe_reexpose` restores both exactly. |
| Rehearsal | No local PostgreSQL on the authoring machine, so `verify-migrations-isolated.sh` was **not run**; its new section **17** covers 062. The same sequence — both defects reproduced, apply, byte-identical service-role projection, anon denied, POST, CREATE OR REPLACE resets the option but not the revoke, rollback in all three modes, four DRIFT cases — was run in PGlite (PostgreSQL 18.3 in WASM): all 37 checks pass. Production is PostgreSQL 17.6. |

**Keep it invoker.** `CREATE OR REPLACE VIEW` replaces a view's reloptions with
its WITH clause, so any later migration restating either view must say
`CREATE OR REPLACE VIEW … WITH (security_invoker = on) AS`.
`scripts/lib/security-invoker-views.test.ts` fails on one that does not. The
older restating files — 036, 058, 061, `058_rollback.sql`, `061_rollback.sql` —
predate 062 and do not carry it: running one after 062 turns the view back
into a definer view (the advisor finding returns), though 062's REVOKE survives
and keeps anon out. For the same reason the 061 section's warning that DROP +
CREATE "would strip the anon/authenticated SELECT PostgREST needs and blank
/browse" no longer holds after 062: browse reads through the service role.

**Not in scope, measured and listed for follow-up:** `anon` still holds ALL on
the base table `market_price_observations` (RLS refuses the writes) and on
every other `public` table via the default privilege (P0); the advisor's
remaining findings are WARN/INFO only — `find_clean_candidates` has a mutable
`search_path`, `pg_trgm` is installed in `public`, leaked-password protection
is off, and 16 tables have RLS enabled with no policy (deny-all, intended for
the 053/054 archives and the scrape pipeline tables).

## 063 — an archive table for duplicate sold-price rows. **APPLIED 2026-10-02.**

Applied through Supabase MCP `apply_migration` (version `20261002200245`), on
the owner's authorisation recorded on PAN-213. Verified the same minute: the
table exists with 15 columns, RLS on, no policy, and an ACL of `postgres` and
`service_role` only (`anon` and `authenticated` hold nothing).

`063_reverb_price_history_dedup_archive.sql` (PAN-213) creates
`reverb_price_history_dedup_archive`: the columns of `reverb_price_history`
plus `archived_at` and `archive_batch`, primary key on the original `id`. It
moves no row.

| Property | |
|---|---|
| Why | 97,815 of the table's 100,345 rows were copies of 585 sales (the May 2026 reprocessing loop and the pre-PAN-210 queue worker). The cleanup had to be reversible, so the rows are archived in full before they are removed. |
| P0 | A new `public` table: RLS is enabled and every `anon` / `authenticated` privilege revoked in the same transaction ([`../CLAUDE.md`](../CLAUDE.md) P0). |
| PRE / POST / DRIFT | PRE creates; POST is a no-op; an archive in another shape, or one `anon` or `authenticated` can reach, raises before any change. |
| Rollback | `063_rollback.sql`. Refuses while the archive holds a row; drops the table when it is empty; absent is a no-op. |
| Rehearsal | PGlite, 30 checks, with the data step and both rollbacks (`rehearse213.mjs`, attached to PAN-213). `verify-migrations-isolated.sh` has no section for it: it was not run on the authoring machine, which has no local PostgreSQL. |
| Readers | None. No application code reads or writes the table. |

**The data step is not a migration.** `pan213-dedup-apply.sql` and
`pan213-dedup-rollback.sql` are attached to PAN-213. The apply ran once on
2026-10-02: it locked `reverb_price_history`, copied 97,815 rows to the archive
under batch `pan213-dedup-2026-10-02`, and removed them, leaving 2,530 rows.
A linked row (`kg_product_id` set) is never removed. To undo: run the rollback
(it re-inserts the rows byte for byte and empties the archive), then
`063_rollback.sql`.
