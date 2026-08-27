# Klup Stage 3 — product-experience specification

**Status:** specification only. **Nothing was built, changed, migrated, published,
scraped, committed or deployed by this work.** Every production access was a
`SELECT`. The Vercel scrape cron remains disabled, product selection remains
frozen, and no KG, matcher, scraper, monitoring or migration change is proposed.

| | |
|---|---|
| Written | 2026-08-27 |
| Foundation closed at | `2c864e4106546f89ad1e7925b4256bb2f3210c57` |
| Deployed production commit | `c7bd481` (Vercel Ready) |
| Authority read | [`CLAUDE.md`](../CLAUDE.md) · [`klup-documentation-index.md`](klup-documentation-index.md) · [`klup-foundation-handover.md`](klup-foundation-handover.md) · [`klup-launch-catalogue-selection.md`](klup-launch-catalogue-selection.md) · [`klup-product-lifecycle-guide.md`](klup-product-lifecycle-guide.md) |
| Application inspected | `frontend/app/**`, `frontend/lib/browse.ts`, `frontend/middleware.ts`, `frontend/components/**` |
| Production inspected | `www.klup.dk` (HTTP) and the database (`SELECT` only), 2026-08-27 |

Every proposal in this document is tagged:

| Tag | Meaning |
|---|---|
| **[REUSE]** | Reuse unchanged. No code, copy or data change. |
| **[CORRECT]** | Correct or simplify something that already exists. |
| **[BUILD]** | Build new. |
| **[DEFER]** | Explicitly deferred — named, scoped, and *not* in V1. |

---

## 0. What the inspection actually found

These are measured, not assumed. They drive most of the specification, so they
come first.

### 0.1 The core experience is behind a login wall

`frontend/middleware.ts` lists `PUBLIC_PREFIXES` as `/login`, `/signup`,
`/browse`, `/search`, `/auth/`, `/onboarding/`, `/api/browse`, `/api/brands`,
`/api/scrape`, `/api/price-observations`, `/api/cron/`, `/api/webhooks/`.

**`/product` and `/api/product` are not on that list.** Verified live:

```
GET https://www.klup.dk/product/roland-juno-106   → 307 → /login
GET https://www.klup.dk/api/product/roland-juno-106 → 307
```

`/browse` is public, and every card on it links to `/product/<slug>`. The public
browse experience is therefore a dead end: an anonymous visitor can see a grid of
categories, click any product, and land on a sign-in form. **Canonical product
pages are described everywhere in the authority documents as "the core
experience", and today no member of the public can read one.** Nothing else in
this specification matters until that is fixed.

### 0.2 Catalogue reality — 62 relevant rows, four different meanings

`SELECT`, 2026-08-27:

| Cohort | n | Behaviour today |
|---|--:|---|
| `supported` + `public` | **14** | matcher-eligible, publicly listed in browse, page behind login |
| `supported` + `qa_only` | **34** | matcher-eligible, invisible in browse, page behind login |
| `known` + `public` (unsupported) | **14** | **not** matcher-eligible, publicly listed in browse, page behind login |
| Total addressable | **62** | |

The 14 public-but-unsupported rows are the ones the selection document
deliberately held from launch, plus six **navigation-family labels** that are
live as if they were priced products:

| Slug | Active matched listings | Problem |
|---|--:|---|
| `gibson-les-paul` | 605 | family label aggregating five distinct markets |
| `fender-telecaster` | 278 | family label |
| `fender-jazz-bass` | 266 | family label |
| `fender-precision-bass` | 160 | family label |
| `fender-stratocaster` | 129 | family label |
| `gibson-es-335` | 7 | family label; `335` is a banned bare token |
| `strymon-timeline` | 28 | held from launch (2.9k median) |
| `sequential-prophet-5` | 9 | held — Rev3/Rev4 not separated |
| `linn-electronics-linndrum` | 3 | held — no observable supply |
| `rhodes-mark-i-stage-88` | 1 | last seen **2026-05-06** |
| `arp-2600` · `oberheim-ob-x` · `oberheim-ob-xa` · `ampex-atr-700` | 0 | held — zero active listings |

Because `support_state='known'`, **none of these can ever gain a new match.**
Their listing sets are frozen legacy aggregates that can only decay. Meanwhile
the 34 maintained, matcher-eligible products — including the highest-supply rows
in the whole catalogue (`gibson-j-45` 198 active listings, `gibson-hummingbird`
119, `gibson-es-335-dot` 78) — are invisible.

**The live experience is exactly inverted: Klup shows the products it no longer
maintains and hides the products it does.**

### 0.3 Browse silently truncates

`buildBrowseRootResponse` (`frontend/lib/browse.ts:346`) calls
`browse_product_projection` with `.eq('browse_domain','music')` and **no range or
pagination**. That projection returns **4,004 rows**; PostgREST caps an unbounded
request (default 1,000). Counted in the database, **23** products are
`public` *and* taxonomy-`classified`. Counted by production:

```
GET https://www.klup.dk/api/browse
bass-guitars 1 · effects-and-pedals 1 · electric-guitars 4 · keyboards-and-synths 12 · pro-audio 1   = 19
```

Four public products are missing from browse, and every category count is
unreliable, for a purely mechanical reason. The request also transfers 4,004 rows
to render five tiles.

### 0.4 Taxonomy blocks 13 supported products from ever being browsable

`is_public` in the projection is `status='active' AND browse_visibility='public'
AND taxonomy_state='classified'`. `taxonomy_state` is `missing_subcategory`
whenever `subcategory_id IS NULL`. Today:

| Cohort | Missing subcategory |
|---|---|
| `supported`, `public` | `rhodes-mark-i-stage-73`, `rhodes-mark-i-suitcase-73`, `rhodes-mark-ii-stage-73`, `wurlitzer-200a` |
| `supported`, `qa_only` | all nine migration-056 guitars: `fender-american-professional-ii-stratocaster`, `fender-american-vintage-52-telecaster`, `fender-telecaster-custom`, `fender-telecaster-thinline`, `gibson-es-335-dot`, `gibson-les-paul-special`, `gibson-les-paul-standard-50s`, `gibson-les-paul-standard-60s`, `gibson-les-paul-studio` |
| `known`, `public` | `rhodes-mark-i-stage-88` |

**13 supported products cannot appear in browse even if they were published
tomorrow.** Four of them are public *now* and still invisible. This is product-data
curation (assign a subcategory), not schema work — but it gates the experience.

### 0.5 There is almost no sold-price data

The product page's "Typisk brugtpris" is computed in
`app/api/product/[slug]/route.ts` from **`reverb_price_history` sold rows only**
(plus an `ilike` join to `auctionet_price_history`), IQR-filtered, requiring
≥3 points.

| Cohort | With ≥3 Reverb sold points |
|---|--:|
| 48 supported | **8** |
| 14 public unsupported | 4 |
| All 62 | **12** |

**40 of the 48 supported products cannot show a price band at all today**, and
fall back to *"Ikke nok prisdata til at beregne typisk pris endnu."* Meanwhile the
same products carry live matched asking prices — Klup's own strongest asset — and
never use them for price context. Deal evaluation cannot be built on sold history
in V1.

### 0.6 Search is a live scraper, not a catalogue

