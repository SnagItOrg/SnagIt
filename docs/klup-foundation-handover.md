# Klup fresh-session handover

**Current through the 2026-08-26 production activation. Self-contained — a fresh
agent can continue from this document without conversation history.**

> **STATUS CHANGED 2026-08-26. The catalogue is ACTIVATED in production.**
> Migrations **053, 054, 055 and 057 are POST**, and **056 is POST** — the launch
> catalogue is live with 48 supported products. The release is committed, pushed
> and deployed. Sections below that describe the pre-activation state have been
> updated; see *Activation record (2026-08-26)* for what actually happened.
>
> **The Vercel cron `/api/cron/scrape` is deliberately DISABLED** and must not be
> re-enabled without resolving the conflict recorded in the activation record.

Read [`CLAUDE.md`](../CLAUDE.md) first for operating rules, and
[`klup-documentation-index.md`](klup-documentation-index.md) for which documents
are authoritative.

---

## Product thesis and current milestone

Klup is a **curated monitoring and comparison service for used music instruments
and studio equipment**. Canonical product pages are the core experience; search
navigates within a supported catalogue. The product must answer *"Er 4.500 kr for
en Roland Juno-106 en god pris i dag?"* without the user thinking.

It is **not** a marketplace, storefront, arbitrage operation or multi-vertical
product database. Non-music verticals are already inactive in the KG.

| Layer | Size | Meaning |
|---|--:|---|
| Verified KG identity universe | 221 brands / 3,440 products | identity + collision protection |
| **Frozen launch catalogue** | **48** | supported and matcher-eligible; 34 private, 14 already public |
| Monitoring | DBA 30 · Finn/Blocket/Kleinanzeigen 28 | explicit per-source product sets |

**Milestone status:** foundation (02→02G-A), product selection (03→03B) and
product data (04→04B) are complete and unapplied. **Stage 3 is experience
specification.** No further foundation, matcher, KG or product-data branch is
authorised.

---

## What exists already

Do not rebuild these. They are assets to preserve and extend.

| Asset | Where |
|---|---|
| Product page | `frontend/app/product/[slug]/page.tsx` → `/product/<slug>` |
| Product API | `frontend/app/api/product/[slug]/route.ts` |
| Browse | `frontend/app/browse/`, projection in `frontend/lib/browse.ts` |
| Draft legendary articles | `kg_product.attributes` → `description`, `specs`, `history`, `external_links` |
| Images | `kg_product.image_url` (Storage webp) and `hero_image_url` (editorial override, wins) |
| Promotion system | `/admin/products` + `PATCH /api/admin/products/[id]` |
| Curation surface | `/admin/product/[slug]` — synonyms, on-demand scrape, match rejection |
| Private founder tool | `/intel` — admin-gated, not the product |

**Frozen-48 content coverage** (`data/klup-frozen-cohort-asset-inventory.csv`):
3 carry a draft article (Juno-106, Juno-60, Jupiter-8); 29 carry an image; 1 has
a hero image; 5 have none (three Rhodes pages, Wurlitzer 200A, Neve Portico II MBP);
9 have no KG row yet and are created by migration 056.

---

## Product information architecture decisions

| Concept | Purpose | Runtime rule |
|---|---|---|
| **Standard category** | primary navigation and SEO | guitars, basses, amps, effects, synths/keyboards, drum machines/samplers, microphones, outboard |
| **Navigation family** | explore related products | may group children; **never** aggregates listings or prices |
| **Canonical product** | compare one coherent buyer decision | terminal listing-match, price-statistics and monitoring identity |
| **Editorial facet** | discovery by character or role | many-to-many curation only; **never** a matcher alias |

`Fender Stratocaster` is a navigation family. `Fender American Professional II
Stratocaster` is a canonical product. A family whose children's markets differ by
more than ~3× must never aggregate — making a parent aggregate safely is an
experience/data-model problem, not a reason to merge children.

Evocative labels (`The Time Machines`, `The Workhorses`, `The Glue Machines`,
`The Crown Jewels`, …) are **future editorial vocabulary**, not implemented, and
never taxonomy or aliases. Standard category and canonical product names stay
visible in URLs, headings, search and metadata.

---

## Data and lifecycle contract

Five independent concerns. Never infer one from another.

| Concern | Field | Values |
|---|---|---|
| Identity | `kg_product.status` | `active` · `inactive` |
| Support | `kg_product.support_state` | `known` · `reserve` · `supported` |
| Visibility | `kg_product.browse_visibility` | `public` · `qa_only` · `hidden` |
| Editorial tier | `kg_product.tier` | `legendary` · `classic` · `standard` |
| Monitoring | `data/klup-source-monitoring.json` | explicit per-source product sets |

