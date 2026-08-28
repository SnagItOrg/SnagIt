# Stage 3 V1 — decision record and build plan

**This document is the single implementation authority for Stage 3 V1.** Where it
disagrees with [`stage-3-experience-spec.md`](stage-3-experience-spec.md),
[`stage-3-frontend-readiness-audit.md`](stage-3-frontend-readiness-audit.md) or
[`stage-3-measurement-spec.md`](stage-3-measurement-spec.md), **this document
wins**. Those three remain the evidence base and are preserved unchanged.

| | |
|---|---|
| Written | 2026-08-27 |
| Foundation frozen at | `2c864e4106546f89ad1e7925b4256bb2f3210c57` |
| Deployed production commit | `c7bd481` |
| Authority read | `CLAUDE.md` · `klup-documentation-index.md` · `klup-foundation-handover.md` (incl. the activation record) · `klup-launch-catalogue-selection.md` · the three Stage 3 reports |
| Verification | repository read; production `SELECT` only, 2026-08-27 |
| Status | **Specification. Nothing here is implemented.** No code, config, migration, KG, matcher, monitoring, scraper, PM2 or Vercel change was made. |
| Revision | **Amended 2026-08-27** before checkpointing — see *Amendment record* below. |

---

## Amendment record — 2026-08-27, extended 2026-08-28

Corrections applied to this document. Each is binding and supersedes the text it
replaces. Amendments 1–9 predate the R1 checkpoint; **amendment 10 was raised by
cross-package review after WP-2 was implemented** and corrects instructions that
were found to be wrong when executed.

| # | Amendment | Where |
|--:|---|---|
| 1 | **Consent and privacy are no longer a deferred exposure.** Q-D7's deferral is withdrawn. Consent gating, withdrawal, the tracker inventory with a per-tracker decision, the fail-closed EU host, URL-capture sanitisation, the operational/behavioural channel split and a public privacy route are **V1 release requirements**, owned by WP-5 and verified at R6 by a recorded rejected-consent network trace | §12.3, **§12.4**, §14.4a–4c, **§16.6**, §17 (R2, R6), §19, §20 Q-D7, WP-5 |
| 2 | **The family contract is tightened.** Empty family routes render **no** children — not as links, not greyed — and are absent from the homepage, browse, navigation, sitemap and search index. They may carry restrained explanatory copy and unsupported-demand capture only, and become indexable and navigable only once at least one canonical child is public | §2.2 D4, **§4.2**, §5, §13.1, §16.3, §17 (R3), §19.14, §20 Q-D5, WP-2 |
| 3 | **All work-package ownership paths are exact.** Globs, brace expansions and shorthand (`page.tsx`, `browse/**`, `cards/nav`, "PostHog components") are replaced by repository-relative file lists, with a contention register naming a single owner for every shared file | **§15** (15.1–15.7), WP-1 … WP-5 |
| 4 | **R0 now requires an operator proof that the deployed Vercel cron is disabled.** The repository declaration asserts the opposite, and this document's behavioural inference is explicitly insufficient | §0, **§25.2** |
| 8 | **Review fixes H1, H2, M1, D and E applied.** Public eligibility is never prerendered or memoised; `/api/product/[slug]` returns an explicit DTO instead of `kg_product.*`; an independent security reference detects posture downgrades; infrastructure failure is 503, never 404; audit counters are labelled; the fourth axis is asserted; route groups normalise identically at runtime and on disk | §7.7, **§7.8**, §12.4, **§15.1**, §15.6–15.7, **§15.10**, §16.2 |
| 9 | **Ownership fully reconciled.** Every WP-1-owned file is listed, root `package.json` is an authorised supporting file, the three test files are authorised in `scripts/lib/`, and the blanket `scripts/**` ban that contradicted them is replaced by a precise rule | §15.1, §15.6, §15.7 |
| 6 | **The product segment gate is formalised.** `frontend/app/product/[slug]/layout.tsx` becomes WP-1-owned: it provides the server-side canonical eligibility gate and the real HTTP 404 that a client-rendered page cannot. WP-3 may replace it only as a bounded hand-off under seven conditions, including re-running the WP-1 route/API eligibility suite | §15.1, §15.3, **§15.8**, WP-3 |
| 7 | **Route posture is mechanically complete.** The pass-through default is accepted only with a guard: `frontend/lib/route-access.ts` becomes the single authority consumed by both middleware and tests, and `scripts/lib/wp1-route-access.test.ts` fails if any routable file is unclassified or if a declared protection is not effective | §7.1, **§7.7**, §15.1, **§15.9**, §16.2 |
| 5 | **WP-1 and WP-5 no longer share a writable file.** `frontend/app/layout.tsx` — where all four trackers are mounted — is now owned exclusively by WP-5; WP-1's site metadata moved to `frontend/lib/site-metadata.ts`. WP-5 consequently runs **after** WP-1 rather than beside it, and joins the critical path | §15.7, §22, §23, §24, WP-1, WP-5 |
| 10 | **Cross-package review of WP-2 — three corrections.** (a) The instruction to change `intent:['monitoring']` to `['metadata']` is **withdrawn**: `FIELD_AXIS.tier` is `'monitoring'` and `mustDeclare` requires it, so that edit alone refuses every tier PATCH with `400 undeclared_axis`, and the axis mapping is forbidden to WP-2. The token stays; the correction is **copy only**, and the copy must state plainly that tier does not control scraper monitoring — `data/klup-source-monitoring.json` does. (b) `frontend/vercel.json` is **not** a WP-2 file: adding a `_comment` is still a change to a deployment input, and the file must stay byte-identical to base. (c) The WP-1 and WP-5 "allowed supporting" rows still named `frontend/__tests__/`, which §15.1 superseded (finding N6) | **§14.9**, §15.1, §15.2, WP-1, **WP-2**, WP-5 |

---

## 0. Pre-flight verification (performed before writing this document)

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `2c864e4106546f89ad1e7925b4256bb2f3210c57` ✅ |
| `git diff HEAD --stat` | **empty** — zero tracked files modified ✅ |
| Untracked additions | `docs/stage-3-experience-spec.md`, `docs/stage-3-frontend-readiness-audit.md`, `docs/stage-3-measurement-spec.md`, plus the pre-existing `.agents/`, `.mcp.json`, `skills-lock.json` ✅ |
| Application code / config / existing docs changed by the three sessions | **none** ✅ |
| Production catalogue | 48 supported · 28 public · 14 both · 34 supported-`qa_only` · 14 public-unsupported · 48 matchable · 4,004 `kg_product` ✅ |
| Vercel scrape cron | **dormant**, see below |

**Cron evidence — behavioural only, and deliberately not sufficient.** Vercel
project configuration is not readable from a coding session. `/api/cron/scrape`
is the only writer that stamps `listings.watchlist_id`; production holds **772**
such rows with a newest `scraped_at` of **2026-03-16** and **zero** ingestion
identities (migration 055 stamps every writer, so a post-activation run would be
visible). Meanwhile the PM2 scrapers wrote through **2026-08-27 02:33**. The cron
has not executed.

Separately, `frontend/vercel.json` **still declares**
`crons: [{ path: "/api/cron/scrape", schedule: "*/10 * * * *" }]`, so the
**repository asserts the cron is enabled while the deployed state says it is
not**. Re-enabling it would restore the documented `ON CONFLICT` collision with
the PM2 `scrape-dba` path. V1 does not re-enable it and does not remove the
declaration (removal is a deployment-affecting change); WP-2 adds a warning
comment only.

> **The evidence above is inference, not proof, and does not authorise R1.**
> An operator with Vercel project access must produce the four-part proof in
> **§25.2** — project-level Cron Jobs state, absence of execution history, the
> corroborating database read re-run at R0, and written confirmation of whether
> a V1 deploy could re-enable the cron from `vercel.json`. If any part cannot be
> produced, R1 does not start.

---

## 1. Current-state diagnosis

### 1.1 The five facts that determine V1

1. **The core experience is unreachable.** `frontend/middleware.ts:39-60`
   lists `/browse` and `/search` as public but **not** `/product` or
   `/api/product`, so every anonymous product request is `307`-redirected to
   `/login` (`middleware.ts:162`). `/api/discover` is likewise non-public, so the
   anonymous homepage renders zero catalogue. All three reports agree; it is the
   single blocking defect.

2. **There is no eligibility gate behind the wall.**
   `frontend/app/api/product/[slug]/route.ts:45-49` is
   `.from('kg_product').select('*, kg_brand(...)').eq('slug', …).single()` — no
   `status`, no `support_state`, no `browse_visibility`. All 4,004 slugs render,
   including 307 inactive non-music rows. **Opening the wall without the gate
   publishes 3,976 unintended pages.** This is why product-owner decision 3 is
   correct and non-negotiable.

3. **Browse silently truncates.** `frontend/lib/browse.ts:346-357`
   (`fetchBrowseRows`) selects `browse_product_projection` with
   `.eq('browse_domain','music')` and **no `.range()` and no `.order()`**. The
   projection holds 4,004 music rows; PostgREST caps the unbounded request at
   1,000 in unspecified physical order, and all public-filtering, counting and
   pagination then happen in JavaScript over that prefix. Ground truth is 23
   browse-eligible products; the root API reports 19 and the leaf APIs sum to 22.

4. **The price answer is computed from the wrong source.**
   `app/api/product/[slug]/route.ts:116-136` builds the only price band from
   **sold** history (`reverb_price_history` FK-joined, plus an `ilike` join to
   `auctionet_price_history`), IQR-filtered, `n ≥ 3`, and labels it *"Typisk
   brugtpris"*. Sold data exists for **8 of 48** supported products. The same
   products carry Klup's own live matched asking prices and never use them.

5. **`/search` is the documented non-goal.** `app/search/page.tsx:94` calls
   `GET /api/scrape`, which live-scrapes DBA, Finn, Blocket, Kleinanzeigen and
   Thomann per request, **writes to `listings`**, and is unauthenticated
   (`middleware.ts:48`) behind a 20 req/min/IP limiter. It has no catalogue
   concept, no product routing and no demand signal. The placeholder still reads
   *"Søg efter alt… (f.eks. iphone, sofa, cykel)"* (`lib/i18n.ts:31`).

### 1.2 What is already good and must be preserved

`PATCH /api/admin/products/[id]` (axis-typed, `intent`-gated, `?dryRun=1`,
before/after manifest) · `browse_product_projection` (exposes `is_public`,
`taxonomy_state`, `supply_state`, `tier_rank`, `has_image`,
`active_listing_count`) · `buildDiscoverResponse` (filters `is_public` **in
SQL**) · `/api/market-price` and `/api/price-observations` (p25/p50/p75 and
min/max/count, resolving by `listing_id` **or** `product_slug`, never called) ·
`lib/listing-price-integrity.ts` · `lib/currency.ts` · `ListingErrorBoundary` ·
`SearchResultCard` with per-source brand colours · shape-matched loading
skeletons on five surfaces · complete design tokens.

---

## 2. Reconciliation of the three reports

### 2.1 Material agreements (adopted without change)

| # | Agreement | Reports |
|--:|---|---|
| A1 | `/product` + `/api/product` are login-walled and this blocks everything | all three (spec §0.1, audit F-01, measurement §3.1) |
| A2 | The product route applies no visibility gate; the two halves must ship together | spec §2, audit F-01/F-03 (B1+B2), measurement G9 |
| A3 | Browse truncates at the PostgREST cap; counts are unreliable | spec §0.3, audit F-04 |
| A4 | 13 supported products are `missing_subcategory` and cannot appear in browse | spec §0.4, audit 4.1c |
| A5 | Sold-price coverage is 8 of 48 and cannot carry the product | spec §0.5, audit F-12, measurement §11 |
| A6 | `/search` must become a catalogue resolver; `/api/scrape` must leave the public path | spec §9, audit F-14 (B5), measurement §9/§10 |
| A7 | Copy is pre-pivot and multi-vertical | spec §0.7, audit F-37, measurement §23.4 |
| A8 | Demand capture is a PostHog event in V1; no new `public` table (P0 default privileges) | spec §9.4, measurement §10/§19.2 |
| A9 | No `posthog.identify()` exists; no product-page, browse or demand events exist | measurement §3.2/§13, corroborated by grep |
| A10 | Zero SEO surface: no `generateMetadata`, no sitemap, no canonical, no JSON-LD, no SSR on the product page | audit F-09/F-16/F-17, measurement §23.4 |
| A11 | The six family-label rows behave as priced products and must stop | spec §0.2/§6.2, selection doc §6 |
| A12 | Catalogue counts 48/28/14/34/14 reproduce exactly on production | audit §1, re-verified here |

### 2.2 Material disagreements, and how each is resolved

| # | Disagreement | Resolution (binding) |
|--:|---|---|
| **D1** | **Public set size.** Audit quick-win #2 says the gate yields "28 pages". Spec §2 says public → everyone, `qa_only` → admin, else 404, which yields 14 canonical + 14 non-canonical public rows. | **Neither, as written.** Product-owner decision 6 forbids public-but-unsupported rows rendering as canonical pages. Canonical set = **14** (§3.1). The other 14 public rows are **not** canonical pages. The audit's "28" is wrong against the decisions. |
| **D2** | **What the 8 non-family public-unsupported rows become.** Spec §10.2 proposes an "archived template". Audit is silent. | **404 in V1.** They are removed from browse, homepage and search in the same release, so nothing links to them. An archived template is new surface for zero V1 value and is deferred (§20 Q-D2). |
| **D3** | **Whether the six family rows redirect, render in place, or are depublished.** Spec §6.2 proposes route-level render-in-place with a canonical link to `/family/<slug>`; spec Q1 defers depublishing. | **308 permanent redirect** `/product/<family-slug>` → `/family/<family-slug>`, with `/family/<slug>` carrying its own canonical. Zero production writes, one URL per entity, no duplicate-content ambiguity. Depublishing stays deferred (§20 Q-D3). |
| **D4** | **Family-page children.** Spec §6.1 shows children "each with its own price band, listing count and freshness". | **Impossible in V1 and forbidden.** Measured: **every** child of **every** family in the selection doc §6.3 map is `supported` + `qa_only`; **zero are public**; `fender-jazz-bass` and `fender-precision-bass` have **no supported child at all**. A V1 family route therefore has **zero canonical-eligible children** (§4.2), so it renders **no children at all** — not as links and not as greyed cards — and is absent from the homepage, browse, navigation and the sitemap. Neither report caught this. |
| **D5** | **Price basis.** Spec §8.1 mandates an asking-price band, `n ≥ 8`, IQR, p25–p75. Audit F-12 treats the 8-of-48 sold coverage as a content-acquisition problem. Measurement §11 instruments the existing sold band. | **Spec wins, with measured confirmation.** Asking-price band on Klup's own matched listings is the V1 primary signal (product-owner decision 10). Measured at `n ≥ 8` after plausibility + IQR filtering: **13 of 14** canonical products qualify, versus **6 of 14** for the sold chart (§9). |
| **D6** | **`n ≥ 8` vs. existing thresholds.** Product route uses `≥ 3` post-IQR for the band; product page uses `≥ 5` for the chart; measurement G4 flags bands with `band_count < 5` as thin. | **`n ≥ 8` for the asking band** (spec §8.1) — no exceptions. **`≥ 5` retained** for the sold chart. **`≥ 3` retired** for anything user-facing. |
| **D7** | **Which asking-price band guardrail.** Measurement G3 caps `band_high/band_low` at 10×. Spec has no width rule. | **Adopt G3 as a render gate, not just a metric.** Measured: raw p25/p75 without the plausibility filter puts `rhodes-mark-i-stage-73` at **1,325×** (p75 = 37,273,095 DKK — the known legacy Kleinanzeigen parser rows) and `gibson-les-paul-custom` at **278×**. After `hasPlausibleListingPrice` + IQR, two supported products still exceed 10× (`gibson-les-paul-custom` 268×, `moog-source` 13.6×), both `qa_only`. Within the canonical 14, the widest are `roland-sh-101` 9.2× and `yamaha-dx7` 8.0× (§9.4). |
| **D8** | **`/api/scrape`'s fate.** Spec §9.5 says the route "may remain for `/admin/product/[slug]`'s on-demand curation scrape". | **Factually wrong; corrected.** Admin curation calls `/api/admin/product/[slug]/scrape-platform` and `…/scrape-kleinanzeigen`, which are admin-gated. A repo-wide search finds **exactly one** caller of `/api/scrape`: `app/search/page.tsx:94`. Once search becomes a resolver it has **zero** callers (§13.3). |
| **D9** | **Homepage selection axis.** Spec §4.1 says select on `support_state='supported' AND browse_visibility='public'`. Audit quick-win #1 says the one-line allow-list fix makes `buildDiscoverResponse` correct. | **Spec wins.** `buildDiscoverResponse` (`lib/browse.ts:581-623`) filters `is_public` and partitions by `tier === 'legendary'`. `is_public` does **not** include `support_state` — the projection has no such column. Un-gating it as-is would put `arp-2600`, `oberheim-ob-x`, `gibson-les-paul` and `sequential-prophet-5` on the homepage. |
| **D10** | **Timestamp semantics.** Audit F-23 says `timeSince(scraped_at)` presents scrape recency as listing recency and needs "a real first-seen column or a documented fallback". | **The column exists.** `listings.first_seen_at` and `last_seen_at` are populated on **35,390 of 48,858** active rows (72.4%). Rule: use `first_seen_at` when present; when absent, show no age string (§10.4). Never present `scraped_at` as listing age. |
| **D11** | **Analytics scope.** Measurement §20 defines 16 V1 events. | **12 are required for first release** (§12); four are deferred with reasons. |
| **D12** | **Onboarding.** Spec §4.2 retires steps 1–3 to a redirect. Audit F-24b says "decide: wire from `/signup`, or remove — leaving it is the worst option". | **Spec wins**, redirect to `/`. Route files and the `onboarding-assets` bucket are retained (browse category images are served from it). |
| **D13** | **Danish category names.** Spec §5.1 proposes a code-owned display map; correcting `kg_category.name_da` is a production write (spec Q4). | **Code map** `frontend/lib/category-labels.ts`. Zero production writes (decision 14). |
| **D14** | **Alerts.** Spec §10.3 replaces free-text watchlists with product-scoped alerts; measurement §7 says product-binding the row is a schema change. | **Event-level binding only in V1.** New alerts store the product's exact canonical name as the query **and** emit `watch_created { origin_product_slug }`. No schema change. The 123 legacy watchlists are untouched. |
| **D15** | **`report-match-backlog` / matcher work.** All three reports touch matcher-adjacent findings (F-07, G9). | **Out of scope entirely.** No matcher, KG, monitoring or scraper change is authorised (decision 18, `CLAUDE.md` §7). F-07 (the 14 decaying public rows) is *resolved by removing them from the public surface*, not by promoting them. |

### 2.3 Why "14 canonical products" and "23 browse-eligible rows" are both correct

They measure different predicates over different populations. Neither report
stated the decomposition; it is now measured exactly:

```
kg_product                                                     4,004
├─ status='active'                                             3,697
└─ browse_visibility='public'                                     28
   ├─ support_state='supported'   → CANONICAL V1 SURFACE          14   ← decision 4
   │  ├─ taxonomy_state='classified'  → listable in browse        10
   │  └─ taxonomy_state='missing_subcategory' → page only          4   (3 Rhodes + Wurlitzer 200A)
   └─ support_state='known'       → NOT canonical (decision 6)     14
      ├─ taxonomy_state='classified'                              13
      └─ taxonomy_state='missing_subcategory'                      1   (rhodes-mark-i-stage-88)

browse_product_projection.is_public
  = status='active' AND browse_visibility='public' AND taxonomy_state='classified'
  = 10 supported + 13 unsupported = 23                            ← the "23"
```

`is_public` is defined in `scripts/migrations/036_browse_visibility_projection.sql:84-97`
and **contains no support axis**. So:

- **14** = the canonical-page set (support-aware, taxonomy-independent).
- **23** = the browse-eligible set today (taxonomy-aware, support-blind).
- **10** = their intersection — the V1 browse-listable set.
- **19 / 22 / 23** = the audit's three disagreeing production counts, all
  artefacts of the unbounded projection fetch (§1.1 fact 3), not of the model.

**After V1, browse shows 10 products, not 23.** Four canonical products
(`rhodes-mark-i-stage-73`, `rhodes-mark-i-suitcase-73`, `rhodes-mark-ii-stage-73`,
`wurlitzer-200a`) have a live public page reachable by URL, breadcrumb, search
and sitemap, but no browse card, until a subcategory is assigned. That assignment
is a production write and is **deferred** (§20 Q-D4).

### 2.4 Monitoring reality behind the canonical 14 (measured, not previously stated)

`data/klup-source-monitoring.json` resolves to a 30-slug union
(DBA 30 · Finn 28 · Blocket 28 · Kleinanzeigen 28). Its exact decomposition:

| Segment | n | Meaning |
|---|--:|---|
| supported **and** public — the canonical 14 | **14** | monitored on **all four** explicit sources, plus the Reverb broad sweep |
| public **and** unsupported | **14** | still queried; matcher-ineligible, so their inflow can never match |
| `wurlitzer-200`, `wurlitzer-207` (`known`/`qa_only`) | **2** | queried; not public, not supported |

**Every one of the 14 canonical products is monitored on all four marketplaces.**
This is the strongest available statement about V1 coverage and licenses the
per-product source line in §8. It also quantifies documentation-index follow-up
#2: roughly half the monitored query budget is spent on products the matcher
cannot match. That is an operations item, **not** Stage 3 work, and no monitoring
change is proposed.

---

## 3. Final public entity contract

### 3.1 Canonical product page — exact eligibility

