# Stage 3 — frontend and content-readiness audit

**Read-only audit. No application code, configuration, database or existing
documentation was modified. Nothing was committed or pushed.**

| | |
|---|---|
| Audit date | 2026-08-27 |
| Repository | `/Users/panter/Workspace/SnagIt`, branch `main` |
| Frozen foundation commit | `2c864e4106546f89ad1e7925b4256bb2f3210c57` |
| Deployed commit observed in prod | `c7bd481…` (per handover); Vercel build id `dpl_CuDdqgwpwDLs81ZmY3dPYV2MH5hK` |
| Production host | `www.klup.dk` (behind Cloudflare) |
| Machine | `Panters-Mac-mini.local` (`panter`) |
| Working tree | clean except pre-existing untracked `.agents/`, `.mcp.json`, `skills-lock.json` — untouched |

**Method.** Documentation read in the order mandated by the index
(`CLAUDE.md` → `docs/klup-documentation-index.md` → `docs/klup-foundation-handover.md`
→ the activation record inside the handover, plus
`docs/klup-launch-catalogue-selection.md` and `docs/klup-product-lifecycle-guide.md`).
Repository implementation read directly. Production behaviour probed with
unauthenticated HTTP requests against `www.klup.dk`. Catalogue state established
with `SELECT`-only queries against the production database. `next lint` was run
(read-only) and reproduces the documented 4-warning baseline in `app/layout.tsx`.

This document establishes **current truth**. It proposes no alternative
information architecture; where it describes work, it describes work implied by
the architecture the handover already fixed.

**Severity scale.** `S1` blocks a coherent public V1 · `S2` major, visible to
users or corrupts the catalogue contract · `S3` moderate · `S4` minor / hygiene.

**Disposition vocabulary.** `Reuse` — keep as is · `Correct` — the asset is
right but the implementation is wrong · `Remove` — dead or misleading ·
`New` — does not exist.

---

## 1. Verified production state — the catalogue side is exactly as documented

Every number the handover claims for the catalogue reproduces on live production.

| Measure | Documented | Measured (SELECT, 2026-08-27) | Verdict |
|---|--:|--:|---|
| `kg_product` total | 4,004 | 4,004 | ✅ |
| `status='active'` | — | 3,697 | ✅ |
| `support_state='supported'` | 48 | **48** | ✅ |
| `browse_visibility='public'` | 28 | **28** | ✅ |
| supported **and** public | 14 | **14** | ✅ |
| supported **and** `qa_only` | 34 | **34** | ✅ |
| public but **not** supported | (implied 14) | **14** | ✅ |

The data foundation is sound. **Every finding in this audit is a frontend,
content or artefact finding.** None of them is a reason to reopen foundation,
matcher, KG or product-data work.

---

## 2. Public route inventory and authentication boundary

Measured against production. `307` = middleware redirect to `/login`.

| Route | Repo path | Anonymous result | Intended? |
|---|---|---|---|
| `/` | `frontend/app/page.tsx` | `200` | yes |
| `/browse` | `frontend/app/browse/page.tsx` | `200` | yes |
| `/browse/[root]` | `frontend/app/browse/[root]/page.tsx` | `200` | yes |
| `/search` | `frontend/app/search/page.tsx` | `200` | yes |
| **`/product/[slug]`** | `frontend/app/product/[slug]/page.tsx` | **`307 → /login`** | **NO — see F-01** |
| `/saved` | `frontend/app/saved/page.tsx` | `200` (teaser) | yes |
| `/watchlists` | `frontend/app/watchlists/page.tsx` | `200` (teaser) | yes |
| `/login`, `/signup` | `frontend/app/{login,signup}/page.tsx` | `200` | yes |
| `/onboarding` | *(no page file)* | **`404`** | no — see F-24 |
| `/onboarding/step1…4` | `frontend/app/onboarding/step{1..4}/page.tsx` | `200` | unreachable — see F-24 |
| `/profile` | `frontend/app/profile/page.tsx` | `307 → /login` | yes |
| `/admin/**` | `frontend/app/admin/**` | `307 → /login` | yes |
| `/intel` | `frontend/app/intel/page.tsx` | `307 → /login` | yes |
| `/sitemap.xml` | *(does not exist)* | **`307 → /login`** | no — see F-16 |
| `/robots.txt` | *(not repo-owned)* | `200` — Cloudflare-managed | see F-18 |
| any unknown path | *(no `not-found.tsx`)* | **`307 → /login`** | no — see F-05 |

**API boundary** (`frontend/middleware.ts:39-60`):

| API | Anonymous | Note |
|---|---|---|
| `/api/browse`, `/api/browse/[root]` | `200` | public |
| `/api/brands`, `/api/scrape`, `/api/price-observations` | `200` | public |
| **`/api/discover`** | **`307 → /login`** | **breaks the homepage — F-02** |
| **`/api/product/[slug]`** | **`307 → /login`** | **F-01** |
| `/api/price-history`, `/api/market-price` | `307` | unused anyway — F-21 |
| `/api/admin/**`, `/api/watchlists`, `/api/saved-listings` | `307`/`401` | correct |

Notes on the boundary itself:

- Every `/api/*` route that serves catalogue data uses `getSupabaseAdmin()`
  (service role) and therefore bypasses RLS. That is acceptable for
  server-rendered projections but means the middleware allow-list — not RLS —
  is the only access control on `/api/browse` and `/api/scrape`.
- `middleware.ts` is the sole authority; there is no route-segment `layout.tsx`
  guard anywhere outside `app/admin/layout.tsx`.

---

## 3. Findings

### A. Access and routing

#### F-01 — Canonical product pages require authentication `S1`
- **Route** `/product/[slug]` (all 4,004 slugs), `/api/product/[slug]`
- **Path** `frontend/middleware.ts:39-60`
- **Behaviour** `PUBLIC_PREFIXES` contains `/browse` and `/search` but **not**
  `/product` or `/api/product`. `isPublicPath()` therefore returns `false` and
  every anonymous request to a product page is `307`-redirected to `/login`.
  Confirmed live: `GET https://www.klup.dk/product/roland-juno-106` → `307`.
- **Impact** The handover and `CLAUDE.md` both state "canonical product pages
  are the core experience". Today that experience is invisible to every
  non-logged-in visitor, to every crawler, and to every link shared externally.
  `/browse` is public and every `ProductCard` links to `/product/<slug>`, so the
  public browse experience is a grid of links that all bounce to `/login`.
- **Disposition** **Correct** — a two-line allow-list change.
- **Dependencies** None technical. It is a product decision whether the page is
  public for all 4,004 slugs or only the 28 (see F-03, which must land with it).
- **Risk** Low to implement, **high to ship alone**: making `/product/*` public
  without F-03 exposes 3,976 unpublished product pages.

#### F-02 — Homepage discovery carousels are dead for anonymous visitors `S1`
- **Route** `/`
- **Path** `frontend/app/page.tsx:23-26`, `frontend/middleware.ts:39-52`
- **Behaviour** The landing page fetches `/api/discover` on mount to populate the
  "Legendarisk gear" and "Populært lige nu" carousels. `/api/discover` is not in
  `PUBLIC_PREFIXES`, so the fetch receives the `/login` redirect, `r.json()`
  throws or yields HTML, and both `legendary` and `popular` stay `[]`. Both
  sections are gated on `length > 0`, so they render nothing — silently, with no
  error state. Verified in the production HTML: the anonymous homepage is a
  header, a headline, a search box and a footer. Nothing else.
- **Impact** The single highest-traffic public surface shows zero catalogue.
  `buildDiscoverResponse` is correct and cheap (it filters `is_public` in SQL,
  so it is unaffected by F-04). This is purely an allow-list omission.
- **Disposition** **Correct** — one line.
- **Risk** Very low. This is the highest value-per-character fix in the audit.

#### F-05 — Unknown paths redirect to `/login` instead of 404 `S3`
- **Route** any unmatched path, e.g. `/nonexistent-page-xyz`
- **Path** `frontend/middleware.ts:162-164`; no `app/not-found.tsx` exists
- **Behaviour** The middleware matcher runs before routing, so a path with no
  page falls through `isPublicPath()` → `307 → /login`. A logged-in user gets
  Next.js's default unstyled 404 instead.
- **Impact** No branded 404, no correct status code for crawlers, and a
  mistyped URL looks like a permissions problem.
- **Disposition** **New** — `app/not-found.tsx` + a middleware pass-through.
- **Risk** Low.

### B. Catalogue ↔ UI consistency

#### F-03 — The product API serves every KG row, ignoring all five state axes `S1`
- **Route** `/api/product/[slug]` → `/product/[slug]`
- **Path** `frontend/app/api/product/[slug]/route.ts:45-53`
- **Behaviour** The query is `.from('kg_product').select('*, kg_brand(...)').eq('slug', …).single()`.
  There is **no** filter on `status`, `support_state` or `browse_visibility`.
  Any of the 4,004 slugs — including the 307 inactive rows and the 3,669
  `known`/`reserve` rows that were never meant to have a page — renders a full
  canonical product page with price statistics and listings.
- **Impact** This is the direct contradiction between the catalogue contract and
  the frontend. The lifecycle guide's whole point is that visibility is an
  independent, explicit axis; the product route honours none of it. It is
  currently masked only by F-01 (the page is behind auth). **Fixing F-01 without
  fixing F-03 publishes 3,976 unintended pages.**
- **Disposition** **Correct** — add the visibility predicate and return `404`.
  Decide deliberately whether the gate is `browse_visibility='public'` (28 pages)
  or `public OR qa_only` for signed-in staff.
- **Dependencies** Must ship in the same change as F-01.
- **Risk** Low code risk; the risk is shipping the two halves out of order.

