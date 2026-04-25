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

**Current state:** ~3,298 music-gear products.

**canonical_name rule:** Always `brand + model`. Never strip brand. "Roland Juno-106" not "Juno-106".

**Priority products to build product pages for first:**
- Fender Telecaster, Telecaster Custom Shop, Fender Stratocaster, Fender Vintera II
- Gibson Les Paul, Gibson ES-335
- Roland Juno-60, Roland Juno-106, Roland Jupiter-8
- Moog Minimoog, Moog Subsequent 37

**Image strategy:**
- Thomann → new/current production gear (best product images)
- Reverb → vintage/discontinued gear

**Reverb CSP integration (planned — Fase 3):**
- Planned column: `kg_product.reverb_csp_id int` — deterministic anchor to Reverb's
  Comparison Shopping Page (the canonical product record across all listings).
- Known CSP ids already resolved:
  - Roland Juno-60 → `1677`
  - Roland Juno-106 → `2444`
  - Roland Jupiter-8 → `27660`
- Planned script: `scripts/enrich-from-reverb-csp.ts` — given a search term,
  looks up CSP, populates kg_product (image, csp_id, used_low_price). Called
  from the matching pipeline when no kg_product match is found, so KG growth
  is demand-driven — no KG rows without user intent.

**What the KG is NOT:**
- Design furniture (design-objects category) — do not import or build
- Cykler, tech, biler — not our vertical

**Admin tools for KG curation:**
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
| `saved_listings` | User-saved listings (RLS-protected) |
| `watchlists` | User watchlists — tied to a product or query |
| `listing_product_match` | Maps listings → KG products |
| `reverb_price_history` | Reverb sold prices per product |
| `auctionet_price_history` | Auctionet hammer prices |
| `kg_suggestions` | Pending AI-generated KG product proposals |

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

**Never:**
- Run scrapers without rate limiting (min 2s between requests + jitter)
- Let PM2 restart a crashing job immediately — add crash-and-don't-restart logic on timeout-prone jobs
- Deploy on Friday
- Hardcode secrets or API keys
- Log PII
- Ask for secrets in chat — route via Vercel dashboard / password manager

---

## Known issues

**`reverb_price_history` is query-keyed, not product-keyed.** Rows store
`query` (free text from the owning watchlist) + `listing_url`, not a
`kg_product_id`. Two different queries for the same model ("Roland Juno 60"
and "Roland Juno-60") each accumulate history independently. Fase 3's
`reverb_csp_id` anchoring is the fix.

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

---

## Technical Debt

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

### No listings on matched products (e.g. Juno-60)
`/product/[slug]` pages show zero listings despite the search API returning
results for the same query. Root cause unknown — likely a mismatch between
how `listing_product_match` is queried on the product page vs. how the
scrape/search pipeline populates it. Investigate before building more
product page features.

### Category cards missing Unsplash images
`/browse` category cards rely on images in Supabase Storage at
`onboarding-assets/categories/[slug].webp`. Most are missing — only the
original onboarding categories have images. The 14 Reverb root category
slugs need corresponding `.webp` files uploaded. Slugs that need images:
electric-guitars, acoustic-guitars, bass-guitars, amps, effects-and-pedals,
keyboards-and-synths, drums-and-percussion, pro-audio, accessories,
folk-instruments, band-and-orchestra, home-audio, dj-and-lighting-gear, parts

### Product cards have no images
`ProductCard` renders text-only. kg_product has no image field.
Planned solution: store a representative Unsplash image URL per product
(or per subcategory as fallback) in kg_product.image_url (nullable text).
Populate manually or via script for high-value products first.

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

---

*Last updated: 2026-04-25*
