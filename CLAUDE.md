# CLAUDE.md — Klup.dk operating guidance

Current as of **2026-08-13**, after Prompts 02→04B. This file tells an agent how
to work safely in this repository *now*. It is not a history — the engineering
record lives in [`docs/klup-engineering-history.md`](docs/klup-engineering-history.md).

**Start here, then read [`docs/klup-documentation-index.md`](docs/klup-documentation-index.md)
and [`docs/klup-foundation-handover.md`](docs/klup-foundation-handover.md).**

---

## 1. What Klup is

A **curated monitoring and comparison service for used music instruments and
studio equipment.** Canonical product pages are the core experience; search
navigates *within* a supported catalogue.

The question the product must answer:

> "Er 4.500 kr for en Roland Juno-106 en god pris i dag?"

**Non-goals — do not build these:**
- A general marketplace, storefront, or inventory/trading operation.
- An arbitrage desk. `/intel` is a private founder tool, not the product.
- Multi-vertical coverage. Design furniture, cycling, photography and tech are
  **out of scope**; their KG rows are already inactive and stay that way.
- A generic listing SERP. Unsupported searches become demand signals.
- Auto-bidding or agent-assisted purchasing.

---

## 2. Product-state model — five separate concerns

Never infer one from another.

| Concern | Field | Values |
|---|---|---|
| **Identity** | `kg_product.status` | `active` · `inactive` |
| **Support** | `kg_product.support_state` *(migration 056, POST)* | `known` · `reserve` · `supported` |
| **Visibility** | `kg_product.browse_visibility` | `public` · `qa_only` · `hidden` |
| **Editorial tier** | `kg_product.tier` | `legendary` · `classic` · `standard` |
| **Monitoring** | [`data/klup-source-monitoring.json`](data/klup-source-monitoring.json) | explicit per-source product sets |

- **Matcher eligibility** = `status='active' AND support_state='supported'`. Nothing else.
- **`tier` is editorial only** — carousel, badges, browse ranking, `/intel`.
  It is *no longer* a scraper selector. Do not reintroduce that coupling.
- **Brand protection is broader than candidacy**: `catalogueBrands` derives from
  `status='active'`, so a verified brand with no supported product (Tokai,
  Greco, Burny) still blocks a false Gibson/Fender match.

## 3. Broad KG vs narrow operations

| Layer | Size | Behaviour |
|---|--:|---|
| Verified KG identity universe | 221 brands / 3,440 products (reviewed seed) | identity + collision protection only |
| **Frozen launch catalogue** | **48** | supported, private, matcher-eligible |
| Query-driven monitoring | DBA 30 · Finn 28 · Blocket 28 · Kleinanzeigen 28 | explicit product sets |
| Reverb | — | broad-catalogue sweep, **not** a per-product query list |

**Do not run the whole KG against every marketplace.** A KG import must never
widen monitoring. Frozen cohort manifest: [`data/klup-launch-cohort-frozen.csv`](data/klup-launch-cohort-frozen.csv).

---

## 4. Repository landmarks

| Area | Path |
|---|---|
| Frontend (Next.js 14 App Router) | `frontend/app`, `frontend/lib` |
| Matcher core | `frontend/lib/matching/match-listings.ts` |
| Brand / intent / source guards | `frontend/lib/matching/{brand-guard,listing-intent,sources}.ts` |
| Ingestion identity | `frontend/lib/matching/ingestion-batch.ts` |
| Product page | `frontend/app/product/[slug]/page.tsx` |
| Promotion seam | `frontend/app/admin/products/page.tsx` + `frontend/app/api/admin/products/[id]/route.ts` |
| Scrapers | `scripts/scrape-{dba,finn,blocket,kleinanzeigen,reverb}.ts` |
| Monitoring config loader | `scripts/lib/source-monitoring.ts` |
| Migrations (manual SQL) | `scripts/migrations/` |
| Read-only SQL | `scripts/queries/` |

### Candidate provenance (never edit the first two)

| File | Rows | Status |
|---|--:|---|
| `data/klup-clean-product-candidates.csv` | 336 | **immutable source** |
| `data/klup-music-vertical-candidate-additions.csv` | 182 | **immutable overlay** |
| `data/klup-product-candidate-registry.csv` | 802 | derived |
| `data/klup-candidate-disposition.csv` | 194 | derived |
| `data/klup-launch-cohort-frozen.csv` | 48 | derived |
| `data/klup-frozen-cohort-asset-inventory.csv` | 48 | derived |

Regenerate derived files with `npm run build-product-artefacts`; never hand-edit.

### Existing assets — preserve, do not rebuild

Product pages, draft legendary articles (`kg_product.attributes`), sourced
images (`image_url` / `hero_image_url`) and the promotion system **already
exist**. Do not rewrite copy, source new images, redesign pages or build a
parallel promotion tool. Coverage across the frozen 48: 3 articles, 29 images,
5 with no image — content gaps block *public exposure only*.

---

## 5. Migrations

**053, 054, 055, 056 and 057 are all `POST` — applied to production 2026-08-26.**

| # | File | Scope |
|---|---|---|
| 053 | `053_kg_duplicate_product_consolidation.sql` | KG duplicate consolidation |
| 054 | `054_identifier_curation.sql` | unsafe identifier removal |
| 055 | `055_listing_ingestion_identity.sql` | immutable ingestion identity |
| 056 | `056_activation_package.sql` | **atomic**: support schema + 34 brands + 142 products + exactly 48 promotions + assertions |

Each has a rollback and PRE/POST/DRIFT handling. **056 is one transaction** —
there is no intermediate state with zero supported products.