#### F-04 — The browse projection is silently truncated at PostgREST's 1,000-row cap `S1`
- **Route** `/browse`, `/browse/[root]`, `/api/browse`, `/api/browse/[root]`
- **Path** `frontend/lib/browse.ts:346-359` (`fetchBrowseRows`)
- **Behaviour** `fetchBrowseRows` issues
  `.from('browse_product_projection').select(PROJECTION_SELECT).eq('browse_domain','music')`
  with **no `.range()` and no `.order()`**. `browse_product_projection` holds
  **4,004** music rows. PostgREST caps an unbounded select at its configured
  maximum, so the function receives a ~1,000-row prefix in unspecified physical
  order, then does all public-filtering, counting, sub-category derivation and
  pagination in JavaScript over that prefix.
- **Measured consequence** Ground truth is **23** browse-eligible public
  products. Production serves:

  | Surface | Root tile counts | Sum |
  |---|---|--:|
  | `/api/browse` (root) | bass 1 · effects 1 · electric 4 · keyboards 12 · pro-audio 1 | **19** |
  | `/api/browse/[root]` (leaf, summed) | bass 2 · effects 2 · electric 4 · keyboards 13 · pro-audio 1 | **22** |
  | Database truth | bass 2 · effects 2 · electric 4 · keyboards 14 · pro-audio 1 | **23** |

  Three separate numbers for the same catalogue. The root page and the leaf page
  disagree because they truncate different row sets (all-music vs root-filtered).
  `linn-electronics-linndrum` is a fully public, imaged, classified product that
  **is unreachable through browse entirely**. `bass-guitars` and
  `effects-and-pedals` advertise "1" on the tile and then list 2.
- **Stability** Five consecutive probes returned identical counts, so today the
  truncation is deterministic — but only because the heap order happens to be
  stable. Any `VACUUM FULL`, bulk `UPDATE` or row churn reorders it, and the
  browse catalogue will change without a deploy.
- **Disposition** **Correct** — filter `is_public` in the database (the
  projection already exposes the column, and `buildDiscoverResponse` already does
  exactly this at `lib/browse.ts:582-586`), and paginate with `.range()`.
  Aggregate counts belong in SQL, not in a JS `.filter().length`.
- **Dependencies** None. The projection view already has everything needed.
- **Risk** Low-to-moderate: the debug payload (`?debug=1`, admin-only) genuinely
  needs the non-public rows, so the fix must split the "public listing" query
  from the "audit" query rather than adding a blanket filter.

#### F-06 — Sub-category chips filter only the loaded page `S2`
- **Route** `/browse/[root]`
- **Path** `frontend/app/browse/[root]/page.tsx:127-129`, `256-267`
- **Behaviour** `filteredProducts` is a client-side `.filter()` over
  `data.products`, which is one 48-item page. Selecting a chip filters only what
  has been fetched; "Vis flere" then appends the *next unfiltered page* and
  re-filters. Pagination and filtering operate on different axes.
- **Impact** Latent today (no root has more than 14 public products, so a page is
  never full) but it is wrong by construction and will produce empty or partial
  sub-category views the moment the public catalogue grows past 48 in one root.
- **Disposition** **Correct** — make the sub-category a server-side query
  parameter on `/api/browse/[root]`.
- **Risk** Low.

#### F-07 — 14 public products are frozen out of matching and are quietly decaying `S2`
- **Route** all 14 `public` + `support_state='known'` product pages
- **Path** catalogue state; surfaced by `frontend/app/api/product/[slug]/route.ts:62-68`
- **Behaviour** Matcher eligibility is `active AND supported`. Half the public
  catalogue is `known`. Their existing `listing_product_match` rows are legacy
  and are never added to. Measured newest match date per public product:

  | Cohort | Newest `listing_product_match` |
  |---|---|
  | 14 public **and supported** | 2026-08-26 / 2026-08-27 (live) |
  | 14 public **and `known`** | 2026-05-03 → 2026-08-11 — **all pre-activation** |

  `arp-2600`, `fender-precision-bass`, `strymon-timeline` and
  `linn-electronics-linndrum` have had no new match since early May.
- **Impact** Half the public catalogue answers "is this a good price today?" with
  data that stopped growing on activation day, and will keep degrading. This is
  the known "monitoring/support overlap is only 14" follow-up from the index §8,
  seen from the user's side.
- **Disposition** **New** — a product decision, not a code change: either
  publish only the supported 14 for V1, or promote the 14 `known` products to
  `supported` through the existing seam. Do not solve it in the frontend.
- **Dependencies** `PATCH /api/admin/products/[id]` with `intent`; monitoring
  config if the set is to be actively scraped.
- **Risk** Promoting 14 products widens the matcher target set — that is exactly
  the change `CLAUDE.md` §7 requires explicit authorisation for.

#### F-08 — Listing counts contradict between browse cards and product pages `S2`
- **Route** `/browse/[root]` card vs `/product/[slug]` body
- **Path** `frontend/components/ProductCard.tsx:96-101` vs
  `frontend/app/api/product/[slug]/route.ts:62-68,113` and
  `frontend/app/product/[slug]/page.tsx:268-272`
- **Behaviour** The card renders `active_listing_count` from the projection
  (e.g. `gibson-les-paul` = 778). The product route caps the match join at
  `.limit(50)` **ordered by score**, then filters and re-sorts by `scraped_at`,
  then `.slice(0, 50)`. The page then prints `listings.length`.
- **Impact** A user clicks a card reading "778 til salg" and lands on a page
  reading "50 aktive annoncer til salg". Nine of the 28 public products exceed
  50 matched listings. Worse, the 50 shown are the 50 *highest-scoring* matches,
  re-sorted by date — an arbitrary and non-obvious sample presented as the
  market.
- **Disposition** **Correct** — paginate the product page's listing set and
  derive both numbers from the same source.
- **Risk** Low.

### C. Product page

#### F-09 — The product page is a client component with no SSR, metadata or structured data `S1`
- **Route** `/product/[slug]`
- **Path** `frontend/app/product/[slug]/page.tsx:1` (`'use client'`)
- **Behaviour** The entire page is client-rendered after a `useEffect` fetch.
  There is no `generateMetadata`, so every product page in the site inherits the
  root layout's `title: "Klup"` and `description: "Kup efter kup – det er Klup"`.
  A repo-wide search finds **one** `metadata` export (`app/layout.tsx:21`), **zero**
  `generateMetadata`, **zero** `application/ld+json`, **zero** canonical links.
- **Impact** For a product whose stated thesis is canonical product pages, there
  is no per-page title, no description, no Open Graph image, no `Product` /
  `Offer` / `AggregateOffer` structured data, no canonical URL, and no
  server-rendered content at all. Combined with F-01 this means the core surface
  is invisible to search engines twice over.
