# PAN-76 — Equipboard and Thomann as image sources: rights finding

**Date of research: 2026-09-21.** All quotes below were read on that date.
**Verdict: neither source permits it. No extractor was built.**

PAN-76 orders the work "rights first, extraction second, import last". The
rights step returned *no* for both candidate sources, so under the ticket's own
sequencing the extractor is not reached. This memo is the deliverable.

The companion file is
[`pan-76-image-candidate-manifest.csv`](pan-76-image-candidate-manifest.csv) —
the 16 supported products with no image, and what evidence exists for each.

---

## 1. The measured gap

Run against production on 2026-09-21, SELECT-only, using the four axes of
`isCanonical()` plus the family-label guard:

| Cohort | Total | No image | Share |
|---|---|---|---|
| Public (`active` + `supported` + `public` + `music`) | 31 | **13** | 41.9% |
| Supported (`active` + `supported` + `music`, any visibility) | 58 | **16** | 27.6% |

"No image" means `COALESCE(hero_image_url, image_url) IS NULL` after trimming.
This reproduces the ticket's figures exactly. `hero_image_url` is set on 6 rows
of 4,041 — it is, as the ticket says, almost entirely null and available.

---

## 2. Equipboard — not permitted

### 2.1 robots.txt draws its line exactly at images

`https://equipboard.com/robots.txt`, read 2026-09-21. Item pages themselves are
crawlable — there is no `Disallow: /items/` in the `User-Agent: *` group. But
every endpoint that serves an item's image set is individually disallowed:

```
Disallow: /items/*/image_carousel
Disallow: /items/*/images_modal
Disallow: /gear_photo_votes
```

The same group also bans, by name, a long list of agents whose sole purpose is
image harvesting — `Image Fetch`, `Image Stripper`, `Image Sucker`,
`WebImageCollector`, `Extreme Picture Finder`, `PictureFinder`, `Picscout`,
`Pixray`, `Papa Foto`, `WebPix` — alongside the generic scraping toolchain
(`Scrapy`, `HTTrack`, `PHPCrawl`, `PyCurl`, `WWW::Mechanize`, `Heritrix`,
`Nutch`, `lwp-request`, `Typhoeus`), and `CCBot`.

This is not an accident of configuration. The operator allowed the pages and
disallowed the images. There is no reading of that file under which an image
extractor is welcome.

### 2.2 A technical access control is in force

`GET https://equipboard.com/terms` with an honestly-identified non-browser agent
returned **HTTP 403** with a Cloudflare managed-challenge body
(`cf_chl_opt`, "Enable JavaScript and cookies to continue"), 2026-09-21.
Content pages are behind an active bot challenge. Defeating it — headless
browser, UA impersonation, challenge solving — would be circumventing an access
control, not scraping a public page. That is out of bounds regardless of what
the terms say.

### 2.3 The terms grant us nothing to re-host

`https://equipboard.com/about/terms`, read 2026-09-21. The document has 18
sections and carries **no "last updated" date**. There is no acceptable-use or
anti-scraping clause — but there is also no grant. The two load-bearing clauses:

> **CONTENT** — "Equipboard accepts no responsibility or liability for the
> images, content, and or links posted on this site by users. You shall not
> upload, post or otherwise make available any material protected by copyright,
> trademark or other proprietary right without the express permission of the
> owner of the copyright, trademark or other proprietary right."

> **Website Content** — "All users adding content to Equipboard agree to provide
> a non-exclusive license for other users to use, modify, reproduce, distribute,
> prepare derivative works of, and display their content as permitted through
> the functionality of the Services and under this Agreement."

Read those together and the position is unambiguous:

1. The licence runs to **other users**, and only **"as permitted through the
   functionality of the Services"** — that is on-platform display. It is not a
   licence to re-host on klup.dk, and re-hosting is not a function of the
   Services.
2. Equipboard **expressly disclaims** responsibility for the images. It does not
   warrant that it owns them, so it could not sub-licence them to us even if the
   clause were read generously. Equipboard is an affiliate site — the
   `/buy_links/`, `/out_reverb` and `/visit-*` paths in robots.txt — so a
   meaningful share of its imagery is retailer and manufacturer material it is
   displaying under its own arrangements.
3. The absence of an anti-scraping clause is **not** permission. Copyright is the
   default; a licence has to be granted, not merely left un-refused.

**Equipboard: no hotlinking, no download-and-re-host. Stop here.**
Per the ticket, extraction was not attempted "to see if it works".

---

## 3. Thomann — not permitted

### 3.1 robots.txt would allow the fetch

`https://www.thomann.de/robots.txt`, read 2026-09-21. Product pages are not
disallowed for `User-agent: *`; only baskets, wishlists, filter params, the
classifieds section and `cableguy`/`woodpicker` are. `GPTBot` and `DataForSeoBot`
are fully disallowed. So crawl access is not the obstacle here.

### 3.2 The copyright notice is the obstacle

`https://www.thomann.dk/compinfo_imprint.html`, section **Copyright**, read
2026-09-21 (fetched raw and quoted verbatim):