**No migration or import runs casually.** Applying anything requires the
operator prerequisites in §8 and an explicit product-owner decision.
`npm run import-kg` is **not** the production activation path — migration 056
is. The importer remains the clean-import path for a fresh database only.

---

## 6. Safe verification commands and current baseline

```bash
npm test                                     # 148 tests, 148 pass, 0 fail
npx tsc --noEmit -p frontend/tsconfig.json   # 0 errors
cd frontend && npm run lint                  # 4 pre-existing warnings (app/layout.tsx)
npm run typecheck                            # EXACTLY 7 pre-existing errors — any 8th is yours
bash scripts/verify-migrations-isolated.sh   # 81 PASS, disposable local cluster
npm run validate-activation                  # artefacts + disposition + migration reproduce exactly
```

**`npm run report-match-backlog` now succeeds** — 056 is applied. Its
order-independence probe covers the forced-supported ~3,697-product projection,
not the live path; the live 48 are deterministic.

The seven root type-check errors are pre-existing and deliberately unfixed:
`schibsted.ts` TS2353 · `scripts/lib/baseline.ts` TS2352 · `scripts/match-listings.ts`
TS2345 (dual `@supabase/supabase-js` install) · `scripts/process-reverb-data.ts` ×3 ·
`scripts/scrape-vintagesynth.ts` TS2304.

---

## 7. Working rules

**Production is SELECT-only by default.** Any write needs explicit authorisation.

**The working tree is intentionally dirty** and carries all accepted Prompt
02→04B work, mostly untracked. Preserve it. `.agents/`, `.mcp.json` and
`skills-lock.json` are pre-existing and must never be modified or committed.

**Never, without explicit authorisation:**
- commit, push or deploy;
- execute a migration, importer, scraper, matcher apply, backfill, rescrape or population;
- publish a product or widen marketplace monitoring;
- alter PM2 or Vercel;
- run the unbounded historical matcher (it is gated behind
  `--historical-backfill` + `--sources=` + `--max=`, dry-run by default, and
  still needs a product-scoped filter that does not exist yet);
- edit the immutable 336/182 candidate sources;
- repair the seven-error type-check baseline.

**Engineering standards:** no quick fixes; every scraper rate-limited (≥2s +
jitter); PM2 jobs need `max_restarts: 3` / `min_uptime: 30000`; store raw
`price` + `currency` and convert at read time; never log PII; never hardcode
secrets or ask for them in chat.

**Design rules:** green `#13ec6d` only on Kup-rating stars and "Aktiv" badges.
DM Serif Display headlines, Inter body. Price history only on `/saved` and
product pages, never on SERP. See [`frontend/CLAUDE.md`](frontend/CLAUDE.md).

---

## 8. Activation authority boundary

Activation is **blocked** until an operator provides all four:

1. **Vercel cron control** — pause `/api/cron/scrape` without deploying.
2. **Real PM2 freeze** — `pm2 stop` does not neutralise `cron_restart`.
3. **Direct PostgreSQL access** — for a logical backup *and a verified restore*.
4. **An approved migration channel** — currently manual Supabase Studio SQL.

The sequence lives in the handover, not here. Do not attempt it from a coding session.

---

## 9. What comes next

**Stage 3: experience specification.** Canonical product pages, navigation
families and restricted search over the frozen 48.

- Product families (`Fender Stratocaster`) are **navigation concepts** — they
  group children but never aggregate listings or prices.
- Concrete variants (`Fender American Professional II Stratocaster`) are the
  terminal listing/price/monitoring identities.
- Evocative labels (`The Time Machines`, `The Workhorses`, `The Glue Machines`)
  are **future editorial facets**, never taxonomy replacements and never
  matcher aliases.

**No further foundation, matcher, KG or product-data implementation branch is
authorised.** Historical population is later, product-scoped, dry-run-first and
separately authorised.

> **Scope gate.** Before opening any new foundation work, state in writing:
> (1) which measured defect it fixes, with evidence; (2) what it costs in delay
> to experience specification; (3) why it cannot wait. If you cannot answer all
> three, do experience specification instead.

---

## 10. Environment

**MacBook** (`dev`) and **Mac Mini M4** (`panter`) both run Claude Code
natively. **Run `hostname` early** — do not assume you are on the MacBook, and
do not assume PM2 state needs an SSH hop.

| Layer | Tool |
|---|---|
| Frontend | Next.js 14 App Router, TypeScript, Tailwind |
| Database + Auth | Supabase Pro (RLS on all tables) |
| Deploy | Vercel — `git push` to `main`. **Never the Vercel CLI** |
| Scraper runtime | PM2 on `panter` |
| Email | Resend |
| Analytics | PostHog EU |
| Currency | Frankfurter API with hardcoded fallbacks |

**DNS:** Simply.com. **Protonmail MX records must never be touched.**

Repo `SnagItOrg/SnagIt` · prod `www.klup.dk`.

---

## 11. Documentation authority

1. **This file** — how to work safely now.
2. [`docs/klup-documentation-index.md`](docs/klup-documentation-index.md) — the map; read it before trusting any other doc.
3. [`docs/klup-foundation-handover.md`](docs/klup-foundation-handover.md) — full technical handover.
4. [`docs/klup-product-lifecycle-guide.md`](docs/klup-product-lifecycle-guide.md) — lifecycle/promotion authoring.
5. [`docs/klup-launch-catalogue-selection.md`](docs/klup-launch-catalogue-selection.md) — the frozen 48 and why.

Anything not listed there may be historical. **Check the index first.**