A slug renders a canonical product page **iff all four hold**:

```
kg_product.status            = 'active'
kg_product.support_state     = 'supported'
kg_product.browse_visibility = 'public'
browse_product_projection.browse_domain = 'music'
```

→ **exactly 14 rows today.** Verified: all 48 supported rows resolve
`browse_domain='music'` (the projection's `COALESCE(root.domain, sub.domain,
legacy_cat.domain)` keeps the four `missing_subcategory` rows in-domain), so the
music guard costs nothing and is a real assertion rather than an assumption.

Outcomes for every other slug:

| Condition | HTTP | Body |
|---|--:|---|
| all four above | 200 | canonical page |
| `active` + `supported` + `qa_only` **and** verified admin session | 200 | canonical page + persistent QA banner |
| slug is a family label in `lib/families.ts` | 308 | → `/family/<slug>` |
| anything else, including every unsupported, `hidden`, `inactive` or non-music row | **404** | branded not-found |

Fail-closed: a row loaded without `support_state` is **not** eligible, mirroring
`isMatchableProduct` (`lib/matching/match-listings.ts:732`).

**The gate and the route allow-list ship in one commit** (decision 3). There is
no intermediate deploy in which `/product` is public and ungated.

### 3.2 The canonical 14

| # | Slug | Brand | Browse | Img | Article | Asking band n≥8 | Sold pts |
|--:|---|---|:-:|:-:|:-:|:-:|--:|
| 1 | `roland-juno-106` | Roland | ✓ | ✓ | ✓ | ✓ (n=40) | 40 |
| 2 | `roland-juno-60` | Roland | ✓ | ✓ | ✓ | ✓ (n=51) | 89 |
| 3 | `roland-jupiter-8` | Roland | ✓ | ✓ | ✓ | ✓ (n=8) | 22 |
| 4 | `moog-minimoog` | Moog | ✓ | ✓ | – | ✓ (n=48) | 63 |
| 5 | `roland-re-201` | Roland | ✓ | ✓ | – | ✓ (n=27) | 20 |
| 6 | `roland-tr-808` | Roland | ✓ | ✓ | – | ✓ (n=16) | 20 |
| 7 | `roland-tr-909` | Roland | ✓ | ✓ +hero | – | ✓ (n=19) | 0 |
| 8 | `korg-ms-20` | Korg | ✓ | ✓ | – | ✓ (n=21) | 0 |
| 9 | `roland-sh-101` | Roland | ✓ | ✓ | – | ✓ (n=8, **9.2× wide**) | 0 |
| 10 | `yamaha-dx7` | Yamaha | ✓ | ✓ | – | ✓ (n=46, **8.0× wide**) | 0 |
| 11 | `rhodes-mark-i-stage-73` | Rhodes | **✗** | ✗ | – | ✓ (n=8) | 0 |
| 12 | `rhodes-mark-i-suitcase-73` | Rhodes | **✗** | ✗ | – | ✓ (n=9) | 0 |
| 13 | `wurlitzer-200a` | Wurlitzer | **✗** | ✗ | – | ✓ (n=16) | 0 |
| 14 | `rhodes-mark-ii-stage-73` | Rhodes | **✗** | ✗ | – | **✗ (n=6)** | 0 |

Band figures: matched active listings, `is_valid IS NOT FALSE`,
`price_dkk > 0`, last seen ≤ 180 days, `hasPlausibleListingPrice` applied, then
IQR-trimmed. `SELECT`, 2026-08-27.

### 3.3 The 34 private (`supported` + `qa_only`)

Not in browse, not in search, not in the sitemap, no public page. `/product/<slug>`
returns **404** to the public and **200 + QA banner** to a verified admin session.
No V1 change publishes any of them (decision 5).

### 3.4 The 14 public-but-unsupported

| Cohort | n | V1 behaviour |
|---|--:|---|
| Family labels: `gibson-les-paul`, `fender-stratocaster`, `fender-telecaster`, `fender-jazz-bass`, `fender-precision-bass`, `gibson-es-335` | 6 | `/product/<slug>` **308** → `/family/<slug>` (§4.2) |
| Held from launch: `ampex-atr-700`, `arp-2600`, `linn-electronics-linndrum`, `oberheim-ob-x`, `oberheim-ob-xa`, `rhodes-mark-i-stage-88`, `sequential-prophet-5`, `strymon-timeline` | 8 | **404**. Removed from browse, homepage and search in the same release |

Rationale: `support_state='known'` means the matcher can never add a match, so
their listing sets are frozen legacy aggregates that only decay. `gibson-les-paul`
carries **778** such listings; four rows have had no new match since May 2026
(audit F-07). Rendering them as canonical pages would be a stale price authority
(decision 13) and a false coverage claim.

---

## 4. Canonical product versus family model

### 4.1 The rule

| Concept | Aggregates listings/prices | Terminal identity | V1 source of truth |
|---|:-:|:-:|---|
| **Canonical product** | ✔ its own only | ✔ | `kg_product` row passing §3.1 |
| **Navigation family** | ✘ **never** | ✘ | `frontend/lib/families.ts` — reviewed code |
| Editorial facet | ✘ | ✘ | **not built** (deferred) |

Families are **not promoted products** (decision 7). There is no family entity in
the schema and V1 creates none: a new table in `public` is born world-readable
and world-writable until the schema-wide default-privilege **P0** is closed
(handover, *Migration and rollback package*). `lib/families.ts` mirrors
`data/klup-source-monitoring.json` in spirit — reviewed code that no runtime
surface may mutate.

```ts
// frontend/lib/families.ts  (shape; WP-2 fills the six entries)
export interface NavigationFamily {
  slug:        string   // '/family/<slug>' AND the legacy kg_product slug it supersedes
  label:       string
  brand:       string
  categoryRoot: string  // browse root slug
  children:    string[] // kg_product slugs, from klup-launch-catalogue-selection.md §6.3
  aliases:     string[] // NAVIGATION ONLY — never matcher aliases
}
export const NEVER_AGGREGATES = true as const  // structural, not a per-row flag
```

### 4.2 Family-page eligibility — exact

A `/family/<slug>` page renders **iff** `slug` is present in `lib/families.ts`.
That is the whole rule. Family pages are **not** derived from `kg_product` state
and are **not** gated on support or visibility, because a family is a navigation
concept, not a catalogue entity.

**Six families in V1**, exactly the six public rows that behave as priced
products today. Their children come verbatim from
`klup-launch-catalogue-selection.md` §6.3.

#### The child-rendering rule — binding

> **A family route renders links to canonical-eligible children only. It renders
> nothing at all for any other child.**

A child appears on a family route **iff** it passes §3.1. A `supported` +
`qa_only` child is **not rendered** — not as a link, not as a greyed card, not
as a disabled card, not in a list of names presented as catalogue depth.
Rendering an unpublished product as a product card, greyed or otherwise, would
advertise a page that returns 404 and would present private catalogue state as a
public surface. **This supersedes the greyed-children treatment proposed earlier
in this document's drafting and in the experience spec §6.1.**

Measured today:

| Family | Children in the frozen 48 | Canonical-eligible children | Rendered entries |
|---|--:|--:|--:|
| `gibson-les-paul` | 5 (`…-custom`, `…-standard-50s`, `…-standard-60s`, `…-studio`, `…-special`) | **0** | **0** |
| `fender-telecaster` | 3 (`…-thinline`, `…-custom`, `fender-american-vintage-52-telecaster`) | **0** | **0** |
| `fender-stratocaster` | 1 (`fender-american-professional-ii-stratocaster`) | **0** | **0** |
| `gibson-es-335` | 1 (`gibson-es-335-dot`) | **0** | **0** |
| `fender-jazz-bass` | **0** | **0** | **0** |
| `fender-precision-bass` | **0** | **0** | **0** |

**Every child of every family is `supported` + `qa_only`, so all six family
routes are empty in V1.**

#### What an empty family route may contain

An empty family route is a **restrained explanatory page and a demand-capture
surface**. Nothing else.

| Permitted | Forbidden |
|---|---|
| Family name, brand, category | Any child name, greyed card or "coming soon" list |
| One or two sentences explaining that the family's variants are separate markets and that Klup does not yet publish any of them | A price band, a "fra X kr" teaser, any price at all |
| The unsupported-demand control from §8.5, pre-filled with the family term, emitting `search_unsupported` + `demand_signal_submitted` | A listing feed or listing count (the 778 legacy listings on `gibson-les-paul` are never rendered) |
| A link back to `/browse` | An alert / watchlist CTA |

Copy of the permitted kind:

> **Gibson Les Paul**
> En Les Paul Custom og en Les Paul Studio er ikke det samme marked, så Klup
> slår dem ikke sammen til én pris. Vi følger flere Les Paul-varianter internt,
> men ingen af dem er offentlige endnu.
> *[Giv besked når Klup følger en Les Paul]*

#### Placement, indexing and lifecycle — binding

1. **A family route with zero canonical-eligible children is absent from the
   homepage, from `/browse`, from `/browse/[root]`, from global navigation and
   from the search index.** Its only inbound paths are the six legacy
   `/product/<family-slug>` URLs and a direct URL.
2. **The six legacy family slugs 308 to their family route**, and that route is
   `noindex,follow` while empty. A 308 into a `noindex` route is deliberate: it
   preserves the URL as a redirect target without offering an empty page to a
   crawler as catalogue depth.
3. **Excluded from `app/sitemap.ts`** while empty.
4. **A family route becomes indexable and navigable only when at least one
   canonical child is public.** At `≥1` canonical-eligible child the route drops
   `noindex`, enters the sitemap, becomes eligible for the canonical page's
   breadcrumb and may appear in the search index. The transition is driven
   entirely by `browse_visibility` in the database and requires **no code
   change and no deploy** — the gate is data.
5. Family routes **never** aggregate listings or prices, at any child count.
   That is structural (§4.1), not a function of emptiness.

Q-D5 (§20) decides only whether the `≥1`-child threshold should be higher; the
zero-child behaviour above is settled and is not a deferred question.

### 4.3 Boundary rules (reused verbatim, `klup-launch-catalogue-selection.md` §6.3)

original ≠ reissue ≠ Custom Shop recreation ≠ lower-cost sub-brand ≠ signature ≠
mk generation ≠ rack/pedal format ≠ 6-/12-string. `Squier` never navigates to a
Fender page; `Epiphone` never to a Gibson page. `335` is never a bare navigation
token (migration 054 removed it as an identifier).

---

## 5. Final page and route hierarchy

```
/                          Forside                       public   [CORRECT]
├─ promise (music scope, five marketplaces, honest coverage line)
├─ catalogue lookup field  ──────────────────────────►  /search (resolver)
├─ Kategorier              ──────────────────────────►  /browse
├─ Fulgt lige nu   (the canonical 14, supported+public) ►  /product/<slug>
├─ Nye annoncer    (recent matched listings)          ►  outbound to marketplace
└─ Sådan læser du priserne ──────────────────────────►  /om-data

/browse                    Katalog                       public   [CORRECT]
└─ /browse/[root]          Kategori                      public   [CORRECT]
   ├─ subcategory chips (server-filtered)
   └─ product grid  ─────────────────────────────────►  /product/<slug>
      shows the 10 canonical products that are taxonomy-classified

/product/[slug]            Kanonisk produktside          public iff §3.1  [CORRECT]
   14 pages · 34 admin-only · everything else 404

/family/[slug]             Navigationsfamilie      public, noindex, unlisted  [BUILD]
   6 routes · never aggregates · zero canonical-eligible children today
   renders NO children · absent from homepage, browse, nav, sitemap, search index
   reachable only via the six legacy /product 308s and a direct URL

/search                    Søg — resolver                public   [CORRECT]
   exact/alias → 302 /product · family → 302 /family · ambiguous → list
   unsupported → "følger ikke endnu" + nearest + demand event
   ✗ never a listing SERP · ✗ never calls /api/scrape

/om-data                   Hvad Klup dækker              public   [BUILD]
/privatliv                 Privatliv og data             public   [BUILD]
   processors · purposes · data categories · retention · consent withdrawal
   renders identically in every consent state (§12.4.5)
