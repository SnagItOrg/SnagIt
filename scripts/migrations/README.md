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

## Followup not yet authored

- `034_*.sql` — backfill `reverb_price_history.kg_product_id` from
  `kg_product.reverb_csp_id` joined via the row's `query` text or
  (preferably) `listing_url → Reverb listing → csp_id`. Not yet written
  because the lookup logic is non-trivial and may need `listing_url`-based
  enrichment in code first.