`/search` calls `GET /api/scrape?q=…&sources=…`, which invokes `scrapeDba`,
`scrapeFinn`, `scrapeBlocket`, `scrapeKleinanzeigen`, a Thomann search scraper and
a paste-a-URL fetcher, **writes rows to `listings`**, and is unauthenticated
(middleware rate-limits it to 20 requests/minute/IP). Any visitor can drive
marketplace requests and database writes by varying `?q=`.

This is a generic marketplace SERP over arbitrary queries, it is a live writer
outside the frozen monitoring boundary, and it is the *primary* navigation item
in `SideNav` and the centre FAB in `BottomNav`.

### 0.7 The copy is still a multi-vertical marketplace

Verified in the production HTML and `lib/i18n.ts`:

- `<title>Klup</title>`, `<meta name="description" content="Kup efter kup – det er Klup">`
- Search placeholder: **"Søg efter alt… (f.eks. iphone, sofa, cykel)"**
- Headline: "Find dit næste kup." / "Vi holder øje med priserne — du slapper af."
- `/onboarding/step1` offers **Fotografi, Musikudstyr, Dansk Design, Mode, Teknologi** — four of the five verticals are out of scope and already inactive in the KG. (`/onboarding/step4` is already a redirect stub to `/login`.)
- `/api/product/[slug]` filters on `slug` only — no `status`, no `browse_visibility`. Inactive non-music rows (`macbook-pro-m3-max`, Wegner `ch20`, `specialized-stumpjumper`) would render as Klup product pages if the auth wall were simply removed. **Publishing product pages and gating them are the same task.**

### 0.8 Smaller, verified defects

| Where | Finding |
|---|---|
| `components/MobileSearchBar.tsx` | rendered `hidden md:block` — it is a **desktop-only** bar despite the name; mobile browse/product pages have no search field |
| `app/product/[slug]/page.tsx:138` | passes `active="soeg"` to `SideNav`; `app/browse/page.tsx:72` passes `active="hjem"` — neither is a real tab, so nav highlighting is wrong on both |
| `components/SearchResultCard.tsx:216` | discount badge uses `bg-green-500` — violates the "green only on Kup stars and Aktiv badges" rule *and* the no-hardcoded-colour rule |
| Product page | tier badge renders literal English `Legendary` / `Classic`; specs/history card headings are hardcoded English (`Specifications`, `Product History`, `Related gear`), against `frontend/CLAUDE.md` |
| Product page | `Ingen aktive annoncer` is rendered twice for an empty product (hero block and list block) |
| `/` | logged-in users are redirected to `/watchlists` by middleware, so a returning user never sees product-centred discovery |
| Browse root tiles | `pro-audio` is illustrated with `ampex-atr-700` (0 listings, held from launch) and `bass-guitars` with `fender-jazz-bass` (a family label) |
| Category names | `kg_category` holds `name_da = name_en` for the roots — production shows Danish users **"Bass Guitars"**, **"Keyboards and Synths"**, **"Pro Audio"** |

---

## 1. Klup's primary user promise

**[CORRECT] — one promise, in Danish, everywhere.**

> **Klup følger brugte instrumenter og studieudstyr på tværs af DBA, Finn,
> Blocket, Kleinanzeigen og Reverb — og fortæller dig, hvad de faktisk koster.**

The question the product answers is unchanged from `CLAUDE.md` §1:
*"Er 4.500 kr for en Roland Juno-106 en god pris i dag?"*

Three sentences the whole experience must be able to defend:

1. **Vi udvælger.** Klup follows a deliberately small, named catalogue — not every
   ad on the internet. Coverage is a promise about *depth*, never breadth.
2. **Vi prissætter ærligt.** Every number is labelled with what it is (asking or
   sold), where it came from, how many observations it rests on, and when it was
   last checked. If Klup cannot say, it says so.
3. **Vi sælger ikke.** Klup owns no inventory, brokers nothing, and every listing
   link goes to the seller's own marketplace.

**What must disappear from the promise:** "Find dit næste kup" as a *deal-hunting*
frame, "Søg efter alt", "Vi søger på {platforms} samtidig" (Klup does not search
on demand — it monitors continuously), and every reference to non-music verticals.

**[DEFER]** A tagline competition, brand refresh, logo work, and the `radar`
mark. The current identity is adequate; the words are the problem.

---

## 2. Product-state model → surface behaviour

The five axes of `CLAUDE.md` §2 stay authoritative and unchanged. **[REUSE]**
This table is the single place the experience reads them; no surface may infer
one axis from another.

| State (`status` / `support_state` / `browse_visibility`) | n today | Catalogue & browse | Search resolves | `/product/<slug>` | Live listings | Price context | Alerts |
|---|--:|---|---|---|---|---|---|
| active / supported / public — **"fulgt"** | 14 | yes | yes | **public** | yes | yes, if data qualifies | yes |
| active / supported / qa_only — **"privat"** | 34 | no | no | **admin-only**, QA banner | yes (internal) | internal | no |
| active / known / public — **"arkiveret"** | 14 | family pages: yes, as family. Others: yes, marked *ikke fulgt* | family label → family page; others by exact name only | public, **archived template** | **no listing list** | **no price claim** | no |
| active / known / non-public — **"kendt"** | ~3.5k | no | no | **404** | no | no | no |
| active / reserve | 0 today | no | no | 404 | no | no | no |
| inactive (incl. all non-music) | ~460 | no | no | **404** | no | no | no |

Three rules follow, and they are the backbone of the whole specification:

- **[CORRECT] Publication is a gate, not an accident.** `/api/product/[slug]` and
  the page must resolve `status` and `browse_visibility` and return 404 for
  anything that is not `public` (or `qa_only` *and* the caller is an admin). This
  is what makes it safe to take the login wall down.
- **[CORRECT] "Supported" is what licenses a price claim.** A page for an
  unsupported product may exist, but it must not show a listing feed, a price
  band, or an alert CTA — it cannot be kept current.
- **[REUSE] Promotion stays the only way a product becomes public.**
  `/admin/products` + `PATCH /api/admin/products/[id]` with explicit `intent`,
  `?dryRun=1` and the before/after manifest already exist and are correct. No
  parallel publishing tool, and no experience surface may write these axes.

---

## 3. Routes and global navigation

### 3.1 Routes

**[REUSE] Keep every existing URL path.** Slugs are the primary key for URLs and
matching, inbound links and analytics exist, and renaming `/product` → `/produkt`
or `/browse` → `/katalog` buys nothing. Danish appears in labels, not in paths.

