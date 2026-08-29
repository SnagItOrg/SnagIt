# Klup documentation index

**The map.** A lookup for whether a document is safe to act on — not
pre-reading, and not a gate on starting work.

> **UPDATED 2026-08-28 — Stage 3 V1 is LIVE.** Verdict
> `STAGE3_V1_LIVE_CRON_HELD`, production `14ee6f8`, rollback `703a117`, tag
> `klup-stage3-v1-2026-08-28`. **Read
> [`stage-3-v1-release-record.md`](stage-3-v1-release-record.md) first** — it is
> the authority on what shipped, what did not (WP-3), the S1–S3 security
> closure, the still-enabled Supabase auth webhook, and the known non-blockers.
> The Vercel cron remains **Disabled**.

> **UPDATED 2026-08-26 — the catalogue is ACTIVATED in production.**
> Migrations **053–057 are all POST**. The launch catalogue is live: 48 supported
> products (14 public, 34 private), 28 public products in total, monitoring
> 30/28/28/28. Deployed commit `c7bd481`.
>
> Two release defects were found and fixed — a stale `promote_scrape_run`
> contract in migration 055, and world-writable archive tables closed by 057.
> Both are documented in
> [`klup-foundation-handover.md`](klup-foundation-handover.md) →
> *Migration and rollback package*, together with a **P0 warning about
> schema-wide default privileges** that applies to every future migration.
>
> **The Vercel cron `/api/cron/scrape` is deliberately DISABLED** — it duplicates
> dba.dk ingestion and can race the PM2 promotion path. See the handover's
> *Vercel cron conflict*.

Created 2026-08-13 (Prompt H1) after the music-vertical pivot and the completion
of Prompts 02→04B. Its job is to tell a fresh agent which documents are safe to
act on, which are history, and which would be dangerous to follow.

This index links to authoritative documents; it does not duplicate them.

---

## 1. Authority hierarchy

1. **[`CLAUDE.md`](../CLAUDE.md)** — prohibitions, production boundaries and
   routing. It loads automatically; you do not need to open it, and it does not
   send you here before you start work.
2. **Code** — for product eligibility, `frontend/lib/catalogue.ts` and
   `frontend/lib/matching/match-listings.ts` are the authority. Prose explains
   them; it never competes with them.
3. **[`stage-3-v1-release-record.md`](stage-3-v1-release-record.md)** — release
   SHAs, catalogue counts, deployment evidence, open operator actions.
4. **Specialised current references** — the `current_supporting` documents below.
5. **Everything else** — historical or superseded. Do not act on it.

**This index is a lookup, not pre-reading.** Come here when you need to know
whether a document is safe to act on. If a document is not listed as
`authoritative_current` or `current_supporting` in §3, treat its instructions as
unsafe until verified against code.

> `klup-foundation-handover.md` is **historical** as of the Stage 3 V1 release.
> It remains accurate for the 2026-08-26 activation it records, and its P0
> default-privilege warning now also lives in
> [`../scripts/CLAUDE.md`](../scripts/CLAUDE.md), which loads automatically when
> working under `scripts/`.

---

## 2. Current entry points

| I need… | Read |
|---|---|
| **What is live in production, and what is not** | **[`stage-3-v1-release-record.md`](stage-3-v1-release-record.md)** — Stage 3 V1 closure record |
| Product thesis and current work | [`../CLAUDE.md`](../CLAUDE.md) §1 |
| The 2026-08-26 activation, as it happened | [`klup-foundation-handover.md`](klup-foundation-handover.md) *(historical)* |
| Activation runbook *(spent — activation is done)* | [`klup-foundation-handover.md`](klup-foundation-handover.md) → *Controlled activation sequence* |
| Matcher / KG / ingestion contracts | `frontend/lib/matching/match-listings.ts` is the authority; [`klup-foundation-handover.md`](klup-foundation-handover.md) → *Matcher and ingestion contract* explains it |
| Product selection and the frozen 48 | [`klup-launch-catalogue-selection.md`](klup-launch-catalogue-selection.md) · `data/klup-launch-cohort-frozen.csv` |
| Candidate provenance | `data/klup-product-candidate-registry.csv` · `data/klup-candidate-disposition.csv` |
| Lifecycle / promotion authoring | [`klup-product-lifecycle-guide.md`](klup-product-lifecycle-guide.md) |
| Migration record, order and rollbacks | [`../scripts/migrations/README.md`](../scripts/migrations/README.md) |
| Read-only SQL | [`../scripts/queries/README.md`](../scripts/queries/README.md) |
| Frontend design rules | [`../frontend/CLAUDE.md`](../frontend/CLAUDE.md) |
| Scraper, PM2 and migration authoring rules | [`../scripts/CLAUDE.md`](../scripts/CLAUDE.md) |
| Engineering history / past defects | [`klup-engineering-history.md`](klup-engineering-history.md) *(history only)* |

---

