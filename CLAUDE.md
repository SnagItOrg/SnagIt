# CLAUDE.md — Klup.dk

This file is the single source of truth for any agent or developer working in this repo.
Read it fully before touching code.

---

## What is Klup?

Klup.dk is a **deal intelligence platform for secondhand music gear**.

The core value proposition: find out if a price is good, across DBA.dk, Reverb, and Nordic marketplaces — without manual research.

The target user is a passionate gear buyer (the founder is customer zero). They know what they want. They want to know if the price is fair, and they want to be alerted when a deal appears.

**The moat is not the scraper. The moat is the structured product knowledge graph + historical price data.**

---

## Product vision

### Product-first, not listing-first

The anchor is the **product entity** (e.g. Roland Juno-106), not the listing.

- Product pages show: canonical image, typical price range, price history, active listings
- Watchlists follow a product — not a raw text query
- Scrapers run on search terms derived from KG products that users actually follow

This is demand-driven scraping. Only scrape what users care about.

### The question the product must answer

> "Er 4.500 kr for en Roland Juno-106 en god pris i dag?"

If the product can answer that without the user having to think, we're building the right thing.

### What we are NOT building

- Design furniture vertical (design-objects) — deprioritised, do not build
- Cykler, tech, generalist e-commerce — not our vertical
- Auto-bidding or agent-assisted purchases — not yet, requires explicit user consent + audit log
- Facebook Marketplace — Apify consumed budget with zero results, parked until alternative found

---

## Stack

| Layer | Tool |
|---|---|
| Frontend | Next.js 14 App Router, TypeScript, Tailwind CSS |
| Database + Auth | Supabase Pro (Row Level Security on all tables) |
| Deploy | Vercel — always `git push` to `main`. Never Vercel CLI |
| Scraper runtime | PM2 on Mac Mini (hostname: `panter`) |
| Email | Resend (transactional) |
| Analytics | PostHog EU cloud (`eu.i.posthog.com`) |
| Currency | Frankfurter API (live) with hardcoded fallbacks |
| AI | Anthropic API — Claude Haiku for bulk KG review |

**Repo:** `SnagItOrg/SnagIt`
**Prod URL:** `www.klup.dk`

---

## Infrastructure — two machines, Claude runs natively on each

**MacBook** (`dev` user)
- Claude Code sessions
- Manual script runs
- Primary development machine

**Mac Mini M4** (`panter` user — hostname: `panter` / `Panters-Mac-mini.local`)
- PM2 scraper jobs
- Devon/OpenClaw agent (restricted branch access)
- Claude Code sessions run directly on this machine too

**Access pattern (changed 2026-08-05):** Claude Code sessions run remotely on
whichever machine they're started on — a session working on the Mac Mini is
running natively there, not relaying commands over SSH from the MacBook.
Tailscale SSH between the two machines is now occasional/manual only (e.g.
founder poking around, one-off intervention) — not the primary access path.
**Don't assume a session is on the MacBook.** Run `hostname` early — this
determines whether PM2/filesystem state observed is real-time or needs an
SSH hop. See "What Claude Code should do at session start" below.

