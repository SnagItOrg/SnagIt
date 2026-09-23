# Wikimedia Commons as a product-image source: rights, coverage, and what it would cost

**Date of research: 2026-09-22.** Companion file:
[`pan-110-commons-image-candidate-manifest.csv`](pan-110-commons-image-candidate-manifest.csv)
— all 49 public supported products, with a verdict and the evidence for each.

`docs/pan-76-image-source-rights-memo.md` assessed Equipboard and Thomann and
refused both. It never evaluated Commons. This is that gap.

**Verdict: the licence is clean, the coverage is real, and the cost is a UI
change nobody has budgeted.** Commons can prove the correct model for 32 of
49 products. But only 9 of those carry no attribution obligation, and Klup has
nowhere to render a credit today. Nine is the number that can ship without new
UI; the other 23 cannot ship until a credit line exists.

---

## 1. Access: compliant, but not via the API

Commons is usually described as welcoming automated access. Its `robots.txt`
is narrower than that reputation suggests. Read 2026-09-22, `User-agent: *`:

```
Allow: /w/api.php?action=mobileview&
Allow: /w/load.php?
Disallow: /w/
Disallow: /api/
Disallow: /wiki/Special:
```

**The MediaWiki API path is disallowed.** `/w/api.php` — the documented,
machine-readable endpoint with licence metadata per file — is off limits to a
general agent, with a narrow `mobileview` exception. So is `/api/rest_v1/`.

This research therefore used only allowed paths: `/wiki/Category:…`,
`/wiki/File:…`, and pixels from `upload.wikimedia.org` (which disallows only
`/wikipedia/commons/archive/`). A descriptive User-Agent was sent on every
request and requests were spaced. **No 403 was encountered at any point, and
no bot challenge was met or defeated.**

The practical consequence for any future integration: licence metadata has to
be parsed out of the rendered `/wiki/File:` page, because the endpoint that
returns it as JSON is the one robots.txt closes. That is a real cost and it is
the opposite of the "documented API" assumption.

`upload.wikimedia.org/wikipedia/commons/thumb/…` returns **400** to a
non-browser agent; only the full original path serves pixels. Some originals
are 3–14 MB.

---

## 2. Coverage, measured against both cohorts

