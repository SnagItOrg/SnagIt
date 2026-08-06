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

## Active queue

These four were authored 2026-04-27 as part of the Reverb-anchor cleanup. Apply
in order; some have backfill steps that need a script run between them.

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

**Not represented here:** ad-hoc DML run during the session (the
`price_fetch_queue` status resets, the `listings.external_id` backfill, the
141 duplicate-row cleanup, and `DROP TABLE price_snapshots_old`). Those were
one-off data operations, not schema contract — see CLAUDE.md → Reliability
fixes for what they did and why.