> "© Copyright 2015 Thomann GmbH. Alle rettigheder forbeholdt. Indholdet på
> denne website er ophavsretligt beskyttet. Alle rettigheder indehaves af
> Thomann GmbH eller dette firmas partnere (leverandører, producenter osv.).
> Anvendelse af indholdet på denne website ud over det i loven om ophavsret
> anførte er ikke tilladt uden udtrykkelig tilladelse fra Thomann GmbH."

Translated: all rights reserved; the content is copyright-protected; rights are
held by Thomann GmbH **or its partners (suppliers, manufacturers etc.)**; and
use of the content beyond what the Copyright Act itself allows **is not
permitted without express permission from Thomann GmbH**.

That is an explicit, opt-in-only reservation. It covers product photography, and
it names the suppliers and manufacturers as rights holders — so Thomann, like
Equipboard, is partly displaying images it does not own.

The Danish consumer T&C (`compinfo_terms.html`) contains no IP clause at all; it
is a sales contract. The imprint is where the reservation lives, which is why
checking only the "terms" page would have produced a false negative.

### 3.3 The existing price scraper does not imply permission

`fetch-thomann-prices.ts` exists and runs. That is deliberate and unaffected:
a price is a fact, and facts are not subject to copyright. A product photograph
is an authored work. The fetch path proves we *can* reach the page; it says
nothing about what we may keep from it.

**Thomann: no hotlinking, no download-and-re-host.**

### 3.4 Pre-existing exposure, flagged not fixed

While measuring, I found that **176 `kg_product` rows already carry an
`image_url` on a Thomann host**, and `frontend/app/product/[slug]/page.tsx:881`
passes one as `thomannImageUrl`. `docs/stock-images-workflow.md` (2026-04-27)
records the origin: image sources were "Reverb CSP, Thomann og:image".

This predates PAN-76 and I have changed nothing. But the clause above applies to
those 176 rows today, so it is a product-owner decision, not a silent one. For
completeness the full distribution of populated `image_url` hosts is: 1,254
self-hosted in Supabase Storage, 176 Thomann, 7 Reverb, 1 Unsplash.

---

## 4. Coverage — the integration would not have been worth it anyway

The ticket asks whether a permitted source could cover enough of the 16 to
justify an integration. Neither is permitted, but the measurement is worth
recording because it changes what should be built instead.

Of the 16 supported products with no image:

- **1 of 16** has a `thomann_url` (`fender-telecaster-custom`) — and that is a
  discontinued vintage model Thomann does not sell, so the URL is at best a
  different product wearing the same name.
- **0 of 16** have a `reverb_csp_id`.

Thirteen of the 16 are vintage or discontinued instruments — four Rhodes, a
Wurlitzer 200A, four pre-owned-only Fenders. A retailer catalogue is
structurally the wrong place to look for them: retailers stock what they sell.
Even with permission, Thomann would have covered approximately one product. That
is well under the ticket's own "a source covering 3 is not worth an integration"
bar.

---

## 5. The third source, and the trap in it

Listing photos are the remaining source, and at first glance they look
abundant: **15 of the 16** have at least one adjudicated (`is_valid IS TRUE`)
match carrying a photo, 472 of them from Reverb alone.

That number is a trap, and it is the same trap as PAN-99.

Splitting those matches by the scoring contract in
`frontend/lib/matching/match-listings.ts` changes the answer completely:

| Evidence tier | What it is | Products of the 16 covered |
|---|---|---|
| `FUZZY` / 100 | written only by the admin curation routes — a human decision | **5** |
| `EAN`/`SKU`/`SYNONYM` ≥ 80 | curated identifier or alias | **0** |
| `MODEL` / 70 | `kg_product.model_name` token — uncurated | 11 |

The 70 tier is below `AUTO_CONFIDENCE_MIN = 80`, and the comment above that
constant documents exactly why:

> "the ONLY tier with no curation behind it … including cross-brand instruments
> ("ESP J-Four Jazz Bass" -> Fender Jazz Bass, "Ibanez Performer PF100" ->
> Crumar Performer), parts and wanted ads."

PAN-35 forbids inferring model identity from a loosely matched listing. A
score-70 match *is* the loose match. So the honest coverage from listing photos
is **5 of 16, not 15 of 16** — and all five are the vintage electric pianos
(4 Rhodes, 1 Wurlitzer 200A).

Note what would have happened otherwise: `gibson-es-335-dot` has the largest
pool in the set, 169 uncurated photos, and `gibson-les-paul-standard-'50s` and
`'60s` differ mainly by neck profile. Taking the most abundant photo would have
shipped a confident, wrong image onto a legendary product page — a cartridge on
a DX7, again.

---

## 6. Answering "how would a wrong match be detected rather than trusted?"

The ticket asks this of an extractor. It applies to any image source, so it is
answered here rather than dropped with the extractor.

The failure mode in PAN-99 was not a bad resolver. It was that the resolver's
output was **written as truth with no state in which a human had looked at it**,
so a wrong answer and a right answer were indistinguishable after the fact. Of
351 products with CSP candidates, 12 had an exact slug match and all 12 were
ignored — meaning the signal that would have caught it existed and had nowhere
to go.