### Behaviour matrix

| State | KG row | Matcher target | Public page | Scheduled monitoring |
|---|---|---|---|---|
| Verified known | yes | **no** | no | no |
| Reserve | yes | **no** | no | no — explicit probe only |
| Supported, private | yes | **yes** | no | config-dependent |
| Supported, public | yes | **yes** | yes | config-dependent |
| Discovery-only | registry only | no | no | no |
| Deprecated / non-music | preserved `inactive` | no | no | no |

**Matcher eligibility = `status='active' AND support_state='supported'`.**
Promotion never publishes; publishing never changes support or monitoring. The
promotion API requires explicit `intent` for visibility and monitoring, offers
`?dryRun=1`, and returns a before/after manifest naming each consequence.

Authoring detail: [`klup-product-lifecycle-guide.md`](klup-product-lifecycle-guide.md).

---

## Candidate and cohort artefacts

| Path | Rows | Purpose |
|---|--:|---|
| `data/klup-clean-product-candidates.csv` | 336 | **Immutable** original research source (md5 `d31d4526…`) |
| `data/klup-music-vertical-candidate-additions.csv` | 182 | **Immutable** music-vertical overlay (md5 `48515001…`) |
| `data/klup-product-candidate-registry.csv` | 802 | Derived — every candidate with provenance |
| `data/klup-candidate-disposition.csv` | 194 | Derived — one audited outcome per matchable-labelled candidate |
| `data/klup-launch-cohort-frozen.csv` | 48 | Derived — the frozen cohort, versioned |
| `data/klup-frozen-cohort-asset-inventory.csv` | 48 | Derived — page/article/image readiness |
| `docs/klup-launch-catalogue-candidates.csv` | 795 | Full reconciliation |
| `docs/klup-music-vertical-kg-manifest.csv` | 88 | Proposed KG actions |

Regenerate derived files with `npm run build-product-artefacts`. Never hand-edit
them and never edit the two immutable sources.

Disposition outcomes: 142 `added_verified_kg_product`, 50 `existing_exact_kg_product`,
2 `rejected_duplicate_nonproduct_or_unsafe` (Rickenbacker 330 and 360 — bare
three-digit model tokens that would have become score-95 identifiers).

---

## Matcher and ingestion contract

Decision precedence in `frontend/lib/matching/match-listings.ts`, mutually exclusive:

| # | Outcome | Row? | `is_valid` |
|---|---|---|---|
| 1 | `none` | No | — |
| 2 | `rejected` (Epiphone→Gibson, Squier→Fender) | **Yes** | **`false`** + reason |
| 3–9 | `deferred`: non_product_intent · brand_mismatch · product_data_conflict · shared_identifier_conflict · ambiguous_tie · low_confidence · copy_or_reference | **No** | — |
| 10 | `matched` | Yes | unset (NULL = unreviewed) |

- Scores: `95` curated identifier · `80` synonym alias · `70` `model_name` token.
  `AUTO_CONFIDENCE_MIN = 80`; a 70 clears it only with the product's own brand present.
- **`is_valid IS NULL` is treated as TRUSTED by consumers** — that is why deferrals write nothing.
- **Eligibility:** `status='active'` **and** `support_state='supported'`, exact-match, fail-closed.
- **Brand protection is broader than candidacy:** `catalogueBrands` derives from
  `status='active'` only, so Tokai/Greco/Burny block false Gibson matches with no
  supported product; inactive non-music brands (Apple + 42 others) are excluded,
  so `Candy Apple Red` cannot read as brand evidence.
- Order-independent: candidates deduped per product, sorted `(score desc, product_id)`; ties fail closed.

### Ingestion identity

`listings.ingestion_batch_id` / `ingested_at` (migration 055) are **write-once**,
enforced by trigger. Legacy rows stay NULL forever. Exact equality on the stored
batch id is the **only** automatic-matching eligibility boundary — an upsert's
returned ids include conflict-refreshed rows and are never proof of new inflow.
All six listing writers are bound: the DBA promotion RPC, the four PM2 scrapers
and `/api/cron/scrape`.

**Rescraping is freshness, not population.** A conflict refresh preserves the
original identity, so a legacy row stays unmatched forever no matter how often
it is rescraped.

---

## Explicit monitoring boundary

