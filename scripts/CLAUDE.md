# scripts/ — authoring rules

Directory-scoped rules for everything under `scripts/`. The repository-wide
production prohibitions — SELECT-only, no unauthorised run of any of this, PM2
and Vercel ownership, secrets — are in the root [`CLAUDE.md`](../CLAUDE.md) and
are **not** repeated here. This file is about how to *write* these scripts, not
about permission to run them.

Commands below are written to run from the repository root.

---

## Scrapers

- **Rate-limit every source: ≥2s between requests, plus jitter.** No exceptions,
  no per-source opt-out.
- Store the raw `price` and `currency` exactly as scraped. Convert at read time,
  never at write time.
- Monitoring is the explicit per-source product set in
  [`../data/klup-source-monitoring.json`](../data/klup-source-monitoring.json),
  loaded by [`lib/source-monitoring.ts`](lib/source-monitoring.ts). Widening it
  is a product-owner decision, not a code change.
- **`tier` is not a scraper selector.** It is editorial only. Selecting by tier
  would couple monitoring to editorial prominence — the coupling that was
  removed and must not come back.
- Reverb is a broad-catalogue sweep, not a per-product query list, and is not
  driven by the monitoring config.
- The historical matcher is gated behind `--historical-backfill` plus
  `--sources=` and `--max=`, and is dry-run by default
  (`npm run match-listings:historical-dry-run`). It still has **no
  product-scoped filter**, so it cannot be aimed at a cohort. Do not add one
  casually — that filter is the precondition for authorising historical
  population at all.

## PM2 jobs

Defined in [`../ecosystem.config.js`](../ecosystem.config.js).

- These are **cron-scheduled one-shots**, not services. The shipped convention
  is `autorestart: false` with `max_restarts: 0`: a job fires on
  `cron_restart`, does its work and exits.
- `stopped` is therefore the correct resting state between firings. It is not a
  fault, and it is not something to "fix".
- A genuinely long-running job would need `max_restarts: 3` and
  `min_uptime: 30000`. There are none today; do not apply those values to a
  cron one-shot.
- `pm2 stop` does **not** neutralise `cron_restart`. Only removing the schedule
  or deleting the job does.

## Migrations

Raw `.sql`, applied by hand through the Supabase Studio SQL editor. The record,
the ordering and the rollbacks are in [`migrations/README.md`](migrations/README.md).

- Every migration ships with a rollback and **PRE / POST / DRIFT** handling:
  PRE applies, POST is an explicit successful no-op, DRIFT raises before any
  mutation.
- `migrations/056_activation_package.sql` is **generated** — never hand-edit it.
  Run `npx tsx scripts/emit-activation-migration.ts` and review the diff;
  `npm run validate-activation-migration` proves it still reproduces exactly.
- Rehearse against the disposable local cluster:
  `bash scripts/verify-migrations-isolated.sh`. It creates and destroys its own
  PostgreSQL cluster on a unix socket with `listen_addresses=''`, and never
  touches production. **Never rehearse against production.**

### P0 — read before any migration creates a table in `public`

This project carries a schema-wide default privilege granting ALL on new
`public` tables to `anon` and `authenticated`, and `public` is served by
PostgREST. **Any new table in `public` is born world-readable and
world-writable, immediately reachable over HTTP.**

Migration 057 closed only the nine archive tables that existed when it ran. The
default privilege itself is still in place, so the next table has the same
defect.

A migration that creates a table in `public` must, in the same transaction,
enable RLS and revoke `anon` / `authenticated` privileges — or create the table
outside `public`.

## Derived data artefacts

`data/klup-product-candidate-registry.csv`, `klup-candidate-disposition.csv`,
`klup-launch-cohort-frozen.csv` and `klup-frozen-cohort-asset-inventory.csv`
are generated. Regenerate with `npm run build-product-artefacts`; never
hand-edit. `npm run validate-activation` asserts they reproduce exactly from
the two immutable candidate sources.