| Route | Auth | Change | Notes |
|---|---|---|---|
| `/` | public | **[CORRECT]** | Music-specific catalogue home. Stop redirecting logged-in users away (§4). |
| `/browse` | **public** | **[CORRECT]** | The catalogue: conventional categories. Paginate the projection query (§0.3). |
| `/browse/[root]` | **public** | **[CORRECT]** | Category page; subcategory chips already exist. |
| `/product/[slug]` | **public → gated by state** | **[CORRECT]** | Canonical product page. Public iff `public`; admin-only iff `qa_only`; else 404. |
| `/family/[slug]` | public | **[BUILD]** | Navigation-family page. Never aggregates. §6–7. |
| `/search` | public | **[CORRECT]** | Restricted resolver over the supported catalogue. No live scraping. §9. |
| `/saved` | auth | **[REUSE]** | Saved listings. |
| `/watchlists` | auth | **[CORRECT]** | Reframed as **product alerts**. §10.3. |
| `/profile` | auth | **[REUSE]** | |
| `/login`, `/signup`, `/auth/*` | public | **[REUSE]** | |
| `/om-data` | public | **[BUILD]** | One page: what Klup follows, which sources, how often, what the numbers mean. §11. |
| `/onboarding/step1..3` | — | **[CORRECT]** | Multi-vertical; retire behind a redirect to `/` (step4 already redirects). |
| `/admin/**`, `/intel` | admin | **[REUSE]** | Unchanged, never in navigation. |
| `/api/scrape` | public | **[CORRECT]** | Remove from every user-facing path. §9.4. |

### 3.2 Global navigation

**[CORRECT] Reorder and rename. Discovery first, search second.**

| Position | Label (da) | Route | Was |
|--:|---|---|---|
| 1 | **Katalog** | `/browse` | position 2, "Udforsk" |
| 2 | **Søg** | `/search` | position 1 — and the mobile centre FAB |
| 3 | **Gemt** | `/saved` | unchanged |
| 4 | **Alerts** | `/watchlists` | "Notifikationer" |
| 5 | **Profil** | `/profile` | unchanged |

- **[CORRECT]** `SideNav` `active` must be derived from `pathname` for all five
  items. Delete the vestigial `NavTab` tab-state path and the dead
  `onChange={() => {}}` props on `/browse`, `/browse/[root]` and `/product/[slug]`.
- **[CORRECT]** Mobile: the centre FAB becomes **Katalog**, not Søg. Search is a
  normal tab. A product-centred product should not make "type a free-text query"
  its largest affordance.
- **[REUSE]** Theme toggle, DA/EN toggle and logout positions in `SideNav`.
- **[DEFER]** A logged-out top bar with a marketing menu (om, priser, kontakt).
  V1 needs `/om-data` linked from the footer and from every price block.

---

## 4. Homepage hierarchy and onboarding

### 4.1 Hierarchy (top to bottom)

1. **[CORRECT] Promise block.** DM Serif Display headline stating the music
   scope explicitly, one sub-line naming the five marketplaces, and one honest
   coverage line rendered from data: *"Klup følger 48 produkter og har set N
   aktive annoncer i dag."* No hero image.
2. **[CORRECT] One search field — labelled as a catalogue lookup.**
   Placeholder: *"Søg efter et produkt Klup følger — fx Juno-106, TR-808, Les Paul Custom"*.
   Below it, four to six real chips (`Roland Juno-106`, `Roland TR-808`,
   `Rhodes Mark I Stage 73`, `Gibson Les Paul Custom`) that navigate straight to
   product pages. The field resolves against the catalogue (§9); it never opens a
   generic SERP.
3. **[BUILD] Kategorier.** The conventional categories (§5) as a compact grid,
   with live counts. This is the primary path, above any carousel.
4. **[CORRECT] "Fulgt lige nu"** — replaces the current `Legendarisk gear`
   carousel. Source: public **and** supported products, ordered by active listing
   count. Today that is 14 products; that is honest and enough.
5. **[CORRECT] "Nye annoncer"** — replaces `Populært lige nu`. The most recently
   ingested matched listings across supported products, each showing product name,
   price, source badge and age. This is the single strongest proof that Klup is
   live, and nothing on the homepage currently does it.
6. **[BUILD] "Sådan læser du priserne"** — three lines and a link to `/om-data`.
7. **[REUSE]** Footer with sign-in link.

**[CORRECT]** `/api/discover` currently selects by `tier === 'legendary'` for the
first carousel. `tier` is editorial only and is explicitly *not* a support or
monitoring axis; a legendary-tier row may be unsupported (`sequential-prophet-5`,
`arp-2600`). The homepage must select on `support_state='supported' AND
browse_visibility='public'` and may *sort* by tier. **This is the one place where
the tier/monitoring decoupling of Prompt 04B is still leaking into the UI.**

### 4.2 Onboarding

**[CORRECT] Delete the funnel; the catalogue is the onboarding.**

- Steps 1–3 select verticals (Fotografi, Dansk Design, Mode, Teknologi), star
  brands from the full 274-brand KG, and build a free-text watchlist with a price
  slider. All three contradict the frozen catalogue. Step 4 is already a redirect
  stub. Retire steps 1–3 to a redirect to `/`, keeping the route files and the
  `onboarding-assets` bucket (browse category images are served from it).
- **[BUILD] Account creation moves to the first moment it is needed:** the user
  presses *"Følg dette produkt"* on a canonical page. One modal, one field
  (email), one sentence about what will be sent. No categories, no brands, no
  price slider.
- **[BUILD] First-run orientation is one dismissible strip** on `/browse`:
  *"Klup følger 48 udvalgte produkter. Vi tilføjer flere, når vi kan følge dem
  ordentligt."* Dismissal in `localStorage`; no account, no server state.
- **[DEFER]** Personalisation, recommended products, taste modelling, and any
  re-introduction of brand-starring.

---

## 5. Navigation families and conventional product categories

Two orthogonal structures. **Categories are the primary navigation. Families are
a within-brand refinement.** Neither is a matcher input.

### 5.1 Conventional categories — the spine

**[CORRECT]** The eight standard categories of the handover are the navigation
spine. The taxonomy roots already exist; what is missing is Danish naming and
complete assignment.

| Category (da) | Root slug | Supported products | Public today |
|---|---|--:|--:|
| Synthesizere & keyboards | `keyboards-and-synths` | 20 | 9 |
| El-guitarer | `electric-guitars` | 8 | 0 |
| Western- & akustiske guitarer | `acoustic-guitars` | 4 | 0 |
| Basguitarer | `bass-guitars` | 1 | 0 |
| Trommemaskiner & samplere | *(in `keyboards-and-synths`)* | 5 | 2 |
| El-klaverer | *(unassigned)* | 4 | 3 |
| Studieudstyr (outboard) | `pro-audio` | 6 | 0 |
| Studiemikrofoner | *(in `pro-audio`)* | 1 | 0 |
| Effekter & pedaler | `effects-and-pedals` | 2 | 1 |

- **[CORRECT] Danish names are a display concern in V1.** `kg_category.name_da`
  equals `name_en` in production, so Danish users read "Bass Guitars". Ship a
  reviewed display map in code (`frontend/lib/category-labels.ts`) rather than
  writing to production taxonomy. *Constraint exposed:* correcting `name_da`
  properly is a small production write and therefore a product-owner decision
  (§18, Q4).
- **[CORRECT] A category tile must never be illustrated by a product Klup does
  not follow.** Choose the tile image from supported+public members, and fall
  back to the neutral `music-gear` asset.
- **[DEFER] Drum machines/samplers, electric pianos and microphones as their own
  roots.** They are subcategories today; splitting them is taxonomy work with a
  production write behind it, and 48 products do not need nine top-level doors.

### 5.2 Navigation families

**[BUILD] Families are code-owned configuration, not data.**