`data/klup-source-monitoring.json`, consumed by `scripts/lib/source-monitoring.ts`.

| Source | Mode | Products |
|---|---|--:|
| `dba.dk` | explicit product set | **30** |
| `finn` · `blocket` · `kleinanzeigen` | explicit product set | **28** each |
| `reverb` | `broad_catalogue_sweep` | n/a — sweeps active music-gear, not a per-product query list |

**No scraper selects products by editorial `tier`.** That coupling was removed in
04B; DBA ⊇ Finn by exactly the two classic-tier extras (`strymon-timeline`,
`wurlitzer-207`), reproducing the pre-change sets exactly. Each scraper calls
`assertResolved()` so a configured product that no longer resolves **fails loudly**
rather than silently shrinking coverage. The file is reviewed code — no runtime
surface may mutate it.

---

## Migration and rollback package

**Files are 053–057. All five are `POST` — applied to production 2026-08-26.**

| # | File | Rollback | Scope | Applied (UTC) |
|---|---|---|---|---|
| 053 | `053_kg_duplicate_product_consolidation.sql` | `053_rollback.sql` | 14 duplicate `(brand, model_name)` groups / 29 rows | 14:47:40–42 |
| 054 | `054_identifier_curation.sql` | `054_rollback.sql` | removes unsafe `PAUL`, `TOM`, `335`; symmetric `Les Paul` / `ES-335` | 14:48:12–13 |
| 055 | `055_listing_ingestion_identity.sql` | `055_rollback.sql` | ingestion identity columns + write-once trigger + promotion stamp | 14:48:44–46 |
| 056 | `056_activation_package.sql` | `056_rollback.sql` | **atomic**: support schema + 34 brands + 142 products + exactly 48 promotions + assertions | 14:49:15–16 |
| 057 | `057_restrict_release_archive_tables.sql` | `057_rollback.sql` | locks down the nine 053/054 archive tables; pins trigger `search_path` | 15:53:56–57 |

SHA-256 of the applied files:

```
053  782b03a82dbd264b677f52549e6e6d67393ddab501a2a17fd59b69c4b7f49ae5
054  710bb0da7611ec0ed0f5723525f09aca5165ec1f0ed54cbd1f2a712de0f28d5f
055  4ac0e2242ed9083b118f5dddb7139b80d431c3bb7708966133bb69c081b1a782
056  b68558ef1898553dfb58aa16f6b5dc39d5cc465d0df97416448aeab1d1c60bfe
057  78ffa81b66ee1e763189d41002091b716ba3b77005f9e17e1944f484686d671f
```

### Two defects found during the release — both fixed, both worth remembering

**1. Migration 055 would have failed in production.** As originally written, 055
and `055_rollback` redefined `promote_scrape_run` as a **`RETURNS TABLE`**
function built on a pre-051 body. Production carries the migration-052
**`RETURNS jsonb`** function, so `CREATE OR REPLACE` fails with *"cannot change
return type of existing function"*. The error's own `DROP FUNCTION` hint was a
trap: forcing it through would have reverted the **051 six-field cohort-identity
guard** and broken `scripts/lib/publish.ts`, which reads the RPC result as a
single jsonb object (`r.skipped`) — a `TABLE` return arrives through PostgREST as
an *array of rows*, so a refused run would have been recorded as a successful
publish. Fixed in commit `a7fab3a`.

**Why the 60-check harness missed it:** `scripts/fixtures/kg_migration_fixture.sql`
contained no `promote_scrape_run` at all, so 055 created it from nothing and
passed. The fixture now carries the production-era `scrape_run`,
`listing_staging`, `listing_coverage_scopes` and the 052 function, and harness
section **11b** pins the contract (22 assertions). Harness is now **81 PASS**.
**Lesson: a synthetic fixture cannot validate a migration against production shape.
Rehearse on a restored snapshot.**

**2. The 053/054 archive tables were world-writable.** They live in `public`,
which PostgREST serves, and this project grants ALL on public tables to
`anon`/`authenticated`. Anonymous callers could read *and `DELETE`* the rollback
evidence. Confirmed live before the fix. Closed by 057 in commit `c7bd481`.

### P0 — read this before any future migration creates a table in `public`

> **The root cause of defect 2 is NOT fixed.** A schema-wide default privilege
> grants ALL on new `public` tables to `anon` and `authenticated`. **Any future
> migration that creates a table in `public` will be born world-readable and
> world-writable.** 057 fixed only the nine tables that existed.
>
> Until the default privileges are corrected, every new migration MUST either
> create its tables outside `public` or enable RLS and revoke anon/authenticated
> grants in the same transaction. Treat this as a prerequisite, not a nicety.