**PM2 jobs (status as of 2026-08-06 — verify with `pm2 list`, don't trust this table blindly)**

All 8 are `autorestart: false` + `cron_restart`, so **"stopped" between runs
is normal** — status here means "does the job actually complete when it fires".

| Job | Schedule | Status |
|---|---|---|
| `scrape-blocket` | Daily 01:00 | Deps fixed 2026-08-05, **first clean run not yet confirmed** |
| `scrape-finn` | Daily 01:00 | Deps fixed 2026-08-05, **first clean run not yet confirmed** |
| `scrape-kleinanzeigen` | Daily 01:00 | Deps fixed 2026-08-05, **first clean run not yet confirmed** |
| `scrape-reverb` | Daily 02:00 | Timeout bug fixed 2026-08-05 (missing index); live manual run OK |
| `fetch-reverb-prices` | Daily 03:00 | Was failing on network at boot — **unverified** |
| `fetch-thomann-prices` | Sunday 03:00 | Cloudflare HTTP 403 from panter — **still broken** |
| `process-price-queue` | Every 5 min | Running; constraint + silent-error bugs fixed 2026-08-05 |
| `match-listings` | Every hour at :30 | Running. Cap-and-exit re-scans the same head of the queue each run, so a given run can match 0 — see Known Issues |

**No listings were scraped from any source between ~2026-05-22 and
2026-08-05.** Reverb last succeeded 2026-05-22; dba/blocket/finn show
2026-07-04 (a backfill touch, not a scrape). Check `max(scraped_at)` per
source before assuming the pipeline is healthy.

---

## Data sources

| Source | Purpose | Status |
|---|---|---|
| DBA.dk | Danish used gear listings | Active (wildcard search parked — bot detection) |
| Reverb API | International used gear + sold price history | Active |
| Thomann | New price reference (nypris) via sitemap | Active — Cloudflare sometimes blocks from Vercel egress |
| Finn.no | Norwegian used gear | Active — Schibsted scraper, daily cron |
| Blocket.se | Swedish used gear | Active — Schibsted scraper, daily cron |
| Kleinanzeigen.de | German used gear listings | Active — DOM scraping, category c74 (Musikinstrumente), daily cron |
| Auctionet | Danish auction prices | Active |
| Facebook Marketplace | — | **Parked** — Apify consumed budget, zero results |

**Price reference source:** Reverb *sold* prices (not DBA — expired listings make DBA unreliable as reference).

**Currency:** Live via Frankfurter API. USD/EUR/SEK/NOK → DKK. Hardcoded fallbacks if API down.

**Reverb CSP API** — `https://api.reverb.com/api/csps` — Comparison Shopping
Pages, the canonical product entity on Reverb. No auth required. Required
header: `Accept-Version: 3.0`. Accessories and parts are tagged under the
same CSP as their parent instrument, so CSP ids enable clean "product +
accessories" grouping. Used for: canonical product images, `used_low_price`
as a quick price anchor, `csp_id` for deterministic joins, and upcoming
demand-driven KG enrichment (see Knowledge Graph → Reverb CSP integration).

---

## Knowledge Graph (KG)

The KG lives in Supabase tables `kg_product`, `kg_brand`, `kg_category`, `synonym`.

**Current state:** ~3,840 music-gear products. ~999+ classified into the
two-level subcategory hierarchy via `classify-products.ts` (Haiku batch).

**canonical_name rule:** Always `brand + model`. Never strip brand. "Roland Juno-106" not "Juno-106".

**KG data integrity rule — verify before writing:**
Before creating or updating any `kg_product` row (slug, canonical_name, image_url, tier, etc.), always verify the product name independently — do not blindly trust user input. If the user supplies a product name alongside an image URL, cross-check the name against the Unsplash page description, the image content, and any existing KG entry. If there is a mismatch (e.g. user says "PO-04" but the image shows a PO-14, or "PO-04" already maps to an existing entry), flag the discrepancy before writing. The KG is the source of truth — a dirty row is harder to clean than to prevent.

**Priority products to build product pages for first:**
- Fender Telecaster, Telecaster Custom Shop, Fender Stratocaster, Fender Vintera II
- Gibson Les Paul, Gibson ES-335
- Roland Juno-60, Roland Juno-106, Roland Jupiter-8
- Moog Minimoog, Moog Subsequent 37

**Image strategy — one displayed image per product:**
Each product renders exactly one image: `hero_image_url ?? image_url`. Two
fields, one result. Priority chain:
1. `hero_image_url` — editorial Unsplash/Pexels pick. Managed in
   `scripts/set-hero-images.ts`. Current entries: Gibson Hummingbird,
   Gibson ES-335, Fender Telecaster, Fender Jazzmaster, Fender Jaguar,
   Roland TR-909.
2. `image_url` — best available auto-derived source, in fill order:
   - Thomann → current production gear (via `fetch-thomann-prices`)
   - Reverb CSP promoted (via `scripts/promote-csp-images.ts`; 710 products
     populated 2026-04-29)
   - Reverb CSP → Storage webp (via `scripts/upload-csp-images.ts`; delta-safe,
     skips products already in storage). Run completed on panter 2026-04-30 —
     ~1,246 products already in storage (prior bulk run). ~11 remain with
     non-storage URLs; use `--force --limit=50` to reprocess if needed.

**Reverb category mirror (shipped 2026-04):**
- `scripts/seed-reverb-categories.ts` imports Reverb's full taxonomy
  (`/api/categories/flat`, 320 categories in 14 music roots) into `kg_category`
  as a two-level hierarchy via `parent_id`. Source data cached in
  `data/reverb-categories.json`.
- Anchor on `kg_category.slug` (e.g. `keyboards-and-synths/analog-synths`),
  NOT on Reverb UUIDs. Pragmatic for shipping; fragile if Reverb renames a
  slug. Migrating to UUID anchors is a known TODO.
- `kg_product.reverb_root_slug` + `reverb_sub_slug` denormalise the join for
  fast filtering on browse pages.

**Reverb CSP integration (shipped 2026-04-27, partial):**
- `kg_product.reverb_csp_id integer` — added by migration 030. Deterministic
  anchor to a CSP (Comparison Shopping Page = canonical product record across
  all listings, including parts/accessories tagged under the parent product).
- `reverb_price_history.kg_product_id uuid` — added by migration 031. FK to
  `kg_product`, nullable. Backfill from existing query-keyed rows is TBD
  (planned migration 034 — listing_url → CSP id → kg_product join).
- `kg_category.reverb_uuid uuid` — added by migration 033. Stable join key
  to Reverb's taxonomy (slugs are fragile if Reverb renames). Backfill via
  `npm run backfill-category-uuids` reads `data/reverb-categories.json`.
- Hand-seeded CSP ids on `attributes.reverb_csp`:
  - Roland Juno-60 → `1677`
  - Roland Juno-106 → `2444`
  - Roland Jupiter-8 → `27660`
- `scripts/enrich-from-reverb-csp.ts` — bulk-resolves Reverb CSPs into
  `kg_product.attributes.reverb_csp` (jsonb) using `canonical_name` + brand
  slug. Run via `npm run enrich-from-reverb-csp`. Flags: `--dry-run`,
  `--limit=N`, `--slug=X`, `--brand=X`, `--force`. Rate-limited at 2.5s
  → ~2.5h for the full ~3,840 catalogue. Idempotent (skips rows that already
  have `attributes.reverb_csp.csp_id` unless `--force`).
- Bulk enrichment run completed 2026-04-27 on Mac Mini (panter):
  resolved 1150/3577 (high=910 medium=109 low=114 none=2444 errors=2).
  Migration 032 then promoted high+medium into the typed column → **1114
  rows have `kg_product.reverb_csp_id` set**. Verify any time with
  `npx tsx scripts/verify-csp-progress.ts`.
- Migration 033 + `npm run backfill-category-uuids` completed 2026-04-27 →
  **320/340 `kg_category` rows have `reverb_uuid`**. The 20 unmatched are
  internal/non-Reverb taxonomy entries (custom subcategories etc.).
- Migration 034 applied 2026-04-30 — DML that backfills
  `reverb_price_history.kg_product_id` from query-text via normalised
  canonical_name match. Final hit rate: 193 rows mapped (TR-808: 20, RE-201: 20,
  Minimoog: 63, Strymon TimeLine: 90). Remaining 443 rows are design-furniture
  queries (deprioritised vertical) or unresolvable noise.
- Why CSP anchoring matters:
  - Joins `reverb_price_history` deterministically (currently query-keyed).
  - Filters parts pollution: a "Jupiter-8 pitch bender cap" listing under
    the `parts` root is excluded from price-history aggregations on the
    parent product.
  - Enables demand-driven KG growth: unknown query → CSP search → auto-create
    kg_product → cache.

**AI enrichment scripts (shipped 2026-04):**
- `scripts/classify-products.ts` — Haiku batch classifier. Reads unclassified
  `kg_product` rows, returns `subcategory_id` + `subcategory_confidence`
  (smallint 0–100). Paginated via `range()` because PostgREST caps at
  1000 rows per request.
- `scripts/enrich-products.ts` — populates `kg_product.attributes` (jsonb)
  with `{ description, specs, history, external_links, related_products }`.
  Source pipeline: Wikipedia → Reverb CSP → Haiku fallback. English-only
  output. Originally seeded for the 7 priority products.
- `scripts/enrich-from-reverb-csp.ts` — see Reverb CSP integration above.
- `scripts/backfill-category-uuids.ts` — populates `kg_category.reverb_uuid`
  from `data/reverb-categories.json`. Run after migration 033.

**What the KG is NOT:**
- Design furniture (design-objects category) — do not import or build
- Cykler, tech, biler — not our vertical

**Product tier system (shipped 2026-04-28):**
- `kg_product.tier text` — `standard` (default) | `classic` | `legendary`
- `kg_product.tags text[]` — facet tags e.g. `vintage`, `discontinued`, `limited-edition`
- `kg_product.year_released int` — production year for era filtering
- Legendary products get a badge on product page hero and product cards, and appear in the homepage "Legendarisk gear" carousel
- Admin curation at `/admin/products` — search any product, click tier badge to cycle, inline year editing
- API: `GET /api/discover` — returns `{ legendary[], popular[] }` for homepage carousels

**Image pipeline (shipped 2026-04-28, extended 2026-04-30):**
- `kg_product.image_url text` — best auto-derived image URL. Storage webp preferred.
- `kg_product.hero_image_url text` — editorial override; always wins over `image_url`.
- `kg_category.image_url text` — category card background. Browse API falls back to
  `onboarding-assets/categories/{slug}.webp` if null.
- Storage bucket: `onboarding-assets` (public). Products: `products/{slug}.webp`.
  Categories: `categories/{slug}.webp`.
- `scripts/upload-product-images.ts` — curated Unsplash batch (43 products). Run:
  `npm run upload-images -- --batch` or `npm run upload-images -- <slug> <url>`.
  Runs all items every time (no delta check); upsert overwrites safely.
- `scripts/upload-csp-images.ts` — Reverb CSP → Storage webp for all eligible
  products. Delta-safe by default. Flags: `--dry-run`, `--force`, `--limit=N`,
  `--tier=X`, `--slug=X`. Run on panter after `git pull`.
- `scripts/set-category-images.ts` — populates `kg_category.image_url` from best
  product image in each root category (score: legendary+hero=6 … any+image=1).
  EDITORIAL_OVERRIDES dict for manual overrides. SKIP_AUTO set for inherited cats.
  MIN_AUTO_SCORE=2 (rejects Reverb CDN thumbnails). Ran live 2026-04-30:
  electric-guitars (score=6), acoustic-guitars (score=2), bass-guitars (score=4),
  pro-audio (score=4) populated. 9 categories still need editorial images (see
  Known Issues).
- Browse API (`/api/browse`): music-gear root excluded from results (it IS the
  browse vertical, not a subcategory). keyboards-and-synths inherits
  `music-gear.image_url` via API logic. Storage fallback for all category images.
- `next.config.mjs` allows `images.unsplash.com` as remote pattern.

**Admin tools for KG curation:**
- `/admin/products` — set tier (legendary/classic/standard) and year_released on any product
- `/admin/suggestions` — review AI-generated product suggestions (pending/approved/rejected)
- `/admin/suggestions/bulk` — bulk review by brand (AI groups proposals, human approves)
- `/admin/msrp` — set manual price ranges on products
- `/admin/product/new` — create a new KG product (see below)

## Create new product (/admin/product/new)

- Route: `/admin/product/new`
- Server component: `frontend/app/admin/product/new/page.tsx`
- Client form: `frontend/app/admin/product/NewProductForm.tsx`

**Form fields:**
- Brand (required) — searchable select, fetched from `/api/admin/product/brands`
- Canonical name (required) — "Brand + Model" rule enforced in UI
- Model name (required) — auto-derived from canonical minus brand, user can override
- Slug (required) — auto-derived, user can override, preview shown as `klup.dk/product/[slug]`
- Tier (required) — `legendary` | `classic` | `standard`, default `legendary`
- Year released (optional) — integer 1900–2030
- Status — `active` | `inactive`, default `active`
- Subcategory (optional) — searchable select, fetched from `/api/admin/product/subcategories`

**API routes:**
- `POST /api/admin/product/new`
  - Validates all required fields; returns `400 { error, field }` on failure
  - Checks slug uniqueness — returns `409 { error: 'slug_exists' }` on collision (no auto-suffix; user resolves manually)
  - Inserts `kg_product` with `browse_visibility='qa_only'`
  - Returns `201 { id, slug }`
  - Derives `category_id` from the selected brand's `kg_brand.category_id`
    (legacy `NOT NULL` column — see **Technical Debt → kg_product.category_id**;
    invisible to the API contract — clients only send `brand_id`)
- `GET /api/admin/product/brands`
  - Returns `{ brands: { id, name }[] }` ordered by name ASC
  - No pagination — `kg_brand` is small (~200 rows)
- `GET /api/admin/product/subcategories`
  - Returns `{ subcategories: { id, name, parent_name }[] }`
  - Filters `kg_category WHERE parent_id IS NOT NULL` (leaf categories only)
  - Resolves `parent_name` server-side (single query, no extra round-trip)

**Behavior:**
- On success: client-side `router.push('/admin/product/' + slug)`
- On slug collision: inline error, user adjusts manually
- Entry point: `+ Nyt produkt` button in `/admin/products` page header
- All new API routes gated with `requireAdminInRoute()` from `lib/admin-auth.ts`

**Private admin-only intelligence tools:**
- `/intel` — private arbitrage dashboard, not linked anywhere in the app
- Access control: `middleware.ts` gates `/intel/*` identically to `/admin/*` —
  session required + `user_preferences.is_admin = true` (service-role Supabase check)
- Current query surface: active `legendary` products, matched active listings
  split by `country IN ('DK', 'DE')`, median `price_dkk` per country,
  `delta_dkk = dk_median_dkk - de_median_dkk`; sorted by `delta_dkk` DESC
- Query uses PostgREST inner-join embed (`listings!inner(...)`) to avoid URL length
  limits — filtering on 22 product IDs not 4,000+ listing IDs
- Multi-market 3-panel Bloomberg-style shell shipped 2026-05-04 — see
  **Intel dashboard — multi-market shell** section below. Figma Make prompt
  retained at `.claude/plans/sparkling-drifting-treehouse.md`.
- No Klup navigation or branding on this surface; treat it as a private founder tool

**Merge-not-create rule:** Never create duplicate products. Match to existing KG entry first. If unsure, flag for review.

---

## Database — key tables

| Table | Purpose |
|---|---|
| `listings` | Raw scraped listings from all sources |
| `kg_product` | Canonical product knowledge graph |
| `kg_brand` | Brands |
| `kg_category` | Categories — two-level hierarchy (`parent_id`, `domain`) since 2026-04 |
| `saved_listings` | User-saved listings (RLS-protected) |
| `watchlists` | User watchlists — tied to a product or query |
| `listing_product_match` | Maps listings → KG products |
| `reverb_price_history` | Reverb sold prices, query-keyed (not product-keyed yet) |
| `auctionet_price_history` | Auctionet hammer prices |
| `kg_suggestions` | Pending AI-generated KG product proposals |
| `thomann_product` | Thomann retail products + scraped prices |
| `market_price_observations` | **Unified append-only price ledger** (migration 039). Asking/sold/retail across all sources + countries. Read via the `market_price_observations_trusted` view. Nothing writes to it yet |
| `price_observation` (singular) | **Unrelated live table** — user-submitted manual price reports tied to a `listing_id`, backs `/api/price-observations`. Not the same as the above |
| `listing_price_history` | Dead stub — 0 rows, zero code references. Superseded by `market_price_observations`; drop pending confirmation |

**`kg_product` columns added 2026-04** (migrations 025–031):
- `image_url text` — product image URL (Unsplash initially, Storage after upload-images run)
- `hero_image_url text` — editorial override; falls back to `image_url` on product page
- `subcategory_id uuid → kg_category` — leaf-level classification
- `subcategory_confidence smallint` — Haiku confidence 0–100
- `reverb_root_slug text`, `reverb_sub_slug text` — denormalised category anchors
- `attributes jsonb` — `{ description, specs, history, external_links, related_products, reverb_csp, reverb_csp_candidates }`
- `reverb_csp_id integer` — typed CSP anchor (migration 030). Populated by migration 032.
- `tier text DEFAULT 'standard'` — `standard` | `classic` | `legendary` (migration 031)
- `tags text[] DEFAULT '{}'` — facet tags (migration 031)
- `year_released int` — production year (migration 031)

**`listings` columns added 2026-05** (migration 037):
- `country char(2)` — ISO market code. Backfill: DKK rows → `'DK'`; Reverb rows → `'US'` (via `scripts/backfill-reverb-country.ts`). New scrapes write this at upsert time.
- `price_dkk numeric` — price converted to DKK at scrape time via `toDkkApprox()`. Backfilled from existing `price` column for DKK-currency rows.
- `frontend/lib/supabase.ts` `Listing` type updated with `country?: string | null` and `price_dkk?: number | null`.

**`kg_product` columns added 2026-05** (migration 036):
- `browse_visibility text DEFAULT 'qa_only'` — `public` | `qa_only` | `hidden`.
  CHECK constraint enforced. Controls browse page visibility independent of tier.

**Views added 2026-05** (migration 036):
- `browse_product_projection` — canonical browse query surface. One row per
  `kg_product` with pre-computed `taxonomy_state`, `supply_state`, `is_public`,
  `active_listing_count`, `tier_rank`, `has_image`. All browse routes read
  from this view via `frontend/lib/browse.ts`. See **Browse architecture** section.

**`reverb_price_history` columns added 2026-04** (migration 031):
- `kg_product_id uuid → kg_product` — nullable FK. Backfill TBD (migration 034).

**`kg_category` columns added 2026-04** (migrations 029, 033):
- `domain text` — `music` / `design` / `other`
- `parent_id uuid → kg_category` — enables 2-level hierarchy
- `reverb_uuid uuid` — stable Reverb taxonomy join key (migration 033).

**listing_product_match** was truncated April 2026 (17M rows of garbage from runaway PM2 loop). Now has unique constraint `(listing_id, product_id)` and index on `listing_id`. Match-listings job should be restarted after confirming it won't loop.

---

## Auth

- Primary: email/password
- Secondary: magic link
- Google SSO: stub exists, not fully wired
- Password reset: implemented
- **UX rule:** Search-first onboarding. Users can search without account. Sign-up is triggered inline when saving a listing or creating a watchlist. Never gate search.

---

## Design rules — non-negotiable

**Green accent `#13ec6d`:** ONLY on Kup-rating stars and "Aktiv" badges.
**Never** on buttons, navigation, or any other UI element.

**Brand badges (source indicators):**
- DBA: `#00098A`
- Finn.no: `#06bffc`
- Blocket.se: `#F71414`
- Thomann: white on `#002D4C`
- Reverb: `#EC5A2C` (unconfirmed — verify against brand guidelines)

**Typography:** DM Serif Display for headlines, Inter for body.

**Price history / prishistorik:**
- ONLY on `/saved` and product pages
- NEVER on SERP (search results) — cross-variant averaging is misleading

**Kup-score:** Hidden in UI. Will be revealed when there is sufficient per-variant price history data. Do not remove the logic, just keep it hidden.

---

## Analytics (PostHog)

EU cloud. GDPR compliant.

**Events logged:**
- `search_performed` (with `query` property)
- `listing_clicked`
- `listing_saved`
- `watchlist_created`
- `signup_completed`

`category` property is deferred — requires surfacing `kg_product → kg_brand → kg_category` in API response.

**UTM taxonomy (ready for paid campaigns):**
- `utm_source`: `facebook` / `dba`
- `utm_medium`: `paid` / `organic`
- `utm_campaign`: by gear category (guitar, synthesizer, mikrofon)

---

## Deployment

```bash
git push origin main
```

Vercel auto-deploys from `main`. That's it. Never use Vercel CLI.

**DNS:** Simply.com. Protonmail MX records must never be touched.

---

## Working principles

**Before building anything:**
1. State what problem it solves
2. Identify the riskiest assumption
3. Ask: can we test this without code first?
4. Only then write code

**Demand-driven scraping:** Scrape what users actually follow. Not everything. Not preemptively.

**Over-engineering is the recurring failure mode.** When in doubt, do less. Ship smaller.

**Strategic alignment before implementation.** If a feature doesn't move toward "is this a good price?", deprioritise it.

**No quick fixes.** Every change is built to last. If the right solution takes longer, take longer. Shortcuts create cleanup debt that costs more than the time saved. If a fix feels hacky, it is — stop and find the correct approach before writing code.

**Never:**
- Run scrapers without rate limiting (min 2s between requests + jitter)
- Let PM2 restart a crashing job immediately — add crash-and-don't-restart logic on timeout-prone jobs
- Deploy on Friday
- Hardcode secrets or API keys
- Log PII
- Ask for secrets in chat — route via Vercel dashboard / password manager

---

## Phase 0 — Security & stability hardening (completed 2026-04-30)

### 0.1 — /api/scrape hardened

- **Per-IP token bucket rate limiting**: 20 req/min via Vercel Edge Middleware
  (file: `middleware.ts`, lines 10-36). In-memory per-Edge-instance map.
  Scoped to `/api/scrape` only. Returns 429 `{ error: 'rate_limit', retry_after: 60 }`.
- **Fire-and-forget write errors now surfaced**: Thomann product upserts
  (lines 82-95) replaced silent catch with structured `console.error`:
  `{ route: '/api/scrape', action: 'thomann_write', error, query }`.
  Non-blocking; errors surface as structured logs without breaking user response.
- **Deterministic Thomann listing IDs**: `crypto.randomUUID()` (line 175) replaced
  with SHA-256 hash of `thomann:${url}` (line 16: `deterministicListingId()`).
  Formatted as UUID. Saved listings now survive page refresh via stable ID.

### 0.2 — PostgREST 1000-row truncation fixed

- **browse/route.ts** (lines 8-50): `kg_product` query replaced with paginated
  `range()` loop (lines 30-49) to fetch all ~3,840 products. `listing_product_match`
  replaced with `count:product_id.count()` aggregate (line 27) — one row per product
  instead of one per listing match. Verified: is_active filter applied correctly.
- **browse/[root]/route.ts** (line 65): product `.limit(200)` → `.limit(500)` with
  TODO. Listing count query (lines 80-85) uses same aggregate pattern.
- **discover/route.ts** (lines 23-32): matches query (line 27) uses aggregate
  instead of `limit(5000)`. One row per product_id with active listing count.
- **Verified correct**: aggregate counts match active-only manual counts on top 5
  products: Gibson Les Paul (705), J-45 (400), Jazz Bass (392), Hummingbird (311),
  P-Bass (272).
- **Note**: `eq('listings.is_active', true)` relies on PostgREST 12 implicit join
  filtering (without embedding listings in select). Verified working on current
  Supabase Pro version. If Supabase upgrades break this, move filter to explicit
  subquery.

### 0.3 — PII-adjacent logs removed

- **saved-listings/route.ts**: Four `console.log` lines removed (lines ~26, ~39, ~40, ~61)
  that linked listing IDs to user context or returned match data.
- **Silent catch {} replaced** (lines 122-124): catch block on price_fetch_queue
  upsert now surfaces errors via structured `console.error`:
  `{ error: err instanceof Error ? err.message : String(err) }`.

### 0.4 — Migration 034 applied

- See Reverb CSP integration → "Migration 034 applied 2026-04-30" above.

### 0.5 — Browse refactor (prerequisite for Phase 1)

Browse visibility bugs discovered during Phase 0 smoke testing triggered
a full browse architecture refactor. Refactor is complete and is a
prerequisite for Phase 1. See **Browse architecture** section for full
details. Browse pages now surface only `is_public=true` products, and the
visibility model gives a clear, single-field promotion path from KG
curation to public browse.

---

## Browse architecture (completed 2026-04-30)

Browse now reads from a canonical DB view `browse_product_projection`
instead of ad-hoc queries in each route. All browse logic is consolidated
in `frontend/lib/browse.ts`.

**Migration 036 added:**
- `kg_product.browse_visibility text` — `public` | `qa_only` | `hidden`
  (default: `qa_only`). CHECK constraint enforced.
- `idx_kg_product_browse_visibility` — composite index on
  `(status, browse_visibility, subcategory_id)`.
- `browse_product_projection` view — one row per `kg_product` with all
  browse-relevant fields pre-computed.

**View columns (key fields):**
- `taxonomy_state`: `classified` | `missing_subcategory` | `missing_root_mapping`
- `supply_state`: `live` | `no_live_listings`
- `browse_visibility`: `public` | `qa_only` | `hidden`
- `is_public`: `boolean` — `true` when `status=active` AND
  `browse_visibility=public` AND `taxonomy_state=classified`
- `active_listing_count`, `tier_rank`, `has_image` — pre-joined for sorting

**Visibility model:**
- Public browse shows only `is_public=true` products
- Initial public set: active products with `subcategory_id` set and
  `tier IN ('classic', 'legendary')` — 23 products at launch (1 classic,
  22 legendary). Set by migration 036 UPDATE.
- Standard-tier products are `qa_only` by default
- Promoting a product to public = single UPDATE:
  `SET browse_visibility='public'` via admin UI or SQL
- `tier` is now an editorial/badge field only — it no longer gates browse
  visibility directly

**Count semantics (defined once in `lib/browse.ts`, used everywhere):**
- Root cards: `subtree_public_count`
- Subcategory labels: `direct_public_count`
- Public counts are hidden in UI during initial rollout pending QA sign-off
- Six count variants exposed in debug mode:
  `direct_catalog_count`, `subtree_catalog_count`,
  `direct_public_count`, `subtree_public_count`,
  `direct_live_count`, `subtree_live_count`

**Admin curation:**
- `browse_visibility` is exposed in `/admin/products` — admins can toggle
  `public` | `qa_only` | `hidden` per product
- `/browse` and `/api/browse` are public for QA and launch-path testing;
  admin-only debug payload is enforced inside the route handlers, not in
  middleware
- Debug mode: `/browse?debug=1` and `/browse/[root]?debug=1` — admin only
- Debug shows: all products regardless of visibility, all six count variants,
  `exclusion_reason` per product, orphan summary (missing_subcategory,
  inactive, etc.)

**Known issues (as of 2026-05-01, pending fix):**
- Debug mode toggle not surfaced as a UI element in admin — requires URL
  param manually
- `debug=1` param is stripped on subcategory navigation
- Admin toggle for `browse_visibility` in `/admin/products` not yet
  confirmed working end-to-end

---

## Multi-market expansion (shipped 2026-05-03)

**Goal:** capture cross-border arbitrage opportunities — buy cheap in DE/US, sell at
DK market rate. The listings table, scrape pipeline, and intel dashboard were all
extended to support multi-market price comparison.

### Migration 037

- Added `country char(2)` and `price_dkk numeric` (both nullable) to `listings`.
- Backfill: existing DKK-currency listings → `country='DK'`, `price_dkk=price`.
- `scripts/backfill-reverb-country.ts` — one-off backfill for Reverb rows:
  sets `country='US'` (Reverb is a US marketplace; original currency info was
  lost because `buildRow` converted to DKK at scrape time) and `price_dkk=price`
  (already in DKK). Uses `.update().eq('id', row.id)` — not upsert — to avoid
  NOT NULL constraint violations on `title` and other required columns.
  Run: `npx tsx scripts/backfill-reverb-country.ts`

### Scrape pipeline

- **`frontend/lib/scrapers/schibsted.ts`**: `SchibstedConfig` gained `country: string`.
  `DBA_CONFIG` → `'DK'`, `FINN_CONFIG` → `'NO'`, `BLOCKET_CONFIG` → `'SE'`.
  Each scraped listing now carries the correct ISO market code.
- **`frontend/app/api/scrape/route.ts`**: Schibsted batch upsert and URL-mode upsert
  now write `country` and `price_dkk` (via `toDkkApprox(price, currency)`).
  Kleinanzeigen added to `ALL_SOURCES` and the parallel jobs array.
- **`scripts/scrape-reverb.ts`**: `buildRow` now writes `country: 'US'` and
  `price_dkk: priceDkk` on every Reverb listing upsert.

### New scraper: Kleinanzeigen.de

- **Frontend library**: `frontend/lib/scrapers/kleinanzeigen.ts`
  - DOM scraping via `article[data-adid]` (no JSON-LD available on Kleinanzeigen)
  - URL pattern: `https://www.kleinanzeigen.de/s-musikinstrumente/{query}/k0c74`
  - Pagination via `?pageNum=N`. Dehyphenation query variant (same as Schibsted).
  - Returns `country: 'DE'`, `currency: 'EUR'`, `price_dkk` via `toDkkApprox`.
  - Exported: `scrapeKleinanzeigen(query, maxPages?): Promise<ScrapedListing[]>`
- **Cron script**: `scripts/scrape-kleinanzeigen.ts`
  - Targets legendary + `status='active'` products from KG only.
  - 3 s rate limit between products. Flags: `--limit=N`, `--product="name"`.
  - Module resolution: `require('../frontend/node_modules/@supabase/supabase-js')` —
    no root `node_modules`; all scripts in `scripts/` use this pattern.
  - Registered in `ecosystem.config.js` on panter, cron `0 1 * * *`.

### New cron scripts (same pattern)

- `scripts/scrape-blocket.ts` — SE market via `frontend/lib/scrapers/blocket.ts`
- `scripts/scrape-finn.ts` — NO market via `frontend/lib/scrapers/finn.ts`
- Both: legendary products only, 3 s rate limit, `--limit=N` / `--product=` flags,
  `autorestart: false`, daily 01:00.

### Module resolution pattern for scripts/

Scripts in `scripts/` cannot use `@/` path aliases or bare `@supabase/supabase-js`
because there is no `node_modules` at the repo root. Use:
```typescript
import type { SupabaseClient } from '../frontend/node_modules/@supabase/supabase-js'
const { createClient } = require('../frontend/node_modules/@supabase/supabase-js') as typeof import('../frontend/node_modules/@supabase/supabase-js')
```
All scripts in `scripts/` that use Supabase follow this pattern.

---

## Intel dashboard — multi-market shell (shipped 2026-05-04)

The single-table DK/DE list at `/intel` was replaced with a three-panel
Bloomberg-style dashboard. Server-component fetch + client-component
interactivity, all hardcoded colors (private admin tool — exempt from the
sparse-accent rule per `frontend/CLAUDE.md`).

**Files:**
- `frontend/app/intel/page.tsx` — server component. Loads legendary products,
  joins `listing_product_match` → `listings` via inner-embed, filters
  `is_active=true` and `country IN ('DK','DE','SE','NO','US')`, computes
  per-market count + min/p25/median/p75/max in TypeScript, plus deltas
  (DK–DE, DK–SE, DK–NO, DK–US) and `best_delta` (DK vs cheapest foreign
  median).
- `frontend/app/intel/IntelDashboard.tsx` — client component. Holds
  selection + filter state. 3-panel layout: 180px left sidebar
  (followed products + best-delta arrows), main panel (overview table +
  filter chips + last-refreshed timestamp), 320px right panel (product
  detail).
- `frontend/app/intel/types.ts` — shared `Market` / `IntelListing` /
  `IntelProduct` / `IntelData` types.

**Overview table columns:** Product · DK · DE · SE · NO · US · Δ DK–DE ·
Δ DK–NO · Δ DK–SE. Each market cell shows median (primary) + count
(muted). Row click opens right-panel detail.

**Right panel sections:** product header (LEGENDARY badge), price-band
IQR bars per market with a shared x-axis (lowest-median market gets
`#13ec6d` accent), three delta cards (Δ DK–DE / Δ DK–US / Best deal with
country + source subtitle), top-10 active listings sorted by
`price_dkk` ascending with brand-coloured source badges + flag emoji,
sparkline placeholder.

**Real arbitrage signal confirmed:** Roland Juno-106 NO→DK delta is
visible in the dashboard once Schibsted price_dkk backfill ran (see
**Backfills run** below).

**Filter chips** (radio-style): All · Legendary Only · Has DE Data ·
Delta > 10.000 DKK. Default: All.

---

## Admin product curation page (shipped 2026-05-05)

Founder-facing private curation tool at `/admin/product/[slug]`. Not
linked from anywhere; reached by typing the URL or via prev/next nav
between legendary products.

**Files:**
- `frontend/app/admin/product/[slug]/page.tsx` — server component.
  Loads `kg_product` (+ brand), `thomann_product` (canonical-name
  ilike), all `listing_product_match` rows where
  `is_valid IS NULL OR is_valid = true` joined to `listings`, all
  `synonym` rows for the product, and prev/next legendary product by
  `canonical_name` for navigation.
- `frontend/app/admin/product/[slug]/ProductCurationClient.tsx` —
  client component. Four sections, optimistic UI updates, brand-coloured
  source badges, country flag emoji.

**Section 1 — Product header:** hero/image, canonical name, brand · year,
LEGENDARY badge, Thomann nypris (or "Ingen nypris"), prev / next
navigation.

**Section 2 — Søgeord / Synonymer:** list current synonyms (alias · lang ·
priority), inline add form (alias · lang select da/de/en/sv/no ·
priority numeric), per-row delete button. Adds default
`match_type='alias'` because the `synonym` table CHECK constraint
requires one of `('exact','alias','abbrev')`.

**Section 3 — Søg på Kleinanzeigen nu:** query input pre-filled with
`canonical_name`, runs `scrapeKleinanzeigen(query, 3)` server-side,
returns scraped listings without writing to the DB. "Gem listing" button
per result upserts into `listings` and creates a confirmed
`listing_product_match` (is_valid=true).

**Section 4 — Matchede listings (X):** filter chips (Alle / DBA / Reverb /
Kleinanzeigen / Finn / Blocket), table with source badge · flag · title
(truncated 60) · price · price_dkk · location · days · external link ·
red "Bad match" button. Inactive listings render at 0.5 opacity.
Rejected matches removed from UI immediately on click.

**API routes (admin-gated):**
- `POST   /api/admin/product/[slug]/synonym` — insert synonym.
  Body `{ alias, lang, priority }`. Returns inserted row.
  400 if alias empty, 404 if slug not found.
- `DELETE /api/admin/product/[slug]/synonym/[id]` — guarded by
  `product_id` match so an admin can't delete another product's synonym
  by id. Returns `{ deleted: true }`. 404 if not found.
- `POST   /api/admin/product/[slug]/scrape-kleinanzeigen` — body
  `{ query }`, calls `scrapeKleinanzeigen()`, returns
  `{ listings: ScrapedListing[] }`. No DB writes.
- `POST   /api/admin/product/[slug]/save-listing` — body
  `{ listing }`, upserts `listings` (onConflict `external_id, source`)
  + upserts `listing_product_match` with `method='FUZZY'`, `score=100`,
  `is_valid=true`. **Note:** spec asked for `method='manual'` but the
  CHECK constraint on `listing_product_match.method` only permits
  `('EAN','SKU','MODEL','SYNONYM','FUZZY')`, so manually-confirmed
  matches use `'FUZZY'` — same convention as
  `/api/admin/match/approve/route.ts`.
- `POST   /api/admin/product/[slug]/reject-match` — body
  `{ listing_id, reason? }`, sets `is_valid=false` + `rejected_reason`
  guarded by `(listing_id, product_id)` pair.

**Auth helper:** `frontend/lib/admin-auth.ts` gained
`requireAdminInRoute(): Promise<NextResponse | null>` that returns 401
if no session, 403 if not admin, or null on pass-through. The five new
routes use it because `middleware.ts` gates `/admin/*` page routes but
**not** `/api/admin/*` — the auth gate has to live in the route
handler.

---

## Match quality flags (shipped 2026-05-05)

### Migration 038

- Added two nullable columns to `listing_product_match`:
  - `is_valid boolean` — `null` = unreviewed, `true` = confirmed,
    `false` = rejected. No default.
  - `rejected_reason text` — optional free-text, populated when
    `is_valid = false`.
- No backfill — existing rows stay `NULL` (unreviewed).
- No FK, no index, no constraint changes.

### Visibility rules

- **Product detail pages** (`/api/product/[slug]`) and **intel dashboard**
  (`/api/intel/*` server fetch) must filter
  `is_valid IS NULL OR is_valid = true` so rejected matches never
  surface in user-facing or analytical views.
- The admin curation page applies this filter directly in its server
  fetch.
- **TODO:** audit all consumers of `listing_product_match` and apply
  the same filter — the new column is currently honoured only by the
  curation page; product/[slug] and intel/page.tsx filters need to be
  added in a follow-up.

---

## model_name fixes & match-listings recovery (2026-05-05)

### Symptom

`match-listings` was producing 0% match-rate. Diagnosis: `model_name`
was `NULL` on every legendary product. The matcher uses `model_name` as
the primary token for the `MODEL` match path (score 70), so a NULL
`model_name` meant the strongest match path was disabled across the
entire legendary set.

### Fix

- Manual SQL `UPDATE` populated `model_name` for all 19 legendary
  products by stripping the brand prefix from `canonical_name`
  (e.g. `Roland Juno-106` → `Juno-106`).
- `scripts/backfill-model-names.ts` — re-runnable backfill that
  derives `model_name` by stripping the matched brand prefix. Targets
  rows where `tier IN ('legendary','classic')` and `model_name IS
  NULL`. Idempotent.

### Match-rate after fix

- Recovered to ~7% on the mixed listing pool (up from 0%).
- The remaining ~19k unmatched Reverb listings are **expected** —
  parts, accessories, and listings that don't clearly resolve to a KG
  product. `match-listings` is conservative by design: it only links
  listings that clearly belong to a single KG product.

### Rule (going forward)

`model_name` must be set for **legendary and classic** tier products.
A null `model_name` on these tiers disables the highest-confidence
match path and silently kills match-rate for the most-watched
products. Standard-tier products may stay `model_name=NULL` until
demand surfaces them.

---

## Backfills run (2026-05-04 → 2026-05-05)

- `scripts/backfill-schibsted-price-dkk.ts` — populated `price_dkk` and
  `country` for **1,248 Schibsted/Kleinanzeigen listings** scraped
  before migration 037 wired the columns into the upsert path.
  Source-conditional country mapping: dba.dk→DK, finn→NO, blocket→SE,
  kleinanzeigen→DE. Uses `.update().eq('id', row.id)` per row to avoid
  NOT NULL violations on `title`.
- `scripts/backfill-reverb-country.ts` — re-run twice; total **172
  rows** updated across both runs (covers Reverb listings that landed
  between the migration and the scraper-config update).

---

## Reliability fixes (2026-08-05)

Scrape pipeline had been silently dead for weeks. Root causes found and fixed:

- **`frontend/node_modules` did not exist on panter.** Killed
  `scrape-finn` / `scrape-blocket` (missing `cheerio`, a frontend-only dep)
  and `scrape-kleinanzeigen` (its `require('../frontend/node_modules/@supabase/supabase-js')`
  path). Fixed by `npm install` in `frontend/`. **Note this is the inverse
  of what the "Module resolution pattern for scripts/" section says** — that
  pattern assumes `frontend/node_modules` exists and the repo root has none;
  in reality the root has `node_modules` and frontend's must be installed
  separately. Both must exist on panter.
- **`scrape-reverb` stale-marking timed out every run.** The
  "mark listings inactive after 48h" UPDATE did a **sequential scan over all
  73k `listings` rows** — no supporting index — and hit the statement
  timeout, so the job never completed. Fixed by adding
  `idx_listings_source_active_scraped ON listings (source, scraped_at) WHERE is_active = true`.
  Verified via `EXPLAIN ANALYZE`: scan time 1.5s → 0.34s. The scraper's
  fetch/upsert logic was always fine — a live run upserted successfully.
  **The historical root cause of the 2026-05-22 → 2026-08-05 data gap was
  never fully confirmed** (logs unrotated; sleep/reboots/DNS ruled out).
- **`price_fetch_queue` had an unsatisfiable constraint.**
  `UNIQUE (product_slug, status)` made the `pending → processing → done`
  transition impossible once a slug already had rows in those states. Both
  `.update()` error returns in `process-price-queue.ts` were unchecked, so
  it failed silently: **19,158 reprocessings of one queue row**, generating
  **97,420 garbage `reverb_price_history` rows** (98.4% of that table) at
  ~5,760/day. Fixed by dropping the constraint, replacing it with a partial
  unique index on `(product_slug) WHERE status IN ('pending','processing')`,
  and adding error checks to every `.update()` in the script.
- **`listings.external_id` backfilled.** 3,805 dba.dk rows had NULL
  `external_id`, defeating the `(external_id, source)` unique index. Found
  141 genuine duplicate rows in the process (one carried a live match, which
  was reassigned before deletion). Backfilled using the same deterministic
  SHA-256 convention as Thomann: `encode(digest('dba.dk:' || url, 'sha256'), 'hex')`.
- **`price_snapshots_old` dropped** (6,136,796 rows, zero code references,
  superseded by the current `price_snapshots`).

---

## Unified price observations — `market_price_observations` (migration 039, 2026-08-05)

Append-only ledger for price history across every source, price type, and
country. Built because **`listings` upserts on `(external_id, source)` and
therefore overwrites price in place** — outside Reverb's separate
`reverb_price_history`, no asking-price trail existed at all for
DBA/Finn/Blocket/Kleinanzeigen.

```
market_price_observations (
  id, kg_product_id (FK, nullable until matched),
  source, country, price_type CHECK IN ('asking','sold','retail'),
  price_raw, currency, price_dkk, condition,
  listing_url, listing_title, external_id,
  match_confidence smallint, match_method, is_valid,
  observed_at, created_at
)
```

- `market_price_observations_trusted` view — `kg_product_id IS NOT NULL AND is_valid IS DISTINCT FROM false`.
  **All charts / deltas / arbitrage queries read the view, never the raw table.**
- Indexes: dedup on `(source, external_id, price_type, observed_at)`;
  lookup on `(kg_product_id, price_type, country, observed_at DESC)`.
- RLS enabled; public read of trusted rows only, writes are service-role.

> ⚠️ **`price_observation` (singular) is a DIFFERENT, LIVE table — do not
> confuse them.** It backs `frontend/app/api/price-observations/route.ts`
> (authenticated users submitting a manual price report tied to a
> `listing_id`; ~14 rows). Migration 039 originally created the new table as
> `price_observations` (plural, one letter apart) and 039b renamed it to
> `market_price_observations` before anything referenced it. Keep them apart.

### THREE SEPARATE LAYERS — do not mix them (2026-08-06)

`market_price_observations` is an **event log, not a statistical sample of
the market.** Computing a median directly over it biases toward listings
that changed price, because those emit more events than stable ones.

| Purpose | Correct data source |
|---|---|
| Current asking median | One current row per **active listing** — query `listings`, never the event log |
| Price-change history | `market_price_observations` (`first_seen` / `price_change` events) |
| Historical market level | `market_price_daily` — daily aggregate per product × source × market (migration 041) |

**Never average across `price_type`.** `asking` (what sellers hoped for),
`sold` (Reverb transactions), and `retail` (Thomann new) are different
economic quantities.

### Event-based, NOT daily snapshots (corrected 2026-08-06)

**A listing that sits on DBA for 90 days is ONE unit of supply observed 90
times — not 90 data points.** The first implementation wrote a day-bucketed
row per listing per scrape, which would have let long-lived, overpriced
listings dominate any median: the ads that did *not* sell would define the
"market price". Corrected before the first nightly run compounded it.

A row is now written only on a **meaningful event**:
- `first_seen` — first time this listing is observed
- `price_change` — the seller changed the asking price

An unchanged listing writes nothing. Verified: re-scraping 6 unchanged
Juno-106 listings produced 0 new rows.

**Migration 040** added `listings.first_seen_at` and `listings.delisted_at`
so listing identity persists across snapshots. Derive time-on-market and
status from `listings` (first_seen_at → scraped_at, is_active, delisted_at),
**never by counting observation rows**.

`reconcileListingLifecycle()` in `scripts/lib/price-observations.ts` marks
listings that stopped appearing. **A disappearance is not proof of sale** —
it may be expired, deleted, or renewed. Any "sold price" inference must
carry that uncertainty explicitly.

**Never average across `price_type`.** `asking` (what sellers hoped for),
`sold` (Reverb transactions), and `retail` (Thomann new) are different
economic quantities.

**Status: `scrape-dba` is the first writer.** Finn/Blocket/Kleinanzeigen/
Reverb still need wiring. `market_price_daily` (layer 3) has no writer yet —
a daily aggregation job is still required.

---

## Scrape quality gate — validate OUTPUT, not exit code (2026-08-06)

**The lesson that forced this:** `scrape-finn` and `scrape-blocket` both
exited 0 and looked healthy while **100% of saved listings had NULL
price_dkk** — the field every arbitrage calculation depends on. NO and SE
were silently invisible for weeks. *A job can be operationally green and
product-worthless at the same time.*

`scripts/lib/scrape-health.ts` + `scrape_run` table (migration 041).
Three outcomes:

| Status | Meaning |
|---|---|
| `passed` | Data publishes normally |
| `quarantined` | Stored, but **excluded from price aggregation and Kup-score**; lifecycle skipped |
| `failed` | Hard invariant broken; **no lifecycle updates**, run untrusted, exit code 1 |

**Hard invariants (→ failed):** all `price_dkk` NULL · empty `external_id` ·
invalid currency. These make data unusable by definition.

**Soft signals (→ quarantined):** partial NULL price_dkk · high null-title
rate · duplicate rate >20% · suspiciously low volume · >25% product failures ·
volume swing >60% vs last passed run. These *alarm*, they do not auto-discard —
they may be legitimate market movement.

### Fail-closed: stage → evaluate → promote (migration 042)

**The gate must PREVENT damage, not record it.** The first version evaluated
*after* upserting to `listings`, so a detected fault had already been
published. Corrected to a staging flow — nothing on the scrape path may
write to `listings` except `promoteRun()`:

1. `stageListings()` → `listing_staging`, keyed by `run_id`
2. `evaluateRun()` → health computed from staged rows
3. `promoteRun()` → **only on `passed`**: listings + price events + lifecycle

`quarantined` / `failed` → rows stay in staging for forensics, zero
downstream effect, `published_count` stays NULL.

**Proven by fault injection** (`--simulate-bad-data` nulls every `price_dkk`,
reproducing the Finn bug): gate returned FAILED, and `listings` (7,028),
`market_price_observations` (612), and `consecutive_misses` (0 rows) were all
**bit-identical before and after**. The run's rows sat in staging, unpublished.

Regression-test the invariant with:
`npx tsx scripts/scrape-dba.ts --product="juno-106" --simulate-bad-data`

### Coverage manifest — "no exceptions" is not completeness

A scraper can return HTTP 200 and still lose half its pages to changed
pagination. `coverage_complete` requires **every expected product scraped**
(`scrapedProducts === products.length`, zero failures, no `--limit`/
`--product`), not merely the absence of thrown errors. Lifecycle
reconciliation is gated on it separately from the data-quality gate: a
targeted run may publish its listings but must never conclude that unseen
listings are gone.

### Idempotent miss counting

`listings.last_miss_run_id` ensures a listing accrues **at most one miss per
unique run**. A retry or resumed job for the same `run_id` cannot compound
misses into a false delisting. Re-finds clear the counter and the marker.

### Baseline protection

Anomaly comparison uses `robustBaseline()` — the **median volume over the
last 14 PASSED runs**, never the single previous run. Otherwise one bad run
becomes the new normal and lets the next bad run through. The baseline used
in each decision is stored on `scrape_run.baseline` so the call can be
re-audited.

> ⚠️ **KNOWN DEFECT — baseline is not scope-aware. NEXT TASK.**
> `robustBaseline()` filters on `status='passed'` only, so **targeted runs
> pollute the baseline for full runs**. Observed live: the first full
> 30-product candidate bootstrap reported `volume_swing: 12600% (6 → 762)`
> because the only prior passed runs were `--product=juno-106` runs of 6
> listings. Same class of bug as the unscoped coverage function retired in
> migration 048.
>
> Required contract (not yet implemented):
> - Baseline cohort matched EXACTLY on `source` + `coverage_scope_hash` +
>   `coverage_version` + `scraper_version` + parser version + pagination strategy.
> - Only complete, promoted runs with approved coverage may qualify.
> - Targeted runs, quarantined runs, and run `43f27632-5881-4095-83a7-b7b840638ba1`
>   must NEVER be included.
> - No comparable runs → `baseline_unavailable`. That is **information, not a
>   violation** — a first complete run must not quarantine merely for lacking
>   a baseline.
> - A first complete run is judged only on hard invariants and absolute data
>   contracts. Relative volume rules activate only once a prior qualifying run
>   with an identical cohort exists.
> - The chosen baseline and its run IDs are stored on the evaluated run so the
>   gate verdict can be re-audited deterministically.
> - Computed from unambiguously named GLOBAL run measurements, never from sums
>   of query-local counts (see the count-naming note below).
>
> Minimum tests: targeted run cannot seed a full scope · different scope hash
> → `baseline_unavailable` · different version/pagination fields →
> `baseline_unavailable` · quarantined and unpromoted runs ignored · first
> complete run not quarantined for missing baseline · second identical run
> gets a correct baseline · volume collapse within an identical cohort raises
> anomaly/quarantine · baseline selection stable under concurrent inserts.

### Count naming — these are five different numbers

The candidate bootstrap reported `796 raw`, `760 unique-per-query`,
`762 staged`, `701 globally unique`. All are legitimate (query results
overlap), but they must never be conflated:

| Meaning | Where |
|---|---|
| Sum of raw results across queries | `sum(scrape_query_coverage.raw_count)` |
| Sum of query-local unique listings | `sum(scrape_query_coverage.unique_staged_count)` |
| Globally unique listings for the run | `scrape_run` metric (distinct `external_id`) |
| Actual staging rows | `scrape_run.staged_count` |
| Actually published | `scrape_run.published_count` |

Baseline and volume rules use the **global** measurements only.

**Wired into `scrape-dba` only.** Finn/Blocket/Kleinanzeigen/Reverb still
need it — the gate is meant to be mandatory for every source.

---

## Where the SQL lives

**`scripts/migrations/NNN_name.sql`** is the record for every schema change.
Applied manually via the Supabase SQL editor (no migration tooling); the file
is the source of truth, not this document. See `scripts/migrations/README.md`
for the 039–048 table with per-file idempotency notes.

**`scripts/queries/`** holds read-only SQL that must never be confused with
migrations — `diagnostics/`, `verification/`, `operations/`. See
`scripts/queries/README.md`.

| Contract described below | File |
|---|---|
| `market_price_observations` + trusted view | `migrations/039_market_price_observations.sql`, `039b`, `039c` |
| Listing lifecycle columns | `migrations/040_listing_lifecycle_tracking.sql` |
| `scrape_run`, `market_price_daily` | `migrations/041_scrape_run_health_and_market_price_daily.sql` |
| `listing_staging`, fail-closed columns | `migrations/042_listing_staging_fail_closed.sql` |
| `promote_scrape_run()` (current = 047) | `migrations/043`, `045`, `046`, `047` |
| `scrape_query_coverage`, coverage_v2 fns | `migrations/044_coverage_v2_manifest.sql` |
| `listing_coverage_scopes` relation | `migrations/046_listing_coverage_scopes_relation.sql` |
| `staging_digest` guard | `migrations/047_staging_digest_guard.sql` |
| Retired unscoped coverage fn | `migrations/048_retire_unscoped_coverage_function.sql` |
| Fail-closed proof | `queries/verification/fail_closed_publication.sql` |
| Lifecycle-disabled proof | `queries/verification/lifecycle_disabled.sql` |
| The finn/blocket NULL-price_dkk detector | `queries/diagnostics/null_rates_per_source.sql` |

---

## coverage_v2 — lifecycle-grade coverage (migrations 044–048, 2026-08-06)

**Why v1 was unsafe:** it asserted "every expected product was scraped" —
that is QUERY coverage, not LISTING coverage. A run fetching only page 1 of
every query passed, established a false universe, and three identical
pagination faults could then still mass-delist. The bootstrap guard only
deferred that risk by one night.

### Schema

- `scrape_query_coverage` — one row per expected product/query:
  `query_started`, `query_completed`, `pages_fetched`, `termination_reason`,
  `raw_count`, `parsed_count`, `parse_error_count`, `unique_staged_count`,
  `pagination_tokens`.
- `scrape_run` gained: `coverage_version`, `coverage_scope_hash`,
  `staging_digest`, `expected_products`, `covered_products`,
  `gate_version`, `scraper_version`, `baseline`, `raw_count`,
  `staged_count`, `published_count`, `promoted_at`.
- `listing_coverage_scopes(listing_id, scope_hash, source, source_query,
  first_seen_run_id, last_seen_run_id)` — see Scope provenance below.

### Termination reasons — only three are terminal

`empty_page` · `no_next_token` · `known_last_page` are terminal.
`max_pages_hit` · `error` · `unknown` are **not** — they mean listings may
exist that were never seen, which cannot support delisting.

**Pagination runs to documented exhaustion.** `MAX_PAGES_FUSE = 40` is a
runaway fuse, never a success signal.

`no_next_token` is an **inference**, not proof: Schibsted omits the
`CollectionPage` block past the last page, which is indistinguishable from an
intermittently missing block. It therefore requires a **jittered re-fetch of
the same page that reproduces the same answer**; disagreement → `error`.

### `run_has_lifecycle_coverage(run_id)`

Requires: `status='passed'` · `coverage_version='v2'` · every expected query
present, completed, and terminal · `parsed/raw ≥ 0.95` (a parser silently
dropping results looks like "fewer listings exist", which would fake
delistings).

### Scope-specific bootstrap

`scope_has_established_coverage(source, scope_hash, scraper_version)`.
Approval belongs to a scope, never to a source.

> Migration 048 **retired** `source_has_established_coverage(source)` — it now
> RAISEs. It accepted any v2 run, so a single `--product` run established
> coverage for an entire source. Observed live.

### Scope provenance must be a RELATION

`listings.coverage_scope_hash` was overwritten on every promotion, so a
targeted run replaced a listing's provenance with a 1-product scope and those
listings would have escaped miss accumulation in the established universe
**permanently**. Membership now lives in `listing_coverage_scopes` and is
**additive** — `ON CONFLICT DO UPDATE` touches only `last_seen_*`. Miss
eligibility comes from a JOIN on that relation; the column is DEPRECATED.

### Atomic, fail-closed promotion

`promote_scrape_run()` is ONE transaction. It refuses: non-`passed` status ·
already-promoted runs · `staging_digest` mismatch (staging mutated after the
gate). `FOR UPDATE` serialises concurrent promotion.

Regression tests (all verified 2026-08-06):
```bash
npx tsx scripts/scrape-dba.ts --product="juno-106" --simulate-bad-data
npx tsx scripts/scrape-dba.ts --product="juno-106" --simulate-promotion-crash
```
Both leave `listings`, `market_price_observations` and `consecutive_misses`
bit-identical. Concurrent promotion: exactly one commits.

### DBA candidate bootstrap — REJECTED, do not reclassify

Run `43f27632-5881-4095-83a7-b7b840638ba1`, `quarantined`, 762 rows in
staging, never promoted. **Must remain untouched** — no reclassification,
promotion, misses or delisting. It is forensic evidence.

Findings:
- **The product universe is 30, not 48** (28 legendary + 2 classic active).
  The "48" in earlier notes was wrong — it came from a `listing_product_match`
  row count. Contract is `expected=30`, `recorded=30`.
- 22/30 queries reached `empty_page`; **8/30 returned `error`**.
- Baseline pollution (see the defect note above).

### The 8 failing queries — diagnosed, unresolved by design

Ampex ATR-700 · ARP 2600 · Oberheim OB-X · Oberheim OB-Xa · Rhodes Mark I
Suitcase 73 · Rhodes Mark II Stage 73 · Roland Jupiter-8 (mixed) · Strymon
TimeLine.

All fail on page 1 with `raw_count=0`. **They are genuinely zero-result
searches, not faults** — rare vintage gear with no current Danish listings.
DBA omits the `CollectionPage` block entirely on a zero-result page (the
second JSON-LD block is present but **empty**, `len=0`), which is
indistinguishable from a schema break.

`zero_results` was investigated and **deliberately NOT implemented** — no
positive, stable marker exists:

| Signal | Verdict |
|---|---|
| 13 text markers (`no-results`, `"totalCount":0`, …) | none present on the zero page |
| Lexical diff | only base64-ish payloads |
| Empty/unparseable JSON-LD block | absence, not a positive signal — rejected |
| `__NEXT_DATA__` / RSC flight chunks | absent on both pages |
| Page size (614 KB vs 665 KB) | diagnostic only, never a rule |

**Underlying data endpoint: investigated, NOT operationally viable.**
`Accept: application/json` → HTML · `.json` suffix → 404 · `RSC: 1` → HTML ·
`?_data=` → HTML. The page is a server-rendered podlet
(`recommerce-search-page`); there is no intermediate JSON call to observe.
Only client-bundle reverse engineering remains, which is explicitly out of
scope as unstable.

**Consequence: DBA cannot reach complete coverage for all 30 products, so
DBA lifecycle cannot be enabled.** This is a property of the source, not a
temporary blocker. Do not reduce the manifest to work around it — "no current
DBA hits" is a dynamic observation, not a stable scope definition, and a
history-based scope would hide the transition from zero to one listing. Any
manifest change is a separate product decision about market relevance.

Fixtures: `scripts/fixtures/dba-{zero,hits}.html`.

### Lifecycle: never delist off one run

`DELIST_AFTER_MISSES = 3`. A single failed or partial search must never
mass-delist a source — that would fabricate a wave of fake "sold" signals.

- Lifecycle reconciliation runs **only** when the gate returned `passed`
  AND the run was a complete sweep (no `--limit`, no `--product`, zero
  product failures). Otherwise it is skipped entirely.
- Re-found listings reset `consecutive_misses` to 0 and **reactivate** if
  previously delisted (sellers renew and relist).
- `delisted_at` is **NOT a sale date.** Expired, deleted, or renewed all
  look identical from outside. Never infer a transaction from it.

---

## AI match validation — `scripts/ai-validate-matches.ts` (2026-08-05/06)

Two-tier AI review of `listing_product_match`. Solves the dominant bad-match
pattern: **sellers keyword-stuff accessory/part listings with the full model
name of a famous instrument** ("Roland TR-909 knob", "Juno-106 dust cover",
"Stratocaster pickup", EPROMs, CPUs, memory cartridges, flight cases). The
deterministic matcher cannot distinguish these — the model-name string is
present either way — so they were polluting price data and product pages.

**Why this mattered urgently:** `/api/product/[slug]` and `/intel` filter
`is_valid IS NULL OR is_valid = true`, so every unreviewed row was being
**treated as trusted and shown**. This pass is the first thing that
actually screens them.

### Usage

```bash
npx tsx scripts/ai-validate-matches.ts --dry-run              # real cost estimate from a 50-row sample, no writes
npx tsx scripts/ai-validate-matches.ts --eval                 # accuracy vs. human-labeled rows, no writes
npx tsx scripts/ai-validate-matches.ts --tier=standard --model=haiku
npx tsx scripts/ai-validate-matches.ts --pass2 --tier=legendary,classic,standard
```

Flags: `--model=sonnet|haiku` · `--tier=a,b,c` · `--limit=N` · `--pass2`
· `--force` · `--dry-run` · `--eval`

- Writes verdicts into `listing_product_match.explain` under `ai_pass1` /
  `ai_pass2` (model, verdict, confidence, reason, reviewed_at) **alongside**
  the deterministic matcher's existing explain keys — never overwrites them.
- Thresholds: `verdict='valid'` + confidence ≥ 85 → `is_valid=true`;
  `verdict='invalid'` + confidence ≥ 85 → `is_valid=false` + `rejected_reason`;
  everything else stays NULL and routes to the existing admin curation queue.
- Idempotent: skips rows already carrying the relevant pass key unless `--force`.

### Results

| Tier | Confirmed valid | Rejected | Pending review |
|---|---|---|---|
| legendary | 2,746 | 1,440 | 584 |
| classic | 46 | 0 | 2 |
| standard | 15,914 | 7,747 | 1,740 |

~**9,200 bad matches removed** from user-facing and arbitrage surfaces.
Cost: ~$8 (legendary/classic, Sonnet) + ~$21 (standard, Haiku) + ~$5 (pass 2).

**Pass 2 completed 2026-08-06 and underdelivered — this is a finding, not a
failure to retry.** Sonnet reviewed 1,908 Pass-1 uncertains and resolved only
**154** (144 valid, 10 rejected); 1,059 stayed uncertain. **A second opinion
from a stronger model does not resolve genuine ambiguity.** The remaining
~2,218 pending rows need *more signal* — images, descriptions, seller
history — or human review. Do not run a Pass 3 expecting a different result.

### Model selection — measured, not assumed

Both models were evaluated against human-labeled ground truth via `--eval`:

| Model | Precision | Recall | Accuracy |
|---|---|---|---|
| Sonnet 5 | 97.0% | 91.5% | 95.7% |
| Haiku 4.5 (after prompt fix) | 99.6% | 98.8% | 99.0% |

**Haiku was sufficient — the earlier assumption that it wouldn't be was
wrong, and the difference was the prompt, not the model.** Haiku's first
eval showed a systematic failure: it rejected genuine clean-titled
instruments (MIJ vintage Juno-60, Custom Shop relics) purely for pricing
above `price_max_dkk`. Fix was making the price rule **asymmetric** —
a price far *below* range is strong accessory evidence; a price *above*
range is weak evidence only (KG ranges are stale/narrow, and rare, premium,
or bundled examples legitimately exceed them).

**Rule going forward:** before blaming a model, check whether the prompt
encodes a rule the model is following too literally. Always `--eval`
against labeled data before a live pass.

### Gotchas this script hit (relevant to any new script in this repo)

1. **PostgREST caps every request at 1000 rows.** Hit three separate times —
   on `listing_product_match`, on `kg_product` (standard tier is ~3,800
   products; the legendary/classic set was small enough to hide the bug),
   and in the eval fetch. **Any query that could exceed 1000 rows must
   paginate with `.range()`.**
2. **`.range()` pagination needs an explicit `.order()`.** Without stable
   ordering, rows shift between page fetches while other writes land, and
   chunks are silently dropped — this undercounted standard tier as 7,490
   instead of 25,162.
3. **A large `.in()` ID list blows the URL length limit** (`Bad Request`).
   Chunk to ~50 IDs, or filter in-memory instead. Same constraint the
   `/intel` dashboard already works around.
4. **Sonnet 5 runs adaptive thinking by default** — `response.content[0]` is
   a `thinking` block, not text. Find the block with `type === 'text'`
   rather than indexing. (Haiku 4.5 does not do this, which is why
   `classify-products.ts` gets away with `content[0]`.)
5. **Confidence is verdict-relative.** `confidence: 97` on
   `verdict: "invalid"` means 97% sure it's *invalid*. Reading confidence
   without verdict inverts every high-confidence rejection — this bug was
   caught only because `--eval` ran against ground truth first.
6. Batches fail intermittently on API load (529 / timeouts). The script
   skips and logs them; **re-run the same command to sweep stragglers.**

---

## Known issues

**`reverb_price_history` is query-keyed; `kg_product_id` FK partially
backfilled.** Migration 031 added a nullable `kg_product_id` FK. Migration
034 (authored 2026-04-27) backfills via normalised canonical_name match
between `rph.query` and `kg_product.canonical_name` — expected to map
~37% of the current 927 rows. The remaining ~63% are legacy design-furniture
queries (deprioritised vertical), generic terms, or queries for products
not yet in the KG. The deterministic path for the long tail is migration
035 (planned): `listing_url → Reverb listing → csp_id → kg_product`.

**`reverb_price_history` is now ~98% garbage.** The runaway
`process-price-queue` loop (see Reliability fixes 2026-08-05) inflated it
from ~927 rows to **98,971**, of which **97,420 are duplicate rows for a
single query** (`moog-minimoog-voyager`, 77 listings × ~1,265 copies each).
The generating bug is fixed, but **the garbage rows were never cleaned up.**
The `(listing_url, watchlist_id)` unique index does not prevent this because
`watchlist_id` is NULL on 98.8% of rows and Postgres treats NULLs as
distinct. Dedupe + `NULLS NOT DISTINCT` (or drop `watchlist_id` from the
key) before trusting anything in this table.

### Unique constraints defeated by NULLs (2026-08-05 audit)

**No index in the database sets `NULLS NOT DISTINCT`.** Where a nullable
column sits in a unique key, the constraint silently does nothing for rows
where that column is NULL:

| Table / index | Nullable col | Impact |
|---|---|---|
| `reverb_price_history (listing_url, watchlist_id)` | `watchlist_id` (98.8% NULL) | **97,381 dupes** — see above |
| `listings (external_id, source)` | `external_id` | Fixed 2026-08-05 (backfilled, 141 dupes removed) |
| `auctionet_price_history (listing_url, watchlist_id)` | both | Latent — table is empty |
| `synonym (alias, product_id)` | `product_id` | Latent — 0 NULLs today |
| `kg_product_suggestions (canonical_name, brand_id)` | `brand_id` | Latent — 0 NULLs today |

`kg_category (reverb_uuid)` and `listings (url, watchlist_id)` are written
correctly as partial indexes — use those as the pattern.

### Price history polluted by parts/accessories matches — partially fixed

**Reverb price history:** `/api/product/[slug]` (line 71-77) now uses
`.eq('kg_product_id', product.id)` FK join instead of `ilike` on canonical_name.
Parts pollution eliminated for Reverb sold-price history. Applied 2026-04-30
after migration 034 backfilled the FK.

**Auctionet price history:** `/api/product/[slug]` (line 78-86) still uses `ilike`
on canonical_name. `auctionet_price_history` has no `kg_product_id` column yet.
Deferred to a separate migration when auctionet data quality justifies the work.

**Other legacy consumers:** `/api/market-price/route.ts` and `/api/price-history/route.ts`
still use `ilike` on reverb_price_history with free-text ?query= input. These need
a query → kg_product resolution layer before migrating. Phase 1 item.

Note: Thomann is intentionally a separate data series — new/retail price reference,
not secondhand. The Thomann link as fallback when price history is thin is correct
behaviour. Do not conflate the two series.

**Future:** apply a minimum price floor per root subcategory when querying price
history (e.g. bass-guitars floor at 2000 DKK). Floor values should live in
kg_category as a nullable `price_floor_dkk` column.

**Price history is not yet rendered on product pages.** Data lives in
`reverb_price_history` but `/product/[slug]` only reads from
`listing_product_match`. Adding a price-history chart is an open UI task.

**Fender Telecaster/Stratocaster thomann_url points at premium-tier SKUs**
— American Professional II Telecaster 75th Anniv (21.890 kr) and American
Ultra II Stratocaster HSS (17.666 kr). The more neutral "entry-level
flagship" would be Player II, but those SKUs are not yet on Thomann DK.
Revisit when Player II arrives in the DK catalogue.

---

### match-listings: ✅ LØST (2026-04-24)

Fix 1: upsert med ignoreDuplicates — constraint-fejl skippede hele batches
Fix 2: range() pagination — PostgREST max-rows = 1000 kan ikke overrides med .limit()
Match-rate: 40% (145/359 per kørsel)
PM2: kører hvert 30. min, listing_product_match vokser gradvist

Synonym-tabel: 1.266 aliases, 1.128 er > 30 tegn (ubrugelige).
Ryddes over tid — ikke akut.

---

## Payment integration — planlagt (ikke bygget)

**Strategisk spor**, ikke umiddelbar implementering. Betalinger bliver
relevante når Klup går fra "deal-intelligens" til "deal-facilitering"
(escrow for køber/sælger, premium-features, eller marketplace-fee på
formidlede handler).

**Nordic mobile-first er ikke til forhandling.** I Norden er card-only
checkout en konversionsdræber:
- **Danmark**: MobilePay (~95% smartphone-penetration, Danske Bank-ejet)
- **Norge**: Vipps
- **Sverige**: Swish
- **Finland**: MobilePay (samme app som DK)

**Mulige veje:**
1. **Stripe** — bredeste integration, dækker MobilePay via "MobilePay" som
   Payment Method (live i Stripe siden 2024). Sweetspot for hurtig
   one-stop-shop. Vipps + Swish har separat integration.
2. **Adyen** — bedre native Nordic-coverage, men dyrere og mere
   enterprise-orienteret.
3. **Direkte MobilePay Online API** + Stripe for cards — to-vejs setup,
   mere arbejde, men giver kontrol over MobilePay-flowet (fx subscription).

**Beslutning udskudt** indtil:
- Vi har valideret hvilken transaktions-model der er rigtig (escrow vs.
  fee vs. premium subscription)
- Bruger-volumen er der til at retfærdiggøre integration-arbejdet
- Compliance-risiko er kortlagt (KYC for escrow, moms på fees)

**Bias mod for tidlig implementering:** intet payment-flow før der er
verified user demand for det specifikke transaktions-mønster. Klup's
core-værdi er still "er denne pris god?" — payment bygges oven på,
ikke ind i, kerneproduktet.

---

## Community features — planlagt (ikke bygget)

**Filosofi:** Co-creation er i fundamentet af Klup. Brugerne
definerer hvad der er vigtigt — ikke redaktionen.

**Product pages (wiki-agtig model):**
- Nominer notable artists/spillere per produkt
- Reddit-style upvote på artist-nominations
- Foreslå ændringer til specs/description (pending admin review)
- Produktsider er tilgængelige uden login

**Platform-ønsker:**
- Brugere kan stemme på hvilke platforme vi skal understøtte
- Bug reports + feature requests med upvote
- Ønsk ny product page (demand-driven KG-vækst)

**Teknisk implikation:**
- Kræver: votes-tabel, suggestions-tabel, public read på product pages
- RLS: public read, authenticated write, admin approve
- Ingen builds før core matching + product pages er stabile

**Prioritet:** efter match-listings er verified + produktsider
er testet af rigtige brugere.

---

## What Claude Code should do at session start

1. Read this file
2. Run `hostname` — confirm which machine this session is running on
   (MacBook vs. `panter` / Mac Mini). Sessions run natively on both; don't
   assume you're on the MacBook and need SSH to reach PM2/scraper state.
3. Check current PM2 status: `pm2 list` (run directly if on the Mac Mini;
   Tailscale SSH only if this session is elsewhere and needs to reach it)
4. Check latest Vercel deployment status
5. Ask one clarifying question if the task is ambiguous
6. Show what you plan to do before doing it — especially for database changes

---

## Scraping lessons — do not repeat in new verticals

These mistakes were made in the music vertical and cost significant cleanup time.

**1. Never build the KG from listing titles.**
Reverb listing titles like "Fender 1958 Precision Bass Old Blue Refin" became
`kg_product` rows. They are not products — they are listing descriptions. Every
row in `kg_product` must have a source that is a canonical product reference
(manufacturer page, Reverb CSP, Thomann product page), not a listing title.
Enforcement: the demand-driven creation path (user search → Haiku resolves
clean brand+model → CSP confirmed) is the only automated path. Bulk import
from listing data is permanently prohibited.

**2. Wildcard scraping a general marketplace produces garbage.**
DBA.dk wildcard search hit bot detection immediately and returned
inconsistent results before it did. Finn.no and Blocket return free-text
titles that don't match `model_name` tokens reliably. Structured sources
(Reverb API with `make`/`model` fields, Thomann sitemap with SKUs) produce
10x better match rates with no extra work.
Rule: every new scraper must map to a structured field (SKU, model number,
or manufacturer slug) — not rely on fuzzy title matching.

**3. PM2 restart on crash + no rate limiting = database destruction.**
The match-listings loop crashed on timeout, PM2 restarted immediately,
and the job generated 44,000+ Supabase requests/hour and 17M garbage rows
in `listing_product_match` before it was caught.
Rule: every PM2 job must have `max_restarts: 3` and `min_uptime: 30000`.
Every scraper must have minimum 2s delay between requests plus jitter.
Crash logs must be checked after every deploy that touches a PM2 job.

**4. Subcategory classification on dirty data propagates errors.**
The AI classifier correctly classified listing-title rows — but into the
wrong categories, because "Fender 1958 Precision Bass Old Blue Refin" reads
as a specific vintage variant, not a Precision Bass. Clean the KG before
running classification, not after.
Rule: run `SELECT COUNT(*) FROM kg_product WHERE canonical_name ~ '\d{4}'`
before any bulk classification run. If > 0, clean first.

**5. Currency and pricing: always store raw + currency, convert at render.**
Early listings stored pre-converted DKK with a hardcoded 7.5 USD/DKK rate.
When the rate moved, prices were silently wrong.
Rule: always store `price` + `currency` from the source. Convert to DKK at
read time via Frankfurter API with hardcoded fallback.

---

## Vertical expansion — principles and gates

Klup is vertical-first by design. Music gear is the only active vertical.

**Do not speculate about future verticals in this file.** PostHog unmatched
search data will surface real demand when it exists. A vertical is not
planned until that signal is clear.

### Rules for any future vertical (learned from music gear)

**1. Find a structured primary source first.**
Every vertical needs one dominant source with structured product data —
SKUs, model numbers, manufacturer slugs. Without this, scrapers produce
listing-title pollution in the KG (see Scraping lessons).
Finn.no, Blocket, and DBA are open marketplaces with free-text titles.
They are listing sources, not KG sources. They can supplement a vertical
but cannot anchor one.

**2. Seed the KG before scraping.**
50–100 canonical products with clean `brand + model` names must exist
before any scraper runs. The scraper maps TO the KG. It does not build it.

**3. Validate demand before building.**
≥ 10 PostHog unmatched search sessions for a category = a signal worth
investigating. Not a green light to build — a reason to research the
primary source and assess scrapability.

**4. One vertical at a time.**
The music vertical is not fully clean yet (see Known Issues: canonical_name
hygiene). Do not start a second vertical until the first is stable.

---

## Technical Debt

### Product families and variant modeling (deferred)

Three taxonomy patterns the KG doesn't model cleanly yet:

**1. Product families** — Telecaster, Stratocaster, Les Paul are family names
that span hundreds of variants. A `kg_product_family` grouping would improve
browse and disambiguation. Not worth building until the KG is clean and
families can be curated from real demand data (which variants users actually
search for).

**2. Cross-manufacturer clones** — Les Paul-style guitars (Epiphone, Burny),
Minimoog-style synths (Behringer Model D). The `kg_relation` table already
has `type = 'clone'` and `'alternative'`. Needs populating for the most
common cases, especially where clone pricing affects the parent product's
market value.

**3. Generation and size variants** — FLkey 25/37/49-key, MkI/MkII/MkIII.
Size variants are arguably one product with a `variants` attribute.
Generational variants are `type = 'successor'` in `kg_relation`.
Cleanup queue should merge listing-title variants into the correct
generational product, not into an arbitrary sibling.

Rule for cleanup queue: when a dirty row is clearly a variant (size, year,
condition) of a clean parent — merge. When it is a genuinely distinct
generation (MkII vs MkIII have different specs) — check if both exist as
clean rows before merging.

---

### kg_product.category_id (legacy)

The original `category_id` column on `kg_product` (pointing to the 4 coarse
seed categories) is superseded by `subcategory_id`. It is retained for
referential safety during the category migration. Remove it — along with the
corresponding column on `kg_brand` — once:

1. `subcategory_id` coverage reaches ~95% of active products
2. Browse pages are live and verified
3. No frontend code references `category_id` directly

Run a cleanup migration at that point.

---

## Known Issues

### kg_product canonical_name hygiene
Many `kg_product` rows have `canonical_name` (and slug) derived from full
Reverb listing titles, not the curated `brand + model` form CLAUDE.md
specifies. Examples seen 2026-04-27:
- `akai-akai-mpk-mini-mk-iii-clavier-matre-25-touches` (duplicated brand,
  French qualifiers)
- `fender-1958-fender-precision-bass-old-blue-refin` (year, condition notes)
- `fender-basso-elettrico-fender-american-vintage-ii-1960-precision-bass-...`
  (Italian qualifier, duplicated brand)

**Impact:** Reverb CSP enrichment hit-rate is bimodal by brand:
- Roland: ~80% high-confidence (clean canonical_names)
- Fender: ~10% (mostly listing-title noise)

**The architecturally correct fix is demand-driven, not bulk:** when a user
searches for a product, Haiku resolves a clean `brand + model` and creates a
kg_product with CSP already attached. Bulk backfilling is a one-time retrofit
only — `confidence: 'none'` is written to rows that can't resolve, marking
them so they aren't re-queried. Migration 032 only promotes high+medium
into the typed `reverb_csp_id` column, so dirty rows don't pollute the anchor.

**Cleanup workstream (deferred):** a Haiku pass that takes a bloated slug
plus linked listing data and emits a clean canonical_name. Then re-run
enrichment with `--force` on those rows. Worth doing only after demand-driven
curation has had time to surface which products users actually care about.

### Product pages show Reverb listings only (cornercase)
`/product/[slug]` renders matched listings — but in practice only Reverb
listings appear. DBA/Finn/Blocket are absent even when the same search
query surfaces them. Likely root causes (unverified):
- `match-listings` only succeeds on Reverb's structured `make`/`model`
  fields; Schibsted free-text titles don't pass the matching threshold
- The product API filters by source somewhere downstream
- Schibsted scrapers run less frequently so the listings table is sparser

**Investigate before assuming a fix** — chasing "all platforms on product
pages" as a feature is a rabbit hole if the right answer is to fix matching
for the Nordic local markets first (DBA = highest KUP value, since that's
where local-market price gaps live).

### Category cards — 9 still need editorial images (2026-04-30)
`kg_category.image_url` is now populated for 4 root categories via
`set-category-images.ts` (electric-guitars, acoustic-guitars, bass-guitars,
pro-audio). The remaining 9 have no qualifying product image (best auto
score=1 = Reverb CDN thumbnail, below MIN_AUTO_SCORE threshold):

**Need editorial Unsplash/Pexels URLs added to EDITORIAL_OVERRIDES in
`scripts/set-category-images.ts`, then re-run the script:**
- `music-gear` — ✅ DONE 2026-04-30: wired to existing onboarding Storage image
  (`categories/music-gear.webp`). keyboards-and-synths now inherits this.
- `amps`
- `dj-and-lighting-gear`
- `drums-and-percussion`
- `effects-and-pedals`
- `home-audio`
- `band-and-orchestra`
- `accessories`
- `parts`
- `folk-instruments`

How to add: find an Unsplash/Pexels URL for each category, add to the
`EDITORIAL_OVERRIDES` dict in `set-category-images.ts`, then run
`npx tsx scripts/set-category-images.ts` (no `--dry-run`).

### Product cards have no images (partially resolved 2026-04-29)
`kg_product.image_url` is populated for:
- Thomann-sourced products (via `fetch-thomann-prices`)
- 710 products with high/medium Reverb CSP confidence (via `promote-csp-images.ts`)
- 6 products with editorial Unsplash/Pexels hero images (via `set-hero-images.ts`)

Remaining gap: ~2,400 products with dirty canonical_names that didn't get a
CSP match. These will be filled organically as demand-driven KG curation
improves canonical_name quality. `ProductCard` should gracefully degrade to
a subcategory-level fallback image or placeholder.

### Products missing descriptions and specs
kg_product has no description or specs fields. Needed for product detail
pages. Only worth rendering for higher-value / well-known products to avoid
noise. Planned: add description (text) and specs (jsonb) columns to
kg_product, populate via AI enrichment script for products with
active_listing_count > 3 or price_min_dkk > 2000.

### Short model_name false matches
Products with short or generic model names (e.g. "Tom", "Solo") produce
false positive matches because the token appears in unrelated listing text.
Fix: require brand name co-occurrence in listing title when model_name is
< 5 characters. Or set model_name = NULL for ambiguous products and rely
on synonym matching only.

### Product page caching (possible)
Juno-60 product page may serve stale data after listings were added.
Investigate whether /api/product/[slug] has a revalidate or cache header
that needs to be shortened or removed.

### Platform filter badges (planned)
Listings on product pages should be filterable by source (reverb, finn,
blocket, dba). DBA/Finn/Blocket signal Nordic local market; Reverb is
international. Users want to see their local market first.

### Resend has stopped sending notifications (2026-04-27) — backlog
Email notifications are silently failing. Auth webhook + watchlist alerts
do not deliver. **Deprioritized** — not a limiting factor pre-launch
(no real users yet). Revisit before the marketing push, after vanity
issues (product pages, stock imagery) are sorted. When investigating:
check Resend dashboard for bounces / API key status, verify
`RESEND_API_KEY` env on Vercel, confirm `RESEND_FROM_EMAIL` domain is
still verified (DNS at Simply.com — never touch Protonmail MX).
Lazy-init pattern in `lib/email.ts` may be hiding errors silently.

### Browse anchor is slug, not Reverb UUID
`kg_product.reverb_root_slug` / `reverb_sub_slug` and `kg_category.slug`
are text. Migration 033 added `kg_category.reverb_uuid` as the durable
join key; backfill via `npm run backfill-category-uuids`. Frontend code
still reads slugs — migrate to UUIDs in the same area where touched next.

---

## KG quality snapshot (2026-04-30)

**Current state:**
- ~3,840 total `kg_product` rows
- ~1,114 (29%) have `reverb_csp_id` verified (migration 032 promoted high+medium
  confidence from enrichment run 2026-04-27)
- ~193 `reverb_price_history` rows now FK-mapped to kg_product via migration 034
  backfill
- 636 total `reverb_price_history` rows: breakdown = 193 mapped (30%) + ~175
  furniture/auctionet (permanent orphans) + ~104 noise (unresolvable) + ~164
  music gear with KG gaps or naming mismatches (Phase 1)

**Known dirty patterns in the KG:**
- Listing-title slugs: `fender-1958-fender-precision-bass-old-blue-refin` — Reverb
  listing imports, not canonical products. `cleanup_status` column exists for
  tracking.
- Parenthetical suffixes break the migration 034 normalizer: "Roland TR-808
  (Rhythm Composer)" won't match query "roland-tr-808". Direct SQL mapping required.
- Brand prefix mismatches: query "minimoog" vs canonical "Moog Minimoog". Same fix.

**Products verified clean and fully enriched** (CSP + price history mapped):
- Roland TR-808 (`roland-tr-808`) — 20 price points
- Roland RE-201 (`roland-re-201`) — note: 15 listing-title duplicates exist in
  KG; canonical entry is UUID 07cc1ac5, 20 price points
- Moog Minimoog (`moog-minimoog`) — note: 15 listing-title duplicates exist; canonical
  entry is UUID a03a8e67, 63 price points
- Strymon TimeLine (`strymon-timeline`) — new entry, CSP enrichment run 2026-04-30,
  90 price points

---

## Open workstream — where the next session picks up (2026-08-06)

Ordered by what the founder prioritised: **founder sourcing / arbitrage
first, and the KG must be clean for that data to have a home.**

1. **Finish AI validation pass 2** — Sonnet second opinion on Pass-1
   uncertains was mid-run at session end. Re-run to completion:
   `npx tsx scripts/ai-validate-matches.ts --pass2 --tier=legendary,classic,standard`
   (idempotent; re-run again to sweep any timeout stragglers).
2. **Wire scrapers into `market_price_observations`** — the table exists,
   nothing populates it. Each scraper should append a `price_type='asking'`
   observation alongside its existing `listings` upsert; Thomann →
   `'retail'`; Reverb sold → `'sold'`.
3. **Clean product pages + images** (the founder's stated goal for a clean
   KG): link Reverb/other images to products, promote products to
   `browse_visibility='public'`.
4. **KG expansion — classic/iconic gear not yet in the KG.** Named gaps:
   Yamaha YTR-8535 and Bach ML 25 trumpets, Martin Committee, SSL consoles,
   Kush Audio / Distressor outboard. Sources the founder named:
   **gearspace.com**, **vintagesynth.com** (primary source for synth model
   data — note `scripts/scrape-vintagesynth.ts` + `expand-synonyms-vse.ts`
   already exist from an earlier effort), Reverb featured/editorial gear,
   and UAD's plugin catalogue (UAD emulates classic outboard — an article
   about a preamp is a strong classic/legendary signal).
   **Also found: Neumann U 87 Ai is `tier='standard'`** with ~12 duplicate
   listing-title rows — a clear mistiering worth fixing when this starts.