There is no family entity in the schema, and inventing one would mean a new
public table — which the handover's **P0 default-privilege warning** makes
actively unsafe until schema-wide default privileges are corrected. So V1 models
families the same way the monitoring boundary is modelled: a reviewed file in the
repository that no runtime surface may mutate.

```
frontend/lib/families.ts        # reviewed config, mirrors klup-source-monitoring.json in spirit
{
  slug: 'gibson-les-paul',
  label: 'Gibson Les Paul',
  brand: 'Gibson',
  category: 'electric-guitars',
  legacyProductSlug: 'gibson-les-paul',   // the public kg_product row rendered as a family
  children: ['gibson-les-paul-custom','gibson-les-paul-standard-50s', … ],
  aliases: ['les paul','lp'],             // navigation only — never matcher aliases
  neverAggregates: true                   // structural, not a flag
}
```

The six families that must exist in V1 are exactly the six family labels that are
already public product pages (§0.2): `gibson-les-paul`, `fender-stratocaster`,
`fender-telecaster`, `fender-jazz-bass`, `fender-precision-bass`, `gibson-es-335`.
The parent→child map in `klup-launch-catalogue-selection.md` §6.3 is the source.

- **[REUSE]** Boundary rules: original ≠ reissue ≠ Custom Shop ≠ sub-brand ≠
  signature ≠ generation ≠ format. `Squier` and `Epiphone` never navigate to a
  Fender or Gibson page.
- **[DEFER] Editorial facets** (`The Time Machines`, `The Workhorses`, `The Glue
  Machines`). Named vocabulary, no surface, no data, no V1.

---

## 6. Family pages and canonical pages

**The relationship is one-way: a family page is a directory. A canonical page is
the terminal identity for listings, prices and monitoring.**

### 6.1 What a family page shows — and what it must never show

| Shows | Never shows |
|---|---|
| Family name, brand, category, one line explaining that variants differ in price | An aggregated price band |
| Every child Klup follows, each with its own price band, listing count and freshness | A merged listing feed |
| Children Klup does **not** follow, named, greyed, marked *"ikke fulgt"* | An alert/watchlist CTA |
| One sentence on *why* the split exists ("En Les Paul Custom og en Les Paul Studio er ikke det samme marked") | A "from X kr" teaser |

**[BUILD]** The strongest single sentence on a family page is the honest one:
*"Priserne i denne familie spænder for bredt til at slås sammen. Vælg den præcise
model."* That is the product thesis rendered as UI.

### 6.2 The six live family rows

**[CORRECT] Route-level resolution, zero production writes.** When
`/product/<slug>` resolves a slug present in `families.ts` as a
`legacyProductSlug`, render the **family template** instead of the product
template, and issue a canonical link to `/family/<slug>`. The 605 legacy matched
listings on `gibson-les-paul` are then simply not rendered — no promotion call, no
`browse_visibility` change, no migration.

*Constraint exposed:* the clean end state is to depublish those six rows through
the existing promotion API with explicit intent. That is a production write and a
product-owner decision (§18, Q1). The route-level approach is what makes V1
shippable **without** one, and it is reversible.

### 6.3 Cross-linking

- **[BUILD]** Every canonical page whose product belongs to a family shows a
  single breadcrumb: `Katalog › El-guitarer › Gibson Les Paul › Les Paul Custom`,
  where the family segment links to `/family/<slug>`.
- **[BUILD]** Family pages link down to children only. Children link up to the
  family only. **No family→family and no child→child "related" chain** — the
  existing `attributes.related_products` mechanism stays as-is and stays optional.
- **[DEFER]** Comparison tables across family children, and "which Les Paul should
  I buy" editorial.

---

## 7. Canonical product-page hierarchy

The existing template (`app/product/[slug]/page.tsx`) is close. The order is the
problem: the page currently leads with an image, and the price answer competes
with a watchlist CTA and a tier badge.

**Specified order, top to bottom:**

| # | Block | Tag | Content |
|--:|---|---|---|
| 1 | Breadcrumb | **[BUILD]** | `Katalog › Kategori › (Familie) › Produkt` |
| 2 | Identity | **[REUSE]** | Brand eyebrow, `canonical_name` as `<h1>`, `era`/`year_released` |
| 3 | **The answer** | **[CORRECT]** | Price band + median + n + basis label + as-of. The first thing below the title on mobile; right column top on desktop. §8. |
| 4 | Image | **[REUSE]** | `hero_image_url ?? image_url`; `piano` fallback. Left column on desktop, **below the answer** on mobile. |
| 5 | Freshness & sources | **[BUILD]** | "Fulgt siden …", per-source last-checked, link to `/om-data`. §11 |
| 6 | Live listings | **[CORRECT]** | The matched active listings, sorted newest-first, with per-listing price evaluation. §8.3 |
| 7 | Alert CTA | **[CORRECT]** | *"Følg dette produkt"* — product-scoped, not a free-text query. §10.3 |
| 8 | Price history | **[REUSE]** | Existing Recharts area chart, **only** with ≥5 sold points, and only labelled as Reverb sold prices |
| 9 | Editorial | **[REUSE]** | `attributes.description`, `specs`, `history`, `external_links` — exactly as authored. Only 3 of 48 have an article; the block simply does not render otherwise. |
| 10 | Family / related | **[BUILD]/[REUSE]** | Family strip if applicable; existing `related_products` grid otherwise |

**[CORRECT] Removed from the page:** the `Legendary`/`Classic` tier badge (an
internal editorial axis, rendered untranslated, that a buyer cannot act on), the
duplicated empty-listings sentence, and the hardcoded English section headings.

**[CORRECT] Placement of the alert CTA.** It sits *below* the listings, not
inside the price block. A user who can already see six live listings does not need
to be asked for an email before reading them.

**[DEFER]** Variant/condition selectors, seller reputation, saved-search
suggestions, "price drop since you last visited", and any reveal of the Kup-score
(the design rules say keep the logic, keep it hidden — unchanged).

---

## 8. Live listings, price context and deal evaluation

This is where the product either answers *"er 4.500 kr en god pris?"* or does not.

### 8.1 The three price sources, never merged

| Source | What it is | Coverage | Label (da) |
|---|---|---|---|
| Matched **active** listings | asking prices, Nordic + German + Reverb | all 48 supported; 44 have ≥1, 26 have ≥15 | *"Udbudspriser lige nu"* |
| `reverb_price_history` | **sold** prices, international | 8 of 48 have ≥3 points | *"Solgt på Reverb (internationalt)"* |
| `thomann_price_dkk` | new-price reference | sparse | *"Ny hos Thomann"* |

**[CORRECT] V1's primary band is the asking-price band, and it must be named as
such.** The current page computes its only band from Reverb sold history, which
exists for 8 of 48 products, and calls it *"Typisk brugtpris"* — a sold-price
label on a page whose live evidence is asking prices. Both halves are wrong.

Specified computation (mirrors the statistics already used in the selection work,
so nothing new is invented):

- Input: matched active listings, `is_valid IS NOT false`, `hasPlausibleListingPrice`
  applied, `price_dkk` non-null, seen within 180 days.
- IQR-filter, then p25–p75 as the band and the median as the headline.
- **Minimum n = 8.** Below that: no band, and the honest line
  *"Klup har kun set N annoncer — for få til at sige noget om prisen."*