Apply strictly in order. Each has PRE / POST / DRIFT: PRE applies, POST is an
explicit successful no-op, DRIFT raises before any mutation.

**056 is one `BEGIN`/`COMMIT`.** Its post-condition (48 supported, 0 outside the
cohort, no additive row public/monitored/supported) runs *before* the commit, so
no intermediate state with zero supported products can ever be committed. It
never sets `browse_visibility`, `tier`, `status`, `attributes` or `image_url`.
Its conflict semantics are identity-equivalence: a slug held by a *different*
entity aborts as DRIFT rather than overwriting product-owned data.

**Support and visibility are independent — the 48 are not all private.** Verified
by rehearsal against a restored production snapshot (2026-08-26): after 056 the
cohort is **14 `supported`/`public` and 34 `supported`/`qa_only`**. The 14 were
already public canonical pages before activation; 056 publishes nothing, adds no
public row, and leaves **`browse_visibility='public'` at 28 in total**, exactly
as before. 056's own `NOTICE` says "48 supported/private" — that wording is
imprecise and is not a post-condition; the assertions it actually enforces are
the 48-count and the additive-row constraints.

Rollbacks refuse destructive reversal by default: 053/054 archive into
`kg_arch_*` tables; 055 refuses while any row carries an identity (`keep_columns`
/ `drop_with_evidence` escapes); 056 refuses while additive identities carry
references (`keep_identities` / `full` escapes).

**`npm run import-kg` is not the production activation path.** Migration 056 is.
The importer remains the clean-import path for a fresh database.

---

## Existing content preservation

- Product-page **slugs** are the primary key for URLs and matching — never edit a
  slug after a product has listings.
- The four former multi-row core identities (`gibson-j-45`, `gibson-hummingbird`,
  `gibson-sj-200-original`, `fender-mustang-bass`) were a **mapping error, not
  duplication**: the family regex also matched listing-title pollution rows. A
  canonical survivor was selected on evidence and **no consolidation is required**,
  so no article, image, match, alias or inbound reference moved.
- Migration 056 adds rows only; it never updates an existing product's attributes.
- Missing or draft content blocks **public exposure only** — never KG import,
  never private support.
- Do not rewrite articles, source or regenerate images, or redesign pages.

---

## Activation record — 2026-08-26

The catalogue was activated in production on 2026-08-26 from the Mac Mini
(`panter`) over a direct PostgreSQL connection, with every writer frozen.

### Release identity

| | |
|---|---|
| Original HEAD | `273d0d4a43ac11f696287c2524c7b150069417e7` |
| Release commit | `8298677711b571e9daafed5d0640b5c886b31f18` |
| 055 contract fix | `a7fab3ac2a96aeecdbd3092eefb554ddf19520dd` |
| Archive lockdown | `c7bd48112d3940002848ba170189cbcfd4b97264` |
| Deployed | Vercel production Ready; Mac Mini runtime on the same commit |

### Sequence actually followed

1. Froze every writer: PM2 daemon killed with 0 registered apps, Vercel Cron Jobs
   disabled at project level. **Quiescence proved over 51 minutes** — five write
   counters flat across ten `*/5` and five `*/10` windows.
2. Logical backup with `pg_dump --format=custom`, **restore-verified** into a
   disposable cluster (26/26 tables, exact row counts, four matching digests)
   plus a separate export of all 1,314 Storage objects.
3. Applied 053 → 054 → 055 → 056, then 057, each `psql -X -v ON_ERROR_STOP=1 -f`.
4. Deployed, smoke-tested, then resumed writers one class at a time with
   `pm2 start ecosystem.config.js --only <name>`, observing a full cycle between
   each and re-checking every stop condition.

### Post-activation production state (SELECT, 2026-08-26 18:59 UTC)

| Measure | Value |
|---|--:|
| `kg_product` | **4,004** (+142 additive) |
| `kg_brand` | **274** (+24, within the ≤34 ceiling) |
| `support_state='supported'` | **48** |
| matchable (`active` + `supported`) | **48** |
| supported / public | **14** |
| supported / `qa_only` | **34** |
| `browse_visibility='public'` | **28 — unchanged** |
| `listings` | **96,887** |
| listings with ingestion identity | **9,524** |
| legacy listings (NULL identity) | **87,363 — frozen throughout** |
| `listing_product_match` | **31,482** |