## 3. Markdown audit — the 2026-08-13 (H1) pass

> **Dated record, not a live inventory.** This table covers the 14 files that
> existed at the H1 pass. The six Stage 3 documents written since are not in it;
> all of them are historical records of Stage 3, and
> [`stage-3-v1-release-record.md`](stage-3-v1-release-record.md) is the current
> authority on that work.

| Path | State | Authoritative replacement | Action taken (H1) | Risk if followed incorrectly |
|---|---|---|---|---|
| `CLAUDE.md` | `authoritative_current` | — | **Rewritten.** Historical body moved to `docs/klup-engineering-history.md`; product thesis, five-axis state model, migration state, safe commands and scope gate made current | Was 108 KB of chronology carrying the old "deal intelligence / arbitrage" thesis, tier-as-monitoring, and pre-056 migration state |
| `docs/klup-foundation-handover.md` | `authoritative_current` | — | **Rewritten** to the fresh-session structure, current through 04B | Previously stopped at Prompt 02G-A totals and pre-04B next steps |
| `docs/klup-documentation-index.md` | `authoritative_current` | — | **Created** | — |
| `docs/klup-product-lifecycle-guide.md` | `current_supporting` | handover | Unchanged — verified accurate | — |
| `docs/klup-launch-catalogue-selection.md` | `current_supporting` | handover | Unchanged — accurate for selection, families, search contract, reserve | Contains the 48-product decision record; still current |
| `scripts/migrations/README.md` | `current_supporting` | handover | **Corrected**: the 030–035 "Active queue" heading was stale (long applied) and 053–056 were missing entirely | An agent could have read 030–035 as pending and missed the real queue |
| `scripts/queries/README.md` | `current_supporting` | — | Unchanged — accurate | — |
| `frontend/CLAUDE.md` | `current_supporting` | — | Unchanged — design/i18n rules still hold | — |
| `frontend/README.md` | `contradictory` → corrected | `CLAUDE.md` | **Corrected**: "Klup overvåger dba.dk for dig" replaced with the curated multi-source monitoring thesis; pointer to handover added | Single-source framing contradicts the five-source product |
| `OPERATIONS.md` | `contradictory` → warned | handover, lifecycle guide | **Correction notice added at top.** Curation craft preserved; stale operational claims tabulated and corrected | Claimed hourly `match-listings`, tier-driven scraping, "all KG products" on Reverb, and framed `/intel` as an arbitrage dashboard |
| `DEPLOYMENT_GUIDE.md` | `superseded` (dangerous) | handover → *Migration and rollback package* | **Prominent superseded warning added.** Content preserved | Instructs `npm run import-kg` against production, which **full-replaces** identifiers, relations and synonyms — it would destroy 053/054 curation |
| `docs/investigation-2026-04-27-product-pages-reverb-only.md` | `historical_snapshot` | handover | **Status notice added.** Content preserved verbatim | Accurate diagnosis for 2026-04-27; both bugs have since been fixed |
| `docs/stock-images-workflow.md` | `historical_snapshot` | — | **Status notice added.** Content preserved | 2026-04-27 proposals; image strategy has since shipped. Still useful as asset inventory |
| `docs/klup-engineering-history.md` | `historical_snapshot` | `CLAUDE.md` | **Created** from the former `CLAUDE.md` body, with a prominent status notice | Contains the old thesis and pre-056 state; must never be read as current instructions |

**No file was deleted or renamed.** No historical report was rewritten to
pretend it described a later state.

---

## 4. Documentation universe and exclusion policy

| Scope | Count |
|---|--:|
| All `*.md` (case-insensitive) under the repository root | **936** |
| — excluded: `./node_modules/**` | 48 |
| — excluded: `./frontend/node_modules/**` | 836 |
| — excluded: `./.agents/**` (main checkout only, untracked, absent from every worktree) | 40 |
| — excluded: `./.git/**`, `./frontend/.next/**`, `./.claude/**` | 0 |
| **Repo-owned Markdown audited** | **12** *(13 after `klup-engineering-history.md` and this index were created)* |

**Exclusion rule:** dependency trees, build output, caches and pre-existing
agent/tooling directories are out of scope. Everything else — tracked or
untracked, root or nested — is audited. Every audited file appears exactly once
in §3.

---

## 5. Historical-document policy

- **Never delete** a historical document, decision record or audit report.
- **Never rewrite** a dated report to describe a later state. Historical accuracy
  is evidence.
- **Add a status notice** only when a fresh agent could plausibly mistake the
  document for current instructions. The notice must state: historical or
  superseded status, the date or programme phase, a link to the authoritative
  replacement, and "do not execute as a current runbook" where the document
  contains executable steps.
- **Do not mass-edit** low-risk historical notes for terminology consistency.
- **Correct contradictions in current documents directly**, and record the change
  in §3.

---

## 6. Update ownership — what must change, and when