- **Disposition** **Correct** — convert the page to a server component shell
  (`generateMetadata` + SSR'd hero, article, specs and price band) with the
  interactive parts (save, watchlist modal, chart) kept as client islands. The
  existing markup is good and can be lifted almost verbatim.
- **Dependencies** F-01 and F-03 first — metadata on an auth-gated page is
  pointless, and structured data on an unpublished product is harmful.
- **Risk** Moderate. It is the largest single piece of work in this audit, but
  it is a mechanical server/client split, not a redesign.

#### F-10 — Error and not-found are the same state on the product page `S3`
- **Path** `frontend/app/product/[slug]/page.tsx:59-75`
- **Behaviour** `.catch(() => setNotFound(true))`. A network failure, a 500, or a
  JSON parse error all render "Produkt ikke fundet" — a definitive statement that
  the product does not exist.
- **Disposition** **Correct** — separate `404` from `error`, and add
  `app/product/[slug]/error.tsx`.
- **Risk** Low.

#### F-11 — Price history is attributed to Reverb regardless of source `S3`
- **Path** `frontend/app/product/[slug]/page.tsx:294-302` vs
  `frontend/app/api/product/[slug]/route.ts:116-129`
- **Behaviour** `priceHistory` merges `reverb_price_history` (a deterministic FK
  join on `kg_product_id`) with `auctionet_price_history` (an **`ilike` on
  `canonical_name`**, per the route's own comment at line 79-81). The chart then
  renders a fixed "Prisdata fra Reverb" attribution link.
- **Impact** Auctionet points are mislabelled, and the `ilike` join is the same
  class of "parts pollution" defect the Reverb join was migrated away from —
  `%Roland Juno-106%` will happily match an accessory lot.
- **Disposition** **Correct** — label per source; treat the Auctionet FK
  migration as separately scoped (the route already flags it).
- **Risk** Low for the label; the FK migration is out of Stage 3 scope.

#### F-12 — Price-history and price-range thresholds are undocumented and mostly unmet `S3`
- **Path** `frontend/app/product/[slug]/page.tsx:288` (`>= 5` for the chart);
  `frontend/app/api/product/[slug]/route.ts:134` (`>= 3` post-IQR for the band)
- **Behaviour** Only **8 of the 48** supported products have any sold-price
  history at all. The other 40 render "Ikke nok prisdata til at beregne typisk
  pris endnu." and no chart.
- **Impact** The product's defining question — *"Er 4.500 kr for en Roland
  Juno-106 en god pris i dag?"* — is answerable on 8 of 48 supported products
  and 10 of 28 public ones. This is a **content** gap, not a code gap, and it is
  the single biggest determinant of whether V1 feels like the promised product.
- **Disposition** **New** (content/data acquisition), separately authorised.
- **Risk** Out of frontend scope; must be surfaced to the product owner now
  because it shapes which products V1 should publish.

#### F-13 — `Related gear` does not respect visibility or ordering `S3`
- **Path** `frontend/app/api/product/[slug]/route.ts:88-93,138-143`
- **Behaviour** Related slugs come from `attributes.related_products`, resolved
  with `.in('slug', relatedSlugs)` — no `status`, no `browse_visibility` filter,
  and PostgREST does not preserve `IN` ordering, so the curated order is lost.
- **Impact** A public page can link to an unpublished product (which, after F-01
  + F-03, will 404). Only 7 products carry `related_products` at all.
- **Disposition** **Correct.**
- **Risk** Low.

### D. Search

#### F-14 — `/search` is a live-scraping generic SERP, not restricted search over the 48 `S1`
- **Route** `/search`, `/api/scrape`
- **Path** `frontend/app/search/page.tsx:92`, `frontend/app/api/scrape/route.ts`
- **Behaviour** Submitting a query calls `GET /api/scrape?q=…&sources=…`, which
  runs `scrapeDba`, `scrapeFinn`, `scrapeBlocket`, `scrapeKleinanzeigen` and a
  Thomann search **live, per request**, upserts every result into `listings`,
  and returns them. There is no catalogue concept anywhere in the path: no
  product resolution, no supported/unsupported distinction, no demand signal, no
  route to a product page. The default placeholder is still
  `"Søg efter alt… (f.eks. iphone, sofa, cykel)"` (`lib/i18n.ts`) — furniture,
  phones and bicycles, i.e. the pre-pivot multi-vertical thesis.
- **Impact** This is precisely the "generic listing SERP" that `CLAUDE.md` §1
  names as a non-goal, and it is the second-most-prominent public surface.
  Secondarily it is an unauthenticated, service-role, write-capable endpoint
  driven by arbitrary anonymous input; the only control is the 20-req/min
  per-IP limiter in `middleware.ts:10-36`.
- **Disposition** **Requires new work.** The supported-search contract in
  `klup-launch-catalogue-selection.md` is unimplemented. `/search` should resolve
  a query against the supported catalogue, route hits to product pages, and
  record misses as demand signals (which, per the handover, "does not exist yet").
  The live-scrape path is worth keeping behind an authenticated or admin surface;
  it should not be the public search.
- **Dependencies** Query normalisation exists (`frontend/lib/query-normalizer.ts`,
  `frontend/lib/synonyms.ts`) and the matcher's identifier/synonym scoring is
  directly reusable. A `demand_signal` table does not exist.
- **Risk** **High.** This is the largest and least-specified piece of Stage 3.
  It should not begin before the experience specification is approved.

#### F-15 — Kleinanzeigen is a monitored source that the SERP can never return `S3`
- **Path** `frontend/app/search/page.tsx:18` vs `frontend/app/api/scrape/route.ts:13`
- **Behaviour** The UI's `ALL_SOURCES` is `['dba','finn','blocket','reverb','thomann']`;
  the API's is the same plus `kleinanzeigen`. The UI always sends an explicit
  `sources=` parameter, so `scrapeKleinanzeigen` is never invoked from the SERP.
  Additionally `listingSourceKey()` (line 219-225) returns `null` for
  `kleinanzeigen`, so if such a listing ever did appear it would bypass every
  source toggle.
- **Impact** Kleinanzeigen is one of four explicitly monitored marketplaces (28
  products) and produced the second-largest match volume in the activation run
  (59 matches). It is invisible in search.
- **Disposition** **Correct** — one array and one mapping.
- **Risk** Low.

### E. Metadata, canonical URLs, structured data, sitemap

#### F-16 — No sitemap `S2`
- **Route** `/sitemap.xml` → `307 → /login`
- **Path** no `app/sitemap.ts`
- **Behaviour** No sitemap exists, and because the middleware matcher does not
  exclude it, the URL is treated as a protected page.
- **Disposition** **New** — `app/sitemap.ts` emitting the public product set and
  the browse roots. Trivial once F-03 defines "public".
- **Dependencies** F-03.
- **Risk** Low.

#### F-17 — No `metadataBase`, canonical URLs, Open Graph or Twitter cards `S2`
- **Path** `frontend/app/layout.tsx:21-28`
- **Behaviour** Metadata is `{title, description, icons}` only. No
  `metadataBase`, no `alternates.canonical`, no `openGraph`, no `twitter`, no
  `viewport`/`themeColor` export.
- **Impact** Every shared Klup link — homepage, browse, product — previews
  identically as "Klup / Kup efter kup – det er Klup" with no image.
- **Disposition** **Correct** at the layout level, **New** per route.
- **Risk** Low.

#### F-18 — `robots.txt` is Cloudflare-managed and not repo-owned `S3`
- **Route** `/robots.txt`
- **Behaviour** The served file is Cloudflare's managed content-signals block. It
  allows general crawling but `Disallow: /` for GPTBot, ClaudeBot, CCBot,
  Google-Extended, Applebot-Extended, Bytespider, Amazonbot and
  meta-externalagent. There is no `Sitemap:` line and no repository source of
  truth.
- **Impact** Not a defect — arguably a deliberate content posture — but it is an
  SEO-relevant surface that no repository document records, and it will silently
  override any `app/robots.ts` added later.
- **Disposition** **Reuse**, but document the ownership boundary.
- **Risk** Low; note the interaction before adding `app/robots.ts`.

#### F-19 — `<html lang="da">` is fixed while the UI is bilingual `S3`
- **Path** `frontend/app/layout.tsx:38`, `frontend/components/LocaleProvider.tsx`
- **Behaviour** Locale is client-only state persisted to `localStorage` under
  `klup-locale`. There is no locale route segment, no `lang` update, no
  `hreflang`. English content is served under `lang="da"` and is not separately
  addressable or indexable. The locale toggle lives only in `SideNav`, which is
  `hidden md:flex` — **mobile users cannot change language at all**.
- **Disposition** **Correct** (sync `lang`; add the toggle to `BottomNav`) or
  **New** if routed i18n is wanted. Routed i18n is a specification decision.
- **Risk** Low for the minimal fix; high scope creep if routed i18n is opened.

### F. Analytics and privacy

#### F-20 — Four analytics systems, no consent gate `S2`
- **Path** `frontend/app/layout.tsx:9-10,35,64-77`,
  `frontend/components/PostHogProvider.tsx`, `frontend/components/PostHogPageView.tsx`
- **Installed** Google Analytics 4 (`gtag`, id hardcoded fallback
  `'G-TCHJJVVWK8'` at `layout.tsx:35`), PostHog (`posthog-js`, EU host via env,
  `capture_pageview: false` with a manual `$pageview` in `PostHogPageView`),
  Vercel Analytics, Vercel Speed Insights.
- **Behaviour** All four initialise unconditionally on first paint. There is no
  cookie banner, no consent state, and no `Privatlivspolitik` page in the route
  inventory — although `lib/i18n.ts` already carries `privacyPolicy` and
  `termsOfService` keys and the onboarding copy promises both.
- **Product events currently captured** `search_performed`, `watchlist_created`,
  `listing_saved`, `listing_clicked`, `$pageview`. Notably **no product-page
  view event, no browse event, and no unsupported-query event** — the exact
  three signals Stage 3 will need to evaluate the experience.
- **Impact** A Danish/EU consumer product placing GA4 + PostHog cookies without
  consent is a real compliance exposure, and `posthog.init(…!)` will run with
  `undefined` if the env var is missing.
- **Disposition** **Correct** (consent gate, drop the hardcoded GA id) and
  **New** (privacy policy route, product-page and demand-signal events).
- **Dependencies** Legal copy. The demand-signal event depends on F-14.
- **Risk** Low technically; the decision is a business one.

#### F-21 — Three price/deal-context APIs exist and nothing calls them `S3`
- **Paths** `frontend/app/api/price-history/route.ts`,
  `frontend/app/api/market-price/route.ts`,
  `frontend/app/api/price-observations/route.ts`
- **Behaviour** A repo-wide search finds no page or component that fetches any of
  the three. `/api/price-observations` is even explicitly allow-listed in
  `middleware.ts:49` with the comment *"price stats shown on public SERP cards"* —
  no such card exists. `/api/price-observations` returns p25/p50/p75 from
  `price_observation` and resolves by `listing_id` **or** `product_slug`;
  `/api/market-price` resolves min/max/count batched by listing ids or slugs.
- **Impact** The deal-context primitives for "is this a good price?" are already
  built and wired to the product identity — and are entirely unused. The product
  page instead computes its own IQR band inline.
- **Disposition** **Reuse.** These are among the most valuable unused assets in
  the repository; `/api/market-price?listing_ids=` is exactly what a listing card
  needs to render a per-listing price verdict.
- **Risk** Low. Verify `price_observation` coverage before relying on it.

### G. Cards, filters, sorting, pagination

#### F-22 — `SearchResultCard` has a product-page bridge that nothing on search uses `S3`
- **Path** `frontend/components/SearchResultCard.tsx:87,417-425`
- **Behaviour** The `productSlug` prop renders a "Se produktside →" link. It is
  passed **only** from `/saved` (`app/saved/page.tsx:185`). Neither `/search` nor
  `/product/[slug]` passes it.
- **Impact** The listing → canonical-product bridge — the mechanism that turns a
  SERP into catalogue navigation — is implemented, tested by use on `/saved`, and
  switched off on the surface that needs it.
- **Disposition** **Reuse** — it is a prop, not a feature to build.
- **Dependencies** Requires resolving listing → product on the search path (F-14).
- **Risk** Low.

#### F-23 — Card defects: green accent misuse, provenance fallback, timestamp semantics `S2`
- **Path** `frontend/components/SearchResultCard.tsx`
- **`bg-green-500` discount badge** (line ~212) — `frontend/CLAUDE.md` is explicit:
  green is **only** for Kup-rating stars and "Aktiv" badges, never elsewhere.
  This badge is both a rule violation and the wrong green (Tailwind `green-500`,
  not `#13ec6d`). `S2`.
- **`PlatformBadge` defaults to DBA** (lines 96-118) — every unmatched
  `platform`/`source` value falls through to a blue "DBA" badge. Provenance is a
  correctness surface; an unknown source must never be labelled as a known one. `S2`.
- **`timeSince(listing.scraped_at)`** (lines 62-79) — presents **scrape**
  recency as **listing** recency. The activation record documents that a single
  DBA run refreshed 604 of 611 rows without creating new identities; those rows'
  `scraped_at` moves to now while the ad may be months old. Measured: every
  public product except `rhodes-mark-i-stage-88` shows `newest_scrape` =
  2026-08-27 while several have had no new match since May. Cards therefore read
  "12m siden" for stale inventory. `S2`.
- **Hardcoded colours** — `text-white/50` on the Thomann link and `bg-white/90`
  on the grid heart are invisible or wrong in light theme. `S3`.
- **Disposition** **Correct** for all four.
- **Risk** The timestamp fix needs a real first-seen column or a documented
  fallback; the other three are cosmetic-to-trivial.

#### F-26 — Filters, sorting and pagination are all client-side only `S3`
- **Route** `/search`, `/browse/[root]`
- **Paths** `frontend/app/search/page.tsx:16-50,227-234`, `frontend/app/browse/[root]/page.tsx:115-129`
- **Behaviour**
  - Source toggles hide already-fetched listings rather than re-querying; the
    result count updates but the sources were already scraped.
  - Sort is a pure client re-sort of the current result set; it is not persisted
    to the URL, so a sorted view cannot be shared or restored.
  - `relevance` is defined as "preserve server interleave order" — a 1:1
    Schibsted/Reverb interleave with Thomann pinned first. It is not relevance.
  - Neither filter nor sort state is in the query string; only `?q=` is.
  - Browse pagination is "Vis flere" append-only with no URL state and no
    `page` parameter, so no browse page beyond the first is linkable.
- **Disposition** **Correct** — move filter/sort/page state into the URL. This is
  a prerequisite for any indexable browse surface.
- **Risk** Low.

### H. Mobile behaviour

#### F-25 — `MobileSearchBar` is hidden on mobile `S2`
- **Path** `frontend/components/MobileSearchBar.tsx:29` — `className="hidden md:block …"`
- **Used by** `/browse`, `/browse/[root]`, `/product/[slug]`, `/saved` (5 files)
- **Behaviour** The component named `MobileSearchBar` renders **only at `md` and
  above**. `SideNav` is `hidden md:flex`. Consequently on a phone, `/browse`,
  `/browse/[root]` and `/product/[slug]` have **no search input at all** — the
  only route to search is the `BottomNav` FAB, which navigates away to `/search`.
- **Impact** Denmark's used-gear traffic is overwhelmingly mobile. The core
  browse-and-product journey has no in-context search.
- **Disposition** **Correct** — either flip the breakpoint or rename the
  component to match its actual (desktop) role and add a real mobile one.
- **Risk** Low. Likely a single-word regression.

#### F-27 — `BottomNav` renders `null` until auth resolves `S3`
- **Path** `frontend/components/BottomNav.tsx:44-56`
- **Behaviour** `authed` starts `null`; the component returns `null` until
  `supabase.auth.getUser()` resolves client-side. On mobile that is the *only*
  navigation, so every page loads with no nav, then pops one in — a guaranteed
  layout shift on every route.
- **Disposition** **Correct** — reserve the space, or resolve auth on the server.
- **Risk** Low.

#### F-28 — `SideNav` shows authenticated-only affordances to anonymous visitors `S3`
- **Path** `frontend/components/SideNav.tsx:53-98,163-178`
- **Behaviour** `SideNav` renders unconditionally on `/browse`, `/search`,
  `/product/[slug]` and `/saved`, including a **"Log ud"** button and links to
  `/profile` (which `307`s to `/login`), `/saved` and `/watchlists`. Unlike
  `BottomNav`, it has no auth branching at all.
- **Impact** A first-time desktop visitor is offered "Log ud" and a profile link
  that bounces them to a login screen.
- **Disposition** **Correct** — mirror `BottomNav`'s anonymous variant.
- **Risk** Low.

### I. Loading, empty, unsupported and error states

#### F-29 — State coverage is good except for "unsupported", which does not exist `S2`

| State | Coverage |
|---|---|
| Loading | ✅ Good — real skeletons on `/browse` (8 tiles), `/browse/[root]` (12 tiles), `/search` (3 cards), `/product/[slug]` (hero + text), `/saved` (3 cards) |
| Empty | ✅ Present on all five, with icon + copy + CTA |
| Error | ⚠️ Partial — `/browse` and `/browse/[root]` render the raw thrown message; `/search` uses `t.searchFailed`; `/product/[slug]` collapses error into not-found (F-10) |
| Not found | ⚠️ `/product/[slug]` has an in-page state; site-wide there is no `not-found.tsx` (F-05) |
| **Unsupported** | ❌ **Does not exist.** An off-catalogue query renders the same "Ingen resultater — prøv et andet søgeord" as a supported query with no hits. There is no way for a user to learn that Klup does not cover their instrument, and no demand signal is recorded |
| Route-level `error.tsx` / `loading.tsx` | ❌ None anywhere in `app/` |

- **Disposition** **New** for the unsupported state (blocked on F-14);
  **Correct** for the raw-error leakage; **New** for route-level boundaries.
- **Risk** Raw error strings from `lib/browse.ts` reach the user verbatim
  ("Failed to load browse projection.") — English, untranslated, and
  implementation-revealing.

### J. i18n and design-system conformance

#### F-30 — Widespread hardcoded Danish, in direct violation of `frontend/CLAUDE.md` `S3`
`frontend/CLAUDE.md` states: *"ALL user-facing text must use `t.key` … Component
files must never contain raw Danish strings."* Confirmed violations:

| String | Path |
|---|---|
| "Typisk brugtpris", "Median … baseret på N salg", "Ny fra Thomann", "Ingen aktive annoncer", "+ Tilføj til watchlist", "Få besked når nye annoncer dukker op", "Prishistorik", "N salg registreret", "Prisdata fra Reverb", "Produkt ikke fundet" | `app/product/[slug]/page.tsx` |
| "Specifications", "Product History", "Related gear" — **English on a Danish page** | `app/product/[slug]/page.tsx:362,381,436` |
| "Legendary" / "Classic" badge text | `app/product/[slug]/page.tsx:218`, `components/ProductCard.tsx:89` |
| "N til salg" | `components/ProductCard.tsx:99` |
| "Gem" / "Gemt" / `aria-label="Gem annonce"` / "Ny hos Thomann" / "Se produktside →" | `components/SearchResultCard.tsx` |
| "Relevans" / "Ældste først" (two of five sort options; the other three use `t`) | `app/search/page.tsx` |
| "Alle" (sub-category chip) | `app/browse/[root]/page.tsx:201` |
| "Lystema" / "Mørkt tema" / "Lys" / "Mørk" | `components/SideNav.tsx:37`, `components/BottomNav.tsx:34` |
| "N gemt annonce / gemte annoncer" | `app/saved/page.tsx:169` |
| "Henter…" / "Vis flere" (inline ternaries, bypassing `t`) | `app/browse/[root]/page.tsx:264` |

- **Disposition** **Correct** — mechanical, and it also fixes the mixed-language
  product page.
- **Risk** Low. Add keys to **both** `da` and `en`.

#### F-31 — The green accent rule protects UI that does not exist `S4`
- **Path** `frontend/app/globals.css:17,39`; `frontend/tailwind.config.ts:32-33`
- **Behaviour** `--accent: #13ec6d` is defined in both themes and mapped in
  Tailwind, and is then **used nowhere in the application**. There are no
  Kup-rating stars (deliberately hidden — see the comment at
  `SearchResultCard.tsx:236`) and no "Aktiv" badges on any public surface. The
  only green pixel that ships is the off-brand `bg-green-500` discount badge
  (F-23). Typography is applied correctly: DM Serif Display on browse and product
  headings, Inter as the body font.
- **Disposition** **Reuse** — the token is correct and waiting. Note that the
  documented rule currently constrains nothing.

### K. Promotion workflow (public/private)

#### F-32 — `/admin/products` cannot change the support axis, and mislabels the tier axis `S2`
- **Route** `/admin/products`
- **Paths** `frontend/app/admin/products/page.tsx`,
  `frontend/app/api/admin/products/[id]/route.ts`,
  `frontend/app/api/admin/products/route.ts`
- **What works — and works well.** `PATCH /api/admin/products/[id]` is a genuinely
  strong seam: axis-typed field mapping, fail-closed value validation,
  mandatory `intent` for the visibility and monitoring axes, `?dryRun=1`,
  a before/after manifest with a plain-language consequence per change, and a
  guard refusing to promote an `inactive` identity to `supported`. It honours the
  lifecycle contract exactly.
- **Defect 1 — no support control in the UI.** The page exposes only *tier*,
  *browse_visibility* and *year*. `support_state` — the axis that decides matcher
  eligibility for the 48 — has **no admin surface at all**, even though the API
  supports it. The only way to move the axis today is a hand-rolled `PATCH`.
- **Defect 2 — the product list is selected by tier.** `GET /api/admin/products`
  defaults to `?tier=legendary` and the UI's empty search sends exactly that. The
  supported cohort cannot be listed. Tier is being used as the operational lens
  precisely where `CLAUDE.md` §2 says it must not be.
- **Defect 3 — the monitoring consequence text is now false.** The route's
  header comment and `consequence()` state that tier *"is ALSO, today, the
  implicit selector four scrapers use"* and emit
  *"MONITORING EXPANDS: … this product joins those query sets on their next run."*
  That coupling was removed in 04B: `scripts/scrape-{finn,blocket,kleinanzeigen}.ts`
  document its removal and all four scrapers now resolve through
  `monitoredSlugs()` / `assertResolved()` from `data/klup-source-monitoring.json`.
  `cycleTier` in the UI even sends `intent: ['monitoring']` for what is a purely
  editorial change. **The one operator-facing surface that explains consequences
  currently explains a consequence that no longer occurs.** `S2` — wrong operator
  guidance on a write path is worse than none.
- **Residue** `scripts/scrape-dba.ts:77-78` still parses `--tier=` and defaults
  `TIERS = ['legendary','classic']`, but the value is used only for log lines
  (`:128`, `:241`); selection goes through `monitoredSlugs`. Dead, misleading CLI
  surface. `S4`.
- **Disposition** **Correct** the consequence text and the `intent` the UI sends;
  **New** for a support-axis control and a support-based list filter.
- **Dependencies** None — the API is ready.
- **Risk** Low code risk. Adding a support control is a write path onto the
  matcher's target set and needs the §7 authorisation discipline.

### L. Dead or misleading legacy paths

| # | Path | State | Severity | Disposition |
|---|---|---|---|---|
| F-24 | `/onboarding` (bare) | `404` in production, yet `middleware.ts:58` treats it as a public path. There is no `app/onboarding/page.tsx` | `S3` | **Remove** the allow-list entry or **New** page |
| F-24b | `/onboarding/step1…4` | A complete, translated 4-step flow (`lib/onboarding.ts` + `OnboardingHeader`) that **nothing links to**. The only inbound reference is step2's *back* button to step1 | `S2` | Decide: **Reuse** (wire from `/signup`) or **Remove** |
| F-33 | `frontend/components/WatchlistListings.tsx` | Zero references | `S4` | **Remove** |
| F-34 | `frontend/components/ListingCard.tsx` | Single reference; superseded by `SearchResultCard`; uses `text-primary` for price and lacks source badges, currency approximation and save/watchlist actions | `S4` | **Remove** or fold in |
| F-35 | `frontend/vercel.json` | Still declares `crons: [{path: "/api/cron/scrape", schedule: "*/10 * * * *"}]`. The handover states the cron is **deliberately disabled at Vercel project level**. Repo and deployment now disagree, and the documented `ON CONFLICT` collision with PM2 `scrape-dba` returns the moment anyone re-enables it from the file | `S2` | **Correct** — remove the declaration or add an in-file warning; do **not** re-enable |
| F-36 | `/api/cron/scrape` | 286 lines of live, reachable code for a disabled job | `S3` | **Reuse** frozen; document at the top of the file |
| F-37 | `lib/i18n.ts` | `watchlistsDescription: "Vi tjekker dba.dk hvert 10. minut…"`, `fetchingListings: "Henter annoncer fra dba.dk…"`, `searchPlaceholder: "Søg eller indsæt link fra dba.dk"`, `searchInputPlaceholder: "Søg efter alt… (f.eks. iphone, sofa, cykel)"` — single-source and pre-pivot multi-vertical copy, still shipping | `S2` | **Correct** — `frontend/README.md` was corrected for exactly this framing (index §3); the strings were not |

### M. Accessibility and interaction defects

| # | Finding | Path | Severity |
|---|---|---|---|
| F-38 | **86 Material Symbols ligature spans, 1 `aria-hidden`.** Decorative icons render literal text (`piano`, `search_off`, `workspace_premium`, `open_in_new`) which screen readers announce as content. Every empty state announces its icon name before its message | `app/**`, `components/**` | `S2` |
| F-39 | `<html lang="da">` fixed while EN is selectable (F-19) | `app/layout.tsx:38` | `S3` |
| F-40 | **No visible focus styles.** Inputs set `outline-none` and swap `borderColor` on `onFocus`/`onBlur` via inline JS — mouse-visible only, and lost entirely for keyboard users on buttons and links | `app/page.tsx:82-83`, `app/search/page.tsx`, `components/MobileSearchBar.tsx` | `S2` |
| F-41 | **Nested interactive elements.** `SearchResultCard` grid variant puts a `<button>` (heart) inside an `<a>`; the list variant nests an `<a>` (Thomann) inside the card. Mitigated by `preventDefault`, but invalid nesting and an ambiguous tab order remain | `components/SearchResultCard.tsx:216-228,393` | `S3` |
| F-42 | **Filter panel is not announced.** The `tune` toggle has `aria-label="Filtre"` but no `aria-expanded` / `aria-controls`; the panel appears and disappears silently | `app/search/page.tsx` | `S3` |
| F-43 | **`autoFocus` on the landing hero input** steals focus and scroll position on load, and on mobile can raise the keyboard immediately | `app/page.tsx:84` | `S3` |
| F-44 | **Sub-category chips are buttons, not a listbox/tablist**, with no `aria-pressed`. The search source toggles do it correctly (`aria-pressed`), so the pattern already exists in-repo | `app/browse/[root]/page.tsx:192-216` | `S3` |
| F-45 | **Debug JSON dump ships to admins in-page** as an open `<details>` with raw `JSON.stringify` — fine as a tool, but it is inside the public browse component and gated only on a client-side `/api/admin/me` call. The API itself correctly re-checks admin server-side | `app/browse/page.tsx:160-178` | `S4` |
| F-46 | **Positives.** All 7 `<Image>` uses have `alt`. Every audited page has exactly one `<h1>`. Touch targets on `BottomNav` and card actions are `min-h-[44px]`/`min-w-[48px]`. `env(safe-area-inset-bottom)` is respected. `ListingErrorBoundary` isolates a bad listing so one row cannot blank the page | — | — |

### N. Artefact drift

#### F-47 — The frozen-cohort artefacts were never regenerated after activation `S2`
- **Paths** `data/klup-launch-cohort-frozen.csv`, `data/klup-frozen-cohort-asset-inventory.csv`
- **Behaviour** Both files still describe the **pre-056** world:
  - **9 of 48 rows carry an empty `slug`** — the products marked
    `kg_prerequisite = create_kg_product_before_support` /`missing_from_kg`.
    Migration 056 created all nine with real slugs (`gibson-les-paul-standard-60s`,
    `gibson-les-paul-standard-50s`, `gibson-les-paul-studio`,
    `gibson-les-paul-special`, `gibson-es-335-dot`, `fender-telecaster-thinline`,
    `fender-telecaster-custom`, `fender-american-vintage-52-telecaster`,
    `fender-american-professional-ii-stratocaster`). The manifest cannot be joined
    to production by slug for those nine, and their `page_route` is blank.
  - `article_state` and `image_state` are **empty for all 48 rows**, so the
    "3 articles / 29 images / 5 with none" coverage the handover cites is not
    actually recorded in the artefact it cites. (Ground truth today, measured:
    **3** articles, **34** images, **2** hero images, **14** with no image.)
  - `visibility_now` and `tier_now` are blank for the same 13 rows.
- **Impact** Any Stage 3 build that reads the frozen manifest — the obvious way
  to drive a product-page build or a sitemap — silently loses 9 of 48 products.
- **Disposition** **Correct** — `npm run build-product-artefacts` and review the
  diff. Explicitly permitted and expected; these are derived files.
- **Risk** Low, but it must happen **before** anything consumes the manifest.

---

## 4. Readiness matrices

Measured by `SELECT` against production, 2026-08-27. Legend: `✓` present ·
`–` absent · **Browse** = reachable through the live `/browse` UI today ·
**Chart** = has ≥5 Reverb sold-price points, the product page's chart threshold ·
**Listings** = `browse_product_projection.active_listing_count`.

### 4.1 — The 48 supported products

#### 4.1a The 14 supported **and** public

| # | Slug | Brand | Tier | Image | Hero | Article | Thomann | Taxonomy | Browse | Listings | Reverb pts | Chart |
|--:|---|---|---|:-:|:-:|:-:|:-:|---|:-:|--:|--:|:-:|
| 1 | `korg-ms-20` | Korg | legendary | ✓ | – | – | ✓ | classified | ✓ | 28 | 0 | – |
| 2 | `moog-minimoog` | Moog | legendary | ✓ | – | – | ✓ | classified | ✓ | 93 | 63 | ✓ |
| 3 | `rhodes-mark-i-stage-73` | Rhodes | legendary | – | – | – | – | **missing_subcategory** | ✗ | 12 | 0 | – |
| 4 | `rhodes-mark-i-suitcase-73` | Rhodes | legendary | – | – | – | – | **missing_subcategory** | ✗ | 9 | 0 | – |
| 5 | `rhodes-mark-ii-stage-73` | Rhodes | legendary | – | – | – | – | **missing_subcategory** | ✗ | 12 | 0 | – |
| 6 | `roland-juno-106` | Roland | legendary | ✓ | – | **✓ full** | – | classified | ✓ | 90 | 40 | ✓ |
| 7 | `roland-juno-60` | Roland | legendary | ✓ | – | **✓ full** | – | classified | ✓ | 60 | 89 | ✓ |
| 8 | `roland-jupiter-8` | Roland | legendary | ✓ | – | **✓ full** | – | classified | ✓ | 35 | 22 | ✓ |
| 9 | `roland-re-201` | Roland | legendary | ✓ | – | – | ✓ | classified | ✓ | 37 | 20 | ✓ |
| 10 | `roland-sh-101` | Roland | legendary | ✓ | – | – | ✓ | classified | ✓ | 11 | 0 | – |
| 11 | `roland-tr-808` | Roland | legendary | ✓ | – | – | – | classified | ✓ | 35 | 20 | ✓ |
| 12 | `roland-tr-909` | Roland | legendary | ✓ | ✓ | – | ✓ | classified | ✓ | 52 | 0 | – |
| 13 | `wurlitzer-200a` | Wurlitzer | legendary | – | – | – | – | **missing_subcategory** | ✗ | 19 | 0 | – |
| 14 | `yamaha-dx7` | Yamaha | legendary | ✓ | – | – | – | classified | ✓ | 123 | 0 | – |

*"Article full" = `attributes` carries `description` + `specs` + `history` +
`external_links` + `related_products`.*

#### 4.1b The 34 supported **and** `qa_only` (private)

| # | Slug | Brand | Image | Hero | Article | Thomann | Taxonomy | Listings | Reverb pts |
|--:|---|---|:-:|:-:|:-:|:-:|---|--:|--:|
| 15 | `emu-sp-1200` | E-mu | ✓ | – | – | – | classified | 48 | 0 |
| 16 | `fender-american-professional-ii-stratocaster` | Fender | – | – | – | – | **missing_subcategory** | 68 | 0 |
| 17 | `fender-american-vintage-52-telecaster` | Fender | – | – | – | – | **missing_subcategory** | 33 | 0 |
| 18 | `fender-mustang-bass` | Fender | ✓ | – | – | ✓ | classified | 76 | 0 |
| 19 | `fender-telecaster-custom` | Fender | – | – | – | – | **missing_subcategory** | 70 | 0 |
| 20 | `fender-telecaster-thinline` | Fender | – | – | – | – | **missing_subcategory** | 34 | 0 |
| 21 | `gibson-es-335-dot` | Gibson | – | – | – | – | **missing_subcategory** | 78 | 0 |
| 22 | `gibson-hummingbird` | Gibson | ✓ | ✓ | – | ✓ | classified | 242 | 20 |
| 23 | `gibson-j-45` | Gibson | ✓ | – | – | ✓ | classified | 273 | 0 |
| 24 | `gibson-les-paul-custom` | Gibson | ✓ | – | – | ✓ | classified | 76 | 0 |
| 25 | `gibson-les-paul-special` | Gibson | – | – | – | – | **missing_subcategory** | 71 | 0 |
| 26 | `gibson-les-paul-standard-50s` | Gibson | – | – | – | – | **missing_subcategory** | 1 | 0 |
| 27 | `gibson-les-paul-standard-60s` | Gibson | – | – | – | – | **missing_subcategory** | 5 | 0 |
| 28 | `gibson-les-paul-studio` | Gibson | – | – | – | – | **missing_subcategory** | 77 | 0 |
| 29 | `gibson-sg-standard-large-guard-with-maestro-vibrola` | Gibson | ✓ | – | – | – | classified | **0** | 0 |
| 30 | `gibson-sj-200-original` | Gibson | ✓ | – | – | ✓ | classified | 57 | 0 |
| 31 | `korg-mono-poly` | Korg | ✓ | – | – | – | classified | 2 | 0 |
| 32 | `korg-polysix` | Korg | ✓ | – | – | – | classified | 6 | 0 |
| 33 | `manley-voxbox` | Manley | ✓ | – | – | ✓ | classified | 19 | 0 |
| 34 | `martin-d-28` | Martin | ✓ | – | – | ✓ | classified | 5 | 0 |
| 35 | `moog-model-d` | Moog | ✓ | – | – | ✓ | classified | 61 | 0 |
| 36 | `moog-source` | Moog | ✓ | – | – | – | classified | 43 | 0 |
| 37 | `neumann-u87ai` | Neumann | ✓ | – | – | – | classified | 52 | 0 |
| 38 | `neve-portico-ii-master-buss-processor` | Neve | – | – | – | – | classified | 19 | 0 |
| 39 | `roland-juno-6` | Roland | ✓ | – | – | – | classified | 11 | 0 |
| 40 | `roland-jupiter-4` | Roland | ✓ | – | – | ✓ | classified | 13 | 32 |
| 41 | `roland-re-501` | Roland | ✓ | – | – | – | classified | 21 | 0 |
| 42 | `roland-system-100` | Roland | ✓ | – | – | ✓ | classified | **0** | 0 |
| 43 | `roland-tr-606` | Roland | ✓ | – | – | ✓ | classified | 36 | 0 |
| 44 | `roland-tr-707` | Roland | ✓ | – | – | ✓ | classified | 43 | 0 |
| 45 | `sequential-prophet-10` | Sequential | ✓ | – | – | ✓ | classified | 42 | 0 |
| 46 | `tube-tech-cl1b` | Tube-Tech | ✓ | – | – | ✓ | classified | 16 | 0 |
| 47 | `tube-tech-lca-2b` | Tube-Tech | ✓ | – | – | – | classified | 8 | 0 |
| 48 | `ua-1176ln` | Universal Audio | ✓ | – | – | – | classified | 35 | 0 |

#### 4.1c Rollup — the 48

| Readiness dimension | Count | % |
|---|--:|--:|
| Matcher-eligible (`active` + `supported`) | **48 / 48** | 100% |
| Product page renders today (auth required) | 48 / 48 | 100% |
| **Product page publicly reachable** | **0 / 48** | **0%** (F-01) |
| `browse_visibility='public'` | 14 / 48 | 29% |
| Reachable through live browse | 10 / 48 | 21% |
| Has `image_url` | 34 / 48 | 71% |
| Has `hero_image_url` | 2 / 48 | 4% |
| **No image at all** | **14 / 48** | **29%** |
| Has a draft article (`description`) | **3 / 48** | **6%** |
| Has Thomann new-price reference | 21 / 48 | 44% |
| Taxonomy `classified` | 35 / 48 | 73% |
| **`missing_subcategory` (browse-invisible)** | **13 / 48** | **27%** |
| Any sold-price history | 8 / 48 | 17% |
| **Renders a price chart (≥5 pts)** | **8 / 48** | **17%** |
| Zero active listings | 2 / 48 | 4% |
| Tier `legendary` | 14 / 48 | 29% |

### 4.2 — The 28 public products

Rows 1-14 are the supported cohort from 4.1a. Rows 15-28 are public but
`support_state='known'`.

| # | Slug | Brand | Tier | Support | Image | Article | Taxonomy | Browse | Listings | Newest match |
|--:|---|---|---|---|:-:|:-:|---|:-:|--:|---|
| 1 | `korg-ms-20` | Korg | legendary | **supported** | ✓ | – | classified | ✓ | 28 | 2026-08-27 |
| 2 | `moog-minimoog` | Moog | legendary | **supported** | ✓ | – | classified | ✓ | 93 | 2026-08-26 |
| 3 | `rhodes-mark-i-stage-73` | Rhodes | legendary | **supported** | – | – | missing_subcat | ✗ | 12 | 2026-08-26 |
| 4 | `rhodes-mark-i-suitcase-73` | Rhodes | legendary | **supported** | – | – | missing_subcat | ✗ | 9 | 2026-05-08 |
| 5 | `rhodes-mark-ii-stage-73` | Rhodes | legendary | **supported** | – | – | missing_subcat | ✗ | 12 | 2026-08-26 |
| 6 | `roland-juno-106` | Roland | legendary | **supported** | ✓ | **✓** | classified | ✓ | 90 | 2026-08-27 |
| 7 | `roland-juno-60` | Roland | legendary | **supported** | ✓ | **✓** | classified | ✓ | 60 | 2026-08-26 |
| 8 | `roland-jupiter-8` | Roland | legendary | **supported** | ✓ | **✓** | classified | ✓ | 35 | 2026-08-26 |
| 9 | `roland-re-201` | Roland | legendary | **supported** | ✓ | – | classified | ✓ | 37 | 2026-08-26 |
| 10 | `roland-sh-101` | Roland | legendary | **supported** | ✓ | – | classified | ✓ | 11 | 2026-08-26 |
| 11 | `roland-tr-808` | Roland | legendary | **supported** | ✓ | – | classified | ✓ | 35 | 2026-08-26 |
| 12 | `roland-tr-909` | Roland | legendary | **supported** | ✓ | – | classified | ✓ | 52 | 2026-08-26 |
| 13 | `wurlitzer-200a` | Wurlitzer | legendary | **supported** | – | – | missing_subcat | ✗ | 19 | 2026-08-26 |
| 14 | `yamaha-dx7` | Yamaha | legendary | **supported** | ✓ | – | classified | ✓ | 123 | 2026-08-27 |
| 15 | `ampex-atr-700` | Ampex | legendary | known | ✓ | – | classified | ✓ | **0** | — |
| 16 | `arp-2600` | ARP | legendary | known | ✓ | – | classified | ✓ | 3 | **2026-05-06** |
| 17 | `fender-jazz-bass` | Fender | legendary | known | ✓ | – | classified | ✓ | 285 | 2026-08-10 |
| 18 | `fender-precision-bass` | Fender | legendary | known | ✓ | – | classified | ✓ | 186 | **2026-05-03** |
| 19 | `fender-stratocaster` | Fender | legendary | known | ✓ | **✓** | classified | ✓ | 62 | 2026-08-08 |
| 20 | `fender-telecaster` | Fender | legendary | known | ✓ +hero | **✓** | classified | ✓ | 176 | 2026-08-11 |
| 21 | `gibson-es-335` | Gibson | legendary | known | ✓ +hero | **✓** | classified | ✓ | 9 | 2026-08-08 |
| 22 | `gibson-les-paul` | Gibson | legendary | known | ✓ | **✓** | classified | ✓ | 778 | 2026-08-11 |
| 23 | `linn-electronics-linndrum` | Linn | legendary | known | ✓ | – | classified | **✗ (F-04)** | 5 | **2026-05-22** |
| 24 | `oberheim-ob-x` | Oberheim | legendary | known | ✓ | – | classified | ✓ | **0** | — |
| 25 | `oberheim-ob-xa` | Oberheim | legendary | known | ✓ | – | classified | ✓ | **0** | — |
| 26 | `rhodes-mark-i-stage-88` | Rhodes | legendary | known | – | – | missing_subcat | ✗ | 1 | **2026-05-06** |
| 27 | `sequential-prophet-5` | Sequential | legendary | known | ✓ | – | classified | ✓ | 10 | 2026-08-10 |
| 28 | `strymon-timeline` | Strymon | **classic** | known | – | – | classified | ✓ | 25 | **2026-05-03** |

#### 4.2a Rollup — the 28

| Readiness dimension | Count | % |
|---|--:|--:|
| **Publicly reachable product page** | **0 / 28** | **0%** (F-01) |
| Matcher-eligible | 14 / 28 | 50% |
| **Matching frozen since activation** | **14 / 28** | **50%** (F-07) |
| Eligible in `browse_product_projection` (`is_public`) | 23 / 28 | 82% |
| **Actually served by the live browse UI** | **22 / 28** | **79%** (F-04) |
| Excluded by `missing_subcategory` | 5 / 28 | 18% |
| Has `image_url` | 22 / 28 | 79% |
| Has `hero_image_url` | 3 / 28 | 11% |
| Has a draft article | 7 / 28 | 25% |
| Any sold-price history | 10 / 28 | 36% |
| Zero active listings | 3 / 28 | 11% |
| Tier `legendary` | 27 / 28 | 96% |

**The five products excluded from browse by taxonomy:**
`rhodes-mark-i-stage-73`, `rhodes-mark-i-suitcase-73`, `rhodes-mark-ii-stage-73`,
`wurlitzer-200a`, `rhodes-mark-i-stage-88`. All five are electric-piano
identities with **no** image, **no** article and **no** sub-category — the same
five the handover names as the content-coverage gap. They are the weakest cohort
on every dimension simultaneously.

### 4.3 — The 14 public **and** supported

This is the only cohort where every axis lines up: an active identity, matcher
eligibility, a live match stream and a published page. It is the natural V1 set.

| # | Slug | Page renders | Public today | In browse | Image | Article | Price chart | Live matching | **V1-ready** |
|--:|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 1 | `roland-juno-106` | ✓ | ✗ F-01 | ✓ | ✓ | ✓ | ✓ | ✓ | **✅ complete** |
| 2 | `roland-juno-60` | ✓ | ✗ F-01 | ✓ | ✓ | ✓ | ✓ | ✓ | **✅ complete** |
| 3 | `roland-jupiter-8` | ✓ | ✗ F-01 | ✓ | ✓ | ✓ | ✓ | ✓ | **✅ complete** |
| 4 | `moog-minimoog` | ✓ | ✗ F-01 | ✓ | ✓ | – | ✓ | ✓ | 🟡 no article |
| 5 | `roland-re-201` | ✓ | ✗ F-01 | ✓ | ✓ | – | ✓ | ✓ | 🟡 no article |
| 6 | `roland-tr-808` | ✓ | ✗ F-01 | ✓ | ✓ | – | ✓ | ✓ | 🟡 no article |
| 7 | `korg-ms-20` | ✓ | ✗ F-01 | ✓ | ✓ | – | ✗ | ✓ | 🟠 no article, no chart |
| 8 | `roland-sh-101` | ✓ | ✗ F-01 | ✓ | ✓ | – | ✗ | ✓ | 🟠 no article, no chart |
| 9 | `roland-tr-909` | ✓ | ✗ F-01 | ✓ | ✓ +hero | – | ✗ | ✓ | 🟠 no article, no chart |
| 10 | `yamaha-dx7` | ✓ | ✗ F-01 | ✓ | ✓ | – | ✗ | ✓ | 🟠 no article, no chart |
| 11 | `rhodes-mark-i-stage-73` | ✓ | ✗ F-01 | **✗** | **✗** | – | ✗ | ✓ | 🔴 not V1-ready |
| 12 | `rhodes-mark-i-suitcase-73` | ✓ | ✗ F-01 | **✗** | **✗** | – | ✗ | ✓ | 🔴 not V1-ready |
| 13 | `rhodes-mark-ii-stage-73` | ✓ | ✗ F-01 | **✗** | **✗** | – | ✗ | ✓ | 🔴 not V1-ready |
| 14 | `wurlitzer-200a` | ✓ | ✗ F-01 | **✗** | **✗** | – | ✗ | ✓ | 🔴 not V1-ready |

**Readiness bands within the 14:**

| Band | Count | Meaning |
|---|--:|---|
| ✅ Complete — image + article + chart + live matching + browse | **3** | Juno-106, Juno-60, Jupiter-8 |
| 🟡 Strong — everything except the article | **3** | Minimoog, RE-201, TR-808 |
| 🟠 Thin — image and listings, no price answer | **4** | MS-20, SH-101, TR-909, DX7 |
| 🔴 Blocked — no image, no sub-category, no price history | **4** | the three Rhodes and the Wurlitzer |

**A public V1 built only from the 14 supported-and-public products can answer the
product's defining price question on 6 of them, and can show a browse-reachable,
imaged page on 10.**

---

## 5. Blockers to a coherent public V1

Ordered by what must be true before anything else is worth doing.

| # | Blocker | Findings | Nature |
|--:|---|---|---|
| **B1** | **Product pages are not public.** The stated core experience is entirely behind `/login`. Every browse card links into it | F-01 | 2-line fix, but see B2 |
| **B2** | **There is no visibility gate on the product route.** Opening B1 without this publishes 3,976 unintended pages and breaks the lifecycle contract at exactly the seam it was built to protect | F-03 | Must ship with B1 |
| **B3** | **Browse silently truncates the catalogue.** Three surfaces report three different public counts; one fully public product is unreachable; the truncation is order-dependent and could shift without a deploy | F-04, F-06, F-08 | Correctness |
| **B4** | **The homepage shows no catalogue to anonymous visitors.** The discovery API is auth-gated | F-02 | 1-line fix |
| **B5** | **`/search` is the non-goal.** It is a live-scraping generic SERP with pre-pivot copy, no catalogue awareness, no product routing, and no unsupported/demand-signal state. It is the second-most-prominent public surface | F-14, F-15, F-29, F-37 | Requires the experience specification |
| **B6** | **Zero SEO surface.** No SSR on the product page, no per-page metadata, no canonical URLs, no structured data, no sitemap. A curated catalogue that search engines cannot see cannot acquire the audience it is curated for | F-09, F-16, F-17 | Substantial but mechanical |
| **B7** | **Content coverage cannot support the promise.** 3 of 48 articles; 14 of 48 without any image; a price chart on 8 of 48. Only 6 of the 14 public-and-supported products can answer *"er det en god pris?"* | F-12, matrices 4.1c / 4.3 | Content acquisition, separately authorised |
| **B8** | **Half the public catalogue is decaying.** The 14 public `known` products stopped receiving matches on activation day, while card timestamps show scrape recency and therefore look fresh | F-07, F-23 | Product decision + card fix |
| **B9** | **Analytics without consent, and without the events Stage 3 needs.** Four trackers, no banner, no privacy-policy route; no product-view, browse, or unsupported-query events | F-20 | Compliance + instrumentation |
| **B10** | **The frozen-cohort manifest cannot be joined to production** for 9 of 48 products | F-47 | One command, must precede any manifest-driven build |

---

## 6. Reusable assets and components

The frontend is in far better shape than "0% of the core experience is public"
suggests. Almost everything needed for V1 exists.

**Reuse as-is**

| Asset | Path | Why |
|---|---|---|
| `browse_product_projection` | database view | Already computes `is_public`, `taxonomy_state`, `supply_state`, `tier_rank`, `active_listing_count`, `has_image`. Every browse question is answerable in SQL |
| `PATCH /api/admin/products/[id]` | `app/api/admin/products/[id]/route.ts` | Axis-typed, intent-gated, `?dryRun=1`, before/after manifest. The best-designed surface in the repository. Only its tier/monitoring prose is stale |
| `buildDiscoverResponse` | `lib/browse.ts:581-623` | Correctly filters `is_public` in SQL; immune to F-04. Ready the moment F-02 lands |
| `/api/market-price`, `/api/price-observations` | `app/api/{market-price,price-observations}/route.ts` | Complete deal-context primitives (min/max/count, p25/p50/p75) resolving by `listing_id` **or** `product_slug`. Never called. The single highest-leverage unused asset |
| `ListingErrorBoundary` | `components/ListingErrorBoundary.tsx` | Per-listing isolation with a skeleton fallback |
| `lib/listing-price-integrity.ts` | — | Already filters the impossible legacy Kleinanzeigen prices out of the product page |
| `lib/currency.ts` | — | Raw `price` + `currency` stored, DKK approximation at read time, exactly as `CLAUDE.md` requires |
| Loading skeletons | browse, browse-leaf, search, product, saved | Real shape-matched skeletons, not spinners |
| Design tokens | `app/globals.css`, `tailwind.config.ts` | Complete light/dark token set; DM Serif Display + Inter correctly applied; `--accent` reserved and unused |
| `lib/query-normalizer.ts`, `lib/synonyms.ts` | — | Directly reusable for supported-search resolution (B5) |

**Reuse with correction**

| Asset | Correction |
|---|---|
| `app/product/[slug]/page.tsx` | The markup — hero, price band, chart, specs `<dl>`, history timeline, external links, related grid, listing list — is good. It needs a server/client split (F-09) and i18n keys (F-30), not a redesign |
| `ProductCard` | Sound in both variants; needs i18n and a listing-count source aligned with the product page |
| `SearchResultCard` | Rich and battle-tested. Fix the green badge, the DBA provenance fallback, the timestamp semantics and the hardcoded colours; then switch on `productSlug` |
| `lib/browse.ts` | The projection shaping, sorting and debug/audit payload are all correct. Only the fetch strategy is wrong |
| Onboarding flow | Four complete translated steps plus `lib/onboarding.ts` and `OnboardingHeader`, fully built and unreachable. Either wire it up or delete it — leaving it is the worst option |

**Remove**

`components/WatchlistListings.tsx` (zero references) ·
`components/ListingCard.tsx` (superseded) ·
`--tier=` in `scripts/scrape-dba.ts` (cosmetic residue) ·
the `crons` block in `frontend/vercel.json` (contradicts the deployed state) ·
the `/onboarding` entry in `PUBLIC_PREFIXES` (404s).

---

## 7. Likely quick wins

Ordered by value per unit of risk. Every item is a small, self-contained change.

| # | Change | Finding | Effort | Effect |
|--:|---|---|---|---|
| 1 | Add `/api/discover` to `PUBLIC_PREFIXES` | F-02 | 1 line | The anonymous homepage gains both catalogue carousels immediately |
| 2 | Add `/product` **and** `/api/product` to `PUBLIC_PREFIXES`, **and** a `browse_visibility` gate + `404` in the product route | F-01, F-03 | ~6 lines | The core experience becomes public — correctly scoped to 28 pages |
| 3 | Filter `is_public` in SQL in `fetchBrowseRows`, keep the unfiltered query for the admin debug path | F-04 | ~15 lines | Browse counts become correct and stable; LinnDrum reappears |
| 4 | Flip the `MobileSearchBar` breakpoint | F-25 | 1 word | Restores in-context search on mobile browse and product pages |
| 5 | Add `kleinanzeigen` to the search UI's `ALL_SOURCES` and to `listingSourceKey` | F-15 | 2 lines | A monitored marketplace becomes searchable |
| 6 | Replace `bg-green-500` with a neutral/destructive token | F-23 | 1 line | Restores the sparse-accent rule |
| 7 | Make `PlatformBadge` return an explicit "Ukendt" instead of defaulting to DBA | F-23 | 3 lines | Stops mislabelling provenance |
| 8 | Add `aria-hidden="true"` to decorative Material Symbols spans | F-38 | mechanical, 86 sites | Large screen-reader improvement |
| 9 | `npm run build-product-artefacts` and review the diff | F-47 | 1 command | The frozen manifest becomes joinable for all 48 |
| 10 | Auth-branch `SideNav` (mirror `BottomNav`) | F-28 | ~10 lines | Anonymous visitors stop being offered "Log ud" |
| 11 | Add `metadataBase` + `openGraph` to the root layout | F-17 | ~10 lines | Every shared link gets a real preview |
| 12 | Add `app/not-found.tsx` and exclude it from the middleware redirect | F-05 | ~20 lines | Correct 404s instead of login bounces |
| 13 | Correct the tier/monitoring prose in `PATCH /api/admin/products/[id]` and stop sending `intent:['monitoring']` for tier | F-32 | ~15 lines | The operator surface stops asserting a removed coupling |
| 14 | Add a warning comment to `frontend/vercel.json` (or remove the `crons` block) | F-35 | 3 lines | Repo stops contradicting the deployed cron state |

Items 1-7 and 10 are, together, a single afternoon and change the public product
from "nothing works without an account" to "the catalogue is browsable and
correct".

---

## 8. Implementation sequence after the experience specification is approved

**Phase 0 — Preconditions (before any Stage 3 code)**
1. Product-owner decision on the V1 public set: the 14 supported-and-public, or a
   promoted set that resolves F-07. This determines everything downstream.
2. `npm run build-product-artefacts`; review the diff (F-47).
3. Decide the product-page visibility predicate: `public` only, or
   `public OR qa_only` for signed-in staff (F-03).

**Phase 1 — Make the existing catalogue correct and public** *(no new surfaces)*
4. F-03 visibility gate **then** F-01 allow-list, in that order, in one change.
5. F-02 discover allow-list.
6. F-04 browse projection fix; F-08 listing-count alignment; F-06 server-side
   sub-category filter.
7. F-25, F-28, F-27 navigation and mobile fixes.
8. F-23 card correctness (green badge, provenance fallback, timestamp semantics,
   theme-safe colours).
9. F-05 `not-found.tsx`; split error from not-found (F-10); route-level
   `error.tsx` boundaries.
*Exit criterion: an anonymous visitor can reach every intended public product
page from the homepage and from browse, and every count on every surface agrees.*

**Phase 2 — Make the product page the product**
10. F-09 server/client split with `generateMetadata`.
11. F-17 canonical URLs, Open Graph, Twitter; F-16 `app/sitemap.ts`; `Product` /
    `AggregateOffer` JSON-LD.
12. F-30 i18n sweep across the product page and cards; F-19 `lang` sync and a
    mobile locale toggle.
13. F-08 listing pagination on the product page; F-13 related-product visibility
    and ordering; F-11 per-source price attribution.
14. Wire `/api/market-price` and `/api/price-observations` into listing cards
    (F-21) — the deal-context layer, using code that already exists.
*Exit criterion: `/product/roland-juno-106` is server-rendered, indexable,
correctly titled, fully Danish, and answers the price question.*

**Phase 3 — Navigation families and restricted search** *(specification-dependent)*
15. Navigation-family browse per the handover's IA — families group, never
    aggregate.
16. Replace the public `/search` with catalogue-restricted search (F-14):
    resolve against the supported set, route hits to product pages, reuse
    `query-normalizer` and `synonyms`.
17. Build the unsupported state and the demand signal (F-29) — the piece the
    handover explicitly records as not existing.
18. Move the live-scrape path behind auth or admin; keep the rate limiter.
19. F-26 URL-persisted filter, sort and page state.
*Exit criterion: an off-catalogue query tells the user so and is recorded.*

**Phase 4 — Instrumentation, compliance and hygiene**
20. F-20 consent gate; privacy-policy and terms routes (the i18n keys exist);
    remove the hardcoded GA id.
21. Product-view, browse and unsupported-query events.
22. F-38, F-40, F-41, F-42, F-44 accessibility pass.
23. F-33-F-37 dead-path removal; F-24 onboarding decision; F-32 support-axis
    admin control.

**Runs alongside, separately authorised:** content acquisition for B7 — images
for the 14 without one, sub-categories for the 13 `missing_subcategory` rows,
articles beyond the current 3, and price history beyond the current 8.

---

## 9. Where the live site is already stronger than the documentation suggests

The documentation is conservative about the frontend. Several things are better
than a reader of `CLAUDE.md` and the handover would expect.

1. **The promotion seam is not merely "existing" — it is well-engineered.**
   The handover lists `/admin/products` + `PATCH …/[id]` as an asset to preserve.
   It is considerably more: axis-typed field mapping, fail-closed validation,
   mandatory `intent` for the two consequential axes, `?dryRun=1`, a
   before/after manifest with a plain-language consequence per change, and an
   explicit refusal to promote an inactive identity. Its only defect is stale
   prose. **The lifecycle contract is enforced in code, not just in a document.**

2. **The deal-context layer is already built.** `/api/market-price` and
   `/api/price-observations` deliver min/max/count and p25/p50/p75, resolve by
   listing id **or** product slug, and are batched. No document mentions them.
   The "is this a good price?" primitive does not need to be designed — it needs
   to be called.

3. **Image coverage is materially better than recorded.** The handover cites
   "29 carry an image; 1 has a hero image". Measured today: **34 of 48** have
   `image_url` and **2** have `hero_image_url`. The 056-created products arrived
   better-supplied than the pre-activation inventory recorded.

4. **The browse projection is a genuinely good piece of data design.**
   `browse_product_projection` already exposes `is_public`, `taxonomy_state`,
   `supply_state`, `tier_rank`, `has_image` and `active_listing_count`, and
   `lib/browse.ts` builds a real audit payload (per-root/per-subcategory counts,
   brand breakdown, explicit `exclusion_reason` per excluded product, orphan
   summary) behind a server-verified admin check. F-04 is a fetch bug on top of
   a sound model — the diagnosis tooling for F-04 already ships.

5. **The listing card is richer than the docs imply.** Correct per-source brand
   colours matching `frontend/CLAUDE.md`, country-flag location normalisation,
   original-currency display with a DKK approximation, discount detection,
   inline magic-link email capture for anonymous users, PostHog events on click
   and save, and a `productSlug` bridge to the canonical page. Most of it is
   already exercised on `/saved`.

6. **Resilience is real.** `ListingErrorBoundary` isolates individual listings;
   `hasPlausibleListingPrice` keeps the known-bad legacy Kleinanzeigen prices off
   the product page; `deterministicListingId` fixed a saved-listing rotation bug;
   `/api/scrape` carries a per-IP rate limiter with bounded-memory GC. These are
   scars from real defects, and they held.

7. **Loading and empty states are already designed.** Five surfaces have
   shape-matched skeletons rather than spinners, and every empty state has an
   icon, a heading, a subtext and a CTA. `/saved` and `/watchlists` even ship
   blurred "fake card" teasers for anonymous visitors. This is finished design
   work no one has to redo.

8. **The state-axis discipline reaches into the frontend.** `lib/browse.ts`
   distinguishes `taxonomy_state`, `supply_state` and `browse_visibility` as
   independent concerns and reports each separately, rather than collapsing them
   into a single "visible" boolean. The five-axis model is not only a document.

9. **The Kup-score is correctly hidden, with the reasoning in the code.**
   `SearchResultCard.tsx:236` carries an explicit comment explaining that the
   rating is withheld until there is sufficient per-variant price history. The
   discipline `frontend/CLAUDE.md` asks for is being kept.

10. **The verification baseline holds.** `next lint` reproduces exactly the four
    documented `app/layout.tsx` warnings and nothing else. The documented
    baseline is accurate.

---

## 10. Non-mutation statement

Every production database access in this audit was `SELECT`. Every production
HTTP request was `GET`. No file in the repository was created, modified or
deleted other than this document. No migration, importer, scraper, matcher run,
backfill, rescrape, publish, promotion, PM2 change or Vercel change was
performed. Nothing was committed or pushed. `.agents/`, `.mcp.json` and
`skills-lock.json` were not read into, modified or staged.