/saved  /watchlists (Alerts)  /profile                   auth     [REUSE]
/login  /signup  /auth/*                                 public   [REUSE]
/onboarding/step1..3       → 308 to /                    public   [CORRECT]
/admin/**  /intel                                        admin    [REUSE]
/sitemap.xml  /not-found                                 public   [BUILD]
```

**No URL is renamed and no slug changes** (`CLAUDE.md` §7: slugs are the primary
key for URLs and matching). Danish appears in labels, never in paths.

### 5.1 Global navigation

| # | Label (da) | Route | Change |
|--:|---|---|---|
| 1 | **Katalog** | `/browse` | promoted from position 2 |
| 2 | **Søg** | `/search` | demoted from position 1 and from the mobile centre FAB |
| 3 | **Gemt** | `/saved` | unchanged |
| 4 | **Alerts** | `/watchlists` | renamed from "Notifikationer" |
| 5 | **Profil** | `/profile` | unchanged |

Mobile centre FAB becomes **Katalog**. `SideNav` derives `active` from
`pathname` (today `/product/[slug]:138` passes `active="soeg"` and
`/browse/page.tsx:72` passes `active="hjem"` — neither is a real tab) and gains
`BottomNav`'s anonymous branching, so a first-time visitor is no longer offered
"Log ud". `MobileSearchBar` (`className="hidden md:block"`, i.e. desktop-only
despite its name) is fixed so mobile browse and product pages have a search
field.

---

## 6. V1 user journey

**The anonymous journey must complete end to end with no login** (decision 1).

```
1. ENTRY      /  (or a shared /product URL, or a crawler)
2. ORIENT     "Klup følger brugte instrumenter og studieudstyr på DBA, Finn,
               Blocket, Kleinanzeigen og Reverb." + coverage line from data
3. DISCOVER   category grid  ·  Fulgt lige nu (the 14)  ·  catalogue lookup
4. RESOLVE    /browse → /browse/[root] → card      OR   /search → 302
5. ANSWER     /product/<slug>:  band · median · n · basis · sources · as-of
6. EVIDENCE   live matched listings, each with source badge, age, per-listing
              verdict (Under typisk / Typisk / Over typisk)
7. ACT        outbound click to the seller's marketplace   (no account)
              or "Følg dette produkt" → email capture      (account created here)
```

Account creation exists at **exactly one** point: pressing *"Følg dette produkt"*.
One modal, one field, one sentence. No vertical picker, no brand starring, no
price slider (decision 17). The logged-in `/` → `/watchlists` redirect
(`middleware.ts:105`) is removed so returning users also land on the catalogue.

**Dead ends are eliminated by construction:** every card, carousel item, search
result and sitemap entry is drawn from the same §3.1 predicate, so no public
surface can link to a page that 404s.

---

## 7. Exact API and middleware contract

### 7.1 `frontend/middleware.ts`

| Change | Detail |
|---|---|
| **Posture source** | `frontend/lib/route-access.ts` (§7.7). The `PUBLIC_PREFIXES` / `PROTECTED_PREFIXES` arrays are **replaced** by one classification per routable file; `requiresAuth()` is derived from it, so middleware holds no independent list |
| **Newly public** | `/product/[slug]` and `/api/product/[slug]` (both **data-gated**), `/api/discover`; `/family`, `/om-data`, `/privatliv` are forward-declared `planned` for WP-2/3/5 |
| **Newly protected** | `/api/admin/**` and `/watchlists/[id]/edit` — both were denied by the old deny-by-default rule and had to be classified explicitly once the default flipped |
| **`/api/scrape`** | stays `public_api` in WP-1; WP-4 reclassifies it to `protected_api` (§13.3, §15.9) |
| **`/onboarding` (bare)** | no `app/onboarding/page.tsx` exists, so it is not a route and now returns a real 404 instead of `307 → /login` |
| **Retain** | the `/api/scrape` per-IP rate limiter (`middleware.ts:10-36`) — it now guards an admin-only route, which is strictly safer |
| **Retain** | `/api/browse`, `/api/brands`, `/api/price-observations`, `/api/cron/`, `/api/webhooks/`, `/login`, `/signup`, `/auth/`, `/browse`, `/search`, `/`, `/watchlists`, `/saved` |
| **Add** | six-entry 308 redirect map `/product/<family-slug>` → `/family/<family-slug>`, sourced from `lib/families.ts` |
| **Remove** | the logged-in `/` → `/watchlists` redirect |
| **Add** | matcher exclusions so `/sitemap.xml` and `/robots.txt` are not treated as protected pages (today `/sitemap.xml` returns `307 → /login`) |
| **Unchanged** | `/admin/**` and `/intel` double-check `user_preferences.is_admin` server-side |

### 7.2 `GET /api/product/[slug]`

```
1. resolve slug → kg_product joined to browse_product_projection.browse_domain
2. if slug ∈ families.ts            → 308 /family/<slug>
3. if §3.1 fails
      and NOT (supported && qa_only && verified admin session)   → 404 {error:'not_found'}
4. eligibility passed →
   product           identity, era/year, image_url/hero_image_url, attributes
   listings          matched active, is_valid IS NOT FALSE, plausible price,
                     paginated (§7.4), each carrying its band verdict
   listingTotal      the SAME count the browse card shows (§7.4)
   askingBand        §9 — or null with an explicit reason code
   soldHistory       reverb (FK join) and auctionet (ilike) LABELLED PER SOURCE
   sources           per-source monitoring + last-checked (§8)
   relatedProducts   filtered by §3.1, order preserved
```

Admin detection is server-side (`user_preferences.is_admin`), never a client
flag. `Cache-Control` for public responses stays `s-maxage=60,
stale-while-revalidate=30`; the admin `qa_only` branch is `no-store`.

### 7.3 `GET /api/browse` and `GET /api/browse/[root]`

| Rule | Detail |
|---|---|
| Filter **in SQL** | `.eq('browse_domain','music').eq('is_public', true)` and intersect with the supported-slug set (§7.5) |
| Paginate | `.order('slug').range(offset, offset+limit-1)`; deterministic ordering is `(tier_rank DESC, active_listing_count DESC, slug ASC)`, with `slug` as the total tie-break so a page boundary can never duplicate or drop a row |
| Counts | aggregate in SQL, never `.filter().length` over a truncated prefix |
| Subcategory | server-side query parameter, not a client `.filter()` over one loaded page |
| Page state | `?page=` and `?sub=` in the URL so every browse page is linkable and indexable |
| Debug | `?debug=1` keeps its **unfiltered** audit query, admin-verified in-route; the two queries are separate, never one query with a conditional filter |

### 7.4 Listing-count coherence

The browse card renders `active_listing_count` from the projection; the product
page today caps the match join at `.limit(50)` **ordered by score**, then
re-sorts by `scraped_at` and prints `listings.length`. A user clicking a card
reading "778 til salg" lands on a page reading "50 aktive annoncer". **Both
numbers must come from one count**: the API returns `listingTotal` (a SQL
`count`) and a paged `listings` array; the page shows `listingTotal` and paginates.

### 7.5 The supported-slug set — one loader, one source of truth

`browse_product_projection` has **no** `support_state` column, so every
support-aware surface would otherwise re-invent the join.
`frontend/lib/catalogue.ts` (new) owns it:

```ts
export const CANONICAL_STATUS     = 'active'
export const CANONICAL_SUPPORT    = 'supported'
export const CANONICAL_VISIBILITY = 'public'

export async function loadCanonicalSlugs(admin): Promise<Set<string>>   // 14 rows, cached 60s
export async function loadSupportedSlugs(admin): Promise<Set<string>>   // 48 rows, cached 60s
export function isCanonical(row): boolean                                // fail-closed
export type SlugRole = 'canonical' | 'family' | 'admin_only' | 'not_found'
export async function resolveSlugRole(admin, slug, isAdmin): Promise<SlugRole>
```

Fail-closed on a missing field, exactly as `isMatchableProduct` does. **No
hard-coded list of 14 slugs anywhere** — the set is derived from state on every
request so a promotion through the existing admin seam takes effect without a
deploy.

### 7.6 Routes explicitly unchanged

`/api/admin/**` (except the copy correction in §14.4) · `/api/cron/scrape`
(dormant, frozen) · `/api/watchlists` · `/api/saved-listings` ·
`/api/notification-preferences` · `/api/preferences` · `/api/brands` ·
`/api/price-history` · `/api/webhooks/auth` · `/auth/*`.


### 7.7 Route posture: explicit classification, pass-through default, mechanical guard

#### Why the default flipped

The middleware matcher runs **before** routing, so it cannot distinguish an
unknown path from a protected one. The original rule — *deny unless
allow-listed* — therefore answered `307 → /login` for every unmatched path. A
mistyped URL read as a permissions problem, `/sitemap.xml` was treated as a
protected page, and crawlers were handed a redirect where the truthful answer
was "this does not exist".

V1 inverts it: **denial is an explicit classification, and everything else
passes through to Next.js routing.** Nothing is exposed that was not already
routable — Next serves only routes that exist, an unmatched path reaches
`app/not-found.tsx` and returns a real `404`, and every route serving catalogue
data applies its own in-route predicate (§14.2: the posture is not the only
control).

**The hazard this creates is real and is named here rather than discovered
later: a newly added route is publicly reachable unless someone classifies it.**
Relying on reviewers to remember that is not a control. Hence the guard.

#### The shared authority

`frontend/lib/route-access.ts` holds **one classification per routable file**
and is imported by `frontend/middleware.ts` *and* by the completeness guard.
There is no second list. It is dependency-free — no `next/server`, no Supabase,
no DOM — so the Edge runtime and a plain Node test can both consume it.

| Class | Anonymous | Examples |
|---|---|---|
| `public_page` | reachable | `/`, `/browse`, `/browse/[root]`, `/search`, `/login`, `/watchlists`, `/saved` |
| `public_page_data_gated` | reachable, **content decided by §3.1** | `/product/[slug]`, later `/family/[slug]` |
| `protected_page` | `307 → /login` | `/profile`, `/watchlists/[id]/edit` |
| `admin_page` | `307`, then `is_admin` re-checked | `/admin/**`, `/intel` |
| `public_api` | reachable | `/api/browse`, `/api/discover`, `/api/brands`, `/api/price-observations`, `/api/scrape` *(until WP-4)* |
| `public_api_data_gated` | reachable, **rows decided by §3.1** | `/api/product/[slug]` |
| `protected_api` | `307`/`401` | `/api/watchlists`, `/api/saved-listings`, `/api/preferences`, `/api/notification-preferences`, `/api/price-history`, `/api/market-price` |
| `admin_api` | denied at the edge **and** in-route | `/api/admin/**` |
| `machine_api` | own credential, no session | `/api/cron/*` (`CRON_SECRET`), `/api/webhooks/*` |
| `framework_metadata` | reachable | `/sitemap.xml`, `/robots.txt` — WP-3 |

`requiresAuth(pathname)` is derived from the classification, so the middleware
has no independent notion of what is protected.

#### The completeness guard

`scripts/lib/wp1-route-access.test.ts` inventories the filesystem and asserts
the authority is complete. It is deterministic and derives everything from the
tree — **no expected route count is hardcoded anywhere**, because a count
passes as soon as one route is added and another deleted.

| # | Assertion |
|--:|---|
| G1 | Every routable file under `frontend/app` — `**/page.tsx`, `**/route.ts`, and the metadata routes `sitemap.ts`, `robots.ts`, `manifest.ts`, `icon.*`, `apple-icon.*`, `opengraph-image.*`, `twitter-image.*` — resolves to exactly one classification. **An unclassified route fails the test**, naming the file and the classes available |
| G2 | Route groups `(group)`, dynamic `[slug]`, catch-all `[...slug]` and optional catch-all `[[...slug]]` are normalised before matching |
| G3 | Every `protected_page`, `protected_api`, `admin_page` and `admin_api` entry resolves, through a concrete example URL, to `requiresAuth === true` — the classification must be *effective*, not merely declared |
| G4 | Every public class resolves to `requiresAuth === false` |
| G5 | A classification with no route file on disk must be marked `planned: true`, so forward declarations for later packages stay visible and honest |
| G6 | Filesystem-nonexistent URLs classify as `null` and pass through, so Next.js returns a real 404 rather than a redirect |
| G7 | Named invariants that must never regress: every `/api/admin/**` route is `admin_api`; `/watchlists/[id]/edit` is `protected_page` while `/watchlists` stays public; `/product/[slug]` and `/api/product/[slug]` are publicly reachable **and** data-gated |
| G8 | Route-level authentication remains defence in depth: the guard asserts the posture, and never that a route may therefore skip its own check |

**Origin.** WP-1's inversion silently opened 34 routes — all of
`/api/admin/**` plus `/watchlists/[id]/edit`. No data was exposed, because every
admin route independently returns `401`/`403`, but the edge layer had lapsed. It
was found by diffing the pre- and post-change posture across every route in
`app/`, not by inspection. This guard makes that diff a permanent, automated
part of the suite.

### 7.8 The independent security reference

`frontend/lib/route-posture-reference.json` — WP-1 owned, human-reviewed, and
deliberately duplicated.

**Why duplication is correct here.** The §7.7 guard proves the implementation
agrees with *itself*: it reads `ROUTE_ACCESS`, asks `requiresAuth()`, and
`requiresAuth()` reads `ROUTE_ACCESS` through `AUTHENTICATED_CLASSES`. Flip
`/api/admin/users` from `admin_api` to `public_api` and every assertion still
passes, because both sides moved together. Empty `AUTHENTICATED_CLASSES` and the
same is true. A self-consistency check cannot detect a posture downgrade.

The reference pins the **expected class, as a literal string**, for every
security-sensitive route, and the test compares it to the class the
implementation resolves — never routing that comparison through `requiresAuth()`
or `AUTHENTICATED_CLASSES`. A downgrade must therefore be made in two places,
one of which exists only to be read carefully in review.

| Assertion | Effect |
|---|---|
| Reference class == resolved class, per route | any downgrade fails, naming the route, the expected class and the actual class |
| Reference class == class resolved through the live matcher | catches a classification that is present but unreachable |
| Every discovered `/admin/**` and `/api/admin/**` route appears in the reference | catches downgrade-by-omission — deleting the entry instead of changing it |
| Session/admin expectations asserted from the reference's own class lists | holds even if `AUTHENTICATED_CLASSES` is emptied |
| Every reference route exists on disk or is explicitly `planned` | keeps the reference from rotting |

**Proven by mutation.** Each of the following was applied, observed to fail, and
reverted: `/profile` → public · `/api/price-history` → public ·
`/api/market-price` → public · `/watchlists/[id]/edit` → public ·
`/api/admin/users` → `protected_api` · `/api/admin/products` → `public_api` ·
`/api/saved-listings` → `public_api` · `AUTHENTICATED_CLASSES` emptied.

**Adding a route does not require an entry** — the §7.7 completeness guard
already forces classification. The reference covers *downgrades*, which
completeness cannot see.
---

## 8. Browse and restricted-search contract

### 8.1 Browse

- **Population:** the §3.1 canonical set ∩ `is_public` = **10 products today**.
- **Ordering:** `(tier_rank DESC, active_listing_count DESC, slug ASC)`, fully
  deterministic; `slug` breaks every tie.
- **Pagination:** `page_size = 24`, `?page=` in the URL. At 10 products page 2
  never renders — if it ever does, the projection filter is wrong, and the
  analytics event `browse_leaf_viewed { page }` will say so.
- **Counts:** every tile count, leaf count and "N produkter" string comes from
  the same SQL aggregate. Three surfaces reporting three numbers is a release
  blocker.
- **Category tiles** are illustrated only by a canonical product with an image;
  otherwise the neutral `music-gear` asset. Today `pro-audio` is illustrated by
  `ampex-atr-700` (0 listings, unsupported) and `bass-guitars` by
  `fender-jazz-bass` (a family label) — both leave the surface.
- **Danish labels** come from `frontend/lib/category-labels.ts`; production
  `kg_category.name_da` is not written (decision 14). Today Danish users read
  "Bass Guitars", "Keyboards and Synths", "Pro Audio".
- **First-run strip** on `/browse`: *"Klup følger 48 udvalgte produkter — 14 er
  offentlige i dag. Vi tilføjer flere, når vi kan følge dem ordentligt."*
  Dismissal in `localStorage`; no account, no server state.

### 8.2 Restricted search — the resolver

The contract in `klup-launch-catalogue-selection.md` §11 is adopted **verbatim**.
`/search` produces exactly one of five outcomes and never a listing list
(decision 8):

| Outcome | Behaviour | `search_resolved.resolution` |
|---|---|---|
| Canonical exact | 302 → `/product/<slug>` | `canonical_exact` |
| Accepted alias | 302 → `/product/<slug>` | `accepted_alias` |
| Family label | 302 → `/family/<slug>` | `accepted_alias` (`product_slug` null) |
| Ambiguous, or a dangerous term | list the candidates with disambiguating qualifiers; **never auto-navigate** | `disambiguation` / `dangerous_alias_blocked` |
| Unsupported / unknown | *"Klup følger ikke dette endnu."* + nearest canonical products + demand capture | `unsupported` |

**Dangerous terms** (never auto-navigate) are adopted unchanged: `Juno` ·
`Jupiter` · `Prophet` · `Rhodes` · `Fender Rhodes` · `Space Echo` · `Model D` ·
`Minimoog` (brandless) · `808` · `909` · `707` · `727` · `606` · `System 100` ·
`Poly` · `Mono` · `Source` · `Spirit` · `1176` (brandless) · `U 87` without `Ai` ·
`CL 1B` (brandless) · `SP-12` when the page is SP-1200 · `MS-20` qualified by
`Mini`/`Kit`/`FS` · `Synthesizer` · `Studio` · `Custom` · `Standard` · `Vintage` ·
`Reissue` · `Clone` · `Type` · `Style`. **G1 must read exactly 0** for the whole
release: any dangerous term that auto-navigates is a P0 correctness bug.

**Autocomplete labels carry their qualifier** so a wide band is honest at the
point of navigation: `Roland TR-808 (Rhythm Composer)` · `Rhodes Mark I Suitcase 73` ·
`Korg MS-20 (original, 1978)` · `Moog Minimoog (original)` · `Yamaha DX7 (1983)`.

### 8.3 Normalisation — a real gap

`frontend/lib/query-normalizer.ts` lower-cases, ASCII-folds (including
`ö→oe`, `ä→ae`), strips punctuation and collapses whitespace. It **does not**
treat `-`, space and nothing as equivalent inside model numbers, so
`juno106` ≠ `juno-106` ≠ `juno 106` today, and the contract requires all three to
resolve. WP-4 adds a `modelKey()` layer **on top of** `normalizeQuery`; the
existing function is not changed, because `/api/scrape` and the matcher-adjacent
paths consume it.

`frontend/lib/synonyms.ts` still ships `macmini`, `apple mac mini`, `imac`,
`macbook pro`, `airpods pro` — pre-pivot multi-vertical residue that must be
removed (decision 17). Only `'space echo' → 'roland re-201'` and `'re201' → 're-201'`
survive.

### 8.4 The index

A **build-time static artefact** — the canonical 14, their accepted aliases, the
six families and their aliases. Tens of entries, generated from the same data as
the frozen cohort and committed as reviewed code, so autocomplete needs no
database round-trip per keystroke and **cannot drift into unsupported products**.
It is regenerated by an npm script and validated in CI against live state, so a
promotion that is not accompanied by an index regeneration fails a test rather
than silently under-serving search.

### 8.5 Demand capture

Every non-resolving query emits `search_unsupported` (§12) carrying `query_norm`,
`resolution_class`, `suggested_slugs`, `suggested_count`. A single control —
*"Giv besked når Klup følger dette"* — emits `demand_signal_submitted
{ query_norm, capture_method, has_email }`. **The email address never reaches
PostHog**; `has_email` is a boolean and the address goes to Supabase through the
existing magic-link path. No `demand_signal` table is created (decision 14/15;
P0 default privileges). PostHog EU retention is finite, so a **weekly export of
the top-50 normalised unsupported terms with distinct-person counts to `data/`
is mandatory**, not optional — it is the only evidence that can ever justify
expanding past 48.

---

## 9. Price-evidence contract

### 9.1 Three sources, never merged

| Source | What it is | Coverage of the 14 | Label (da) |
|---|---|--:|---|
| Matched **active** listings | asking prices, Nordic + German + Reverb | **13 / 14** at n≥8 | *"Udbudspriser lige nu"* |
| `reverb_price_history` | **sold**, international | 6 / 14 at ≥5 points | *"Solgt på Reverb (internationalt)"* |
| `auctionet_price_history` | **sold**, `ilike` join | sparse | *"Solgt på Auctionet"* |
| `thomann_price_dkk` | new-price reference | sparse | *"Ny hos Thomann"* |

The existing chart labels **every** point "Prisdata fra Reverb" even when it came
from the `ilike` join to Auctionet (`app/product/[slug]/page.tsx:294-302` vs
`route.ts:79-87`). V1 labels per source. The Auctionet FK migration remains out
of scope.

### 9.2 The asking-price band — exact computation

```
INPUT   listing_product_match ⋈ listings
        WHERE product_id = <product>
          AND m.is_valid IS NOT FALSE          -- NULL is trusted; false is a rejection
          AND l.is_active = true
          AND l.price_dkk IS NOT NULL AND l.price_dkk > 0
          AND COALESCE(l.last_seen_at, l.scraped_at) > now() - interval '180 days'
          AND hasPlausibleListingPrice(l)      -- lib/listing-price-integrity.ts

FILTER  IQR: q1 - 1.5*(q3-q1)  ≤  price_dkk  ≤  q3 + 1.5*(q3-q1)

OUTPUT  n       = surviving count
        p25/p75 = band edges            (NOT min/max — the current route uses min/max)
        median  = headline
        sources = distinct l.source over the surviving set
        asOf    = max(COALESCE(l.last_seen_at, l.scraped_at))

RENDER GATES — all must hold, or no band is shown
        n ≥ 8                                        (decision 13; supersedes the ≥3 in route.ts:134)
        p75 / p25 ≤ 10                               (measurement G3, promoted to a render gate)
        distinct sources ≥ 1
NEVER   computed for a family · for an unsupported product · shown on a card,
        grid or SERP (the existing "price history only on /saved and product
        pages" rule extends to bands)
```

Rendered form — four elements or nothing:

```
14.200 kr            median udbudspris
11.900 – 16.400 kr   typisk spænd (p25–p75)
baseret på 23 aktive annoncer · DBA, Kleinanzeigen, Reverb
sidst set 27. august 2026
```

### 9.3 Per-listing verdict

| Position | Label (da) | Rule |
|---|---|---|
| `price_dkk < p25` | **Under typisk** | |
| p25 ≤ price ≤ p75 | **Typisk** | inclusive |
| `price_dkk > p75` | **Over typisk** | |
| no band, or no price | *(no verdict)* | never guess |

Three words. No score, no percentage, no colour beyond type weight. The
`bg-green-500` discount badge (`components/SearchResultCard.tsx:216`) is removed:
it breaks the accent rule in `frontend/CLAUDE.md`, it is the wrong green
(Tailwind `green-500`, not `#13ec6d`), and it asserts a saving against a scraped
"was" price Klup does not verify. The Kup-score stays hidden
(`SearchResultCard.tsx:236` documents why).

### 9.4 Why asking prices, with evidence

| Basis | Products of 48 | Of the canonical 14 |
|---|--:|--:|
| Asking band, n ≥ 8, plausibility + IQR | **39** | **13** |
| Asking band, n ≥ 5 | 44 | 14 |
| Any sold history (≥3 points) | 8 | 6 |
| Sold chart (≥5 points) | 8 | 6 |

The asking band answers *"er 4.500 kr en god pris?"* on 13 of 14 canonical pages;
sold history answers it on 6. That is the whole case for decision 10.

**Two width warnings inside the canonical 14**, surfaced now rather than
discovered in production: `roland-sh-101` (n=8, p25 = 1.216 kr, median = 8.686 kr,
**9.2×**) and `yamaha-dx7` (n=46, p25 = 583 kr, median = 1.476 kr, **8.0×**). Both
pass the 10× gate but their low tails look like parts, accessories or
mis-scoped matches. WP-3's acceptance criteria require a manual read of the
bottom decile of both products' matched listings before release; if pollution is
confirmed, the correct remedy is match rejection through the **existing** admin
curation surface (`/admin/product/[slug]`), not a code change and not a matcher
change.

### 9.5 Stale legacy aggregates can never appear current

Four independent mechanisms, each individually sufficient:

1. **Support gate (§3.1).** No unsupported product renders a canonical page, so
   its frozen legacy aggregate has no surface. This alone removes 778 listings on
   `gibson-les-paul`, 285 on `fender-jazz-bass`, 186 on `fender-precision-bass`.
2. **Family pages never aggregate** (§4.2) — structural, not a flag.
3. **180-day recency window** in the band input, so a band cannot be built from
   listings that stopped moving.
4. **Explicit provenance line.** Every canonical page states
   *"Klup har fulgt dette produkt siden 26. august 2026"*. Rescraping is
   freshness, not population: a legacy row keeps its NULL ingestion identity
   forever and can never gain a match, so a product's feed reflects inflow since
   activation, not the whole market. The page says so rather than implying
   completeness.

And the timestamp rule (D10): age strings use `listings.first_seen_at` when
present (35,390 of 48,858 active rows); when absent, **no age is displayed**.
`scraped_at` is never presented as listing age — the activation record documents
a single DBA run refreshing 604 of 611 rows without creating identities, which
moves `scraped_at` to now on months-old ads.

---

## 10. Empty and insufficient-data states

Every state is explicit, none is an error, and none fabricates authority
(decision 13).

| State | Trigger | Copy (da) |
|---|---|---|
| **No band — too few** | `n < 8` | *"Klup har kun set N annoncer for dette produkt — for få til at sige noget om prisen endnu."* |
| **No band — too wide** | `p75/p25 > 10` | *"Priserne for dette produkt spænder for bredt til én pålidelig pris. Se annoncerne herunder."* |
| **No listings** | 0 active matched | *"Ingen annoncer lige nu. Klup følger dette produkt på DBA, Finn, Blocket, Kleinanzeigen og Reverb. Sidst set til salg: <dato>."* — a **normal, successful** state, not `search_off`, not "ikke fundet". The alert CTA is the primary action here |
| **No article** | `attributes.description` absent | the block does not render. Never a placeholder, never a stub (decision 12) |
| **No image** | no `image_url`/`hero_image_url` | the neutral `piano` fallback (§11.2) |
| **No sold history** | `< 5` points | the chart does not render. No "0 salg registreret" |
| **Search unsupported** | resolver miss | *"Klup følger ikke <term> endnu."* + nearest canonical products + demand control |
| **Search ambiguous** | >1 candidate, or a dangerous term | the candidate set with qualifiers. Never auto-picks |
| **404** | §3.1 fails | branded `app/not-found.tsx`, correct status, links to `/browse` and `/` |
| **Error ≠ not-found** | fetch/5xx | separated. Today `app/product/[slug]/page.tsx:59-75` collapses a network failure into "Produkt ikke fundet" — a definitive false statement. Route-level `error.tsx` per segment; raw thrown strings ("Failed to load browse projection.") never reach a user |

**The duplicate empty-listings sentence** (rendered twice today, in the hero block
and the list block) is removed.

---

## 11. Content and imagery minimums

### 11.1 What V1 requires

| Asset | Minimum | Blocking? |
|---|---|:-:|
| `canonical_name`, brand, slug | present for all 14 | **yes** (already true) |
| Asking band **or** an explicit insufficient-data state | all 14 | **yes** |
| Per-product source + freshness line | all 14 | **yes** |
| Danish copy for every user-facing string | all surfaces | **yes** |
| Image | **no minimum** — fallback is sufficient | no |
| Article | **no minimum** (decision 12) | no |
| Sold-price chart | **no minimum** | no |
| Subcategory | not required for the page; required for the browse card | no |

**No content is produced, commissioned, rewritten or sourced by V1**
(`CLAUDE.md` §4: preserve, do not rebuild). Coverage across the 14 today: 3
articles, 10 images (4 without), 2 hero images.

### 11.2 Image fallback policy

```
hero_image_url  ??  image_url  ??  neutral category asset  ??  'piano' glyph
```

`hero_image_url` wins where present (editorial override, 2 of 48). The neutral
asset comes from the existing `onboarding-assets` bucket — which is why the
onboarding **route files and bucket are retained** even though steps 1–3 are
retired. No image is ever borrowed from another product, and a category tile is
never illustrated by a product Klup does not follow.

### 11.3 The four canonical products with no image

`rhodes-mark-i-stage-73`, `rhodes-mark-i-suitcase-73`, `rhodes-mark-ii-stage-73`,
`wurlitzer-200a` — the same four that lack a subcategory and are therefore not in
browse. They ship with a fallback image and a live asking band (three of the four
qualify at n≥8). They are reachable by URL, search and sitemap. This is honest:
they are followed products with real prices and no photograph.

---

## 12. Analytics events required before release

Twelve events, plus identity. All carry the super-properties below. Anything not
listed is deferred.

### 12.1 Required

| # | Event | Fires | Why it is required for V1 |
|--:|---|---|---|
| 1 | `$pageview` *(sanitised)* | every route change | `$current_url` currently carries the raw `?q=` — free-text user input into a third-party processor. Add `path_template` (`/product/[slug]`, not the slug) |
| 2 | `product_viewed` | canonical page render | the entire product-centred funnel; carries `support_state`, `browse_visibility`, `active_listing_count`, `has_image`, `has_article`, `entry_ref` |
| 3 | `price_context_shown` | product render, **band present or not** | the absence is the more interesting case; carries `has_band`, `band_low/high/median`, `band_count`, `band_width_ratio`, `history_points` |
| 4 | `listing_click_out` | outbound to a marketplace | the north star's raw input; **gains `product_slug` and `band_delta_pct`**, which today's `listing_clicked` lacks |
| 5 | `outbound_retail_click` | outbound to Thomann | starts accruing affiliate evidence from day one with a `click_id` reconciliation key (§13.3) |
| 6 | `search_submitted` | any query submitted | intent, split from outcome |
| 7 | `search_resolved` | exactly one per query | the resolver's own vocabulary; **`auto_navigated` on a dangerous term is guardrail G1 and must read 0** |
| 8 | `search_unsupported` | resolver miss | the only demand record that exists in V1 (decision 15) |
| 9 | `demand_signal_submitted` | the notify control | intensity — the strongest demand evidence at this N |
| 10 | `discovery_product_clicked` | any product card | `shelf: 'followed' \| 'recent' \| 'browse_grid' \| 'related'` |
| 11 | `browse_leaf_viewed` | `/browse/[root]` render | proves the pagination fix; `page > 1` at 10 products means the filter is wrong |
| 12 | `watch_created` | alert creation | **`origin_product_slug`** recovers product-bound intent with no schema change (D14) |

### 12.2 Identity and hygiene (all required)

- `posthog.identify(user.id)` on **every** authenticated session start, not only
  at signup — there is **no `identify()` anywhere in the codebase today**, so no
  person-level metric is currently computable.
- `posthog.reset()` on sign-out.
- **Never send an email address to PostHog** — not as distinct id, not as a
  person property, not in a URL. `has_email: true` instead (`CLAUDE.md` §7: never
  log PII).
- Super-properties on every event: `klup_schema_version=2`, `app_env`, `surface`,
  `locale`, `is_internal`, `internal_role`.
- **`NEXT_PUBLIC_POSTHOG_HOST` fails closed.** `frontend/components/PostHogProvider.tsx:10`
  currently reads `process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com'`,
  so an unset variable silently sends EU traffic to the US region. V1 removes the
  fallback entirely: an unset or non-EU host **must not initialise PostHog at
  all** (§12.4.6).
- Do not initialise PostHog when `NEXT_PUBLIC_VERCEL_ENV !== 'production'` —
  preview deploys currently emit into the production project.
- `/admin/**` and `/intel` emit **no** product events.
- Remove the hardcoded GA4 fallback id `'G-TCHJJVVWK8'` (`frontend/app/layout.tsx:35`)
  together with GA4 itself (§12.4.1).
- **Everything in §12.1 and §12.2 is non-essential and therefore consent-gated
  by §12.4.** No event in this taxonomy may be captured, buffered for later
  delivery, or written to a persistent client store before consent is granted.

### 12.3 Deferred, with reasons

`browse_category_clicked` (derivable from `$pageview` + `browse_leaf_viewed`) ·
`search_failed` (a static-index resolver has no upstream to fail) ·
`auth_completed` / extended `signup_completed` (one auth path, low marginal
value) · `listing_saved` product-context extension · impression events ·
scroll-depth · chart interaction · `search_disambiguation_selected` ·
alert-email instrumentation (**the cron is dormant — this loop cannot fire**) ·
`/go/[destination]` server-side redirect · a durable `demand_signal` table
(blocked on the P0).

**Consent and the privacy route are no longer deferred.** They were recorded as
Q-D7 in an earlier revision of this document; that deferral is **withdrawn** and
replaced by the release requirement in §12.4. Nothing in §12.1 or §12.2 may ship
without it.

### 12.4 Consent and privacy — a V1 release requirement

This section defines a **technical release boundary**. It is not legal advice, it
makes no compliance assurance, and it does not assert that any particular legal
standard is met. It states what the software must do, and what R6 must observe
before release.

**Present state, measured.** Four independent trackers initialise unconditionally
on first paint, before any user action, with no consent state anywhere in the
codebase and no privacy route in the route inventory — while
`frontend/lib/i18n.ts:80,82,246,248` already ships `termsOfService` and
`privacyPolicy` labels that link nowhere.

#### 12.4.1 Tracker inventory and per-tracker decision

Every tracker currently loaded, with an explicit V1 disposition. **No tracker may
exist in the shipped bundle without a row in this table.**

| # | Tracker | Where it loads today | Purpose | V1 decision |
|--:|---|---|---|---|
| 1 | **Google Analytics 4** (`gtag.js`) | `frontend/app/layout.tsx:35` (hardcoded fallback id `G-TCHJJVVWK8`), `:64-75`; event sender at `frontend/lib/onboarding.ts:5,44-45` | duplicate acquisition funnel, split-brain with PostHog | **REMOVED.** Its only product use is the onboarding funnel, and WP-1 retires onboarding steps 1–3. Removal deletes one processor, one cookie family and one cross-border transfer rather than gating them. The two `<Script>` tags, the hardcoded id and the `window.gtag` sender all go. |
| 2 | **PostHog** (`posthog-js`) | `frontend/components/PostHogProvider.tsx`, `frontend/components/PostHogPageView.tsx`, mounted at `frontend/app/layout.tsx:7-8,53,57-59` | the entire §12.1 product taxonomy | **RETAINED, CONSENT-GATED.** Not initialised until consent is granted. EU host enforced fail-closed (§12.4.6). |
| 3 | **Vercel Analytics** (`@vercel/analytics/next`) | `frontend/app/layout.tsx:9,76` | pageview counts already covered by PostHog `$pageview` | **REMOVED.** Redundant with tracker 2, and the measurement spec already forbids drawing behavioural conclusions from it. Removing it is strictly simpler than gating a third behavioural processor for data nobody uses. |
| 4 | **Vercel Speed Insights** (`@vercel/speed-insights/next`) | `frontend/app/layout.tsx:10,77` | Core Web Vitals (LCP), the source for guardrail G8 | **RETAINED, CONSENT-GATED.** It measures real users' sessions, so it is behavioural, not operational. G8 is therefore measured on the consenting population only, and every G8 figure must be reported with that denominator. |

Both Vercel packages are declared at `frontend/package.json:15-16`. Removing
tracker 3 removes its dependency; tracker 4 keeps its own.

**Adding any tracker not in this table is a new product-owner decision, not an
implementation detail.**

#### 12.4.2 The consent gate

1. **Nothing non-essential initialises before consent.** No script tag is
   injected, no SDK `init()` runs, no request reaches a tracking endpoint, and no
   tracking cookie or persistent client store (`localStorage`, `sessionStorage`,
   IndexedDB) is written, until consent is granted.
   **Consent-then-load, never load-then-suppress.** An SDK that loads with
   tracking "disabled" has already made the request and set its identifiers, and
   does not satisfy this rule.
2. **Pre-consent events are not buffered.** Interactions before consent are lost,
   deliberately. A queue that flushes on grant is retroactive collection of
   pre-consent behaviour.
3. **Three states**, persisted in a first-party, non-tracking store under one
   key: `granted` · `rejected` · `undecided`. **`undecided` behaves exactly as
   `rejected` for every purpose.** There is no implied, scroll-based,
   timeout-based or continued-use consent.
4. **Reject is exactly as easy as accept** — same surface, same interaction cost,
   no pre-ticked control, no dark pattern, and no "manage preferences" detour
   required in order to decline.

#### 12.4.3 Rejection must leave the product whole

> **A visitor who rejects analytics gets the complete V1 product experience.**

Every §6 journey step must work with consent `rejected`: homepage, browse,
category, canonical product page, the price band with its basis and as-of, live
listings, per-listing verdicts, outbound clicks, restricted search and all five
resolver outcomes, `/om-data`, saved listings, alert creation, and sign-in.

Two specific consequences:

- **`demand_signal_submitted` is an analytics event and is consent-gated. The
  demand-capture *control* is not.** With consent rejected, the control still
  renders, the visitor can still leave an email address, and that address still
  reaches Supabase through the existing magic-link path — that is a
  user-initiated service request, not behavioural measurement. Only the PostHog
  event is suppressed. The unsupported screen must not degrade for a rejecting
  visitor.
- **No feature, page, price, band, listing or search outcome may be withheld,
  delayed, degraded, blurred or nagged** on the basis of consent state, and there
  is no repeat prompt after a rejection in the same browser — the only route back
  is the withdrawal/grant control of §12.4.4.

#### 12.4.4 Withdrawal

- Consent is withdrawable at any time from a persistent, discoverable control on
  `/privatliv`, and from the footer of every public page.
- On withdrawal the client **stops sending immediately**, calls
  `posthog.reset()`, and clears the tracking cookies and client-store keys it set.
- Withdrawal returns the visitor to `rejected` and is durable across navigation
  and reload. Granting after a rejection is equally available.
- Consent-state changes are not themselves recorded in a behavioural system.

#### 12.4.5 The privacy route — `/privatliv`

A new public route, in the middleware allow-list (§7.1), linked from the footer
of every public page and from the consent surface. It states, in Danish,
factually and specifically — no generic template text:

| Must state | V1 content |
|---|---|
| **Active processors** | Supabase (database, auth, storage) · Vercel (hosting; Speed Insights only when consented) · PostHog EU (product analytics, only when consented) · Resend (transactional and alert email) · Cloudflare (edge, DNS) · Frankfurter (currency rates — no user data) · the five monitored marketplaces (outbound links only; Klup sends them no user data) |
| **Purpose per processor** | one plain sentence each. Analytics purposes named as *product improvement* and never bundled with service delivery |
| **Data categories** | account email; saved listings and alerts; consent state; and — only when consented — a pseudonymous person/device id, page paths (`path_template`), product slugs, normalised search terms (`query_norm`), outbound-click events and Web Vitals. **Explicitly: no raw search text, no name, no address, no payment data, no marketplace credentials, no advertising identifiers, no cross-site tracking** |
| **Retention** | account data for the life of the account and deleted on request; consent state until withdrawn or cleared; PostHog EU behavioural data at the project's configured retention, **stated as a concrete period, never "as long as necessary"**; the weekly unsupported-demand export to `data/` (aggregate `query_norm` plus distinct-person counts, no identifiers) |
| **Region** | PostHog is EU-hosted and enforced fail-closed (§12.4.6); Supabase and Vercel regions named as actually configured |
| **Rights and contact** | how to withdraw consent, how to request account deletion, and a working contact address |
| **What Klup is not** | Klup sells nothing, brokers nothing, runs no advertising, and shares no user data with the marketplaces it monitors |

Every processor, category and retention period on the shipped page is confirmed
against actual configuration before R6. **A processor that cannot be confirmed is
removed from the product, not omitted from the page.**

`/privatliv` renders identically in every consent state and is fully reachable
with consent `rejected`.

#### 12.4.6 EU host — fail closed

`frontend/components/PostHogProvider.tsx:10` currently reads
`process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com'`, so an unset
variable silently sends EU traffic to the US region. V1 replaces it with:

```
resolve host from NEXT_PUBLIC_POSTHOG_HOST
  unset                          -> DO NOT INITIALISE. no fallback host, ever.
  not on the EU host allow-list  -> DO NOT INITIALISE.
  development                    -> additionally throw, so it cannot be missed
  production                     -> initialise nothing; emit ONE operational
                                    log line server-side (§12.4.8)
```

**Silence is the failure mode. Sending to the US region is not an available
outcome, under any configuration.** The absence of an environment variable must
never widen the destination of user data.

#### 12.4.7 Raw search text must not leak through URL capture

`frontend/components/PostHogPageView.tsx:15` captures
`posthog.capture('$pageview', { $current_url: url })` with the full query string,
so `?q=<free text the visitor typed>` reaches PostHog on every search pageview.

V1 rules:

- `path_template` (`/product/[slug]`, `/search`) is the primary path property.
- `$current_url` is transmitted **only** after the query string has been reduced
  to an allow-list of non-free-text parameters (`page`, `sub`). `q` — and any
  future free-text parameter — is removed **before** the payload is constructed,
  not redacted afterwards. The raw URL must never enter a payload that is then
  sanitised.
- Search terms reach PostHog **only** as the explicit `query_norm` property on
  `search_submitted`, `search_resolved`, `search_unsupported` and
  `demand_signal_submitted`, where the value is contract-normalised and the
  capture is deliberate.
- The referrer is reduced to `referrer_host`; full referrer URLs are not sent.

#### 12.4.8 Operational logging is separate from behavioural analytics

Two channels. They never merge and never share a transport.

| | **Operational** | **Behavioural** |
|---|---|---|
| Purpose | keeping the service running: server errors, 5xx, upstream failures, rate-limit trips, misconfiguration (including §12.4.6) | understanding product usage |
| Consent | **not** consent-gated — necessary to operate the service | **consent-gated** |
| Destination | server-side and Vercel platform logs. **Never PostHog** | PostHog EU only |
| Content | route, status, error class, timing. **No `query_norm`, no person-linked product slug, no user id, no email, no IP beyond what the platform records to deliver the response** | the §12.1 taxonomy |
| Client emission | none — operational logging is server-side | client SDK, post-consent only |

The `/api/scrape` rate limiter in `frontend/middleware.ts:10-36` and the error
logging in `frontend/app/api/scrape/route.ts:32,38` are operational and stay as
they are. **Nothing operational may be routed through the analytics client to
reuse the pipe, and no analytics event may be justified as operationally
necessary.**

#### 12.4.9 Ownership and verification

**WP-5 owns this entire contract**, §12.4.1 through §12.4.8 — the consent
surface, its persistence, the withdrawal control, the privacy route, the two
tracker removals, the two consent gates, the fail-closed host resolution and the
URL sanitisation. **No other package may add, remove, gate or configure a
tracker.**

**R6 release gate — the rejected-consent path.** Release is blocked unless, with
consent `rejected` and again with consent `undecided`, a recorded network trace
of a complete §6 journey shows **zero** requests to `posthog.com`,
`*.i.posthog.com`, `googletagmanager.com`, `google-analytics.com`,
`*.google-analytics.com`, `vitals.vercel-insights.com` and `*.vercel-scripts.com`,
and **zero** cookies or client-store keys set by those origins — while every step
of the journey completes successfully. The trace is attached to the release note.
See §16.6.

---

## 13. SEO and affiliate-readiness requirements

### 13.1 SEO — required for V1

| Requirement | Detail |
|---|---|
| **SSR** | `/product/[slug]` becomes a server component shell. It is `'use client'` today and fetches after mount, so a crawler sees a skeleton. The interactive parts (save, alert modal, chart) stay as client islands. The markup is good and lifts almost verbatim — this is a server/client split, not a redesign |
| **`generateMetadata`** | per product: `<title>` = `"<canonical_name> — brugtpris og annoncer \| Klup"`, description naming the band and the marketplaces. There are **zero** `generateMetadata` exports in the repository today |
| **`metadataBase` + Open Graph + Twitter** | authored in `frontend/lib/site-metadata.ts` (WP-1) and consumed by `frontend/app/layout.tsx` (WP-5, R2). Today metadata is `{title:"Klup", description:"Kup efter kup – det er Klup", icons}`, so every shared link previews identically with no image and no mention of musical equipment |
| **Canonical URL** | `alternates.canonical` on every public page. `/family/<slug>` is canonical for itself; the six legacy `/product` URLs 308 to it, so no duplicate exists |
| **`app/sitemap.ts`** | the canonical 14 + `/browse` + each browse root + `/om-data` + `/privatliv` + `/`. **Not** the families (all six are childless and `noindex`, §4.2), **not** the 34 private, **not** the 14 unsupported. Generated from `loadCanonicalSlugs()`, so it cannot drift |
| **`app/not-found.tsx`** | branded 404 with the correct status. Today an unknown path 307s to `/login` because the middleware matcher runs before routing |
| **JSON-LD** | `Product` + `AggregateOffer` on canonical pages **only where a band exists**, with `lowPrice`/`highPrice`/`priceCurrency: "DKK"`/`offerCount` = the band's own n. Never emitted on a family page, never on a page with no band. Structured data asserting a price Klup cannot defend is worse than none |
| **`<html lang>`** | synced to the active locale; the locale toggle added to `BottomNav` (it lives only in `SideNav`, which is `hidden md:flex`, so **mobile users cannot change language at all**) |
| **`robots.txt`** | **not repo-owned** — Cloudflare serves a managed content-signals block that `Disallow: /` for GPTBot, ClaudeBot, CCBot, Google-Extended, Applebot-Extended, Bytespider, Amazonbot and meta-externalagent, with no `Sitemap:` line. V1 does **not** add `app/robots.ts` (it would be silently overridden). The ownership boundary is documented and the `Sitemap:` line is an operations follow-up |

### 13.2 Affiliate readiness

V1 does **not** monetise (no affiliate framing, no sponsored placement). It
establishes the evidence the failed Thomann application lacked:

1. anonymous visitors can see product pages (§3.1) — a reviewer currently hits a
   login wall on every product link;
2. those pages are server-rendered and indexable (§13.1);
3. every public page is musical equipment, **demonstrable from the event log**
   (`product_viewed` carries `support_state` and `browse_visibility`, and the
   canonical set is support-gated);
4. `/om-data` states the categories, the five marketplaces and the
   curated-catalogue model — the single artefact that most directly answers the
   objection that sank the application;
5. `<title>` and meta name the vertical;
6. `outbound_retail_click` accrues from day one with a `click_id`, so 30 days of
   pre-programme clicks become a credible traffic-quality argument.

Marketplace outbound (`listing_click_out`) is **never** counted as affiliate
traffic. Conflating the two would misrepresent Klup to a partner — the exact
failure mode that already cost one application.

### 13.3 `/api/scrape` — removal from the public surface

| Fact | Evidence |
|---|---|
| Exactly one caller | `app/search/page.tsx:94`; repo-wide search finds no other |
| Admin curation does **not** use it | `/api/admin/product/[slug]/scrape-platform` and `…/scrape-kleinanzeigen`, both admin-gated |
| It is a public write path | live-scrapes five marketplaces and upserts into `listings`, unauthenticated, service-role, driven by arbitrary `?q=` |

**V1 action:** remove `/api/scrape` from `PUBLIC_PREFIXES`; keep the route and
its per-IP rate limiter; keep `lib/scrapers/**` untouched. After WP-4 it has zero
callers and is reachable only with an authenticated session. This removes an
unauthenticated public write path and takes the user experience back inside the
frozen monitoring boundary. **Deleting the route is deferred** — it is a live,
rate-limited, battle-tested code path and removal earns nothing in V1.

---

## 14. Security and privacy constraints

1. **Never open the middleware gate without the data filter.** They are one
   commit (decision 3, WP-1). No deploy exists in which `/product` is public and
   ungated.
2. **Every `/api/*` catalogue route uses `getSupabaseAdmin()` and bypasses RLS.**
   The middleware allow-list is therefore the *only* access control on
   `/api/browse`, `/api/discover` and `/api/product`. Every newly public route
   must apply its own in-route eligibility predicate and must not trust the
   allow-list alone.
3. **No new table in `public`.** The schema-wide default privilege grants ALL on
   new `public` tables to `anon`/`authenticated`; 057 fixed only the nine tables
   that existed. Any new table would be born world-readable and world-writable.
   V1 creates none (decision 14).
4. **No PII to PostHog.** No email as distinct id, person property, event
   property or URL fragment. `$current_url` is built with the free-text query
   already removed, never sanitised after the fact (§12.4.7).
4a. **No non-essential tracker initialises before consent, and rejecting consent
   leaves the whole product usable** (§12.4). This is a release gate verified at
   R6 by a recorded network trace (§16.6), not a best-effort intention.
4b. **PostHog's EU host fails closed.** An unset or non-EU
   `NEXT_PUBLIC_POSTHOG_HOST` initialises nothing; there is no fallback host
   (§12.4.6). A missing environment variable must never widen the destination of
   user data.
4c. **Operational logging and behavioural analytics are separate channels** with
   separate transports and separate consent treatment (§12.4.8). Operational
   logging carries no `query_norm`, no person-linked slug, no user id and no
   email.
5. **Admin checks stay server-side.** `user_preferences.is_admin`, re-verified
   in-route. The `qa_only` branch of `/api/product/[slug]` is `no-store`.
6. **No secrets in code or chat**; no hardcoded ids — the GA4 fallback id goes
   with GA4 itself (§12.4.1).
7. **Outbound links** carry `rel="noopener noreferrer"` and the card says where
   it goes: *"Åbner hos DBA"*.
8. **No production write of any kind.** No promotion, publication,
   `browse_visibility` change, taxonomy edit, `kg_category` rename, migration,
   importer, scraper, matcher run, backfill or rescrape. No PM2 change. No Vercel
   change. The scrape cron stays disabled and `vercel.json`'s `crons` block is
   **not** removed (that would be a deployment-affecting edit); WP-2 adds a
   warning comment only.
9. **Operator truth.** `frontend/app/api/admin/products/[id]/route.ts:20-23,49-53,79-85`
   still states that `tier` *"is ALSO, today, the implicit selector four
   scrapers use"* and emits *"MONITORING EXPANDS: … this product joins those
   query sets on their next run."* That coupling was removed in 04B — all four
   scrapers resolve through `monitoredSlugs()`/`assertResolved()` against
   `data/klup-source-monitoring.json`, which is the **only** control over
   marketplace monitoring. **Wrong operator guidance on a write path is worse
   than none**: WP-2 corrects it as **copy only**. The axis mapping, the
   validation, the `intent` requirement, `dryRun` and the manifest are correct
   and are not touched.

   **The `intent` token stays `monitoring` — corrected 2026-08-28.** An earlier
   revision also instructed WP-2 to change `frontend/app/admin/products/page.tsx:73`
   from `intent:['monitoring']` to `intent:['metadata']`. **That instruction is
   withdrawn: it was incorrect and, applied on its own, breaks the admin tier
   control.** The route maps `FIELD_AXIS.tier -> 'monitoring'` and requires
   `mustDeclare = ['visibility', 'monitoring']`, so a tier PATCH declaring only
   `metadata` is refused with `400 undeclared_axis` and the tier button stops
   working. The two edits are one change or neither, and the axis mapping is
   explicitly forbidden to WP-2.

   So: **while `FIELD_AXIS.tier` is `'monitoring'` and `mustDeclare` contains
   `'monitoring'`, the caller MUST send `intent:['monitoring']`.** It is a
   declaration token for the tier axis and a historical name — it asserts no
   monitoring effect, and the operator-facing copy must say so explicitly at the
   call site and in every string the route returns. Renaming the axis to
   `metadata` on both sides is a single coherent follow-up for a package
   authorised to touch the axis mapping; note it would also drop tier out of
   `mustDeclare`, which loosens a write-path guard and is therefore a decision,
   not a tidy-up.

---

## 15. File-level implementation map

`N` = new · `C` = changed · `B` = bounded supporting edit · `F` = forbidden in V1.

**Every path is repository-relative and exact.** No glob, no brace expansion and
no shorthand appears in an ownership row: a package owns the files named here and
no others. Where a package creates additional files inside a directory it already
owns exclusively (for example a colocated client island), the directory is named
as an exclusive-ownership row and the rule is stated in the package definition.

### 15.1 WP-1 — eligibility spine

**Complete and reconciled.** Every file WP-1 writes appears here; nothing WP-1
writes appears in §15.6.

| File | Kind | Change |
|---|:-:|---|
| `frontend/lib/catalogue.ts` | N | four-axis predicate, slug-role resolver, uncached slug loaders, `CatalogueUnavailableError`, `assertSupportedCohortIsMusic` |
| `frontend/lib/public-product.ts` | N | the public DTO: allow-lists, explicit SELECTs, field-by-field construction for product, related product and listing |
| `frontend/lib/route-access.ts` | N | the shared route-access authority (§7.7), consumed by middleware and the guard |
| `frontend/lib/route-posture-reference.json` | N | the independently reviewed security reference (§7.8) |
| `frontend/lib/category-labels.ts` | N | reviewed Danish display map for taxonomy roots |
| `frontend/lib/families.ts` | N | **shape and empty export only** (WP-2 fills it) |
| `frontend/lib/site-metadata.ts` | N | `metadataBase`, OG/Twitter, music-specific title and description, for `app/layout.tsx` (WP-5) to consume |
| `frontend/app/not-found.tsx` | N | branded 404 |
| `frontend/app/product/[slug]/layout.tsx` | N | server-side eligibility gate and real HTTP 404 (§15.8) |
| `frontend/middleware.ts` | C | posture derived from `lib/route-access.ts`; `/` redirect removal; sitemap/robots matcher exclusion |
| `frontend/app/api/product/[slug]/route.ts` | C | eligibility gate, public DTO, four-axis related gate, 404-vs-503 failure model |
| `frontend/lib/browse.ts` | C | SQL filtering, deterministic ordering, `.range()` pagination, split audit query, music assertion, failure-vs-absence separation, relabelled audit counters |
| `frontend/app/api/browse/route.ts` | C | `force-dynamic`, `no-store`, 503-on-unavailable, no error-message echo |
| `frontend/app/api/browse/[root]/route.ts` | C | as above. **WP-3 keeps its bounded `?sub=`/`?page=` edit** |
| `frontend/app/api/discover/route.ts` | C | `force-dynamic`, `revalidate = 0`, `no-store`, 503-on-unavailable |
| `frontend/lib/i18n.ts` | C | complete V1 key set (DA **and** EN) for all five packages; all pre-pivot strings removed |
| `frontend/app/onboarding/step1/page.tsx` | C | 308 → `/` |
| `frontend/app/onboarding/step2/page.tsx` | C | 308 → `/` |
| `frontend/app/onboarding/step3/page.tsx` | C | 308 → `/` |

**Allowed supporting files**

| File | Why |
|---|---|
| `package.json` (repository root) | the only place `npm test` is defined. WP-1 appends its three test files to the `test` script and changes nothing else — no dependency, no other script. `frontend/package.json` is WP-5's and is untouched |
| `scripts/lib/wp1-catalogue.test.ts` | N — eligibility spine |
| `scripts/lib/wp1-route-access.test.ts` | N — route-posture completeness guard and security reference |
| `scripts/lib/wp1-public-contract.test.ts` | N — public DTO, eligibility freshness, failure model |

> **Test location.** WP-1's original brief said "new test files under
> `frontend/__tests__/`". There is no frontend test runner: `npm test` is
> `tsx --test` over `scripts/lib/*.test.ts`, and tests placed under
> `frontend/__tests__/` would never execute. The three files above therefore
> live in `scripts/lib/` alongside `baseline.test.ts` and
> `matcher-integrity.test.ts`, and are **formally authorised there**. This
> supersedes the earlier location.

### 15.2 WP-2 — families, non-canonical isolation, operator copy

| File | Kind | Change |
|---|:-:|---|
| `frontend/lib/families.ts` | C | the six family entries and their children, from `klup-launch-catalogue-selection.md` §6.3 |
| `frontend/app/family/[slug]/page.tsx` | N | family route — SSR, `noindex,follow`, unlisted while childless, canonical-eligible children only, demand control |
| `frontend/app/family/[slug]/error.tsx` | N | route error boundary |
| `frontend/middleware.ts` | B | **only** the six-entry 308 map |
| `frontend/app/api/admin/products/[id]/route.ts` | B | **only** the stale tier/monitoring prose at `:20-23,49-53`, the `consequence()` text at `:79-85` and the `axis_semantics.tier` description string. Manifest **keys** and every branch of the write path are unchanged |
| `frontend/app/admin/products/page.tsx` | B | **only** the operator-facing copy: the page description, the tier-button `title`, and a comment at the `intent` call site recording that `monitoring` is the tier axis's declaration token and carries no monitoring effect. **The `intent` value itself is NOT changed** (§14.9) |

### 15.3 WP-3 — canonical page, price evidence, SEO

| File | Kind | Change |
|---|:-:|---|
| `frontend/app/product/[slug]/page.tsx` | C | server shell, `generateMetadata`, block order, JSON-LD |
| `frontend/app/product/[slug]/layout.tsx` | **B** | **bounded hand-off from WP-1 only** — may be replaced or deleted solely by folding the gate into the server shell, under every condition in §15.8 |
| `frontend/app/product/[slug]/error.tsx` | N | error separated from not-found |
| `frontend/app/product/[slug]/loading.tsx` | N | route-level skeleton |
| `frontend/app/product/[slug]/ProductPageClient.tsx` | N | client island: save, alert modal, listing pagination |
| `frontend/app/product/[slug]/PriceHistoryChart.tsx` | N | client island: the Recharts sold-history chart |
| `frontend/lib/price-band.ts` | N | pure asking-band computation, render gates, per-listing verdict |
| `frontend/app/sitemap.ts` | N | canonical 14 + `/browse` + browse roots + `/om-data` + `/privatliv` + `/`. Adding it requires a `framework_metadata` classification in `lib/route-access.ts` (bounded edit) or the §7.7 guard fails |
| `frontend/app/om-data/page.tsx` | N | what Klup covers, which sources, what the numbers mean |
| `frontend/app/page.tsx` | C | promise, lookup field, categories, *Fulgt lige nu*, *Nye annoncer* |
| `frontend/app/browse/page.tsx` | C | tile images, Danish labels, first-run strip, URL page state |
| `frontend/app/browse/[root]/page.tsx` | C | server-side subcategory filter, `?page=`/`?sub=` URL state |
| `frontend/components/ProductCard.tsx` | C | i18n keys, listing count aligned with the product page, tier badge removed |
| `frontend/components/SearchResultCard.tsx` | C | verdict chip, `bg-green-500` removal, `PlatformBadge` "Ukendt", `first_seen_at` age, theme-safe colours, `productSlug` bridge on |
| `frontend/components/SideNav.tsx` | C | pathname-derived `active`, anonymous branching, nav order |
| `frontend/components/BottomNav.tsx` | C | Katalog centre FAB, reserved space before auth resolves, locale toggle |
| `frontend/components/MobileSearchBar.tsx` | C | breakpoint fix so it renders on mobile |
| `frontend/app/api/product/[slug]/route.ts` | B | **only** replace the price block, add `listingTotal` and `sources`, label sold history per source, filter `relatedProducts` by §3.1 |
| `frontend/app/api/browse/[root]/route.ts` | B | **only** the `?sub=` and `?page=` parameters |

### 15.4 WP-4 — restricted search

| File | Kind | Change |
|---|:-:|---|
| `frontend/app/search/page.tsx` | C | resolver UI — five outcomes, no SERP, no source chips, no sort control |
| `frontend/app/api/search/resolve/route.ts` | N | server-side resolve endpoint |
| `frontend/lib/search-resolver.ts` | N | contract implementation including the dangerous-term list |
| `frontend/lib/model-key.ts` | N | `-`/space/nothing equivalence, layered **on top of** `normalizeQuery` |
| `frontend/lib/search-index.ts` | N | typed loader for the static index |
| `frontend/lib/synonyms.ts` | C | remove the five multi-vertical entries (`macmini`, `apple mac mini`, `imac`, `macbook pro`, `airpods pro`) |
| `frontend/data/klup-search-index.json` | N | build-time index over the canonical 14 and the six families |
| `frontend/scripts/build-search-index.ts` | N | generator + CI drift check |
| `frontend/middleware.ts` | B | **only** remove `/api/scrape` from `PUBLIC_PREFIXES` |
| `frontend/app/api/scrape/route.ts` | B | **only** a header comment recording that the route is no longer public |

### 15.5 WP-5 — consent, privacy, analytics identity

| File | Kind | Change |
|---|:-:|---|
| `frontend/app/layout.tsx` | C | **exclusive owner.** Consumes `lib/site-metadata.ts`; removes GA4 (`:35`, `:64-75`) and Vercel Analytics (`:9`, `:76`); mounts `ConsentProvider` and the gated `AnalyticsRoot`; syncs `<html lang>` |
| `frontend/lib/consent.ts` | N | three-state model, first-party persistence, read/grant/withdraw API |
| `frontend/components/ConsentProvider.tsx` | N | consent context; nothing non-essential mounts beneath it while `rejected`/`undecided` |
| `frontend/components/ConsentBanner.tsx` | N | accept/reject surface with equal-cost actions |
| `frontend/components/ConsentFooterControl.tsx` | N | persistent withdraw/grant control for the public footer |
| `frontend/components/AnalyticsRoot.tsx` | N | the only mount point for PostHog and Speed Insights; renders nothing until consent is `granted` |
| `frontend/components/PostHogProvider.tsx` | C | fail-closed EU host resolution, production-only init, no US fallback |
| `frontend/components/PostHogPageView.tsx` | C | `path_template`, query-string allow-list, `referrer_host` |
| `frontend/lib/analytics.ts` | N | typed `track()`, event union, super-properties, identify/reset, internal exclusion |
| `frontend/lib/onboarding.ts` | C | remove the `window.gtag` sender (`:5`, `:44-45`) |
| `frontend/app/privatliv/page.tsx` | N | the privacy route of §12.4.5 |
| `frontend/package.json` | C | drop `@vercel/analytics` (`:15`); `@vercel/speed-insights` (`:16`) stays |

### 15.6 Forbidden in V1 — no package may touch these

| File | Why |
|---|---|
| `frontend/lib/query-normalizer.ts` | consumed by `/api/scrape` and adjacent paths — extend via `lib/model-key.ts`, never modify |
| `frontend/app/api/cron/scrape/route.ts` | dormant writer; frozen |
| `frontend/lib/scrapers/**` | scraper code is out of scope |
| `frontend/lib/matching/**` | matcher contract is frozen |
| `scripts/migrations/**` | no migration change, ever |
| `scripts/*.ts` (importers, scrapers, matcher CLIs, harness) | frozen. **Exception, explicit:** `scripts/lib/*.test.ts` is the repository's only test location and each package MAY add its own `wp<N>-*.test.ts` there. No package may modify `scripts/lib/baseline.test.ts`, `scripts/lib/matcher-integrity.test.ts` or any non-test file under `scripts/` |
| `data/klup-source-monitoring.json` | monitoring is reviewed code and is not widened |
| `data/klup-clean-product-candidates.csv`, `data/klup-music-vertical-candidate-additions.csv` | immutable sources |
| `.agents/`, `.mcp.json`, `skills-lock.json` | pre-existing; never modified, never committed |
| `docs/stage-3-experience-spec.md`, `docs/stage-3-frontend-readiness-audit.md`, `docs/stage-3-measurement-spec.md` | evidence base; preserved unchanged |

### 15.7 Contention register — every shared file has exactly one owner

| File | Sole owner | Why it is contended | Resolution |
|---|:-:|---|---|
| `frontend/app/layout.tsx` | **WP-5** | all four trackers live here (`:9,10,35,53,57-59,64-77`) **and** the `metadata` export WP-1 wants | WP-5 owns the file outright. WP-1 never opens it: it ships `frontend/lib/site-metadata.ts`, which WP-5 wires in. Site-wide metadata therefore lands at R2 rather than R1; per-page `generateMetadata` is WP-3 at R4 either way |
| `frontend/lib/i18n.ts` | **WP-1** | every package needs strings | WP-1 lands the **complete** V1 key set for all five packages up front, including consent, privacy and family-empty-state copy. WP-2/3/4/5 are read-only consumers (`t.key`) |
| `frontend/middleware.ts` | **WP-1** | WP-2 needs the 308 map, WP-4 needs the `/api/scrape` removal | WP-1 owns it. WP-2 and WP-4 make one named bounded edit each, at R3 and R5 — sequential, never concurrent with WP-1 or with each other |
| `frontend/app/api/product/[slug]/route.ts` | **WP-1** | WP-3 replaces the price block | WP-1 owns eligibility. WP-3's bounded edit is scheduled at R4, after R1 merged |
| `frontend/lib/families.ts` | **WP-1** creates, **WP-2** fills | WP-3 reads it for breadcrumbs | WP-1 lands the type and an empty export at R1; WP-2 is the only writer thereafter. WP-3 imports read-only and tolerates an empty array |
| `frontend/lib/onboarding.ts` | **WP-5** | holds the GA4 sender, while WP-1 retires the onboarding pages | WP-1 redirects `step1..3/page.tsx` only and does not open this file. WP-5 removes the `gtag` path as part of the tracker inventory |
| `frontend/lib/analytics.ts` | **WP-5** | WP-1/2/3/4 emit events | WP-5 is the only writer. Other packages import `track()` and add call sites **inside files they own** |
| `frontend/package.json` | **WP-5** | dependency removal for tracker 3 | only WP-5 changes dependencies in V1 |
| `package.json` (repository root) | **WP-1** | every package wants to register its test file | WP-1 owns the `test` script. Later packages append their own `wp<N>-*.test.ts` to it as a one-line bounded edit, scheduled in their own release. No other field may be touched |
| `frontend/app/api/browse/route.ts` | **WP-1** | fix H1 required `force-dynamic` + `no-store` + a 503 path | WP-1 owns it outright; no later package has a claim |
| `frontend/app/api/browse/[root]/route.ts` | **WP-1** | same, and WP-3 needs `?sub=`/`?page=` | WP-1 owns it. WP-3 keeps one bounded edit for the two query parameters, at R4 |
| `frontend/app/product/[slug]/layout.tsx` | **WP-1** | WP-3 owns the rest of the directory | WP-1 owns this file (§15.8). WP-3 may replace it only under the seven hand-off conditions |
| `frontend/lib/route-access.ts` | **WP-1** | every package adds routes | WP-1 owns it. WP-2/3/4/5 make classification-only bounded edits (§15.9) |
| `frontend/lib/route-posture-reference.json` | **WP-1** | security reference | WP-1 owns it. Any change is a security decision and must be justified in the PR (§7.8) |
| `frontend/lib/public-product.ts` | **WP-1** | WP-3 adds the price band to the response | WP-1 owns the DTO. WP-3 adds `askingBand` as a bounded edit at R4, and may not widen the product allow-list |

**Computed pairwise intersections of §15.1–15.5 (owned ∪ bounded):**

```
WP-1 ∩ WP-5 = ∅                                      <-- required by this amendment
WP-2 ∩ WP-3 = ∅      WP-2 ∩ WP-5 = ∅
WP-3 ∩ WP-4 = ∅      WP-3 ∩ WP-5 = ∅      WP-4 ∩ WP-5 = ∅

WP-1 ∩ WP-2 = { frontend/lib/families.ts, frontend/middleware.ts }
WP-1 ∩ WP-3 = { frontend/app/api/product/[slug]/route.ts }
WP-1 ∩ WP-4 = { frontend/middleware.ts }
WP-2 ∩ WP-4 = { frontend/middleware.ts }
```

Every non-empty intersection is a registered, sequential hand-off from the table
above — WP-1 owns the file and merges at R1; the other package makes one named
bounded edit at R3, R4 or R5. **No two packages ever hold write access to the
same file at the same time**, and `frontend/middleware.ts`'s two bounded edits
land in different releases (WP-2 at R3, WP-4 at R5).

**WP-1 ∩ WP-5 = ∅ specifically.** WP-1 writes `frontend/lib/site-metadata.ts`;
WP-5 writes `frontend/app/layout.tsx`. WP-1 writes
`frontend/app/onboarding/step1|2|3/page.tsx`; WP-5 writes
`frontend/lib/onboarding.ts`. WP-1 writes `frontend/lib/i18n.ts`; WP-5 only
reads it.


### 15.8 The product segment gate — WP-1 owned, WP-3 hand-off only

**`frontend/app/product/[slug]/layout.tsx` is owned by WP-1.**

**What it is.** A server component on the `/product/[slug]` route segment that
resolves the §3.1 four-axis predicate before the page renders, and calls
`notFound()` when it fails.

**Why WP-1 owns it.** `app/product/[slug]/page.tsx` is a client component: it
fetches `/api/product/[slug]` after mount and, on a 404, renders "Produkt ikke
fundet" **with an HTTP status of 200**. WP-1 is the package that puts `/product`
in the public route posture, so WP-1 is the package that must make the status
code true. Without this file the gate is only half-effective — no data leaks,
because the API refuses ineligible slugs, but all 3,976 ineligible slugs answer
`200` and a crawler will index them as real pages. A soft 404 on the core
surface is the precise harm the eligibility gate exists to prevent.

**What it provides, and what must never regress:**

1. the server-side canonical eligibility gate, using the **same** predicate as
   `/api/product/[slug]`, imported from `lib/catalogue.ts` and never restated;
2. a **real HTTP 404** for every ineligible slug, rendered by
   `app/not-found.tsx`;
3. the admin-only branch for `active + supported + qa_only`, resolved server-side
   from `user_preferences.is_admin`;
4. the family 308, once `lib/families.ts` carries entries.

#### The WP-3 hand-off — bounded, and conditional

WP-3 converts `page.tsx` into a server shell with `generateMetadata`. At that
point the gate belongs in the shell, and this file becomes redundant. WP-3 may
therefore replace or delete it — **as a bounded hand-off, not as ownership**,
and only if every condition below holds:

| # | Condition |
|--:|---|
| H1 | The replacement enforces the **exact four-axis predicate** — `status='active'`, `support_state='supported'`, `browse_visibility='public'`, `browse_domain='music'` — by calling `isCanonical()` from `lib/catalogue.ts`. The predicate is never inlined, re-implemented or partially applied |
| H2 | **Fail-closed** behaviour is preserved: a row missing any axis, a null row, and a failed lookup are all ineligible |
| H3 | Ineligible slugs still return a **real HTTP 404** — `notFound()`, never an in-page state with a 200, and never a redirect |
| H4 | The admin `qa_only` branch is preserved, still resolved server-side, and still `no-store` |
| H5 | The family 308 is preserved and still evaluated **before** eligibility |
| H6 | The gate still runs **before** any product data is assembled or any metadata is emitted, so an ineligible slug produces no title, no canonical link and no JSON-LD |
| H7 | **WP-3 re-runs the WP-1 route/API eligibility suite after the replacement** — `scripts/lib/wp1-catalogue.test.ts`, `scripts/lib/wp1-route-access.test.ts`, `scripts/lib/wp1-public-contract.test.ts`, and the §16.3 anonymous route sweep across all 14 canonical slugs and the four ineligible cohorts — and attaches the results to its PR. A green unit suite alone does not discharge this condition; the route sweep is the evidence |
| **M2** | **The 404 must be visibly a product 404.** `app/not-found.tsx` is generic. An ineligible product URL currently renders the site-wide not-found, which is correct in status but says nothing about the catalogue. WP-3 ships `app/product/[slug]/not-found.tsx` with segment-specific copy — Klup follows a curated catalogue, this product is not part of it, here is the catalogue — using the `notFound*` keys WP-1 landed in `lib/i18n.ts` |
| **L7** | **No client-fetch soft-404 race after the replacement.** Once `page.tsx` is a server shell, the client island must not re-fetch `/api/product/[slug]` and render its own "Produkt ikke fundet" on a 404. Two gates that can disagree is one gate too many: the server decides, the client renders. WP-3 must show that an ineligible slug produces exactly one 404 — no 200-then-flash, no client-side not-found state — and that an eligible slug performs no duplicate product fetch on mount |

If any condition cannot be met, **the layout stays** and WP-3's server shell
renders beneath it. A duplicated gate is acceptable; a missing one is not.

### 15.9 The route-access authority — `frontend/lib/route-access.ts`

**WP-1 owned.** One classification per routable file, consumed by **both**
`frontend/middleware.ts` and the §7.7 completeness guard, so the runtime posture
and the test can never diverge into two lists that disagree.

**Bounded edits by later packages**, each confined to changing or adding
classifications and nothing else:

| Package | Edit |
|---|---|
| WP-2 | classify `/family/[slug]` as `public_page` when the route file lands |
| WP-3 | classify `/om-data` (`public_page`) and `/sitemap.xml` (`framework_metadata`) |
| WP-4 | change `/api/scrape` from `public_api` to `protected_api`. **This supersedes the earlier wording "remove `/api/scrape` from `PUBLIC_PREFIXES`"** — the prefix lists no longer exist |
| WP-5 | classify `/privatliv` as `public_page` |
### 15.10 Pre-release security package — required before R6, not built in WP-1

Three **pre-existing** defects, all outside WP-1's scope and none introduced by
it. They are recorded here because R6 is the last gate before a publicly
reachable product, and because "pre-existing" is not a disposition.

| # | Finding | Requirement |
|--:|---|---|
| **S1** | Six `/api/admin/cleanup/**` routes do not call `requireAdminInRoute()`. They are denied at the edge by the `admin_api` classification, so they are not currently reachable — but the edge is one layer, and §14.2 is explicit that a route serving privileged data must apply its own check. A middleware regression would expose them. | Each of `/api/admin/cleanup`, `…/brands`, `…/inactivate`, `…/keep`, `…/merge`, `…/self-clean` calls `requireAdminInRoute()` before any read or write. Add a test that fails if an `/api/admin/**` route file omits the call |
| **S2** | `/api/webhooks/auth` is classified `machine_api` and is therefore exempt from the session gate by design — but it must then authenticate its caller itself. | Verify a shared secret or a signature over the raw body, with a constant-time comparison, before acting; reject with 401 otherwise. Escape or strictly type every value echoed into a response or a log line |
| **S3** | An unset `CRON_SECRET` must fail closed. A comparison against `undefined` can succeed when the caller also supplies nothing. | Assert the secret is configured and non-empty **before** comparing, and refuse the request if it is not. A missing secret is a 503, never an authorisation |

**Ownership.** Not WP-1, not WP-2/3/4/5. A separate, bounded security package,
scheduled before R6 and blocking it. It touches only
`frontend/app/api/admin/cleanup/**`, `frontend/app/api/webhooks/auth/route.ts`
and `frontend/app/api/cron/scrape/route.ts` — and, for S3, must not otherwise
modify the dormant cron route or change its disabled state.

---

## 16. Test plan

### 16.1 Baseline that must not regress

```bash
npm test                                     # 148 pre-existing + the WP-1 suites
                                             # (eligibility spine + §7.7 route guard)
npx tsc --noEmit -p frontend/tsconfig.json   # 0 errors
cd frontend && npm run lint                  # 4 pre-existing warnings (app/layout.tsx)
npm run typecheck                            # EXACTLY 7 pre-existing errors — an 8th is yours
bash scripts/verify-migrations-isolated.sh   # 81 PASS (unchanged — V1 touches no SQL)
npm run validate-activation                  # unchanged
```

The seven root type-check errors stay unfixed (`CLAUDE.md` §7). The four lint
warnings are in `frontend/app/layout.tsx`, which **only WP-5** edits — the count must stay 4 through every release.

### 16.2 New unit tests

| Area | Cases |
|---|---|
| `lib/catalogue.ts` | all four §3.1 conditions independently; `qa_only` + admin → allowed; `qa_only` + anonymous → 404; missing `support_state` → fail-closed; `inactive` + `supported` + `public` → 404; non-music → 404 |
| `lib/price-band.ts` | n=7 → no band; n=8 → band; the 1,325× Rhodes fixture (raw Kleinanzeigen 37M) → filtered by plausibility then IQR; `p75/p25 > 10` → no band with the width reason; single-source band; empty input; `is_valid=false` excluded; `is_valid IS NULL` **included**; 181-day-old listing excluded; verdict boundaries exactly at p25 and p75 (both inclusive) |
| `lib/families.ts` | all six slugs resolve; every child slug exists in `kg_product`; no child is also a family; no family slug is in the canonical 14; `neverAggregates` is structural |
| `lib/search-resolver.ts` | `juno106` ≡ `juno-106` ≡ `juno 106` → Juno-106; every dangerous term → **never** `auto_navigated`; `Rhodes` → disambiguation across all four Rhodes identities; `Yamaha CS-80` → `unsupported` with nearest; `Squier Strat` → never a Fender page; `MS-20 Mini` → not `korg-ms-20`; family label → `/family/<slug>` |
| `lib/browse.ts` | ordering is total (no duplicate/missing row across a page boundary); counts equal a SQL aggregate; the audit query is unfiltered while the public query is filtered |
| `lib/route-access.ts` | the §7.7 completeness guard, G1–G8. Every routable file classified; classifications effective, not merely declared; unclassified route fails; no hardcoded route count. Proven by adding a temporary unclassified fixture route and observing the failure |
| Search index | regenerated index equals live canonical state — **fails CI if a promotion is not accompanied by a regeneration** |

### 16.3 Integration / route tests

| Route | Expectation |
|---|---|
| `GET /product/roland-juno-106` (anon) | 200, SSR HTML containing the band, `<title>` naming the product |
| `GET /product/gibson-les-paul-custom` (anon) | 404 |
| `GET /product/gibson-les-paul-custom` (admin) | 200 + QA banner |
| `GET /product/macbook-pro-m3-max` (anon) | 404 |
| `GET /product/arp-2600` (anon) | 404 |
| `GET /product/gibson-les-paul` (anon) | 308 → `/family/gibson-les-paul` |
| `GET /family/gibson-les-paul` | 200, `noindex,follow`, **zero** child names in the HTML, **no** band, **no** listing feed, **no** count, **no** alert CTA, demand control present |
| `GET /api/browse` | 10 products; tile counts == leaf counts == SQL truth |
| `GET /sitemap.xml` | 200 (not 307); exactly 14 product URLs; **zero** family, private or unsupported URLs |
| `GET /nonexistent-xyz` | 404 with the branded page, **not** 307 → `/login` |
| `GET /api/scrape?q=…` (anon) | 307 → `/login` |
| `GET /search?q=juno106` | 302 → `/product/roland-juno-106` |
| `GET /search?q=rhodes` | 200 disambiguation, `auto_navigated=false` |
| `GET /search?q=yamaha%20cs-80` | 200 unsupported + nearest + demand control |

### 16.4 Data-truth assertions (read-only, CI-safe)

Run against production with `SELECT` only, as a release gate:

```
canonical set size            == 14
supported                     == 48
public                        == 28
sitemap entry count           == canonical set size
browse product count          == |canonical ∩ is_public|          (10 today)
products with a rendered band == 13 of 14                          (rhodes-mark-ii-stage-73 shows the n<8 state)
G1 dangerous auto-navigations == 0
any /product 200 for a non-canonical slug == 0
```

### 16.5 Manual pre-release checks

1. Anonymous mobile pass: `/` → category → product → outbound, no login prompt.
2. Anonymous desktop pass: shared `/product/roland-juno-106` URL → readable, correct title, correct OG preview.
3. Read the bottom decile of `roland-sh-101` and `yamaha-dx7` matched listings (§9.4).
4. Confirm `NEXT_PUBLIC_POSTHOG_HOST` is the EU host in production, and confirm that unsetting it in a scratch environment initialises **nothing** rather than falling back (§12.4.6).
5. Confirm a preview deployment emits **zero** PostHog events.
6. Confirm every one of the 12 events fires once in a staging session **with consent granted**.

### 16.6 Consent and privacy verification — R6 release gate

Automated where possible, recorded in every case, and attached to the release
note. **Any failure blocks release.**

**A. Rejected-consent network trace (the gate named in §12.4.9).**
With consent `rejected`, walk a complete §6 journey — `/` → `/browse` →
`/browse/[root]` → `/product/roland-juno-106` → outbound click → `/search`
(supported, ambiguous **and** unsupported queries) → `/om-data` → `/privatliv`.
Record the full network log and the cookie/`localStorage`/`sessionStorage`
inventory. Required result:

```
requests to posthog.com, *.i.posthog.com                         == 0
requests to googletagmanager.com, google-analytics.com, *.google-analytics.com == 0
requests to vitals.vercel-insights.com, *.vercel-scripts.com     == 0
cookies or client-store keys set by any of those origins         == 0
journey steps that failed, degraded, blurred or were withheld    == 0
```

**B. Undecided-consent trace.** Repeat A with consent `undecided` (a fresh
browser profile, no interaction with the consent surface). Identical required
result — `undecided` must behave exactly as `rejected`.

**C. Granted-consent trace.** With consent `granted`: PostHog requests go to the
**EU** host only; Speed Insights loads; **zero** requests to
`googletagmanager.com`, `google-analytics.com` or `vercel-scripts.com` analytics
endpoints, because trackers 1 and 3 are removed, not gated (§12.4.1).

**D. Withdrawal.** Grant, generate events, then withdraw. Required: sending stops
immediately, `posthog.reset()` is called, the tracker cookies and client-store
keys set under grant are cleared, and the state survives navigation and reload.

**E. Fail-closed host.** In a scratch environment, unset
`NEXT_PUBLIC_POSTHOG_HOST` and then set it to a non-EU value. Required in both
cases: **zero** PostHog network requests, one operational log line, no fallback
host, and a thrown error in development.

**F. No raw query leakage.** Search for a distinctive string
(`zzq-canary-7431`). Required: that string appears in **no** PostHog payload,
including `$current_url`, on any event. `query_norm` carries the normalised term
only, and only on the four search events.

**G. Static assertions (CI).**
- No email-typed field exists anywhere in the event-property union.
- `grep -rn "gtag\|dataLayer\|googletagmanager" frontend/app frontend/lib frontend/components` returns nothing.
- `grep -rn "@vercel/analytics" frontend/` returns nothing, and `@vercel/analytics` is absent from `frontend/package.json`.
- No tracker origin is referenced outside `frontend/components/AnalyticsRoot.tsx` and `frontend/components/PostHogProvider.tsx`.
- `'https://app.posthog.com'` appears nowhere in the repository.

**H. Privacy-route content confirmation.** Every processor, data category and
retention period on `/privatliv` is confirmed against actual configuration and
recorded, with the person who confirmed it. An unconfirmable processor is removed
from the product, not omitted from the page (§12.4.5).

**I. Rejected-consent product completeness.** With consent `rejected`, confirm by
hand: the price band and its basis render; live listings and verdicts render;
all five resolver outcomes render; the demand-capture control renders **and
accepts an email address**, which reaches Supabase while the PostHog event does
not fire; sign-in works.

**This document makes no legal assurance.** §16.6 defines the observable
technical boundary the release must clear; whether that boundary satisfies any
particular legal obligation is not determined here.

---

## 17. Release sequence

Each step is a separate deploy with its own verification. No step begins before
the previous one's exit criterion is met.

| Step | Contents | Exit criterion |
|--:|---|---|
| **R0** | Pre-implementation checkpoint (§21). No code. | Every box ticked and written down |
| **R1** | **WP-1** — the eligibility spine (atomic) | Anonymous `/` → carousel → product page works; `/product/<any non-canonical slug>` 404s; browse counts agree on all three surfaces; `npm test` + typecheck + lint baselines hold |
| **R2** | **WP-5** — consent, privacy and analytics identity | The §16.6 traces A–G pass on the deployed revision: rejected and undecided consent produce **zero** non-essential tracker requests while the journey stays whole; GA4 and Vercel Analytics are gone from the bundle; the EU host fails closed; `/privatliv` is reachable in every consent state; `identify`/`reset` work under grant. **R2 must land before R4**, because WP-3 emits events |
| **R3** | **WP-2** — families, non-canonical isolation, operator copy | Six 308s land; all six `/family/*` routes render zero children, carry `noindex,follow`, are absent from homepage, browse, nav and sitemap, and expose the demand control; the admin route no longer claims tier drives monitoring |
| **R4** | **WP-3** — canonical page, price evidence, SEO | 13 of 14 render a band with basis and as-of; `rhodes-mark-ii-stage-73` renders the n<8 state; sitemap has exactly 14 product URLs; product page is server-rendered |
| **R5** | **WP-4** — restricted search and `/api/scrape` isolation | Five resolver outcomes verified; G1 = 0; `/api/scrape` 307s for anonymous callers; no listing SERP remains |
| **R6** | Release verification | §16.4 assertions all pass; **§16.6 A–I all pass and are attached to the release note**; all 12 events observed under granted consent; manual passes complete |

WP-3 and WP-4 may be developed in parallel; **R4 deploys before R5** because
search resolves *to* product pages and a resolver pointing at an un-split page is
a worse experience than the current one.

**R2 is a hard gate, not a convenience.** From R1 onward the product is publicly
reachable, so every subsequent release ships to real anonymous visitors. The
consent boundary must therefore be in place before WP-3 and WP-4 add event
emission at R4 and R5. If WP-5 slips, R4 and R5 slip with it — shipping more
instrumentation onto an ungated tracker stack is not an available trade.

---

## 18. Rollback boundaries

**Every V1 change is code. There is nothing to roll back in the database.** No
migration, no promotion, no `browse_visibility` change, no taxonomy edit, no
monitoring change (decision 14). Rollback is `git revert` plus a deploy.

| Package | Revert blast radius | Constraint |
|---|---|---|
| WP-1 | Product pages return to being login-walled; browse returns to truncation. **Everything else must be reverted with it** — WP-2/3/4 assume the gate | **WP-1 cannot be reverted alone once R3+ has shipped.** Revert in reverse order |
| WP-2 | The six family slugs 404 instead of redirecting (WP-1's default). Safe alone | Also reverts the admin copy fix — acceptable |
| WP-3 | The product page returns to client-rendered with the sold-price band. Safe alone | Sitemap and `/om-data` disappear; no data effect |
| WP-4 | `/search` returns to the live-scrape SERP and `/api/scrape` returns to `PUBLIC_PREFIXES` | **Reintroduces the unauthenticated public write path.** Prefer forward-fixing to reverting |
| WP-5 | The consent gate, `/privatliv`, the withdrawal control and all analytics disappear, and GA4 and Vercel Analytics return ungated. Site-wide metadata reverts with it | **Not safe alone once R4 has shipped.** WP-3 and WP-4 emit events, so reverting WP-5 would restore ungated trackers on a publicly reachable product. Forward-fix instead; if a revert is unavoidable, revert R4 and R5 first |

**Hard boundaries that no rollback may cross:** never revert to a state where
`/product` is public and ungated; **never revert to a state where a non-essential
tracker loads before consent on a publicly reachable product**; never re-enable
the Vercel scrape cron; never revert into a state where an unsupported product
renders a price band.

---

## 19. Explicit non-goals

**Inherited from `CLAUDE.md` §1, not re-litigated:** a marketplace, storefront or
inventory operation; an arbitrage desk (`/intel` stays private and out of
navigation); multi-vertical coverage; a generic listing SERP; auto-bidding or
agent-assisted purchasing.

**Stage 3 V1 non-goals:**

1. No foundation, matcher, KG, scraper, monitoring or migration work. The
   `CLAUDE.md` §9 scope gate applies unchanged.
2. **No production write of any kind** — no promotion, publication, visibility
   change, taxonomy edit or category rename. Where the clean fix is a write, it
   is recorded in §20, not done.
3. **No new database object** — no demand-signal table, no family table, no
   materialised view, no column. The P0 default-privilege defect makes new
   `public` tables unsafe.
4. No re-enabling of the Vercel scrape cron; no user-triggered scraping.
5. No widening of the catalogue or of monitoring. The frozen 48 stand; the
   monitored sets stay 30/28/28/28 (decision 18).
6. No content production — no new articles, no new or regenerated images, no
   rewritten product copy, no page redesign beyond block order.
7. No parallel admin tooling. The promotion seam and curation surface are the
   only write paths and are reused as-is.
8. No URL renaming, no slug changes, no locale removal.
9. No Kup-score reveal, no personalisation, no recommendations, no editorial
   facets, no brand pages, no comparison tables, no price-drop alerts.
10. No monetisation surface — no affiliate parameters, no sponsored placement,
    no "sell your gear" flow. §13.2 builds *evidence*, not revenue.
11. No A/B testing infrastructure (measurement §18: nothing below ~300
    qualifying sessions/week can separate a real effect from a coin flip).
12. No archived template for the eight held-from-launch rows (D2).
13. No migration of the 123 existing free-text watchlists (D14).
14. No greyed, disabled or "coming soon" rendering of `qa_only` children on
    family routes, and no family route in the homepage, browse, navigation,
    sitemap or search index while it has zero canonical children (§4.2).

> **Removed from this list.** An earlier revision listed "no consent banner or
> privacy-policy route in V1". That is no longer a non-goal: consent gating, the
> withdrawal control and `/privatliv` are **V1 release requirements** under
> §12.4, verified at R6 by §16.6.

---

## 20. Deferred product-owner decisions that genuinely remain

Only decisions that V1 cannot make for itself. Everything the eighteen given
decisions already settle has been removed.

| # | Decision | Why it cannot be made here | Blocks |
|---|---|---|---|
| **Q-D1** | **Assign subcategories to the 13 `missing_subcategory` supported products** (4 canonical, 9 private) | Production write + taxonomy judgement | Browse coverage. Four canonical products have a live page and no browse card until this happens |
| **Q-D2** | Should the eight held-from-launch public rows get an **archived template**, or stay 404? | Product judgement about preserving identity vs. surface minimalism | Nothing in V1 (404 is complete and safe) |
| **Q-D3** | **Depublish** the six family rows and the eight held rows through the promotion API? | Permanent catalogue decision + production write | Nothing in V1 (the 308 and the 404 cover it); needed for a clean end state |
| **Q-D4** | **Which of the 34 private products get published, and in what order?** 9 lack an image, 13 lack a subcategory, 31 lack an article | Editorial and commercial judgement; publication is irreversible in practice | The size of the public catalogue after V1, and whether family pages ever gain a linkable child |
| **Q-D5** | Should the indexable/navigable threshold be **higher than one** canonical child? | SEO/editorial judgement | Nothing in V1. The zero-child behaviour is settled (§4.2); the code lifts `noindex` and lists the route at ≥1 canonical-eligible child unless told otherwise |
| **Q-D6** | Correct `kg_category.name_da` in production, or keep the code display map permanently? | Production write | Cosmetic in V1; permanent afterwards |
| **Q-D7** | ~~Consent gate and privacy route~~ — **withdrawn as a deferral.** Consent gating, withdrawal and `/privatliv` are now V1 release requirements (§12.4), owned by WP-5 and verified at R6 (§16.6). The id is retained, not reused, so earlier references resolve | — | Nothing. What remains open is only the **terms-of-service** page, which is separate from privacy and is not required for the V1 journey |
| **Q-D8** | Does the **EN locale** stay first-class, or does Klup become Danish-only with EN best-effort? | Market decision | Copy volume in every later package |
| **Q-D9** | Should **`qa_only` pages be publicly visible with an "under opbygning" banner** instead of admin-only? | Trades honesty-of-coverage against having more to show | §3.3 |
| **Q-D10** | **The 123 legacy free-text watchlists** — migrate to product alerts, retire, or run both? Note `/api/cron/scrape`, which serves them, is disabled and conflicts with the PM2 dba path | User-facing commitment + the unresolved ingestion-path decision | Alert strategy beyond V1 |
| **Q-D11** | Is **48 products (14 public) enough to launch publicly**, or does launch wait for promotions? | Launch judgement | Timing, not design |
| **Q-D12** | **The `/api/cron/scrape` ingestion-path decision** — should watchlist ingestion route through the staging/promotion path? | Design decision, not an operational toggle | The alert loop, and half of the "does anyone return?" question |
| **Q-D13** | Is the **monitoring/support overlap** acceptable to leave as is — 16 of 30 monitored slugs are products the matcher can never match (§2.4)? | Operations/roadmap decision | Nothing in V1; it is wasted scraper budget, not a defect |

---

## 21. Work packages

Five packages. Primary file ownership is non-overlapping **at the time each
package runs**. A `B` (bounded supporting edit) names the exact lines a package
may touch in a file owned by another package, and is only ever scheduled after
that package has merged.

---

### WP-1 — Eligibility spine: public access, data gate, browse correctness, language

**This is the atomic package. It is not divisible.** Decision 3 requires the
gate and the allow-list in one commit, and §6 requires that no public surface can
link to a page that 404s — which means the browse and discover projections must
be filtered in the same release.

| | |
|---|---|
| **Files owned (exclusive, exact)** | `frontend/lib/catalogue.ts` (N) · `frontend/lib/category-labels.ts` (N) · `frontend/lib/families.ts` (N — shape and empty export only) · `frontend/lib/site-metadata.ts` (N) · `frontend/app/not-found.tsx` (N) · `frontend/middleware.ts` · `frontend/app/api/product/[slug]/route.ts` · `frontend/lib/browse.ts` · `frontend/lib/i18n.ts` · `frontend/app/api/discover/route.ts` · `frontend/app/onboarding/step1/page.tsx` · `frontend/app/onboarding/step2/page.tsx` · `frontend/app/onboarding/step3/page.tsx` |
| **Allowed supporting** | `scripts/lib/wp1-catalogue.test.ts`, `scripts/lib/wp1-route-access.test.ts`, `scripts/lib/wp1-public-contract.test.ts` (N) · `package.json` (repository root) — **only** appending those three files to the `test` script · `frontend/tsconfig.json` (path alias only, if genuinely required). **Corrected 2026-08-28:** this row said "new test files under `frontend/__tests__/`", which §15.1 supersedes — `npm test` is `tsx --test` over `scripts/lib/*.test.ts` and nothing under `frontend/__tests__/` would ever execute |
| **Forbidden (exact)** | `frontend/app/layout.tsx` (**WP-5 owns it**) · `frontend/lib/onboarding.ts` (**WP-5**) · `frontend/lib/analytics.ts` (**WP-5**) · `frontend/components/PostHogProvider.tsx` · `frontend/components/PostHogPageView.tsx` · `frontend/package.json` · `frontend/app/product/[slug]/page.tsx` · `frontend/app/page.tsx` · `frontend/app/browse/page.tsx` · `frontend/app/browse/[root]/page.tsx` · `frontend/app/search/page.tsx` · `frontend/app/api/scrape/route.ts` · `frontend/app/family/[slug]/page.tsx` · `frontend/components/ProductCard.tsx` · `frontend/components/SearchResultCard.tsx` · `frontend/components/SideNav.tsx` · `frontend/components/BottomNav.tsx` · `frontend/components/MobileSearchBar.tsx` · `frontend/lib/price-band.ts` · `frontend/lib/query-normalizer.ts` · `frontend/lib/synonyms.ts` · `frontend/lib/matching/**` · `frontend/lib/scrapers/**` · `frontend/vercel.json` · `scripts/` **except its own `scripts/lib/wp<N>-*.test.ts`** · `data/**` · `.agents/` · `.mcp.json` · `skills-lock.json` |
| **Dependencies** | None. First. |
| **Parallel?** | **No.** WP-5 was parallel in an earlier revision; §12.4 gives WP-5 exclusive ownership of `frontend/app/layout.tsx`, and R1 must be the first deploy, so WP-1 runs alone |
| **Integration order** | 1st (R1) |

**Scope.** `lib/catalogue.ts` (§7.5) · the §3.1 gate in `/api/product/[slug]`
with the admin `qa_only` branch · middleware allow-list add (`/product`,
`/api/product`, `/api/discover`, `/family`, `/api/family`, `/om-data`,
`/privatliv`) and removal (`/api/scrape` stays for WP-4; `/onboarding` special
case goes), the `/` → `/watchlists` redirect removal and the sitemap/robots
matcher exclusion · `lib/browse.ts` SQL filtering, deterministic ordering,
`.range()` pagination and SQL counts with the audit query split out · the
**complete** V1 i18n key set in DA **and** EN for all five packages — including
the consent, privacy and family-empty-state copy WP-5 and WP-2 will consume —
with every pre-pivot string removed · the Danish category display map ·
`lib/site-metadata.ts` (**not** `app/layout.tsx`) · the branded 404 · onboarding
steps 1–3 redirecting to `/`.

**Acceptance tests.**
1. Anonymous `GET /product/roland-juno-106` → 200; `/product/arp-2600`,
   `/product/gibson-les-paul-custom`, `/product/macbook-pro-m3-max` → 404.
2. Admin `GET /product/gibson-les-paul-custom` → 200.
3. `GET /api/browse` returns 10 products; root tile counts == leaf counts == SQL
   truth; `linn-electronics-linndrum` is **absent** (unsupported), and no count
   is derived from a truncated prefix.
4. `GET /api/discover` (anon) → 200; the carousel contains only canonical
   products (no `arp-2600`, no `gibson-les-paul`, no `sequential-prophet-5`).
5. `GET /nonexistent-xyz` → 404 branded, not 307.
6. No Danish or English pre-pivot string remains: `grep -ri "iphone\|sofa\|cykel\|Søg efter alt\|Search for anything" frontend/lib/i18n.ts` is empty.
7. `lib/i18n.ts` carries every key WP-2/3/4/5 will consume — asserted by a test
   that reads the key list from this document's §12.4 and §4.2 copy requirements.
8. Baselines hold: 148 tests · 0 frontend TS errors · **4** lint warnings ·
   7 root TS errors. WP-1 does not open `app/layout.tsx`, so the four warnings
   are untouched by construction.
9. `git diff --name-only` intersected with the forbidden list is empty.

**Commit message**
```
Stage 3 WP-1: gate canonical product pages and make them public

Adds lib/catalogue.ts as the single eligibility authority (active +
supported + public + music), applies it in /api/product/[slug], and adds
/product, /api/product and /api/discover to PUBLIC_PREFIXES in the same
change so the gate and the allow-list can never ship apart.

Filters and paginates the browse projection in SQL (it was unbounded and
truncated at the PostgREST 1,000-row cap, producing three different public
counts), removes the logged-in / -> /watchlists redirect, adds a branded
404, retires the multi-vertical onboarding steps, and replaces the
pre-pivot copy with music-specific DA/EN strings covering every later
package.

Site metadata lands in lib/site-metadata.ts rather than app/layout.tsx:
WP-5 owns that file, because all four trackers are mounted in it.

No production write, no migration, no schema change.
```

---

### WP-2 — Catalogue truth: navigation families, non-canonical isolation, operator copy

| | |
|---|---|
| **Files owned (exclusive, exact)** | `frontend/lib/families.ts` (content — WP-1 created the empty shape) · `frontend/app/family/[slug]/page.tsx` (N) · `frontend/app/family/[slug]/error.tsx` (N) |
| **Allowed supporting (bounded, exact)** | `frontend/middleware.ts` — **only** the six-entry 308 map · `frontend/lib/route-access.ts` — **only** dropping `planned: true` from the `/family/[slug]` classification once the route file exists (§15.9; the §7.7 guard fails otherwise) · `frontend/app/api/admin/products/[id]/route.ts` — **only** the prose at `:20-23,49-53`, the `consequence()` text at `:79-85` and the `axis_semantics.tier` description string · `frontend/app/admin/products/page.tsx` — **only** operator-facing copy, **not** the `intent` value (§14.9) · `package.json` (repository root) — **only** appending `scripts/lib/wp2-families.test.ts` to the `test` script · `scripts/lib/wp2-families.test.ts` (N) · `scripts/lib/wp1-catalogue.test.ts` — **only** the `families:` block that pinned `NAVIGATION_FAMILIES.length === 0`, an R1→R3 intermediate state that WP-2 ends by definition |
| **Forbidden (exact)** | Any `frontend/middleware.ts` change beyond the 308 map · the admin route's axis mapping, validation, `intent` requirement, `dryRun` or manifest logic · **the `intent` value at `frontend/app/admin/products/page.tsx:73`** (§14.9) · **`frontend/vercel.json` entirely** — it is a deployment input and Stage 3 changes none; the `crons` block is not removed and no property is added · `frontend/app/layout.tsx` · `frontend/lib/i18n.ts` · `frontend/lib/analytics.ts` · `frontend/lib/catalogue.ts` · `frontend/lib/browse.ts` · `frontend/lib/price-band.ts` · `frontend/app/product/[slug]/page.tsx` · `frontend/app/page.tsx` · `frontend/app/browse/page.tsx` · `frontend/app/browse/[root]/page.tsx` · `frontend/app/search/page.tsx` · `frontend/components/**` · `data/klup-source-monitoring.json` · `scripts/` **except its own `scripts/lib/wp<N>-*.test.ts`** · `.agents/` · `.mcp.json` · `skills-lock.json` |
| **Dependencies** | WP-1 merged (needs `lib/families.ts` shape and `resolveSlugRole`) |
| **Parallel?** | Yes — with WP-3, WP-4 and WP-5 |
| **Integration order** | 3rd (R3) |

**Scope.** The six family entries with children from
`klup-launch-catalogue-selection.md` §6.3 · the family template: name, brand,
category, the "why this is not one price" sentence, children as links **iff**
§3.1 passes and **omitted entirely otherwise** (no greyed cards, no child
names), `noindex,follow` plus absence from homepage, browse, navigation,
sitemap and search index while zero children are canonical-eligible, and the
§8.5 demand control on the empty state · the six 308s · correcting the admin
monitoring copy (§14.9), as copy only.

**Acceptance tests.**
1. `GET /product/gibson-les-paul` → 308 → `/family/gibson-les-paul`; same for the other five.
2. `/family/gibson-les-paul` renders **zero** children — `curl` finds no occurrence of `les-paul-custom`, `les-paul-studio`, `les-paul-special`, `standard-50s` or `standard-60s` in the HTML; **no** band, **no** listing feed, **no** listing count, **no** alert CTA; `robots` = `noindex,follow`; the demand control is present.
3. `/family/fender-jazz-bass` renders the "no supported variants yet" state.
4. Unit test: every child slug in `families.ts` exists in `kg_product`; no child is a family; no family slug is in the canonical 14.
5. Publishing a child in a **test fixture** turns it into a link and lifts `noindex` — with no code change.
6. `grep -n "implicit selector\|MONITORING EXPANDS" frontend/app/api/admin/products/\[id\]/route.ts` is empty; `FIELD_AXIS`, `mustDeclare`, `dryRun`, `intent` validation and the manifest keys are byte-identical apart from the corrected strings.
7. `frontend/vercel.json` is **byte-identical to the integration base**: the `crons` block is present and no property has been added.
8. `/admin/products` still changes a tier successfully — the PATCH declares `intent:['monitoring']` and is not refused with `undeclared_axis` (§14.9).

**Commit message**
```
Stage 3 WP-2: navigation families, and stop family labels acting as products

Adds lib/families.ts (reviewed code, not a table — the P0 default-privilege
defect makes new public tables unsafe) and /family/[slug], and redirects the
six public family-label rows there with a 308. Family pages never aggregate:
no band, no listing feed, no count, no CTA. Every child of every family is
currently supported+qa_only, so all six routes render no children at all,
carry noindex, stay out of the homepage, browse, navigation and sitemap, and
offer only restrained copy plus unsupported-demand capture. They become
indexable and navigable automatically, with no deploy, once a canonical
child is published.

Also corrects the promotion API's monitoring consequence text, which still
claims tier is the scraper selector — that coupling was removed in 04B.

No production write, no visibility change, no monitoring change.
```

---

### WP-3 — Canonical product page: SSR, asking-price evidence, states, SEO

The largest package and the critical path after WP-1.

| | |
|---|---|
| **Files owned (exclusive, exact)** | `frontend/app/product/[slug]/page.tsx` · `frontend/app/product/[slug]/error.tsx` (N) · `frontend/app/product/[slug]/loading.tsx` (N) · `frontend/app/product/[slug]/ProductPageClient.tsx` (N) · `frontend/app/product/[slug]/PriceHistoryChart.tsx` (N) · `frontend/lib/price-band.ts` (N) · `frontend/app/sitemap.ts` (N) · `frontend/app/om-data/page.tsx` (N) · `frontend/app/page.tsx` · `frontend/app/browse/page.tsx` · `frontend/app/browse/[root]/page.tsx` · `frontend/components/ProductCard.tsx` · `frontend/components/SearchResultCard.tsx` · `frontend/components/SideNav.tsx` · `frontend/components/BottomNav.tsx` · `frontend/components/MobileSearchBar.tsx`<br><br>WP-3 may add further colocated client islands under `frontend/app/product/[slug]/`. It does **not** own `frontend/app/product/[slug]/layout.tsx`, which is WP-1's (§15.8), nor `frontend/lib/route-access.ts` (§7.7) |
| **Allowed supporting (bounded)** | `frontend/app/api/product/[slug]/route.ts` — **only** replace the price block with `askingBand`, add `listingTotal` and `sources`, and label sold history per source (`relatedProducts` is already gated by WP-1) · `frontend/app/api/browse/[root]/route.ts` — **only** the `?sub=` and `?page=` parameters · `frontend/app/product/[slug]/layout.tsx` — **only** the §15.8 hand-off · `frontend/lib/route-access.ts` — **only** adding `framework_metadata` classifications for `app/sitemap.ts` and any other metadata route it introduces |
| **Forbidden (exact)** | The §3.1 gate itself · `frontend/lib/route-access.ts` · `frontend/lib/route-posture-reference.json` · widening `PUBLIC_PRODUCT_FIELDS` in `frontend/lib/public-product.ts` · `frontend/lib/catalogue.ts` · `frontend/lib/browse.ts` · `frontend/lib/families.ts` · `frontend/lib/i18n.ts` · `frontend/lib/analytics.ts` · `frontend/middleware.ts` · `frontend/app/layout.tsx` · `frontend/app/search/page.tsx` · `frontend/app/api/search/resolve/route.ts` · `frontend/app/family/[slug]/page.tsx` · `frontend/components/PostHogProvider.tsx` · `frontend/components/PostHogPageView.tsx` · `frontend/components/ConsentBanner.tsx` · `frontend/components/AnalyticsRoot.tsx` · `frontend/package.json` · any `attributes`, image or article content · `frontend/lib/matching/**` · `scripts/` **except its own `scripts/lib/wp<N>-*.test.ts`** · `data/**` · `.agents/` · `.mcp.json` · `skills-lock.json` |
| **Dependencies** | WP-1 merged. Reads `frontend/lib/families.ts` for the breadcrumb (tolerates it empty). Emits events through WP-5's `frontend/lib/analytics.ts`, so **R2 must deploy before R4** |
| **Parallel?** | Yes — developed alongside WP-2, WP-4 and WP-5 |
| **Integration order** | 4th (R4) |

**Scope.** Server/client split with `generateMetadata` and `Product`/`AggregateOffer`
JSON-LD (band-present pages only) · block order: breadcrumb → identity →
**the answer** → image → freshness & sources → listings → alert CTA → sold
history → editorial → family strip · `lib/price-band.ts` per §9.2 with the render
gates and the three-word verdict · listing pagination with a coherent
`listingTotal` · error separated from not-found · sitemap · `/om-data` ·
homepage rebuild (promise, lookup field, categories, *Fulgt lige nu*,
*Nye annoncer*) · browse URL state, tile images and the first-run strip · card
fixes (green badge, `PlatformBadge` "Ukendt", `first_seen_at` age, theme-safe
colours) · nav fixes (pathname-derived `active`, anonymous branching, mobile
search, Katalog FAB) · removal of the tier badge, the duplicated empty sentence
and the English headings.

**Acceptance tests.**
1. `/product/roland-juno-106` is server-rendered: `curl` returns the band, the
   median, `n`, the basis and the as-of in the HTML, with no JS.
2. 13 of the 14 render a band; `rhodes-mark-ii-stage-73` renders the `n < 8`
   state; no product renders a band from fewer than 8 listings or wider than 10×.
3. The Rhodes 37M-DKK fixture produces **no** band and **no** exception.
4. `<title>`, description, canonical and OG are per-product.
5. `/sitemap.xml` → 200 with exactly 14 product URLs and zero family, private or
   unsupported URLs.
6. A product with 0 listings renders the "Ingen annoncer lige nu" state with the
   alert CTA as the primary action.
7. The card count and the page count are equal for all 14.
8. No `bg-green-500` anywhere; `grep -rn "bg-green-500" frontend/` is empty.
9. Mobile: the price answer is above the fold; a search field exists on
   `/browse` and `/product`.
10. Manual: bottom-decile read of `roland-sh-101` and `yamaha-dx7` (§9.4),
    recorded in the PR.

**Commit message**
```
Stage 3 WP-3: server-render the canonical page and answer the price question

Splits /product/[slug] into a server shell with generateMetadata, canonical
URLs and Product/AggregateOffer JSON-LD, keeping save, alert and chart as
client islands. Replaces the sold-price band (Reverb history, n>=3, present
on 8 of 48 products) with an asking-price band computed from Klup's own
matched active listings: plausibility filter, IQR trim, n>=8, p25-p75 with
the median, basis, source list and as-of. 13 of the 14 canonical products
now answer "er det en god pris?"; sold history becomes a labelled secondary
block.

Adds the sitemap and /om-data, rebuilds the homepage around the catalogue,
puts browse page and subcategory state in the URL, and fixes the card
defects (green badge, DBA provenance fallback, scrape-vs-listing age).

No production write, no content change.
```

---

### WP-4 — Restricted search, demand capture, `/api/scrape` isolation

| | |
|---|---|
| **Files owned (exclusive, exact)** | `frontend/app/search/page.tsx` · `frontend/app/api/search/resolve/route.ts` (N) · `frontend/lib/search-resolver.ts` (N) · `frontend/lib/model-key.ts` (N) · `frontend/lib/search-index.ts` (N) · `frontend/lib/synonyms.ts` · `frontend/data/klup-search-index.json` (N) · `frontend/scripts/build-search-index.ts` (N) |
| **Allowed supporting (bounded, exact)** | `frontend/middleware.ts` — **only** removing the `/api/scrape` entry from `PUBLIC_PREFIXES` · `frontend/app/api/scrape/route.ts` — **only** an added header comment |
| **Forbidden (exact)** | `frontend/lib/query-normalizer.ts` (extend via `frontend/lib/model-key.ts`, never modify — `/api/scrape` and adjacent paths consume it) · deleting `frontend/app/api/scrape/route.ts` or anything in `frontend/lib/scrapers/**` · the rate limiter at `frontend/middleware.ts:10-36` · `frontend/lib/i18n.ts` · `frontend/lib/analytics.ts` · `frontend/lib/catalogue.ts` · `frontend/lib/price-band.ts` · `frontend/lib/families.ts` · `frontend/app/layout.tsx` · `frontend/app/product/[slug]/**` (WP-3's, except `layout.tsx` which is WP-1's) · `frontend/app/browse/**` · `frontend/app/family/**` · `frontend/components/**` · `data/klup-source-monitoring.json` · `frontend/lib/matching/**` · `scripts/` **except its own `scripts/lib/wp<N>-*.test.ts`** · `.agents/` · `.mcp.json` · `skills-lock.json` |
| **Dependencies** | WP-1 (canonical slug loader), WP-2 (family entries for the index) and WP-5 (`track()` for the demand events) |
| **Parallel?** | Yes — developed alongside WP-2, WP-3 and WP-5, but **deploys after WP-3** |
| **Integration order** | 5th (R5) |

**Scope.** The five-outcome resolver per §8.2 · the dangerous-term list ·
`modelKey()` for `-`/space/nothing equivalence · autocomplete labels carrying
their qualifiers · the build-time static index over the 14 + 6 families with a CI
drift test · the unsupported screen with nearest-product suggestions and the
"Giv besked" control · removal of the source chips, the sort control, the listing
grid, the free-text "Opret overvågning" button and the *"Vi søger på {platforms}
samtidig"* subtext · removal of the five multi-vertical synonyms ·
`/api/scrape` off the public path.

**Acceptance tests.**
1. `juno106`, `juno-106`, `juno 106`, `JUNO 106` all → 302 `/product/roland-juno-106`.
2. Every dangerous term produces `auto_navigated=false`. **G1 = 0**, asserted as
   a test, not a metric.
3. `rhodes` → disambiguation listing all four Rhodes identities with qualifiers.
4. `les paul` → 302 `/family/gibson-les-paul`.
5. `yamaha cs-80` → unsupported + nearest + demand control; emits
   `search_unsupported`; the notify control emits `demand_signal_submitted` with
   **no** email in the payload.
6. `squier strat` never resolves to a Fender page.
7. `/search` issues **zero** requests to `/api/scrape`; anonymous
   `GET /api/scrape?q=x` → 307 → `/login`.
8. The regenerated index equals live canonical state (CI drift test).
9. No listing grid, no source chips and no sort control remain on `/search`.

**Commit message**
```
Stage 3 WP-4: replace the live-scrape SERP with a catalogue resolver

/search now resolves against a build-time index of the supported catalogue
and the six navigation families, per the supported-search contract in
klup-launch-catalogue-selection.md §11: exact and alias hits navigate,
families navigate to /family, ambiguous and dangerous terms show the
candidate set and never auto-navigate, and unsupported queries get an
honest message, the nearest followed products and a PostHog demand event.

Adds model-key normalisation so TR-808 / TR 808 / TR808 are equivalent
(query-normalizer is left untouched — /api/scrape consumes it), removes the
pre-pivot Apple synonyms, and takes /api/scrape out of PUBLIC_PREFIXES.
That endpoint was the only unauthenticated public write path in the app and
its sole caller was this page; the rate limiter stays.

No demand-signal table (P0 default privileges), no monitoring change.
```

---

### WP-5 — Consent, privacy and analytics identity

**WP-5 owns the whole of §12.4.** It is the only package permitted to add,
remove, gate or configure a tracker, and it is the only owner of
`frontend/app/layout.tsx`.

| | |
|---|---|
| **Files owned (exclusive, exact)** | `frontend/app/layout.tsx` · `frontend/lib/consent.ts` (N) · `frontend/components/ConsentProvider.tsx` (N) · `frontend/components/ConsentBanner.tsx` (N) · `frontend/components/ConsentFooterControl.tsx` (N) · `frontend/components/AnalyticsRoot.tsx` (N) · `frontend/components/PostHogProvider.tsx` · `frontend/components/PostHogPageView.tsx` · `frontend/lib/analytics.ts` (N) · `frontend/lib/onboarding.ts` · `frontend/app/privatliv/page.tsx` (N) · `frontend/package.json` |
| **Allowed supporting** | `scripts/lib/wp5-*.test.ts` (N) · `package.json` (repository root) — **only** appending its own test file to the `test` script · `frontend/package-lock.json` (regenerated by the dependency removal only). **Corrected 2026-08-28:** this row said "new test files under `frontend/__tests__/`", which §15.1 supersedes — there is no frontend test runner |
| **Forbidden (exact)** | `frontend/lib/i18n.ts` (**WP-1 owns it** — WP-5 consumes `t.key`; consent and privacy strings are landed by WP-1 at R1) · `frontend/lib/site-metadata.ts` (**WP-1** — WP-5 imports and re-exports it, never edits it) · `frontend/middleware.ts` · `frontend/lib/catalogue.ts` · `frontend/lib/browse.ts` · `frontend/lib/families.ts` · `frontend/lib/price-band.ts` · `frontend/lib/search-resolver.ts` · `frontend/app/api/product/[slug]/route.ts` · `frontend/app/product/[slug]/**` · `frontend/app/browse/**` · `frontend/app/family/**` · `frontend/app/search/page.tsx` · `frontend/app/page.tsx` · `frontend/components/{ProductCard,SearchResultCard,SideNav,BottomNav,MobileSearchBar}.tsx` · `frontend/app/onboarding/step1/page.tsx` · `frontend/app/onboarding/step2/page.tsx` · `frontend/app/onboarding/step3/page.tsx` · `scripts/` **except its own `scripts/lib/wp<N>-*.test.ts`** · `data/**` · `.agents/` · `.mcp.json` · `skills-lock.json` |
| **Dependencies** | **WP-1 merged** — WP-5 imports `lib/site-metadata.ts` and the consent/privacy i18n keys, and `/privatliv` must already be in `PUBLIC_PREFIXES` |
| **Parallel?** | **No with WP-1** (WP-1 must land first). **Yes with WP-2, WP-3 and WP-4** — no shared file with any of them |
| **Integration order** | 2nd (R2), and **strictly before R4** |

**Scope — the §12.4 contract in full.**

1. **Consent model** (`lib/consent.ts`, `ConsentProvider`, `ConsentBanner`,
   `ConsentFooterControl`): three states, first-party non-tracking persistence,
   `undecided` behaving as `rejected`, reject as easy as accept, no pre-tick, no
   re-prompt after rejection, withdrawal from `/privatliv` and the footer.
2. **Consent-then-load** (`AnalyticsRoot`): the single mount point for PostHog
   and Speed Insights. Renders nothing — no script, no `init()`, no request, no
   cookie — until consent is `granted`. No pre-consent event buffer.
3. **Tracker removals** (`app/layout.tsx`, `lib/onboarding.ts`,
   `package.json`): GA4 (`layout.tsx:35,64-75` and the `window.gtag` sender at
   `lib/onboarding.ts:5,44-45`) and Vercel Analytics (`layout.tsx:9,76`,
   `package.json:15`) are **deleted**, not gated.
4. **Fail-closed EU host** (`PostHogProvider.tsx:10`): no fallback host; unset or
   non-EU initialises nothing, throws in development, emits one operational log
   line in production.
5. **URL sanitisation** (`PostHogPageView.tsx:15`): `path_template`, a query-string
   allow-list of `page` and `sub`, `referrer_host` only. `q` is removed before the
   payload is built.
6. **`/privatliv`** (`app/privatliv/page.tsx`): processors, purposes, data
   categories, retention, region, rights, contact — per §12.4.5, rendering
   identically in every consent state.
7. **Analytics core** (`lib/analytics.ts`): typed `track()` over the 12-event
   union with compile-time property checking, `identify()` on every authenticated
   session start, `reset()` on sign-out, super-properties, person properties,
   production-only init, `?klup_internal=1` founder tagging, admin-surface
   suppression.
8. **Channel separation** (§12.4.8): no operational logging through the analytics
   client, no analytics event justified as operational.
9. **`app/layout.tsx`** additionally consumes WP-1's `lib/site-metadata.ts` for
   `metadataBase`/OG/title and syncs `<html lang>` to the active locale.

**Acceptance tests.**
1. `track('product_viewed', {...})` fails to compile with a wrong or missing property.
2. Sign-in calls `identify(user.id)`; sign-out calls `reset()`.
3. **Rejected consent:** §16.6 trace A — zero requests to any tracker origin,
   zero tracker cookies or client-store keys, and every §6 journey step completes.
4. **Undecided consent:** §16.6 trace B — identical to A.
5. **Granted consent:** PostHog reaches the **EU** host only; Speed Insights
   loads; no GA4 or Vercel Analytics request exists at all.
6. **Withdrawal:** sending stops immediately, `reset()` is called, tracker
   cookies and client-store keys are cleared, state survives reload.
7. **Fail-closed:** unset and non-EU `NEXT_PUBLIC_POSTHOG_HOST` both initialise
   nothing; development throws; `'https://app.posthog.com'` appears nowhere in
   the repository.
8. **No query leakage:** the `zzq-canary-7431` search string appears in no
   PostHog payload, including `$current_url`.
9. `NEXT_PUBLIC_VERCEL_ENV='preview'` → zero events emitted.
10. `/admin` and `/intel` emit no product events.
11. No email-typed field exists in the event-property union (static assertion).
12. `grep -rn "gtag\|dataLayer\|googletagmanager" frontend/app frontend/lib frontend/components` and `grep -rn "@vercel/analytics" frontend/` both return nothing.
13. **Rejected-consent completeness:** the demand-capture control renders and
    accepts an email address that reaches Supabase, while the PostHog event does
    not fire.
14. Lint warnings in `app/layout.tsx` do not increase beyond the documented 4.
15. `git diff --name-only` intersected with the forbidden list is empty.

**Commit message**
```
Stage 3 WP-5: consent gate, privacy route and PostHog identity

Nothing non-essential now loads before consent. Removes Google Analytics
and Vercel Analytics outright rather than gating them, and puts PostHog and
Speed Insights behind a three-state consent gate where undecided behaves
exactly as rejected. Rejecting analytics leaves the entire product usable:
band, listings, search, demand capture and sign-in all work, and the demand
control still accepts an email address even though the analytics event does
not fire.

Adds /privatliv naming the active processors, purposes, data categories and
retention, plus a withdrawal control there and in the footer.

Makes the PostHog EU host fail closed - an unset or non-EU host now
initialises nothing instead of silently falling back to the US region - and
stops raw ?q= search text reaching $current_url by building the payload
from a path template and a parameter allow-list.

Adds lib/analytics.ts with a typed track() over the twelve V1 events plus
identify()/reset(), neither of which existed, so no person-level metric was
computable at all. Operational logging stays server-side and separate.
```

---

## 22. Dependency graph

```
                    ┌──────────────────────────────┐
                    │ R0  Pre-implementation        │
                    │     checkpoint (§25)          │
                    │  incl. operator proof that    │
                    │  the Vercel cron is disabled  │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌──────────────────────────────┐
                    │ WP-1  Eligibility spine (R1)  │
                    │ ATOMIC — not divisible        │
                    │ middleware + API gate +       │
                    │ browse + i18n + site-metadata │
                    │ RUNS ALONE                    │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌──────────────────────────────┐
                    │ WP-5  Consent, privacy,       │
                    │       analytics identity (R2) │
                    │ owns app/layout.tsx outright  │
                    │ HARD GATE before R4           │
                    └───────────────┬───────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
      ┌───────────────┐   ┌───────────────────┐   ┌──────────────────┐
      │ WP-2 Families │   │ WP-3 Product page │   │ WP-4 Restricted  │
      │ + operator    │   │ + price evidence  │   │      search      │
      │   copy  (R3)  │   │ + SEO      (R4)   │   │           (R5)   │
      │               │   │  CRITICAL PATH    │   │                  │
      └───────┬───────┘   └─────────┬─────────┘   └────────┬─────────┘
              │                     │                      │
              └──────────► WP-4 ◄───┘  (R3 → R5, R4 → R5)  │
                                    │                      │
                                    └──────────┬───────────┘
                                               ▼
                                  ┌────────────────────────┐
                                  │ R6  Release verification│
                                  │  §16.4 data truth       │
                                  │  §16.6 A–I consent gate │
                                  │  12 events under grant  │
                                  └────────────────────────┘
```

**Hard edges**

- `R0 → WP-1` — no code before the checkpoint, including the operator cron proof.
- `WP-1 → WP-5` — WP-5 imports `frontend/lib/site-metadata.ts` and the consent
  and privacy i18n keys, and `/privatliv` must already be in `PUBLIC_PREFIXES`.
- `WP-1 → {WP-2, WP-3, WP-4}` — all three assume the eligibility gate exists.
- `WP-5 → WP-3` and `WP-5 → WP-4` — both emit through `frontend/lib/analytics.ts`,
  and neither may add event emission to a publicly reachable product before the
  consent boundary is deployed.
- `WP-2 → WP-4` — the search index contains the six family entries.
- `WP-3 ⟶ WP-4` (deploy order only) — search resolves *to* product pages, so the
  page must be split first.

**Non-edges, stated so nobody invents them.** WP-2, WP-3, WP-4 and WP-5 share no
owned or bounded file with one another (§15.7). WP-2 and WP-4 each hold one
bounded edit to `frontend/middleware.ts`, scheduled at R3 and R5 respectively —
sequential, never concurrent.

**Changed from the previous revision.** WP-1 and WP-5 were listed as fully
parallel. They are not: §12.4 gives WP-5 exclusive ownership of
`frontend/app/layout.tsx`, which WP-1 previously also claimed. WP-1 no longer
opens that file — its metadata work moved to `frontend/lib/site-metadata.ts` —
and WP-5 now runs after WP-1 rather than beside it. **WP-1 ∩ WP-5 writable
files = ∅.**

## 23. Critical path

```
R0  →  WP-1  →  WP-5  →  WP-3  →  R6
```

WP-1 is atomic and unavoidable: nothing in Stage 3 has any effect until product
pages are simultaneously public and gated. **WP-5 joined the critical path with
this amendment** — from R1 the product is publicly reachable, so the consent
boundary must be deployed before WP-3 and WP-4 add event emission at R4 and R5.
WP-3 remains the largest package and carries everything user-visible about
whether Klup answers the price question.

WP-2 is **off** the critical path: it is small, and its release can slip without
blocking WP-3. WP-4 is large but independent of WP-3's internals and deploys
last.

**If schedule pressure appears, the only safe compressions are:**
- develop WP-2, WP-3, WP-4 and WP-5 concurrently (already planned) and deploy in
  the R2 → R3 → R4 → R5 order;
- start WP-4's resolver and index while WP-3 is in review;
- deploy R3 and R4 together if WP-2 lands early, since they share no file.

**What must never be compressed:** WP-1's two halves; the atomicity of the
eligibility gate; **WP-5 landing before any package adds event emission**; the
§16.4 data-truth assertions and the §16.6 A–I consent gate before R6.

## 24. Safe parallelisation plan

| Slot | Packages | Why it is safe |
|---|---|---|
| **Slot A** | **WP-1 alone** | It owns `frontend/middleware.ts`, `frontend/lib/catalogue.ts`, `frontend/lib/browse.ts`, `frontend/lib/i18n.ts`, `frontend/app/api/product/[slug]/route.ts` and `frontend/lib/site-metadata.ts` — the files every other package reads. Nothing may run beside it |
| **Slot B** | WP-5 (deploys R2) developed alongside WP-2, WP-3 and WP-4 | Disjoint owned sets (§15.7). WP-5 owns `frontend/app/layout.tsx`, the consent and PostHog components, `frontend/lib/analytics.ts`, `frontend/lib/onboarding.ts`, `frontend/app/privatliv/page.tsx` and `frontend/package.json`; none of those appears in WP-2, WP-3 or WP-4 |
| **Serialisation points** | R1 → R2 → {R3, R4} → R5 | The gate must exist before anything assumes it; the consent boundary must exist before event emission ships; the family route must exist before search redirects to it; the product page must be split before search sends traffic to it |

**Merge-conflict avoidance rules, binding:**

1. **`frontend/lib/i18n.ts` is owned by WP-1 only, and WP-1 lands the complete V1
   key set for all five packages up front** — including WP-5's consent and privacy
   copy and WP-2's family-empty-state copy. Every other package is a read-only
   consumer (`t.key`). This is the highest-risk contention point in the
   repository and it is removed by design, not by coordination.
2. **`frontend/app/layout.tsx` is owned by WP-5 only.** WP-1 never opens it;
   site-wide metadata reaches it through `frontend/lib/site-metadata.ts`.
3. **`frontend/middleware.ts` is owned by WP-1.** WP-2 and WP-4 make one named,
   bounded edit each, at R3 and R5 — never concurrently with WP-1 or each other.
4. **`frontend/app/api/product/[slug]/route.ts` is owned by WP-1** for
   eligibility; WP-3's bounded price-block edit lands at R4.
5. **`frontend/lib/analytics.ts` is owned by WP-5.** Other packages import
   `track()` and add call sites **only inside files they own**.
6. **`frontend/package.json` is owned by WP-5.** No other package changes
   dependencies in V1.
7. Every package runs the full §16.1 baseline before opening a PR. An eighth root
   type error, a fifth `app/layout.tsx` lint warning or a 149th test failing is
   that package's regression by definition.
8. Every package's PR runs `git diff --name-only` against its forbidden list; a
   non-empty intersection blocks the merge.

---

## 25. Pre-implementation checkpoint (R0)

**No implementation begins until every line below is confirmed in writing.**

### 25.1 Authorisation

- [ ] The product owner has approved this document as the Stage 3 V1
      implementation authority, superseding the three source reports where they
      conflict.
- [ ] Explicit authorisation to modify application code on `main` (`CLAUDE.md`
      §7 — commit, push and deploy each require separate authorisation).
- [ ] Confirmation that the canonical V1 surface is the **14** supported-and-public
      products, and that **no** promotion accompanies V1 (decisions 4 and 5).
- [ ] Acceptance that browse shows **10** products at launch, not 14 and not 23,
      until Q-D1 is decided.
- [ ] Acceptance that the eight held-from-launch public rows **404** (D2) and the
      six family rows **308** to empty, `noindex`, unlisted routes (D3, §4.2).
- [ ] Approval of the §12.4.1 tracker decisions: **GA4 removed**, **Vercel
      Analytics removed**, **PostHog consent-gated**, **Speed Insights
      consent-gated** — accepting that guardrail G8 (LCP) is then measured on the
      consenting population only.
- [ ] Acceptance that consent, withdrawal and `/privatliv` are **V1 release
      requirements** (§12.4), that Q-D7's deferral is withdrawn, and that R6 is
      blocked until §16.6 A–I pass.

### 25.2 Operator proof — the Vercel cron is disabled

**The repository declaration is not evidence, and neither is this document's
behavioural inference.** `frontend/vercel.json` still declares
`crons: [{ path: "/api/cron/scrape", schedule: "*/10 * * * *" }]`, so the
repository asserts the cron is *enabled*. The deployed state is the opposite, and
only an operator with Vercel project access can prove it.

