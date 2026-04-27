# Stock images workflow — current state + three proposals

**Date:** 2026-04-27
**Trigger:** Manager flagged that `/browse` category cards lack imagery.
Goal: a sustainable workflow that scales from 14 root categories today to
hundreds of subcategories + thousands of products later, without
hand-curating every asset.

## Current state

### Supabase Storage `onboarding-assets` (public bucket)

```
onboarding-assets/
├── categories/   (7 files)
│   ├── baby.webp           ❌ wrong vertical (legacy onboarding)
│   ├── danish-modern.webp  ❌ deprioritised vertical
│   ├── fashion.webp        ❌ wrong vertical
│   ├── gaming.webp         ❌ wrong vertical
│   ├── music-gear.webp     ✓ usable as a generic music fallback
│   ├── photography.webp    ❌ wrong vertical
│   └── tech.webp           ❌ wrong vertical
└── brands/       (45 files)
    fender.webp, gibson.webp, korg.webp, akai.webp, behringer.webp,
    focusrite.webp, elektron.webp, moog.webp, roland.webp (likely),
    sequential.webp (likely), arturia.webp, boss.webp, epiphone.webp,
    bang-olufsen.webp, …
```

Brand assets are in good shape; category assets are not. Leftover from the
old "4 coarse domains" onboarding — none map to the 14 Reverb root slugs we
now use for `/browse`.

### `kg_product` image fields (per migrations 028+)

```
kg_product.image_url        — populated for ~half of active products,
                              source varies (Reverb CSP, Thomann og:image)
kg_product.hero_image_url   — manual editorial override (mostly null)
kg_product.attributes.reverb_csp.image_url
                            — being populated by enrich-from-reverb-csp.ts
```

There's already a clean priority chain to render a product hero:
`hero_image_url ?? image_url ?? attributes.reverb_csp.image_url ?? null`.

### `kg_brand`

No `image_url` column today. Brand pages would need to either look up
`onboarding-assets/brands/<slug>.webp` directly, or we add an `image_url`
column matching the kg_product pattern.

## The actual gap

For `/browse`:

| Asset needed | Slugs | Bucket coverage |
|---|---|---|
| Root-category card | 14 (Reverb roots) | **0/14** |
| Sub-category card | 306 (Reverb leaves) | 0/306 |
| Brand card | ~3,000 unique brands | ~45 covered |
| Product hero | 3,840 active products | ~50% via Reverb CSP, growing |

Sub-categories and full brand coverage are not blockers for marketing
push — only **14 root cards** stand between today and a usable
`/browse` landing page.

## Three workflow proposals

### A. Manual curation (lowest tech, highest taste)

Pick 14 Unsplash photos by hand, download, rename to `<slug>.webp`,
upload to `onboarding-assets/categories/`. Roughly 30 min one-off, plus
30 min × N if we want sub-category cards later.

**Pros**
- Editorial control. Nordic-aesthetic photos, consistent crop, no jank.
- Zero infra changes — the `/browse` route already expects this layout.
- Unsplash license allows commercial reuse with attribution; no API
  dependency at runtime.

**Cons**
- Doesn't scale to 306 sub-categories or 3,000 brands.
- Re-curation needed every time Reverb adds a category root.

**When to choose:** if marketing push is in <2 weeks. Ship the 14, learn,
revisit before going wider.

### B. Unsplash API + automated bulk fetch

Build `scripts/fetch-unsplash-images.ts`:
1. For each kg_category (or any slug-keyed entity), query Unsplash Search
   API with the slug + a category hint ("electric guitars", "synthesizer",
   "amplifier").
2. Pick top result by relevance × portrait orientation × min resolution.
3. Download → resize/convert to webp → upload to bucket at canonical path.
4. Persist Unsplash metadata (photographer, photo_id, attribution string)
   in a sibling table or in the bucket as `<slug>.json` next to the webp,
   for license compliance.

**Pros**
- Scales to all 306 sub-categories + arbitrary product fallbacks.
- Idempotent — re-running on a subset is safe.
- Keeps Unsplash attribution centralized; one place to change CSS for
  "Photo by …" overlay.

**Cons**
- Unsplash free tier is 50 req/hour. Backfilling 320 categories takes a day.
- AI-pick can choose ugly photos. Top relevance ≠ good thumbnail.
- License: free tier requires attribution. We need a UI surface for that
  ("ⓘ photo info" overlay or footer line).

**When to choose:** if we want all 320 sub-category cards within a sprint
and accept some manual review afterward to swap bad picks.

### C. Drop bucket dependence — render from product images

Instead of curating category-level assets, generate category cards from
the products inside them:

```ts
// At render time:
SELECT image_url FROM kg_product
WHERE subcategory_id = $cat
  AND status = 'active'
  AND image_url IS NOT NULL
ORDER BY  reverb_used_total DESC NULLS LAST,  -- popularity proxy
          created_at DESC
LIMIT 1
```

The card hero becomes "the most popular product image in this category",
auto-updating as the KG grows.

**Pros**
- Zero curation burden. Card content reflects actual data, not editorial
  guesses.
- Automatically improves as enrich-products + CSP backfill progresses.
- One less storage thing to maintain.

**Cons**
- No editorial control — categories may end up showing a single weird
  photo (a part, a back-panel shot).
- Visual consistency suffers; product photos vary in lighting, crop,
  background.
- Requires a fallback when the category has zero products with images.

**When to choose:** if "convenience" outweighs "polish" for an early
audience that values data depth over magazine looks. Pairs naturally
with the reverb_csp_id work — once products are CSP-anchored, their
images are reliably clean.

## Recommendation

**Combine A and C, defer B.**

1. Curate the 14 root-category cards manually in the next 1–2 hours of
   editorial work. Drop them into `onboarding-assets/categories/` with
   exact slug filenames. Marketing push gate cleared.

2. For sub-category cards, use approach C — render from a representative
   product. Because the CSP backfill (running today) already populates
   clean images for many products, by the time anyone clicks into a
   sub-category there will be material to display.

3. Defer Unsplash API automation until we have actual demand signal that
   curated sub-category cards are needed (e.g. PostHog click-throughs to
   sub-categories that suggest browse-by-category is a real path).

## Concrete next actions if "yes, do it"

- Create a `/docs/stock-images-curation-list.md` checklist with 14 slugs +
  Unsplash search keywords + license attribution.
- Optionally add a small `kg_brand.image_url` column (mirror of kg_product
  pattern) so brand pages aren't dependent on the bucket layout — a
  schema migration the same size as 028.
- Optionally: add `onboarding-assets/categories/_attribution.json` to log
  per-slug photographer credit, in case Unsplash audits.

## What I did NOT touch

- No images uploaded.
- No code committed yet for approach C — it's a one-line change in the
  browse API and a fallback layer in the card component, but ships
  cleanly only after kg_product images are dense enough that "first hit"
  is reliably good. The CSP backfill in flight today is the gating data.

If you approve A+C, I can write the curation checklist now and start on
the C fallback in code; if you'd rather B, I'll scope the Unsplash
integration as a separate session task.
