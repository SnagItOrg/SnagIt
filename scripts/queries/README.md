# Queries

**These are NOT migrations.** Nothing here changes schema or database
contract. Everything is read-only inspection, verification, or operations.

Anything that alters schema, indexes, constraints, functions, views, or RLS
belongs in `scripts/migrations/` instead.

| Directory | Purpose |
|---|---|
| `diagnostics/` | Find problems. Data-contract health, silently-defeated constraints. |
| `verification/` | Prove an invariant holds. Run before/after a change and diff. |
| `operations/` | Day-to-day inspection of run health and review queues. |

## Files

### verification/
- `fail_closed_publication.sql` — proves a detected fault cannot change
  authoritative state. Run before/after the `--simulate-bad-data` and
  `--simulate-promotion-crash` fault injections; all counters must be identical.
- `lifecycle_disabled.sql` — confirms no scope is established and no listing
  has accrued misses or been delisted.
- `coverage_v2_status.sql` — per-query pagination coverage for one run.
- `promotion_cross_query_duplicates.sql` — regression fixture for the P0 fixed
  by migration 052: one advert found by three product queries must promote to a
  single listing and a single coverage-scope row while staging keeps all rows.
  Creates and removes its own synthetic data; safe to re-run.
- `baseline_cohort_scoping.sql` — re-audits a gate verdict's baseline decision
  from the evidence stored on `scrape_run.baseline`: which cohort was required,
  which runs were selected, and why the rest were rejected.

### diagnostics/
- `null_rates_per_source.sql` — the query that would have caught the
  finn/blocket all-NULL `price_dkk` bug the same night.
- `unique_constraints_on_nullable.sql` — unique indexes defeated by NULLs
  (found 97,381 duplicate `reverb_price_history` rows).

### operations/
- `scrape_run_health.sql` — recent run outcomes, gate verdicts, violations.
- `match_review_queue.sql` — match review state by tier. Unreviewed rows are
  treated as trusted downstream, so `pending_review` is live risk.

## Conventions

Every file starts with a comment stating purpose, kind (diagnostic /
verification / operational), and related migrations. Queries are read-only —
if you need a mutation, write a migration or a script.