### First controlled inflow — 8 writer classes, all green

| Job | New listings | Batch outcome |
|---|--:|---|
| `process-price-queue` | 0 | queue empty |
| `scrape-dba` | 7 | 7 considered → 0 matched |
| `scrape-finn` | 180 | 14 matched, 1 deferred |
| `scrape-blocket` | 177 | 18 matched, 2 rejected, 1 deferred |
| `scrape-kleinanzeigen` | 450 | 59 matched, 1 rejected, 6 deferred |
| `scrape-reverb` | 8,710 | 537 matched, 57 rejected, 44 deferred |
| `fetch-reverb-prices` | 0 | no listing writes |
| `fetch-thomann-prices` | 0 | no listing writes |

**688 new `listing_product_match` rows = 628 matched (`is_valid IS NULL`) + 60
hard brand-collision rejections (`is_valid = false`).** Every one is on a listing
belonging to one of the five controlled ingestion batches. **Zero** on an
unsupported product; **zero** on a legacy row. Content digests for the 3,862
pre-existing products are byte-identical to the pre-migration baseline.

### Ingestion identity worked exactly as designed

Each source wrote under a single immutable batch id, and the counts correspond
exactly (`+N listings` ⇔ `+N identities`). The DBA run published 611 listings but
created only **7** identities — the other 604 were conflict refreshes, which
preserve the original (NULL) identity and are therefore correctly ineligible for
automatic matching. **Rescraping is freshness, not population**, demonstrated in
production.

### Final writer state

PM2 holds exactly 8 jobs, all cron-scheduled, `match-listings` **absent** and
purged from `~/.pm2/dump.pm2` by `pm2 save`. **The Vercel cron remains
DISABLED** — see *Vercel cron conflict* below.

### Backups retained

`~/klup-release-2026-08-26/` — `klup-prod-20260826.dump`
(`b0cdbb6c…`, 23,399,888 bytes, restore-verified), `storage-manifest.csv`
(`3078c53f…`, 1,314 rows), 1,313 storage files (229,340,362 bytes; one
case-folded pair with identical bytes, see `STORAGE-NOTES.md`), and the
pre-release PM2 dump. No rollback was used.

---

## Vercel cron conflict — `/api/cron/scrape` is disabled

It iterates 123 active user watchlists and calls `scrapeDba`, so it ingests the
**same dba.dk source** as the PM2 `scrape-dba` job, through a **different
conflict target on a shared unique index**:

```
PM2    -> ON CONFLICT (external_id, source)   [listings_external_id_source_unique — NOT partial]
Vercel -> ON CONFLICT (url, watchlist_id)     [listings_url_watchlist_unique — partial]
```

772 rows already carry both `watchlist_id` and `external_id`, all `dba.dk`. A
cron insert whose `(external_id, source)` already exists under a different
watchlist raises a unique violation instead of upserting. Re-enabling it requires
deciding whether watchlist ingestion should route through the same
staging/promotion path — a design decision, not an operational toggle.

---

## Current production and repository state

| Measure | Value | Source |
|---|--:|---|
| `kg_product` | 4,004 | SELECT, 2026-08-26 |
| `kg_brand` | 274 | SELECT, 2026-08-26 |
| `listings` | 96,887 | SELECT, 2026-08-26 |
| `listing_product_match` | 31,482 | SELECT, 2026-08-26 |
| Monitored set (DBA / others) | 30 / 28 | SELECT, 2026-08-26 |
| `browse_visibility='public'` | 28 | SELECT, 2026-08-26 |
| Migrations 053 / 054 / 055 / 056 / 057 | all **POST** | SELECT, 2026-08-26 |
| New brands (Tokai, Greco, Burny, PRS, Rickenbacker…) | **present** — added by 056 | SELECT, 2026-08-26 |

`HEAD = c7bd48112d3940002848ba170189cbcfd4b97264`, branch `main`, pushed to `origin/main`.

**Working-tree ownership.** The tree is intentionally dirty and carries all
accepted Prompt 02→04B work, largely untracked. **Pre-existing, never modify or
commit:** `.agents/`, `.mcp.json`, `skills-lock.json`.

**Non-mutation evidence:** every production access has been `SELECT`; matcher
analysis has been dry-run with zero `listing_product_match` writes; row counts
above are unchanged from the start of the programme except for scraper drift in
`listings`; no commit, push, deploy, migration, import, scrape, match apply,
backfill, rescrape, population, publish, PM2 or Vercel change has occurred.

---

