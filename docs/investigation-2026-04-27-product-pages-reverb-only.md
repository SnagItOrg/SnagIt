# Investigation: why product pages show Reverb listings only

**Date:** 2026-04-27
**Mode:** Read-only diagnostics. No code committed.
**Trigger:** Manager observed `/product/[slug]` pages render almost exclusively
Reverb listings even when the search index has DBA / Finn / Blocket results
for the same query.

## TL;DR

Three contributing causes. Two are bugs; one is a ranking choice.

1. **🐛 DBA listings are silently excluded from matching.**
   `scripts/match-listings.ts:86` filters `source IN ('reverb','finn','blocket','dba')`,
   but the DBA scraper writes `source='dba.dk'`. Since the filter was introduced,
   no DBA listing has been considered for matching. Only ~10 historical DBA
   matches exist (pre-filter); current 29 DBA listings/week are silently dropped.

2. **🐛 Reverb parts/accessories pollute the match set.**
   The matcher uses `containsToken("Juno-60")` on listing titles. Reverb listings
   like "Slider Cap Roland Juno-6, **Juno-60**, Jupiter 8" match — they're
   parts-category listings tagged across many products. They take precedence in
   ranking because there are many of them and they often have prices.

3. **⚠️ Sort order favours expensive listings.**
   `/api/product/[slug]/route.ts:94-97` sorts by `score DESC, price DESC`.
   Every MODEL match gets score=70, so the tie-break is price-descending. Reverb
   listings (USD-converted, often international) tend to be priced higher than
   Nordic locals → Reverb dominates the top-20.

## Evidence — Roland Juno-60 (kg_product id `3ecf2933…`)

### Match counts in `listing_product_match`

```
source   active  inactive
reverb   58      39
finn      2       0
blocket   1       0
dba.dk    0       0          ← suspicious: 7 dba.dk Juno-60 listings exist
```

### Listings actually present in `listings` table (last 7 days)

```
source     count
reverb     903
finn        56
dba.dk      29
blocket     12
```

DBA listings exist (29 in last week). 7 of them mention Juno-60 directly. None
ever made it into `listing_product_match`.

### Confirming the source-string bug

```sql
-- match-listings.ts line 86:
.in('source', ['reverb', 'finn', 'blocket', 'dba'])

-- but DBA-scraperen i lib/scrapers/schibsted.ts:
DBA_CONFIG: { source: 'dba.dk', ... }
```

The filter never matches `dba.dk`, so DBA listings never enter the matcher.
Total `dba.dk` rows in `listing_product_match`: **10** (all from before the
filter was added — verified via `Range`-counted query).

### Top-20 ranking demo

For Juno-60, the route returns top-20 by `score DESC, price DESC` of active
matches. Distribution:

```
{"reverb":18,"finn":1,"blocket":1}
```

The 1 Finn listing that gets in is the 45.000 kr synth, not the 500 kr manual.
DBA gets 0 because of bug #1.

## Manager's three hypotheses, scored

| | Hypothesis | Verdict |
|---|---|---|
| (a) | match-listings matcher kun på Reverb's strukturerede make/model | **Wrong.** Matcher is title-regex, source-agnostic. |
| (b) | `/api/product/[slug]` filtrerer source downstream | **Wrong.** Route doesn't filter by source. |
| (c) | Schibsted listings sjældnere i listings-tabellen | **Partly right.** Reverb has ~10× more listings, but the dominant cause is bug #1 + ranking. |

There's a fourth, hidden cause the hypotheses didn't list — the silent
DBA-string mismatch. That's the leverage point.

## Recommended fixes (deferred — not committed)

### Fix 1 (1-line, high leverage): match DBA listings

```diff
- .in('source', ['reverb', 'finn', 'blocket', 'dba'])
+ .in('source', ['reverb', 'finn', 'blocket', 'dba.dk'])
```

Then run `npm run match-listings -- --backfill` to retro-match the historical
DBA listings that have been ignored. Estimated ~600–1000 listings to backfill.

### Fix 2 (small): rank Nordic locals first on product pages

Change route sort from `score DESC, price DESC` to:

```ts
.sort((a, b) => {
  if (b.score !== a.score) return b.score - a.score
  // Nordic locals first — local market is the KUP play
  const sourceRank: Record<string, number> = { 'dba.dk': 0, 'finn': 1, 'blocket': 2, 'reverb': 3 }
  const ar = sourceRank[a.listing?.source as string] ?? 99
  const br = sourceRank[b.listing?.source as string] ?? 99
  if (ar !== br) return ar - br
  return ((a.listing?.price as number) ?? 0) - ((b.listing?.price as number) ?? 0)  // cheaper first within source
})
```

Effect: a user on a product page sees Danish listings first, then Norwegian /
Swedish, then Reverb international as fallback. Matches the "DBA-first KUP
value" framing.

### Fix 3 (structural): exclude Reverb parts from matches

Best done after migration 030 lands `kg_product.reverb_csp_id`. Then for each
listing matched via Reverb, we can join through Reverb's `categories[]` and
exclude any whose root category is `parts`. This is the same fix that solves
the Jupiter-8 outlier ("339 kr pitch bender cap").

Until then, a cheaper mitigation: **demote** match score for Reverb listings
whose title contains words like "slider", "cap", "knob", "pcb", "panel",
"bender", "screw", "bracket". Heuristic, not deterministic.

## Risks & footguns

- **Fix 1 will create a one-time spike** in `listing_product_match` writes
  when the backfill runs. It's bounded (~1k rows) and idempotent.
- **Fix 2 changes user-visible ranking.** PostHog will show shifted CTR
  patterns. Worth a flag if you want to A/B it.
- **Fix 3 (heuristic version) will mismatch some real product titles.** A
  Roland Juno-60 listing called "Roland Juno-60 with new sliders installed"
  would lose score. Better to wait for proper category-aware filtering via
  CSP id.

## Next action

Apply **Fix 1** as the smallest, highest-leverage change. Re-investigate
ranking only after the data set includes the missing DBA listings.

If approved as a low-risk fix, the diff is:

```
scripts/match-listings.ts   1 line change
+ run npm run match-listings -- --backfill once
```