An operator with dashboard access must record all four, dated and attributed:

- [ ] **Project-level Cron Jobs state.** Vercel → the Klup project → Settings →
      Cron Jobs, showing `/api/cron/scrape` **disabled**. Record a screenshot or
      the `GET /v1/projects/{id}/crons` API response, with the project id and the
      timestamp.
- [ ] **No execution history.** The cron's last-run/next-run fields, or the
      project's cron logs, showing **no invocation since the 2026-08-26
      activation freeze**.
- [ ] **Corroborating database read** (`SELECT`, re-run at R0, not copied from
      here): `MAX(scraped_at)` over `listings WHERE watchlist_id IS NOT NULL`
      remains **2026-03-16**, and `COUNT(*) WHERE watchlist_id IS NOT NULL AND
      ingestion_batch_id IS NOT NULL` remains **0**. Migration 055 stamps every
      writer, so a post-activation cron run would be visible here.
- [ ] **Deploy-safety confirmation.** Written confirmation of whether deploying
      the V1 releases re-reads `frontend/vercel.json` and could **re-enable** the
      cron. If it can, the cron declaration must be resolved *before R1* — as a
      deliberate, separately authorised Vercel or repository change, never as a
      side effect of a Stage 3 deploy.

**If any of the four cannot be produced, R1 does not start.** Re-enabling
`/api/cron/scrape` would restore the documented `ON CONFLICT` collision with the
PM2 `scrape-dba` path (handover, *Vercel cron conflict*), and V1 ships five
deploys.