Three properties fix that, and all three are cheap:

1. **Propose, never write.** A resolver's output lands in a manifest with
   `review_state = proposed`. Nothing reaches `image_url` without a human
   transition. The manifest in this PR is that shape.
2. **Carry the evidence, not just the verdict.** Every row states the matching
   method and score and links the source page, so the claim is re-checkable
   without re-running anything. The manifest rows show why this matters: the
   best candidate for `rhodes-mark-i-stage-73` is titled only "Fender Rhodes
   Mk1", which distinguishes neither Stage from Suitcase nor 73 from 88. At
   score 100 that is a human's call — and the row has to say so, because the
   text alone does not carry it.
3. **Abstain loudly.** Eleven of sixteen rows in the manifest say
   `blocked_no_curated_evidence` rather than offering the most abundant photo.
   An empty card is a known-missing image; a wrong card is a lie the user
   cannot detect.

---

## 7. Provenance — the smallest shape that satisfies PAN-35

PAN-35 requires source URL, acquisition time and review state to be retained,
and requires "wrong image" and "missing image" to be **distinct states**.
PAN-100 will consume this.

No image-provenance table exists today (no `*_image*`, `*_photo*` or `*_asset*`
table in `public`), and a new table in `public` is a P0 under
`scripts/CLAUDE.md` — born world-readable and world-writable. So the smallest
shape avoids creating one.

**Proposal: one nullable `jsonb` column, `kg_product.image_provenance`, beside
the existing image columns.**

```json
{
  "source_url":     "https://www.dba.dk/recommerce/forsale/item/24403517",
  "image_url":      "https://images.dbastatic.dk/dynamic/default/item/24403517/92f9...",
  "source":         "dba.dk",
  "acquired_at":    "2026-09-21T20:00:00Z",
  "evidence":       { "method": "FUZZY", "score": 100, "listing_id": "..." },
  "review_state":   "proposed",
  "reviewed_by":    null,
  "reviewed_at":    null
}
```

`review_state` is the axis PAN-35 asks for, and it is what makes the two failure
states distinct:

| State | Meaning | Renders? |
|---|---|---|
| (column null, `image_url` null) | **missing image** — never had a candidate | no, and that is correct |
| `proposed` | a candidate exists, unreviewed | **no** — fail-closed |
| `approved` | a human confirmed the model | yes |
| `rejected` | **wrong image** — a human said no | no, and never proposed again |

`rejected` is the state PAN-99 lacked. Without it a wrong image is silently
re-proposed by the next run, and "we looked and it was wrong" is
indistinguishable from "we never looked".

Why this shape and not more:

- **It reuses the existing render chain.** `hero_image_url ?? image_url` stays
  the authority; provenance describes, it does not decide. Nothing in
  `frontend/lib/public-product.ts` has to change to *not* break.
- **`hero_image_url` stays the manual override**, as the ticket intends and as
  `promote-csp-images.ts` already documents ("hero_image_url is the editorial
  override and is never touched here"). An approved candidate writes
  `hero_image_url`; `image_url` remains the automated axis.
- **No new table, so no P0 RLS surface.** `kg_product` already has RLS.
- **It is one migration the size of 028**, which added `hero_image_url`.

This is a proposal. It is not authorised by PAN-76 and no migration was written.

---

## 8. Recommendation

1. **Do not build an Equipboard scraper.** Both robots.txt and the licence
   structure refuse it, and a Cloudflare challenge enforces it. If the owner
   wants Equipboard, the route is a written licensing request — they have a
   contact form and a copyright agent — not an extractor.
2. **Do not take images from Thomann**, and put the 176 existing Thomann-hosted
   `image_url` rows in front of the owner as a separate decision.
3. **The answer to "billeder på alle kort" is not a scraper.** Five of the 16
   already have a defensible candidate sitting in our own database; the manifest
   proposes them for review. The other eleven need one curation decision each,
   which is an afternoon, not an integration.
4. **If a bulk automated source is still wanted**, the only one with an
   unambiguous commercial licence is Unsplash — already assessed in
   `docs/stock-images-workflow.md` §B and already used for one row. It gives
   category-grade imagery, not model-accurate product shots, so it answers the
   empty-card problem without ever claiming to be the right model. That is a
   different and much safer promise than a wrong product photo.

One caveat on the five: a marketplace listing photo belongs to the seller, not
to the marketplace and not to us. Using them is a smaller and more familiar
rights question than Equipboard's — we already display these same images on
listing cards today — but it is a question, and it is the owner's to answer.
This memo does not assume the answer.

## 9. What this change does not do

No scraping run. No import. No `image_url` or `hero_image_url` write. No new
PM2 job. No change to `data/klup-source-monitoring.json`. No migration. Two new
documents in `docs/` and nothing else. Production was read SELECT-only.

Network requests made during this research: 5 to equipboard.com (robots.txt,
`/terms` ×2, `/about/terms` ×2) and 3 to thomann.de/thomann.dk (robots.txt,
`compinfo_terms.html`, `compinfo_imprint.html`). No product page was fetched
from either site, because the rights answer arrived first.
