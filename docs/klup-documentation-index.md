# Klup documentation index

**The map. Read this before trusting any other document in the repository.**

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

1. **[`CLAUDE.md`](../CLAUDE.md)** — how to work safely *now*. Operating rules,
   product-state model, safe commands, prohibited actions. Read first.
2. **[`klup-foundation-handover.md`](klup-foundation-handover.md)** — the full
   technical handover, self-contained through Prompt 04B.
3. **This index** — which other documents are current.
4. **Specialised current references** — the `current_supporting` documents below.
5. **Everything else** — historical or superseded. Do not act on it.

**Rule:** if a document is not listed as `authoritative_current` or
`current_supporting` in §3, treat its instructions as unsafe until verified
against code.

---

## 2. Current entry points

| I need… | Read |
|---|---|
| **What is live in production, and what is not** | **[`stage-3-v1-release-record.md`](stage-3-v1-release-record.md)** — Stage 3 V1 closure record |
| Product thesis and roadmap | [`../CLAUDE.md`](../CLAUDE.md) §1, §9 |
| Fresh-session technical handover | [`klup-foundation-handover.md`](klup-foundation-handover.md) |
| Activation runbook | [`klup-foundation-handover.md`](klup-foundation-handover.md) → *Controlled activation sequence* |
| Matcher / KG / ingestion contracts | [`klup-foundation-handover.md`](klup-foundation-handover.md) → *Matcher and ingestion contract* |
| Product selection and the frozen 48 | [`klup-launch-catalogue-selection.md`](klup-launch-catalogue-selection.md) · `data/klup-launch-cohort-frozen.csv` |
| Candidate provenance | `data/klup-product-candidate-registry.csv` · `data/klup-candidate-disposition.csv` |
| Lifecycle / promotion authoring | [`klup-product-lifecycle-guide.md`](klup-product-lifecycle-guide.md) |
| Migration queue and order | [`../scripts/migrations/README.md`](../scripts/migrations/README.md) → *053–056* |
| Read-only SQL | [`../scripts/queries/README.md`](../scripts/queries/README.md) |
| Frontend design rules | [`../frontend/CLAUDE.md`](../frontend/CLAUDE.md) |
| Experience-specification inputs | This index → §2 rows above, plus `data/klup-frozen-cohort-asset-inventory.csv` |
| Engineering history / past defects | [`klup-engineering-history.md`](klup-engineering-history.md) *(history only)* |

---

## 3. Complete audit — all 12 repo-owned Markdown files

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
| — excluded: `./.agents/**` (pre-existing, must not be modified) | 40 |
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
| Schema (a new migration) | `scripts/migrations/README.md`, handover → *Migration and rollback package*, `CLAUDE.md` §5 |
| Lifecycle axes or matcher eligibility | `klup-product-lifecycle-guide.md`, handover → *Data and lifecycle contract* + *Matcher and ingestion contract*, `CLAUDE.md` §2 |
| The frozen cohort (any entry/exit) | `data/klup-launch-cohort-frozen.csv` (regenerate — never hand-edit), `klup-launch-catalogue-selection.md`, handover → *Product thesis and current milestone* |
| Source monitoring sets | `data/klup-source-monitoring.json`, handover → *Explicit monitoring boundary*, `CLAUDE.md` §3 |
| Activation state (a migration is applied) | handover → *Current production and repository state* + *Controlled activation sequence*, `CLAUDE.md` §5 |
| Test/type/lint/harness totals | handover → *Verification baseline*, `CLAUDE.md` §6 |
| Product thesis or roadmap stage | `CLAUDE.md` §1 and §9, handover → *Product thesis and current milestone*, this index |

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
| Pre-056 migration order / 057 files | Corrected — 057 and the release wrapper no longer exist; `scripts/migrations/README.md` states the 053–056 queue |
| Old test totals presented as current | Corrected to 148 tests / 60 harness passes / 7 root errors in `CLAUDE.md` and handover. Older totals survive only inside dated history |
| Broad seed importer as the production activation path | Neutralised with a prominent warning on `DEPLOYMENT_GUIDE.md`; corrected in `CLAUDE.md`, handover and `scripts/migrations/README.md` |
| `report-match-backlog` as a PRE-056 preflight | Explicitly corrected in `CLAUDE.md` §6 and handover → *Known compatibility and operational constraints* |
| Unbounded historical matcher instructions | `OPERATIONS.md` Part 7 suggested `npx tsx scripts/match-listings.ts`; corrected in its notice. The CLI itself refuses without `--historical-backfill --sources= --max=` |
| Product selection "not started" | Corrected — the cohort is frozen at 48 |
| Claims that product pages / images / promotion do not exist | Corrected — handover → *What exists already* inventories all of them |

---

## 8. What the next agent should do

**Start with [`stage-3-v1-release-record.md`](stage-3-v1-release-record.md).**
Stage 3 V1 is live and closed; the record states the production and rollback
SHAs, the final catalogue counts, the security closure, the unresolved operator
actions, and the only next approved work (`visual-foundation-v1`). It also
records that no further foundation, matcher, migration or product-architecture
work is authorised.


1. Read [`../CLAUDE.md`](../CLAUDE.md).
2. Read [`klup-foundation-handover.md`](klup-foundation-handover.md), especially
   *Activation record — 2026-08-26* and the **P0** default-privilege warning.
3. Proceed to **experience specification** (Stage 3).

**Activation is DONE.** Do not re-run it, do not re-apply migrations (all five are
idempotent no-ops but there is no reason to touch them), and do not reopen
foundation, matcher, KG or product-data work.

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
