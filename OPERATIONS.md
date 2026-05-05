# Klup.dk — Operations Manual
## Data Curation & Product Management

*This is your playbook. Read it before curating products or adding new ones.*

---

## The Mental Model

Every piece of data in Klup flows through one pipeline:

```
Source listing → listings table → match-listings → listing_product_match → product page / intel
```

You control two things:

1. **What gets scraped** — which products the scrapers search for
2. **What gets matched** — which listings are linked to which products

Everything else is automated. Your job is to curate the edges where automation fails.

---

## Part 1 — Adding a New Product

### When to add a product

Add a product when:
- You know there is a real secondhand market for it in the Nordics or Germany
- You can name it precisely: Brand + Model (e.g. "Roland Juno-6", not "old Roland synth")
- It is not already in the KG (search `/admin/products` first)

Do not add:
- Listing-title variants ("Roland Juno-60 serviced black Japan")
- Accessories or parts
- Products you cannot name precisely

### How to add a product

1. Go to `klup.dk/admin/products`
2. Click **"+ Nyt produkt"** in the top right
3. Fill in the form:

**Brand** — search and select. If the brand doesn't exist, add it via Supabase directly for now.

**Canonical name** — always `Brand + Model`. Examples:
- ✅ Roland Juno-6
- ✅ Fender Telecaster
- ❌ Juno-6 (missing brand)
- ❌ Roland Juno-60 serviced (condition note)
- ❌ Fender American Professional Telecaster (too specific — that's a variant)

**Model name** — auto-derived from canonical name. Usually correct. Override if wrong.
This is the token the matcher uses. Keep it short and precise:
- "Juno-6" not "Roland Juno-6"
- "TR-808" not "Roland TR-808 Rhythm Composer"

**Slug** — auto-derived. Only override if the auto version is wrong.
Must be unique. If you get a 409 collision, the product already exists — go find it.

**Tier**:
- `legendary` — iconic, high-value, strong secondhand market. Juno-60, TR-808, Minimoog.
- `classic` — well-known, solid market. HS-60, Juno-6, DX7.
- `standard` — everything else.

**Year released** — the year the product was first manufactured. Not when your unit was made.

**Subcategory** — pick the most specific one that fits. This affects browse visibility.

4. Click **Create**. You land on `/admin/product/[slug]`.

---

## Part 2 — Populating a Product with Listings

A new product starts empty. Listings reach it through two paths:

### Path A — Automated (cron scrapers)

Every night at 01:00 the scrapers run:
- `scrape-kleinanzeigen` — searches Kleinanzeigen.de for `Brand + Model`
- `scrape-blocket` — searches Blocket.se
- `scrape-finn` — searches Finn.no

Every night at 02:00:
- `scrape-reverb` — searches Reverb for all KG products

Every hour at :30:
- `match-listings` — links unmatched listings to KG products via model_name token matching

**This means a new product gets its first listings within 24 hours automatically.**
You do not need to do anything. Come back tomorrow.

### Path B — On-demand (admin curation page)

When you want results immediately, or want to test a specific query:

1. Go to `/admin/product/[slug]`
2. Scroll to **"Søg på Kleinanzeigen nu"**
3. Type a search query (pre-filled with canonical name)
4. Click **Søg**
5. Review results — click **Gem listing** on relevant ones
6. Bad results: ignore them (don't save)

This triggers a live scrape and lets you hand-pick which listings to save.
Saved listings are immediately linked to the product with `is_valid=true` and `score=100`.

---

## Part 3 — Cleaning Matched Listings

This is the most important curation task. Bad matches pollute price medians and make the intel page useless.

### What is a bad match?

- **Parts and accessories** — button caps, sliders, battery holders, cables, cases, covers
- **Wrong product** — a Juno-6 matched to Juno-60, an HS-60 matched to Juno-106
- **Clones** — Roland JU-06A is not a Juno-60. Roland Boutique series are not originals.
- **Wanted ads** — "Suche Roland Juno-60" is a buyer looking, not a seller listing
- **Price errors** — 345.000€ listings are data entry errors on the platform

### How to clean

1. Go to `/admin/product/[slug]`
2. Scroll to **"Matchede listings"**
3. Listings are sorted by price ascending — bad matches often cluster at the bottom (parts) and top (price errors)
4. Click **Bad match** on anything that shouldn't be here
5. It disappears immediately from the page
6. The listing is flagged `is_valid=false` in the database and never resurfaces for this product

### What to keep vs reject

| Keep | Reject |
|---|---|
| The actual product | Parts, accessories, consumables |
| Original versions | Clones, boutique reissues, software versions |
| Seller listings | Wanted/sought ads |
| Reasonable prices | Obvious price entry errors (10x normal price) |
| Complete units | Broken/for-parts listings (judgment call) |

### Price sanity check

After cleaning, look at the price distribution in the listing table.
For a Juno-60, you expect 15.000–35.000 DKK range.
If you see 89 DKK — that's a button cap. Reject it.
If you see 345.000 DKK — that's a price error. Reject it.

---

## Part 4 — Adding Synonyms

Synonyms improve scraper coverage. When you add a synonym, the next scraper run will search for it too — finding listings that the canonical name query would miss.

### When to add a synonym

- The product has a common alternative name: "Space Echo" for Roland RE-201
- The product is searched differently in another language: "Rytmeboks" for drum machines
- The model number is commonly abbreviated: "108" for TR-808
- Sellers misspell it consistently: "Minimoog" vs "Mini Moog"

### How to add a synonym

1. Go to `/admin/product/[slug]`
2. Scroll to **"Søgeord / Synonymer"**
3. Fill in:
   - **Alias** — the search term to add
   - **Sprog** — the language it's used in (da/de/en/sv/no)
   - **Prioritet** — leave at 5 unless you have a reason to change
4. Click **Tilføj**

The synonym is immediately saved. It will be picked up on the next scraper run.

### Good synonyms for common products

| Product | Good synonyms |
|---|---|
| Roland RE-201 | "Space Echo", "tape echo", "båndekko" |
| Roland TR-808 | "808", "Rhythm Composer", "rytmeboks" |
| Roland TR-909 | "909" |
| Roland Juno-60 | "Juno 60", "juno60" |
| Moog Minimoog | "Mini Moog", "minimoog model d" |
| Fender Telecaster | "Tele", "telecaster" |

---

## Part 5 — The Intel Page

`klup.dk/intel` is your arbitrage dashboard. It shows median prices per market for all legendary products.

### Reading the table

Each row is a product. Columns are markets (DK, DE, SE, NO, US).
Each cell shows: `median price DKK / listing count`

**Delta columns** (Δ DK–DE, Δ DK–NO, Δ DK–SE):
- Positive (green) = DK median is higher than foreign market = buy opportunity
- Negative (red) = foreign market is more expensive than DK = sell there instead
- — = not enough data yet

### Why a product shows no data

- No listings matched yet (wait for next cron run, or use on-demand search)
- All listings were rejected as bad matches (check `/admin/product/[slug]`)
- The product has no `model_name` set (go to Supabase and add it)

### The arbitrage workflow

1. Open `/intel` — sort by Δ DK–DE descending
2. Find products with large positive delta
3. Click the product row — right panel shows active listings per market
4. Find the cheapest DE/NO/SE listing — click Link → to see it on the source platform
5. Assess: is the price real? Is the condition acceptable?
6. If yes: plan the route

---

## Part 6 — Daily/Weekly Workflow

### Every morning (2 min)

1. Check `/intel` — did overnight scrapers add new data?
2. Note any new products with strong deltas
3. If a product has bad median (obvious noise): go to `/admin/product/[slug]` and clean it

### Weekly curation session (30–60 min)

1. Pick 3–5 products to curate deeply
2. For each: go to `/admin/product/[slug]`
3. Clean bad matches
4. Run on-demand Kleinanzeigen search with 1–2 synonyms
5. Add synonyms that produced good results
6. Move to next product

### When adding a new product

1. Create at `/admin/product/new`
2. Wait 24 hours for scrapers to run
3. Come back, clean bad matches
4. Add synonyms if coverage is thin
5. Check `/intel` — does the product appear with data?

---

## Part 7 — Troubleshooting

**Product appears on intel page with wrong median**
→ Bad matches are polluting the median. Go to `/admin/product/[slug]` and reject the outliers.

**Product has 0 listings after 24 hours**
→ Check `model_name` is set on the product (Supabase: `SELECT model_name FROM kg_product WHERE slug = '...'`)
→ Check the scraper ran: `pm2 logs scrape-kleinanzeigen` on panter

**Kleinanzeigen on-demand search returns 0 results**
→ Try a shorter query — "Juno 60" instead of "Roland Juno-60"
→ Try a synonym

**match-listings shows 0 matched**
→ Check `model_name` is set on legendary products
→ Most unmatched listings are Reverb parts/accessories — this is expected

**Intel page shows — for all markets except DK**
→ Listings exist but aren't matched yet. Run on Mac Mini:
   `npx tsx scripts/match-listings.ts`

---

## Part 8 — What Not To Do

- **Never add a product from a listing title.** "Fender 1958 Precision Bass Old Blue Refin" is not a product.
- **Never save a wanted ad as a listing.** "Suche Roland Juno-60" is a buyer, not a seller.
- **Never save accessories.** Button caps, sliders, cases — these pollute price data.
- **Never add two products for the same thing.** Search before creating.
- **Never manually edit slugs after a product has listings.** The slug is the primary key for URLs and matching.

---

*Last updated: 2026-05-05*
