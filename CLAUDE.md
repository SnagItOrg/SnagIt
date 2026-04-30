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

## Infrastructure — two machines

**MacBook** (`dev` user)
- Claude Code sessions
- Manual script runs
- Primary development machine

**Mac Mini M4** (`panter` user — hostname: `panter`)
- PM2 scraper jobs
- Devon/OpenClaw agent (restricted branch access)
- Connected via Tailscale SSH from MacBook

**PM2 jobs (current status)**

| Job | Schedule | Status |
|---|---|---|
| `scrape-reverb` | Daily 02:00 | Running |
| `fetch-reverb-prices` | Daily 03:00 | Running |
| `fetch-thomann-prices` | Sunday 03:00 | Running |
| `process-price-queue` | Every 5 min | Running |
| `match-listings` | Every 30 min | Running — 40% match-rate |

---

## Data sources

| Source | Purpose | Status |
|---|---|---|
| DBA.dk | Danish used gear listings | Active (wildcard search parked — bot detection) |
| Reverb API | International used gear + sold price history | Active |
| Thomann | New price reference (nypris) via sitemap | Active — Cloudflare sometimes blocks from Vercel egress |
| Finn.no | Nordic used gear | Live (Schibsted scraper) |
| Blocket.se | Nordic used gear | Live (Schibsted scraper) |
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
- Migration 034 authored 2026-04-27 (not yet applied) — DML that backfills
  `reverb_price_history.kg_product_id` from query-text via normalised
  canonical_name match. Preview shows ~37% hit rate on current 927 rows.
- **Hit rate is bimodal by canonical_name quality** — see Known issues
  ("kg_product canonical_name hygiene"). Roland resolves ~80%, Fender ~10%
  on the same script. Bulk backfill is a retrofit; the architecturally
  intended path is demand-driven CSP attachment on user searches (new
  kg_product rows are created with a clean canonical_name + CSP already
  attached).
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

## Known issues

**`reverb_price_history` is query-keyed; `kg_product_id` FK partially
backfilled.** Migration 031 added a nullable `kg_product_id` FK. Migration
034 (authored 2026-04-27) backfills via normalised canonical_name match
between `rph.query` and `kg_product.canonical_name` — expected to map
~37% of the current 927 rows. The remaining ~63% are legacy design-furniture
queries (deprioritised vertical), generic terms, or queries for products
not yet in the KG. The deterministic path for the long tail is migration
035 (planned): `listing_url → Reverb listing → csp_id → kg_product`.

### Price history polluted by parts/accessories matches
`/api/product/[slug]` queries `reverb_price_history` and `auctionet_price_history`
using `ilike` on `canonical_name`. For products like "Fender Jazz Bass" this
matches sold parts (necks, pickguards, pickups) alongside complete instruments,
pulling the secondhand price range artificially low.

Note: Thomann is intentionally a separate data series — new/retail price reference,
not secondhand. The Thomann link as fallback when price history is thin is correct
behaviour. Do not conflate the two series.

Fix for parts pollution: apply a minimum price floor per root subcategory when
querying price history (e.g. bass-guitars floor at 2000 DKK). Floor values should
live in kg_category as a nullable `price_floor_dkk` column.

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
2. Check current PM2 status on Mac Mini: `pm2 list`
3. Check latest Vercel deployment status
4. Ask one clarifying question if the task is ambiguous
5. Show what you plan to do before doing it — especially for database changes

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

*Last updated: 2026-04-30 — browse API: music-gear excluded, keyboards-and-synths inherits image; set-category-images.ts live (4 categories + music-gear populated); ~1,246 products in Storage (prior panter bulk run confirmed); Roland RE-201 set to legendary; image strategy: one image per product (hero_image_url ?? image_url)*