### 25.3 State verification (re-run immediately before R1, not copied from this document)

- [ ] `git rev-parse HEAD` matches the approved base commit.
- [ ] The working tree contains no unexpected modification.
- [ ] `SELECT`: 48 supported · 28 public · 14 both · 34 `qa_only` · 14
      public-unsupported. **Any drift halts R1** — the canonical set is derived
      from state, so a change here changes the release.
- [ ] `NEXT_PUBLIC_POSTHOG_HOST` is confirmed as the EU host in production **and**
      its absence is confirmed to initialise nothing (§12.4.6) rather than
      falling back.
- [ ] `npm test` 148/148 · frontend `tsc` 0 errors · `next lint` 4 warnings ·
      root `typecheck` 7 errors — recorded as the pre-change baseline.

### 25.4 Decisions required before the package they block

- [ ] Before WP-2: confirm the six family slugs and their child lists against
      `klup-launch-catalogue-selection.md` §6.3; confirm that empty family
      routes render **no** child names and are absent from homepage, browse,
      navigation, sitemap and search index; and confirm the indexable threshold
      is one canonical child (Q-D5).
- [ ] Before WP-3: confirm `n ≥ 8` and the 10× width gate; confirm that the
      `roland-sh-101` and `yamaha-dx7` low tails will be read manually and, if
      polluted, corrected through the **existing** admin curation surface — not
      by a code or matcher change.