5. **Source expansion for arbitrage**, DE-first (founder can drive to
   collect): Musik-Produktiv B-stock (SKU-based, low risk), eBay Browse API
   (structured aspects; note eBay *sold* comps need the restricted
   Marketplace Insights partner API, so eBay is an **asking**-price source
   only), then Egun.de (free-text — needs the AI validation pipeline).
   **Craigslist is a separate decision** — no API, ToS prohibits scraping,
   and Craigslist has litigated this (3taps); the founder wants it for the
   US market (Chicago/NY/LA/Nashville/Detroit) and should accept that risk
   explicitly before engineering time goes in.
6. **Vertical signal** — the founder reads sparse user data as wanting
   non-music verticals. Pull real PostHog unmatched-search data before
   building anything (this is the long-documented Phase 1 prerequisite that
   has still never actually been run).

**Smaller open items:** drop `listing_price_history` (dead stub) pending
confirmation · dedupe `reverb_price_history` (97k garbage rows) · fix the
defeated NULL unique constraints · `ecosystem.config.js` `max_restarts`/
`min_uptime` don't match the documented rule.

---

## Phase 1 — next (not started)

**Prerequisite:** Pull PostHog top 20 searches. Cross-reference against kg_product for:
(a) searches with no matching product, (b) products with `reverb_csp_id IS NULL`.
That list is the Phase 1 work queue.