- Never computed for a family. Never computed for an unsupported product.
- Never shown on a listing grid or SERP (existing design rule — price history only
  on `/saved` and product pages; extend the same restraint to bands).

### 8.2 The as-of and the basis are part of the number

**[BUILD]** Every band renders four things or it does not render:

```
14.200 kr        median udbudspris
11.900 – 16.400  typisk spænd (p25–p75)
baseret på 23 aktive annoncer · DBA, Kleinanzeigen, Reverb
sidst opdateret i dag kl. 03:12
```

**[CORRECT]** Sold history, when it exists, appears as a **separate, secondary**
block, never averaged into the asking band, and always carrying the international
caveat.

### 8.3 Per-listing evaluation

**[BUILD]** Each listing on a canonical page carries one plain-language verdict
against the product's own band:

| Position | Label (da) | Rule |
|---|---|---|
| below p25 | **Under typisk** | `price_dkk < p25` |
| p25–p75 | **Typisk** | inclusive |
| above p75 | **Over typisk** | `price_dkk > p75` |
| no band, or no price | *(no verdict)* | never guess |

- Three words, no score, no percentage, no colour beyond type weight. **[CORRECT]**
  the existing `bg-green-500` discount badge is removed — it breaks the accent rule
  and it compares against a scraped "was" price Klup does not verify.
- **[REUSE]** `SearchResultCard`, its platform badges (the exact brand colours in
  `frontend/CLAUDE.md`), the `timeSince` age string, the save heart and
  `ListingErrorBoundary`.
- **[CORRECT]** Listings link out with `rel="noopener noreferrer"` to the seller's
  marketplace, and the card says so: *"Åbner hos DBA"*.
- **[REUSE]** Store raw `price` + `currency`, convert at read time. **[BUILD]**
  when converted, show it: *"≈ 4.470 kr (599 €)"*.

### 8.4 Honest scarcity

**[BUILD]** *Rescraping is freshness, not population* has a user-visible
consequence: legacy rows can never gain a match, so a supported product's feed
reflects inflow **since 2026-08-26**, not the whole market. The page must say
*"Klup har fulgt dette produkt siden 26. august 2026"* rather than implying
completeness. `roland-system-100` and `gibson-sg-standard-…` have **0** matched
listings; their pages must read as "vi følger det, der er ikke noget lige nu", not
as an error.

**[DEFER]** Condition-adjusted pricing, shipping/import cost, seller type
(private vs dealer), per-variant sold history, price alerts on band movement,
"good deal" scoring, and any Kup-score reveal.

---

## 9. Restricted search

### 9.1 Contract

**[REUSE]** The supported-search contract in
`klup-launch-catalogue-selection.md` §11 is already specified, already reviewed,
and is adopted here verbatim: canonical-exact and accepted-alias navigate
directly; normalisation case-folds, strips diacritics and treats `-`/space/nothing
as equivalent inside model numbers; generation qualifiers (`Mini`, `Kit`, `FS`,
`II`, `Mk2`, `Rev4`, `Suitcase`, `Stage`, `73`, `88`, `100M`, `727`) are
significant; dangerous terms never auto-navigate; ambiguous terms show the set.

**[REUSE]** The dangerous-term list (`Juno`, `Jupiter`, `Prophet`, `Rhodes`,
`808`, `909`, `Model D`, `1176`, `Custom`, `Standard`, `Vintage`, `Reissue`, …)
is adopted unchanged. **[REUSE]** The expected autocomplete labels carry their
qualifiers (`Roland TR-808 (Rhythm Composer)`, `Korg MS-20 (original, 1978)`,
`Moog Minimoog Model D (2016 reissue)`).

### 9.2 Search is a resolver, not a result page

**[BUILD]** `/search` resolves to one of five outcomes and nothing else:

| Outcome | Behaviour |
|---|---|
| **Exact / alias hit** | 302 to `/product/<slug>` |
| **Family hit** | 302 to `/family/<slug>` |
| **Ambiguous** (>1 supported product, or a dangerous term) | List those products with disambiguating qualifiers. Never pick one. |
| **Known but unsupported** (in the KG, not in the 48) | *"Klup følger ikke Yamaha CS-80 endnu."* + nearest supported products + demand capture |
| **Unknown** | *"Klup følger ikke dette endnu."* + the categories + demand capture |

**No empty SERP. No generic listing list. Ever.**

### 9.3 The index

**[BUILD]** A build-time index over the supported catalogue plus family labels —
tens of entries, not thousands. Ship it as a static JSON artefact generated from
the same data as the frozen cohort, so autocomplete needs no database round-trip
per keystroke and cannot drift into unsupported products.

### 9.4 Demand capture

**[BUILD]** Record the unsupported query as an analytics event (PostHog is
already wired: `PostHogProvider`, `search_performed`) with the normalised query,
the outcome class and whether a nearest-match was offered. **No PII.**

*Constraint exposed, deliberately:* a proper demand-signal table would be a new
table in `public`, and the handover's **P0** says any such table is born
world-readable and world-writable until schema-wide default privileges are fixed.
V1 therefore **does not create one**. **[DEFER]** the durable demand table until
the P0 is closed; the analytics event is a complete V1 substitute for deciding
what to promote from reserve.

### 9.5 What is deleted from search

**[CORRECT]** Delete from the user path: the call to `/api/scrape`, the
five source toggle chips, the relevance/newest/oldest/price sort control, the
mobile list ↔ desktop 4-column listing grid, the free-text "Opret overvågning"
button, and the *"Vi søger på {platforms} samtidig"* subtext. The `/api/scrape`
route itself may remain for `/admin/product/[slug]`'s on-demand curation scrape —
but it must leave `PUBLIC_PREFIXES` and become admin-gated. **This removes an
unauthenticated public write path and takes the user experience back inside the
frozen monitoring boundary.**

---

## 10. Product states in the interface

### 10.1 Private (`supported` + `qa_only`) — 34 products

- **[CORRECT]** Not in browse, not in search, not in sitemaps, no public page.
  `/product/<slug>` returns 404 for the public and renders for an admin session
  with a persistent banner: *"Privat — ikke offentliggjort. Matcher-berettiget."*
- The banner names what is missing before promotion is even possible: image,
  subcategory, article. **[BUILD]** a small readiness line on the admin banner
  fed by the same three checks — this is the operator's view of
  `data/klup-frozen-cohort-asset-inventory.csv`, not a new dataset.
- **[REUSE]** Promotion to public is the existing admin flow. Nothing here
  publishes anything.

### 10.2 Public but unsupported — 14 products

- **[BUILD] The archived template.** Identity, image, editorial article if one
  exists, and one honest sentence: *"Klup fulgte dette produkt tidligere. Vi har
  ikke aktuelle priser."* No listing feed, no band, no alert CTA.
- **[CORRECT]** Six of the fourteen resolve to the family template instead (§6.2).
- **[CORRECT]** These pages leave browse, the homepage carousels and the search
  index. They stay reachable by URL and by exact name, so existing links and
  search-engine results do not break.

### 10.3 Public and supported — 14 products

The full experience of §7 and §8, and the only state that offers alerts.