| When this changes… | Update these |
|---|---|
| Schema (a new migration) | `scripts/migrations/README.md`, `scripts/CLAUDE.md` → *Migrations* |
| Lifecycle axes or matcher eligibility | `frontend/lib/catalogue.ts` and `frontend/lib/matching/match-listings.ts` first — they are the authority — then `klup-product-lifecycle-guide.md` |
| The frozen cohort (any entry/exit) | `data/klup-launch-cohort-frozen.csv` (regenerate — never hand-edit), `klup-launch-catalogue-selection.md` |
| Source monitoring sets | `data/klup-source-monitoring.json`, `scripts/CLAUDE.md` → *Scrapers* |
| Activation state (a migration is applied) | `scripts/migrations/README.md`, and a release record |
| Test/type/lint/harness totals | **Nowhere.** Counts belong to the run, and to the pre-deploy gate recorded in a release record |
| Product thesis or current work | `CLAUDE.md` §1, and this index |

**Derived data files are never hand-edited.** Regenerate with
`npm run build-product-artefacts` and review the diff.

---

## 7. Known stale-claim sweep

These high-risk claims were searched for across all repo-owned Markdown after
the H1 edits. Every remaining occurrence is either corrected, quoted as history
behind a status notice, or listed here with justification.

| Stale claim | Status |
|---|---|
| Generic marketplace / arbitrage / storefront positioning | Corrected in `CLAUDE.md`, `frontend/README.md`; quoted as history behind notices in `OPERATIONS.md` and `klup-engineering-history.md` |
| Full-KG monitoring | Corrected; explicit sets documented everywhere current |
| `tier` as the monitoring axis | Corrected in `CLAUDE.md`, handover, `OPERATIONS.md` notice. Historical occurrences remain inside `klup-engineering-history.md` behind its notice |
| Pre-056 migration order / 057 files | Corrected. The *retired* 056/057 activation split and its release wrapper no longer exist; the number 057 was later reused by `057_restrict_release_archive_tables.sql`, which is applied. `scripts/migrations/README.md` carries the per-file state |
| Old test totals presented as current | Corrected to 148 tests / 60 harness passes / 7 root errors in `CLAUDE.md` and handover. Older totals survive only inside dated history |
| Broad seed importer as the production activation path | Neutralised with a prominent warning on `DEPLOYMENT_GUIDE.md`; corrected in `CLAUDE.md`, handover and `scripts/migrations/README.md` |
| `report-match-backlog` as a PRE-056 preflight | Corrected in handover → *Known compatibility and operational constraints*. 056 is applied, so it now succeeds |
| Unbounded historical matcher instructions | `OPERATIONS.md` Part 7 suggested `npx tsx scripts/match-listings.ts`; corrected in its notice. The CLI itself refuses without `--historical-backfill --sources= --max=` |
| Product selection "not started" | Corrected — the cohort is frozen at 48 |
| Claims that product pages / images / promotion do not exist | Corrected — handover → *What exists already* inventories all of them |

---

## 8. What the next agent should do

**Stage 3 V1 is closed** at release `14ee6f8`. Current work is
**`visual-foundation-v1`** — semantic colour, elevation and typography tokens.

There is no mandatory reading order. `CLAUDE.md` and the scoped `CLAUDE.md`
files load on their own; start the work and open a document here when you need
a specific fact. The one document worth reading in full before touching
anything product-facing is
[`stage-3-v1-release-record.md`](stage-3-v1-release-record.md), which states
what shipped, what deliberately did not (WP-3), the security closure, the
unresolved operator actions and the P1–P8 backlog.

**Activation is DONE.** Migrations 053–057 are all `POST`. Do not re-run the
activation, do not re-apply a migration, and do not reopen foundation, matcher,
KG or product-data work.

### Immediate product-operations follow-ups (not engineering branches)

| # | Item | Why it matters |
|---|---|---|
| 1 | **P0: schema-wide default privileges** grant ALL on new `public` tables to `anon`/`authenticated` | any future migration creating a `public` table is born world-readable and world-writable. 057 fixed only the nine tables that existed |
| 2 | **Monitoring/support overlap is only 14** | monitored sets resolve 30/28/28/28, but just 14 of those products are among the supported 48, so roughly half of each source's monitored products collect listings that cannot auto-match |
| 3 | **Vercel cron conflict** | `/api/cron/scrape` duplicates dba.dk ingestion; disabled until the ingestion path is unified |
| 4 | **Deferred, non-live:** `report-match-backlog` order-dependence | affects its forced-supported ~3,697-product projection only; the live 48 are deterministic. Investigate before any historical backfill |

### Operational state a fresh agent should assume

- PM2 holds exactly 8 cron-scheduled jobs; `match-listings` is retired and purged
  from the saved dump. **Never run `pm2 resurrect`** — start jobs with
  `pm2 start ecosystem.config.js --only <name>`.
- Backups from the release are retained in `~/klup-release-2026-08-26/`
  (database dump restore-verified, plus all 1,314 Storage objects).
