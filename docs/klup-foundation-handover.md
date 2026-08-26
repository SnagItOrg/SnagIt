# Klup fresh-session handover

**Current through Prompt 04B. Self-contained — a fresh agent can continue from this
document without conversation history.**

**Status:** all work below is **uncommitted** in the local working tree. Nothing
has been committed, pushed, deployed or applied to production. Production is
untouched and every access has been `SELECT`-only.

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

**Final files are 053–056 only.** All four are `PRE`; none applied.

| # | File | Rollback | Scope |
|---|---|---|---|
| 053 | `053_kg_duplicate_product_consolidation.sql` | `053_rollback.sql` | 14 duplicate `(brand, model_name)` groups / 29 rows |
| 054 | `054_identifier_curation.sql` | `054_rollback.sql` | removes unsafe `PAUL`, `TOM`, `335`; symmetric `Les Paul` / `ES-335` |
| 055 | `055_listing_ingestion_identity.sql` | `055_rollback.sql` | ingestion identity columns + write-once trigger |
| 056 | `056_activation_package.sql` | `056_rollback.sql` | **atomic**: support schema + 34 brands + 142 products + exactly 48 promotions + assertions |

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

## Current production and repository state

| Measure | Value | Source |
|---|--:|---|
| `kg_product` | 3,862 (3,569 active) | SELECT, 2026-08-13 |
| `kg_brand` | 250 | SELECT, 2026-08-13 |
| `listings` | 87,185 | SELECT, 2026-08-13 |
| `listing_product_match` | 30,794 | SELECT, 2026-08-13 |
| Monitored set (DBA / others) | 30 / 28 | SELECT, 2026-08-13 |
| `browse_visibility='public'` | 28 | SELECT, 2026-08-13 |
| Migrations 053 / 054 / 055 / 056 | all `PRE` | SELECT, 2026-08-13 |
| New brands (Tokai, Greco, Burny, PRS, Rickenbacker…) | **0 in database** — seed/migration only | SELECT, 2026-08-13 |

`HEAD = 273d0d4a43ac11f696287c2524c7b150069417e7`, branch `main`, index **empty**.

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

- **`npm run report-match-backlog` fails against PRE-056 production**
  (`column kg_product.support_state does not exist`). It is a **post-056
  verification command, not a preflight**. Do not make the column optional.
- **Deploy order matters:** the matcher code reads `support_state`. Deploying the
  application before migration 056 would break `matchListings` in production.
  Apply 056 *before or with* the deploy that carries the matcher change.
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