## Verification baseline

```bash
npm test                                     # 148 tests, 148 pass, 0 fail
npx tsc --noEmit -p frontend/tsconfig.json   # 0 errors
cd frontend && npm run lint                  # 4 pre-existing warnings (app/layout.tsx)
npm run typecheck                            # EXACTLY 7 pre-existing errors
bash scripts/verify-migrations-isolated.sh   # 81 PASS + 1 documented BOUNDARY
npm run validate-activation                  # artefacts + disposition + migration reproduce exactly
npm run build-product-artefacts              # regenerate derived data files
```

The isolated harness creates a **disposable** local PostgreSQL cluster (unix
socket, `listen_addresses=''`) and destroys it on exit. It never touches production.

---

## Known compatibility and operational constraints

- **`npm run report-match-backlog` now succeeds** (056 is POST). Note its
  order-independence probe forces every product `supported` and covers ~3,697
  active products — that is NOT the live path. The live 48-product universe was
  tested separately and is fully deterministic (36,316/36,316 identical
  decisions forward vs reversed). Investigate the broad probe before any
  historical backfill.
- **Deploy order mattered and was respected:** 056 was applied BEFORE the deploy
  carrying the matcher change, so `matchListings` never ran against a database
  without `support_state`.
- After 056 the matcher target set narrows from 3,569 active products to **48**.
  That is intended; existing matches are untouched.
- Historical population remains blocked: `--historical-backfill` accepts only
  `--sources=` and `--max=`, with no product/cohort filter.

### Operator prerequisites — all four block activation

1. **Vercel cron control** — pause `/api/cron/scrape` (every 10 min) without deploying. No Vercel CLI, no dashboard access today.
2. **Real PM2 freeze** — `pm2 stop` does not neutralise `cron_restart`; deletion or cron removal is required.
3. **Direct PostgreSQL access** — for a logical backup of the 12 product/match tables *and a verified restore*. Only PostgREST + service-role key exist today.
4. **An approved migration channel** — currently manual Supabase Studio SQL.

---

## Controlled activation sequence

Not to be attempted from a coding session. Requires all four prerequisites.

1. Freeze every writer (PM2 jobs, Vercel cron, admin write surfaces) and **prove** it.
2. Record the commit SHA and SHA-256 of every migration, rollback, verifier and seed file.
3. Logical backup of the 12 product/match tables with a row-count + checksum manifest.
4. **Restore-verify** into a disposable database. A backup that has not been restore-verified is not a backup.
5. Fresh state check — require `PRE` for 053/054/055/056 and zero contradictions.
6. Apply **053 → 054 → 055 → 056** in order, postflighting each.
7. Deploy the reviewed revision (`git push origin main` → Vercel) with matching still frozen.
8. Post-056 verification: `npm run report-match-backlog` now runs; expect
   `product_data_conflict = 0`, exactly 48 supported, 28 public, 30/28 monitored.
9. Unfreeze writers. Verify one bounded cycle: a first cycle over existing
   inventory must match **nothing**, because every existing row is a conflict refresh.
10. Observe ≥1 nightly cycle. `npm run import-kg` stays prohibited throughout.

**Hard stop at any failed gate.** Roll back in reverse order.

**Historical population is explicitly excluded** from this sequence.

---

## Product work that comes next

**Stage 3: experience specification.** Not more KG or foundation work.

Read, in this order:

1. [`klup-documentation-index.md`](klup-documentation-index.md) — the authority map.
2. [`../CLAUDE.md`](../CLAUDE.md) — operating rules.
3. This handover.
4. [`klup-launch-catalogue-selection.md`](klup-launch-catalogue-selection.md) — the frozen 48, family/variant boundaries, supported-search contract, reserve set.
5. [`klup-product-lifecycle-guide.md`](klup-product-lifecycle-guide.md) — the five axes and the promotion seam.
6. `data/klup-launch-cohort-frozen.csv` and `data/klup-frozen-cohort-asset-inventory.csv` — what to build pages for and what content exists.

The specification work is: canonical product-page structure, navigation-family
browse, restricted search over the 48, and how unsupported queries record a
demand signal (which **does not exist yet** — today they simply find nothing).

---

## Hard scope gate

> **No new foundation, matcher, KG or product-data branch may displace experience
> specification without an explicit product-owner decision.**

Before opening any such work, state in writing:

1. which measured defect it fixes, with evidence;
2. what it costs in delay to experience specification;
3. why it cannot wait.

If those three cannot be answered, do experience specification instead.