**Build target:** `/product/[slug]` product detail page as the first surface where
"is this a good price?" works end-to-end.
- FK join is clean (migration 034 + Phase 0.2)
- Price history populated for verified top products
- IQR filter in `/api/product/[slug]` is correct (existing implementation)
- Leverage price_history chart (data exists; UI task)

**Deferred until Phase 1 complete:**
- `/api/market-price` and `/api/price-history` ilike → FK migration (needs
  query → kg_product resolution layer)
- Re-enable PM2 scrapers (confirm `ecosystem.config.js` has `max_restarts: 3`,
  `min_uptime: 30000` before turning on)
- Re-enable price-observations as batch job (not real-time)
- Facebook Marketplace / Apify — do not touch until alternative approach identified

**Browse visibility entry point:**
Browse visibility architecture is in place (migration 036 + `lib/browse.ts`).
Phase 1 KG work (canonical name cleanup, CSP enrichment, subcategory
coverage) directly feeds `browse_visibility` promotion. A product becomes
promotable to public once:
1. `canonical_name` is clean (`brand + model`, no listing-title noise)
2. `reverb_csp_id` is set (CSP enriched via `enrich-from-reverb-csp.ts`)
3. `subcategory_id` is correct (classified by `classify-products.ts`)
4. Admin sets `browse_visibility='public'` in `/admin/products` or via SQL