- [ ] Before WP-4: confirm the dangerous-term list is adopted unchanged and that
      **G1 = 0** is a release blocker rather than a metric.
- [ ] Before WP-5: confirm the §12.4.5 processor list, data categories and the
      **concrete** PostHog retention period against actual configuration. A
      processor that cannot be confirmed is removed from the product, not omitted
      from the page.
- [ ] Before R6: confirm the weekly unsupported-demand export to `data/` has an
      owner (PostHog retention is finite and this log is the only evidence that
      can justify expanding past 48).

### 25.5 Explicitly out of scope of R0

Do not attempt from a coding session: any production write, any PM2 or Vercel
configuration change, the four `CLAUDE.md` §8 operator prerequisites, and the
activation sequence. §25.2 is a **read and record** exercise by an operator —
it changes nothing.

---

## 26. Traceability

| Claim | Evidence |
|---|---|
| `/product`, `/api/product`, `/api/discover` are not public | `frontend/middleware.ts:39-60`, `:162` |
| No eligibility gate on the product route | `frontend/app/api/product/[slug]/route.ts:45-49` |
| Browse fetch is unbounded and unordered | `frontend/lib/browse.ts:346-357` |
| `is_public` excludes `support_state` | `scripts/migrations/036_browse_visibility_projection.sql:84-97` |
| `support_state` appears nowhere in a public read path | grep over `frontend/{lib,app,components}` — only `lib/matching/**` and `app/api/admin/products/**` |
| 48 / 28 / 14 / 34 / 14 / 48 matchable / 4,004 | `SELECT` on `kg_product`, 2026-08-27 |
| 23 browse-eligible = 10 supported + 13 unsupported; 5 public rows excluded by taxonomy | `SELECT` joining `browse_product_projection` to `kg_product`, 2026-08-27 |
| All 48 supported resolve `browse_domain='music'` | `SELECT`, 2026-08-27 |
| Asking band n≥8 after plausibility+IQR: 39/48 and 13/14 | `SELECT` over `listing_product_match ⋈ listings`, 2026-08-27 |
| Raw p75 of 37,273,095 DKK on `rhodes-mark-i-stage-73`; 268× on `gibson-les-paul-custom` | same query without `hasPlausibleListingPrice`; cause documented in `frontend/lib/listing-price-integrity.ts:1-26` |
| Sold-price coverage 8/48 | `reverb_price_history` count per `kg_product_id` |
| Every family child is `supported` + `qa_only`; two families have no supported child | `SELECT` on `kg_product` filtered to the §6.3 child names, 2026-08-27 |
| Monitored union 30 = 14 canonical + 14 public-unsupported + 2 `qa_only` | `data/klup-source-monitoring.json` intersected with production state |
| `/api/scrape` has exactly one caller | repo-wide grep; `frontend/app/search/page.tsx:94` |
| Admin curation uses its own admin-gated scrape routes | `app/api/admin/product/[slug]/{scrape-platform,scrape-kleinanzeigen}/route.ts` |
| No `generateMetadata`, no sitemap, no robots, no `not-found`, no `families.ts` | filesystem checks under `frontend/app` and `frontend/lib` |
| Product page is `'use client'` | `frontend/app/product/[slug]/page.tsx:1` |
| PostHog defaults to the US host | `frontend/components/PostHogProvider.tsx:10` |
| No `identify`/`reset`; five legacy events only | grep: `app/watchlists/page.tsx:39`, `app/search/page.tsx:102,182`, `components/SearchResultCard.tsx:147,191,273` |
| Pre-pivot copy still shipping | `frontend/lib/i18n.ts:23,24,31,33,189,190,197,199` |
| Multi-vertical synonyms still shipping | `frontend/lib/synonyms.ts:4-12` |
| `normalizeQuery` does not collapse model-number separators | `frontend/lib/query-normalizer.ts` (full file) |
| `vercel.json` still declares the cron | `frontend/vercel.json` |
| Cron dormant: 772 watchlist rows, newest `scraped_at` 2026-03-16, zero identities | `SELECT` on `listings`, 2026-08-27 |
| `first_seen_at` on 35,390 of 48,858 active listings | `SELECT`, 2026-08-27 |
| Stale tier/monitoring operator copy | `frontend/app/api/admin/products/[id]/route.ts:20-23,49-53,79-85`; `frontend/app/admin/products/page.tsx:73` |
| Four trackers initialise unconditionally, no consent state, no privacy route | `frontend/app/layout.tsx:9,10,35,53,57-59,64-77`; `frontend/lib/onboarding.ts:5,44-45`; `frontend/package.json:15-16`; no `app/privatliv` in the route tree; no consent module anywhere in `frontend/lib` |
| Unused privacy/terms labels already shipping | `frontend/lib/i18n.ts:80,82,246,248` |
| Raw `?q=` reaches PostHog on every search pageview | `frontend/components/PostHogPageView.tsx:15` |
| PostHog falls back to the US host when unset | `frontend/components/PostHogProvider.tsx:10` |
| Every family child is `supported` + `qa_only`, so all six family routes are empty | `SELECT` on `kg_product` over the §6.3 child names, 2026-08-27 |
| Supported-search contract and dangerous terms | `docs/klup-launch-catalogue-selection.md` §11 |
| Family parent→child map | `docs/klup-launch-catalogue-selection.md` §6.3 |
| P0 default privileges on new `public` tables | `docs/klup-foundation-handover.md` → *Migration and rollback package* |

---

## 27. Non-mutation statement

Every production database access supporting this document was a `SELECT`. No
application code, configuration, environment variable, migration, KG row, matcher
input, monitoring set, scraper, PM2 process or Vercel setting was changed. No
file in the repository was created, modified or deleted other than this document.
The three Stage 3 source reports are byte-unchanged. `.agents/`, `.mcp.json` and
`skills-lock.json` were not read into, modified or staged.

**Committed and pushed:** exactly four documentation files — this document and
the three source reports — under the message
`docs: define stage 3 public product experience`. That commit contains no
application or configuration file. The resulting Vercel deployment is a
documentation-only build: it changes no route, no data and no runtime behaviour,
and it does not alter the Vercel cron state, which remains as recorded in §0 and
must still be proved by an operator per §25.2 before any implementation begins.