The cohort is **49 public supported music products** — `isCanonical()`'s four
axes plus the family-label guard. Of these, **13 have no image at all** and
**36 have one**. (The work package said 14 and 34. 13/36 is what production
returns today; the 34 is the count of image-bearing rows carrying a
`reverb_csp_id`, which is a different question and is confirmed — as is
PAN-110's "20 carry a `thomann_url`".)

| | No image (13) | Has image (36) | Total (49) |
|---|---|---|---|
| **PROVEN_MODEL** | 7 | 25 | **32** |
| FAMILY_ONLY | 2 | 4 | 6 |
| NO_CANDIDATE | 4 | 7 | 11 |

That is 65% model-level coverage, far above the memo's "a source that covers 6
is not worth an integration" bar. **Commons is a real source.**

The evidence standard was the pixels, not the filename. Every candidate above
was downloaded and read: nameplates, control panels and badges. Two near-misses
were caught that a title match would have shipped:

- **Neumann U 87 Ai** — the only clean Commons file is stamped `MADE IN WESTERN
  GERMANY` and dated 1971. That is the original U 87, not the U 87 Ai (1986).
- **Sequential Prophet-10** — the only whole-instrument file is the single-manual
  **Rev 4 (2020) reissue**, which the product row explicitly excludes.

And two products are **structurally unprovable from any photograph**: Les Paul
Standard `'50s` and `'60s` differ chiefly by neck profile. No image can decide
between them. They should stay empty rather than take a coin-flip.

### Where Commons is strong and weak

Strong on vintage and iconic instruments — the Rhodes category tree is
correctly split by Mark, by Stage/Suitcase and by key count, which is better
disambiguation than Klup's own listing data offers. Weak on current production
runs: American Professional II, American Standard Telecaster, American Ultra II,
Jim Root Jazzmaster and the Les Paul Standard split are five of the eleven
misses, and all are recent Fender/Gibson catalogue names. Expect that gap to
persist; Commons is not the source for modern product lines.

---

## 3. The attribution obligation, and the UI it implies

**This is the finding that decides whether Commons is usable, and it is a UI
question, not a rights question.**

| Licence class | Count | Obligation |
|---|---|---|
| Public domain / CC0 | **9** | none |
| CC BY / CC BY-SA | **28** | visible credit + licence name + licence link; note if modified |
| (no candidate) | 12 | — |

A CC BY image displayed with no visible credit is a licence breach. Klup has
**no surface that renders an image credit today** — not on the product hero,
not on `ProductCard`, not on search results, not on category tiles.

So adopting any of the 28 requires, as a prerequisite and not a follow-up:

1. **A credit line under the product hero** — author, licence name, and a link
   to both the licence and the Commons file page. Roughly
   `Foto: Ed Uthman · CC BY-SA 2.0`, linked.
2. **A decision about cards.** The same image renders on the homepage, browse,
   search and family surfaces where a per-image caption does not fit. The
   conventional answer is a single `/billedkreditter` page listing every image,
   author, licence and source, linked from the footer and from the hero
   caption. That is a new public route.

Neither exists, and both are outside tonight's scope — `app/product/[slug]`
and `ProductCard` belong to sibling workers.

### The ShareAlike trap, which cuts against the owner's actual goal

PAN-110's request is **"skrabet rent med hvid baggrund"** — clean, background
removed. Removing a background is creating a **derivative work**.

Of the 28 attribution-bearing candidates, most are CC BY-**SA**. Retouching one
produces a derivative Klup must itself license under ShareAlike. The images the
owner most wants to clean up are exactly the ones where cleaning them up
propagates a copyleft obligation onto Klup's own asset.

The CC BY (non-SA), CC0 and PD candidates can be retouched freely. **That
inverts the priority order:** source by licence first, quality second.

### The nine that need no UI at all

These carry no attribution obligation and could be adopted with zero UI change:

`rhodes-mark-i-stage-73` (PD) · `fender-telecaster-custom` (PD) ·
`roland-juno-106` (PD) · `roland-re-201` (PD) · `roland-jupiter-4` (CC0) ·
`oberheim-ob-x` (PD) · `emu-sp-1200` (PD) — all seven proposed.

Two more are PD but not recommended: `roland-re-501` (757×432 — proven correct,
proposed in the manifest, but marginal for a hero) and `sequential-prophet-5`
(**rejected** — the file is an upscale of a 386×163 parent and carries a
"blurry" objection template).

**Seven usable. Two of them — the Rhodes Mark I Stage 73 and the Telecaster
Custom — are currently image-less**, and the Telecaster Custom is a clean
white cut-out with a legible `Fender TELECASTER Custom` headstock decal.

---

## 4. Two rendering problems found by looking at the pixels

**Aspect ratio.** The product page renders the hero in `aspect-square` with
`object-cover` (`app/product/[slug]/page.tsx`). Instrument photography is not
square: the best candidates run 2.5–3.1:1 wide (Jupiter-8 2.86, Juno-106 3.13,
DX7 3.10, Telecaster Custom 3.02) or 0.34–0.46:1 tall (Thinline 0.34, Neumann
0.46). `object-cover` on a 3:1 image inside a square shows the middle third and
crops the rest — the Jupiter-8 would lose both ends of its own keyboard.
Adopting wide catalogue cut-outs needs `object-contain` with padding, or a
non-square hero. This is a prerequisite for the cleanest assets specifically.

**The TR-909 hero does not render at all.** Its `hero_image_url` is a
`images.pexels.com` URL, and that host is **not in `next.config.mjs`
`remotePatterns`**. The page uses `next/image`, which refuses an undeclared
host and falls through to the `onError` placeholder. PAN-110 states "the page
has been serving the Pexels photograph throughout" — it cannot have been. This
is worth re-checking in a browser before anything is concluded from it.

---

## 5. Recommendation

1. **Commons is worth using, selectively.** 32 of 49 provable is well past the
   integration bar — but it is a curation source, not a bulk import. There is
   no API path available, the licences differ per file, and 17 products still
   have no correct candidate.
2. **Take the seven PD/CC0 candidates first.** No attribution UI, no ShareAlike,
   and two of them close image-less products. This is the only part that can
   proceed without new UI.
3. **Decide the credit surface before touching the other 23.** A CC BY image
   with no visible credit is a breach, and the honest sequencing is the same one
   PAN-76 used: rights first.
4. **Two products need a definition, not an image.** `fender-telecaster-custom`
   (1959–68 bound-body vs 1972–81 humbucker) and `fender-telecaster-thinline`
   ('68/'69 vs '72 vs reissue). Commons separates both correctly; Klup has to
   say which it means.
5. **Leave the two Les Paul Standards empty.** An empty card is a known-missing
   image. A coin-flip between `'50s` and `'60s` is a lie the user cannot detect.

---

## 6. What this change does not do

No image was fetched from a path any `robots.txt` disallows. No bot challenge
was encountered or defeated; no browser User-Agent was impersonated. No
`image_url` or `hero_image_url` was written. No scraper, no import, no
migration, no PM2 job, no change to `data/klup-source-monitoring.json`.
Production was read SELECT-only. The manifest proposes; it does not apply.