---

## Architecture decisions (validated 2026-04-30)

A full senior engineering and product audit was conducted on 2026-04-30 covering
migrations 001-035, all API routes (`/api/scrape`, `/api/product/[slug]`,
`/api/browse/*`, `/api/discover`, etc.), frontend components, and infrastructure
config. The audit identified KG hygiene as the primary limiting factor and three
security/reliability issues (now fixed in Phase 0). Audit findings are the basis
for the Phase 0/1/2 roadmap in this document.

**Key architectural decisions validated:**
- **CSP as the durable anchor**: `kg_product.reverb_csp_id` is the join key for
  price history and avoids parts pollution. Query-keyed legacy rows are a retrofit;
  new rows are created with clean canonical_name + CSP already attached.
- **Demand-driven scraping queue**: Scrapers run on search terms derived from KG
  products users actually follow, not pre-emptively. Reduces waste and focuses
  infrastructure budget on user-requested data.
- **Partial unique indexes**: `listing_product_match (listing_id, product_id)` +
  `(listing_id)` enables efficient deduplication and bulk matching. Cap-and-exit
  pattern in match-listings prevents runaway loops (40% match rate verified).
- **IQR-filtered price ranges**: Outlier-resistant (Q1 - 1.5×IQR, Q3 + 1.5×IQR).
  Correctly handles long-tail distributions in secondhand pricing.