**[CORRECT] Alerts are product-scoped.** The current mechanism creates a watchlist
from a **free-text query** — derived from an arbitrary listing title truncated at
60 characters (`app/product/[slug]/page.tsx:113`, `app/search/page.tsx:146`). That
is the generic-marketplace mechanism, and it produces watchlists Klup cannot
service inside a frozen catalogue. Replace with: *"Følg Roland Juno-106"* →
one alert bound to `product_id`, optional max price.

*Constraint exposed:* `watchlists` is query-based today, and 123 active user
watchlists exist and drive the (currently disabled) `/api/cron/scrape`. Migrating
them is a data decision, not an experience decision (§18, Q5). **[DEFER]** the
migration; V1 creates new alerts with the product's exact canonical name as the
query and stores the slug alongside, which is forward-compatible either way.

### 10.4 No-listing state

**[BUILD]** A supported, public product with zero active listings is a **normal,
successful** state and reads as one:

> **Ingen annoncer lige nu.**
> Klup følger dette produkt på DBA, Kleinanzeigen og Reverb. Vi giver besked, når
> der dukker en op. Sidst set til salg: 14. august 2026.

No `search_off` icon, no "ikke fundet", and never an empty page. The alert CTA is
at its most useful here and should be the primary action.

### 10.5 Unsupported and unknown queries

Covered in §9.2. The one rule that must not bend: **an unsupported query never
produces listings.**

---

## 11. Trust, freshness and data-source communication

**[BUILD] Freshness is a first-class element, not a footnote.** Three levels:

| Level | Where | Content |
|---|---|---|
| Listing | card | *"Set for 2 timer siden"* — `timeSince(scraped_at)` **[REUSE]** |
| Product | page | *"Klup tjekker DBA, Kleinanzeigen og Reverb for dette produkt. Sidst tjekket i dag kl. 03:12."* |
| Service | `/om-data` | Which marketplaces, how often, what is and is not covered |

- **[BUILD] Per-product source list.** `data/klup-source-monitoring.json` already
  states explicitly which products each source queries, and
  `scripts/lib/source-monitoring.ts` already loads it. Surface it read-only. This
  also communicates the known 30/28/28/28-versus-48 overlap honestly instead of
  implying every product is watched everywhere.
- **[BUILD] `/om-data`** answers, in Danish, in one screen: what Klup is (a
  monitor, not a shop); the five marketplaces; that Klup owns nothing and earns
  nothing on a sale; that asking prices are what sellers *ask*, not what items
  *sell for*; that Reverb sold prices are international; that the catalogue is 48
  products by choice; and that currency conversion is approximate with a named
  source (Frankfurter).
- **[REUSE]** Platform badges with their exact brand colours are already the
  clearest trust signal in the product. Keep them everywhere a listing appears.
- **[CORRECT]** Never present a scraped "before" price as a saving (§8.3).
- **[CORRECT]** Never log PII; the demand-capture event carries a normalised query
  string and nothing else.
- **[DEFER]** Source-level reliability disclosure ("Finn last succeeded 6 h ago"),
  a public status page, and per-listing verification.

---

## 12. Mobile and desktop

**[REUSE]** The existing responsive pattern is sound: `SideNav` (`hidden md:flex`,
60 rem, fixed) plus `BottomNav` (`md:hidden`, safe-area padded). Keep it.

### Mobile

| Item | Tag | Behaviour |
|---|---|---|
| Bottom nav | **[CORRECT]** | Five tabs; **Katalog** is the centre FAB, not Søg |
| Search entry | **[CORRECT]** | `MobileSearchBar` is `hidden md:block` — it is a **desktop** bar. Rename it and add a real mobile search affordance in the header of `/browse` and `/browse/[root]`. |
| Product page | **[CORRECT]** | Single column, order: title → **price answer** → image → freshness → listings → alert → history → editorial. The price answer must be above the fold; today the square image occupies it. |
| Listings | **[REUSE]** | `variant="list"` cards |
| Family page | **[BUILD]** | Children as a vertical list with band + count per child |
| Category page | **[REUSE]** | 2-column product grid, subcategory chips, load-more |

### Desktop

| Item | Tag | Behaviour |
|---|---|---|
| Product page | **[REUSE]** | Two-column hero: image left, identity + answer + freshness right |
| Listings | **[CORRECT]** | Full-width list, **not** the 4-column grid used on `/search` — a price comparison reads down a column, not across a mosaic |
| Category page | **[REUSE]** | 4-column grid |
| Search | **[CORRECT]** | Centred resolver, max ~40 rem. It is a lookup, not a results page. |

**[CORRECT]** Product page `max-w-4xl` is right for the hero and too narrow for a
listing table; let the listings block run to `max-w-5xl`.
**[DEFER]** A dedicated tablet layout, and any keyboard-navigation layer.

---

## 13. How Klup demonstrates that it is about musical equipment

Not a slogan — six concrete mechanisms, in descending order of effect.

1. **[CORRECT] The catalogue is the argument.** A homepage whose first screen is
   Juno-106, TR-808, Rhodes Mark I and a Les Paul Custom cannot be mistaken for a
   general marketplace. This is why §4 puts categories and followed products above
   any search box.
