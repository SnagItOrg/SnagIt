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