- **Demand-driven KG growth**: User search → Haiku resolves clean brand+model →
  CSP confirmed → create kg_product. Prevents listing-title pollution at source.

---

*Last updated: 2026-08-06 (late) — coverage_v2 (migrations 042–048): fail-closed staging→evaluate→promote, atomic `promote_scrape_run()` with staging-digest + concurrency guards, per-query pagination coverage with documented exhaustion, normalized `listing_coverage_scopes` provenance, scope-specific bootstrap (unscoped variant retired). DBA candidate bootstrap `43f27632…` REJECTED and preserved. Product universe corrected to 30 (not 48). `zero_results` and the DBA data endpoint investigated and closed as not viable. **NEXT: scope-aware baseline (`baseline_unavailable`) — see the KNOWN DEFECT note in the quality-gate section.** Lifecycle hard-disabled on all sources.*

*Earlier 2026-08-06 — Reliability fixes (frontend deps on panter, scrape-reverb stale-marking index, price_fetch_queue constraint + silent-error bugs, listings.external_id backfill, price_snapshots_old dropped), migration 039/039b `market_price_observations` unified price ledger, `scripts/ai-validate-matches.ts` two-tier AI match validation (~9,200 bad matches rejected across 30k rows; Haiku 99.6%/98.8% precision/recall after prompt fix), PM2 status table corrected, Claude-runs-natively infra update*

*Previous: 2026-05-05 — Admin product curation page (`/admin/product/[slug]` + 5 API routes), migration 038 match-quality flags (`is_valid`, `rejected_reason`), model_name backfill recovers match-rate from 0% to ~7%, intel dashboard 3-panel multi-market shell, schibsted price_dkk + reverb country backfills*