2. **[CORRECT] Every string is music-specific.** Placeholder becomes *"Søg efter
   et produkt Klup følger — fx Juno-106, TR-808, Les Paul Custom"*; `<title>` and
   meta description name the vertical (*"Klup — brugte instrumenter og
   studieudstyr"*); the DA/EN pair is kept in sync in `lib/i18n.ts` per
   `frontend/CLAUDE.md`.
3. **[CORRECT] Non-music can never render.** Enforcing `status`/`browse_visibility`
   in `/api/product/[slug]` (§2) is what makes it impossible to reach
   `/product/macbook-pro-m3-max` or a Wegner chair on a music service.
4. **[CORRECT] Retire the multi-vertical onboarding.** Fotografi, Dansk Design,
   Mode and Teknologi are the single most explicit contradiction in the live
   product.
5. **[BUILD] Domain vocabulary in the interface.** Era and year, Danish category
   names, generation qualifiers in every label (`Mark I Suitcase 73`, not
   "Rhodes"), and the family explanation that a Les Paul Custom is not a Les Paul
   Studio. Precision of this kind is legible only to a music service.
6. **[BUILD] Editorial where it exists.** Three draft articles (Juno-106, Juno-60,
   Jupiter-8) already exist in `attributes`; render them well and let them be the
   depth signal. **[REUSE]** Do not commission, rewrite or generate more as part
   of this work.

**[DEFER]** Genre/role facets, artist associations, "studio starter" collections,
and every evocative label.

---

## 14. Remove · retain · deemphasise

### 14.1 Remove

| # | What | Tag | Why |
|--:|---|---|---|
| 1 | The auth wall on `/product` and `/api/product` | **[CORRECT]** | It hides the core experience from everyone (§0.1) |
| 2 | `/api/scrape` from the user path + `PUBLIC_PREFIXES` | **[CORRECT]** | Unauthenticated live scrape + DB write, outside the frozen boundary (§0.6) |
| 3 | The listing-grid SERP (`/search` results, source chips, sorts) | **[CORRECT]** | A generic SERP contradicts product-centred discovery |
| 4 | Onboarding steps 1–3 | **[CORRECT]** | Four of five verticals are out of scope |
| 5 | "Søg efter alt… (iphone, sofa, cykel)" and every generic string | **[CORRECT]** | Directly contradicts the promise |
| 6 | Free-text watchlist creation from listing titles | **[CORRECT]** | Marketplace mechanism; unserviceable in a frozen catalogue |
| 7 | `bg-green-500` discount badge | **[CORRECT]** | Breaks the accent rule and asserts an unverified saving |
| 8 | Tier badges on cards and product pages | **[CORRECT]** | Internal editorial axis, rendered untranslated |
| 9 | The `/` → `/watchlists` redirect for signed-in users | **[CORRECT]** | Returning users never see the catalogue |
| 10 | Unsupported products from browse tiles, carousels and search index | **[CORRECT]** | Klup cannot keep them current |

### 14.2 Retain unchanged

| What | Tag |
|---|---|
| Product page template shell, image handling, `attributes` rendering, price-history chart | **[REUSE]** |
| `SearchResultCard`, `ProductCard`, `ListingCard`, `PlatformBadge` colours, `ListingErrorBoundary` | **[REUSE]** |
| `/browse` and `/browse/[root]` structure, subcategory chips, pagination, `browse_product_projection` | **[REUSE]** |
| Promotion seam (`/admin/products`, `PATCH /api/admin/products/[id]`, intent + dryRun + manifest) | **[REUSE]** |
| Curation surface `/admin/product/[slug]`, `/intel`, all admin gating | **[REUSE]** |
| `/saved`, saved-listings API, theme, locale provider, i18n mechanism, PostHog wiring | **[REUSE]** |
| Design rules: green only on Kup stars and Aktiv badges; DM Serif + Inter; price history only on `/saved` and product pages | **[REUSE]** |
| All 48 slugs, images, hero images and draft articles | **[REUSE]** |

### 14.3 Deemphasise

| What | Tag | How |
|---|---|---|
| Search | **[CORRECT]** | Second nav item; a resolver, not a destination |
| Watchlists/alerts | **[CORRECT]** | Fourth nav item; the CTA sits below listings, not above them |
| Price history chart | **[REUSE]** | Only with ≥5 sold points, below the fold, labelled Reverb-international |
| Thomann new price | **[REUSE]** | One quiet line; it is a reference, not the answer |
| `related_products` | **[REUSE]** | Below the fold; render only when authored |
| Brands as a navigation axis | **[DEFER]** | 274 KG brands, ~20 with a supported product — brand pages would be mostly empty |

---

## 15. Proposed page hierarchy

```
/                                    Forside  · public
├─ promise + coverage line
├─ catalogue lookup (resolver, not SERP)
├─ Kategorier  ─────────────────────►  /browse
├─ Fulgt lige nu (supported + public)►  /product/<slug>
├─ Nye annoncer (matched, recent)   ►  outbound to marketplace
└─ Sådan læser du priserne          ►  /om-data

/browse                              Katalog  · public
└─ /browse/[root]                    Kategori  · public
   ├─ subcategory chips
   └─ product grid  ────────────────►  /product/<slug>
                                     └►  /family/<slug>   (when the card is a family)

/family/[slug]                       Navigationsfamilie  · public  · [BUILD]
├─ explanation: why this is not one price
├─ children Klup follows  ──────────►  /product/<slug>
└─ children Klup does not follow (named, greyed)
   ✗ no aggregated band · ✗ no merged listing feed · ✗ no alert CTA

/product/[slug]                      Kanonisk produktside  · public iff public
├─ breadcrumb  ─────────────────────►  /browse/[root], /family/[slug]
├─ identity
├─ THE ANSWER — band · median · n · basis · as-of
├─ image
├─ freshness + sources  ────────────►  /om-data
├─ live listings + per-listing verdict  ──► outbound
├─ "Følg dette produkt"  ───────────►  /watchlists (auth)
├─ sold history (≥5 Reverb points)
├─ editorial (only where authored)
└─ family strip / related
   states: fulgt · arkiveret (no prices) · privat (admin-only) · ingen annoncer

/search                              Søg  · public  · resolver
└─ exact → /product · family → /family · ambiguous → list
   unsupported → "følger ikke endnu" + nearest + demand event
   ✗ never a listing SERP

/saved            · auth   /watchlists (Alerts) · auth   /profile · auth
/om-data          · public · [BUILD]
/login /signup /auth/*     · public
/admin/** /intel           · admin — never in navigation
```

---

## 16. Ten highest-priority experience decisions

| # | Decision | Recommendation | Tag |
|--:|---|---|---|
| 1 | **Make canonical product pages public** — remove the middleware auth wall, and in the same change gate `/product` and `/api/product` on `status='active'` and `browse_visibility` (public → everyone, `qa_only` → admin, else 404) | **Do it first.** Nothing else in Stage 3 has any effect until it ships, and the gate is what makes it safe | **[CORRECT]** |
| 2 | **Stop the six family labels behaving as priced products** — resolve them to a family template at the route level | Do it. Removes the single largest contradiction of the product thesis with **zero production writes** | **[BUILD]** + **[CORRECT]** |
| 3 | **Replace the sold-price band with a labelled asking-price band** from Klup's own matched listings, n ≥ 8, IQR, with basis and as-of | Do it. It is the difference between 8 of 48 products answering the core question and 44 of 48 | **[CORRECT]** |
| 4 | **Turn `/search` into a resolver over the supported catalogue** and remove `/api/scrape` from the user path | Do it. Ends the generic SERP, the unauthenticated write path and the boundary violation in one change | **[CORRECT]** |
| 5 | **Rebuild the homepage around the catalogue**, selecting on `support_state`, not on `tier` | Do it. The last place where tier still acts as a monitoring proxy in the UI | **[CORRECT]** |
| 6 | **Re-language the product as music-specific** — title, meta, placeholders, categories in Danish, retire multi-vertical onboarding | Do it. Cheapest high-value change in the set | **[CORRECT]** |
| 7 | **Page the browse projection query** and stop transferring 4,004 rows per request | Do it. Four public products are missing and every count is wrong for a mechanical reason | **[CORRECT]** |
| 8 | **Publish freshness and per-product sources** on every canonical page, plus `/om-data` | Do it. Trust is the product; monitoring is uneven and saying so is stronger than implying uniform coverage | **[BUILD]** |
| 9 | **Product-scoped alerts** replace free-text watchlists as the conversion moment | Do it for new alerts; **defer** migrating the 123 existing ones | **[CORRECT]** + **[DEFER]** |
| 10 | **Assign subcategories to the 13 supported products that lack one** | Product-data curation, ordered before any further promotion — otherwise a published product is invisible in browse | **[CORRECT]**, product-owner |

---

## 17. Unresolved decisions requiring product-owner judgment

| # | Question | Why it cannot be decided here | Blocks |
|--:|---|---|---|
| Q1 | Should the six family rows and the eight held-from-launch rows be **depublished** (`browse_visibility`) through the promotion API, rather than only route-masked? | A production write and a permanent catalogue decision | Nothing in V1 (route masking covers it); needed for a clean end state |
| Q2 | **Which of the 34 private products get published, in what order?** 9 have no image, 13 have no subcategory, 31 have no article | Editorial and commercial judgment; publication is irreversible in practice | The size of the public catalogue after V1 |
| Q3 | Is an **asking-price band** acceptable as the headline number, given Klup has sold data for only 8 of 48? | A truth-in-communication call the product owner owns | §8; the whole deal-evaluation surface |
| Q4 | **Danish category names:** display map in code, or correct `kg_category.name_da` in production? | The clean fix is a production write | Cosmetic in V1; permanent afterwards |
| Q5 | **The 123 existing free-text watchlists** — migrate to product alerts, retire, or run both? Note `/api/cron/scrape` (which serves them) is disabled and conflicts with the PM2 dba path | User-facing commitment + the unresolved ingestion-path decision | Alert strategy beyond V1 |
| Q6 | Does the **EN locale** stay a first-class surface, or does Klup become Danish-only with EN as best-effort? | Market decision; affects every copy change | Copy volume in V1 |
| Q7 | Should `qa_only` pages be **publicly visible with an "under opbygning" banner** instead of admin-only? | Trades honesty-of-coverage against having something to show | §10.1 |
| Q8 | When the P0 default-privilege issue is closed, should demand signals get a **durable table** instead of analytics events? | Requires the P0 fix first; then a schema decision | §9.4 beyond V1 |
| Q9 | Is **48 products enough to launch publicly**, or does the public catalogue wait for reserve promotions? | Launch judgment | Timing, not design |
| Q10 | Is monitoring/support overlap of **14** acceptable to communicate, given the monitored sets are 30/28/28/28? | Roadmap decision recorded as follow-up #2 in the documentation index | §11 wording |

---

## 18. Smallest coherent V1

**Goal:** an anonymous visitor can find a product Klup follows, read an honest
price answer, see live listings, and understand what Klup is — with no production
write, no migration, no scraper change, no KG change, and no new database object.

**In scope — nine changes:**

1. **Publish and gate product pages.** `/product` + `/api/product` public;
   resolve `status`/`browse_visibility`; 404 everything else; admin sees
   `qa_only` with a QA banner. *(Decision 1)*
2. **Family template at route level** for the six family slugs, from
   `frontend/lib/families.ts`, plus `/family/[slug]`. *(Decision 2)*
3. **Archived template** for the eight remaining public-unsupported products —
   identity and editorial only, no listings, no prices, no CTA.
4. **Asking-price band** (n ≥ 8, IQR, p25–p75 + median) with basis, source list
   and as-of; sold history demoted to a labelled secondary block; three-word
   per-listing verdict. *(Decision 3)*
5. **`/search` becomes a resolver** over a static index of the 48 + 6 families,
   with the adopted §11 contract, unsupported-query messaging, and a PostHog
   demand event. `/api/scrape` leaves `PUBLIC_PREFIXES` and becomes admin-only.
   *(Decision 4)*
6. **Homepage rebuild** — promise, resolver field, categories, *Fulgt lige nu*
   (supported+public), *Nye annoncer*, `/om-data` link; no `/watchlists`
   redirect. *(Decision 5)*
7. **Music-specific language pass** across `lib/i18n.ts` (DA **and** EN),
   `<title>`/meta, category display labels; onboarding steps 1–3 redirect to `/`.
   *(Decision 6)*
8. **Browse correctness** — page the projection query, fix category counts,
   choose tile images from supported+public products. *(Decision 7)*
9. **`/om-data`** plus per-product freshness and source lines read from
   `data/klup-source-monitoring.json`. *(Decision 8)*

**Explicitly out of V1 but pre-decided:** product-scoped alert creation ships
(new alerts only); the 123 legacy watchlists are untouched.

**V1 succeeds when:** an anonymous visitor reaches
`/product/roland-juno-106` from `/`, sees a band with its basis and as-of, sees
live listings with source badges and ages, and can state — without asking anyone —
that Klup follows 48 used instruments and studio units across five marketplaces
and does not sell anything.

**Not required for V1 to succeed:** publishing more than the 14 already-public
supported products. Growing the public catalogue is Q2, not engineering.

---

## 19. Non-goals

**Inherited and unchanged from `CLAUDE.md` §1 — not re-litigated here:** a
marketplace, storefront or inventory operation; an arbitrage desk (`/intel` stays
private); multi-vertical coverage; a generic listing SERP; auto-bidding or
agent-assisted purchasing.

**Stage 3 non-goals, specific to this specification:**

1. **No new foundation, matcher, KG, scraper, monitoring or migration work.** The
   scope gate applies unchanged: name the measured defect, the delay cost, and why
   it cannot wait — or do experience work instead.
2. **No production writes.** No promotion, no publication, no `browse_visibility`
   change, no taxonomy edit, no `kg_category` rename. Every V1 item is code and
   copy. Where the clean fix is a write, it is written down as Q1–Q5, not done.
3. **No new database object.** No demand-signal table, no family table, no
   materialised view — the P0 default-privilege defect makes new `public` tables
   unsafe, and families and the search index are better as reviewed config.
4. **No re-enabling of the Vercel scrape cron**, and no user-triggered scraping.
5. **No widening of monitoring or of the catalogue.** The frozen 48 stand; reserve
   promotion is a separate, evidence-led decision under the §16 rules of the
   selection document.
6. **No content production.** No new articles, no new images, no rewritten copy on
   existing product pages, no redesigned product pages beyond block order.
7. **No parallel admin tooling.** The promotion seam and curation surface are the
   only write paths and are reused as-is.
8. **No URL renaming, no slug changes, no locale removal** in V1.
9. **No Kup-score reveal, no personalisation, no recommendations, no editorial
   facets, no brand pages, no comparison tables.**
10. **No monetisation surface** — no affiliate framing, no sponsored placement, no
    "sell your gear" flow.

---

## 20. Traceability

| Claim in this document | Evidence |
|---|---|
| `/product` behind auth | `frontend/middleware.ts` `PUBLIC_PREFIXES`; live `307 → /login` on `www.klup.dk/product/roland-juno-106` |
| 14 / 34 / 14 cohort split | `SELECT` on `kg_product`, 2026-08-27 — matches handover *Post-activation production state* |
| Browse truncation | `frontend/lib/browse.ts:346` unbounded `select`; 4,004 music rows vs 23 public-classified vs 19 reported by `GET /api/browse` |
| 13 supported products lack a subcategory | `browse_product_projection.taxonomy_state='missing_subcategory'` |
| 8 of 48 supported have ≥3 sold points | `reverb_price_history` count per `kg_product_id` |
| Family rows carry 605/278/266/160/129/7 active matched listings | `listing_product_match` ⋈ `listings` where `is_active` |
| Search live-scrapes and writes | `frontend/app/api/scrape/route.ts`; rate limit in `middleware.ts` |
| Generic copy | production HTML `<title>`/meta; `frontend/lib/i18n.ts:31,114,140`; `app/onboarding/step1/page.tsx:9` |
| Design-rule breaches | `components/SearchResultCard.tsx:216`; English headings in `app/product/[slug]/page.tsx` |

**Nothing in this document has been implemented.** It is a specification awaiting
a product-owner decision on §17 and an implementation authorisation for §18.
