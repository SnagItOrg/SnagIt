# Klup product lifecycle — operator and author guide

How a product moves from "someone suggested it" to "a public page Klup monitors".
Nothing in this guide is automatic, and no step implies the next one.

---

## 1. The four independent concerns

These are four different questions with four different answers. Conflating any
two of them is the defect this contract exists to prevent.

| Concern | Question | Field | Values |
|---|---|---|---|
| **Identity** | Is this a verified music product? | `kg_product.status` | `active` · `inactive` |
| **Support** | Is it in the frozen launch cohort? | `kg_product.support_state` *(migration 056)* | `known` · `reserve` · `supported` |
| **Visibility** | Is its page publicly exposed? | `kg_product.browse_visibility` | `public` · `qa_only` · `hidden` |
| **Monitoring** | Which marketplaces are queried for it? | `kg_product.tier` | `legendary` · `classic` · `standard` |

### Behaviour matrix

| State | KG row | Matcher target | Public page | Scheduled monitoring |
|---|---|---|---|---|
| Verified known | yes | **no** | no | no |
| Reserve | yes | **no** | no | no — explicit probe only |
| Supported, private | yes | **yes** | no | configuration-dependent |
| Supported, public | yes | **yes** | yes | configuration-dependent |
| Discovery-only | candidate registry only | no | no | no |
| Deprecated / non-music | preserved `inactive` | no | no | no |

**Matcher eligibility is exactly `status='active' AND support_state='supported'`**
(`isMatchableProduct` in `frontend/lib/matching/match-listings.ts`). Visibility and
monitoring are deliberately absent from that predicate.

### `tier` is monitoring, not decoration

`scripts/scrape-{dba,finn,blocket,kleinanzeigen}.ts` choose which products to
query **by tier**. DBA queries `legendary` + `classic`; the other three query
`legendary` only. Raising a product to `legendary` therefore **adds it to four
marketplace scrapers**. Never change `tier` casually, and never change it as a
side effect of promoting support.

---

## 2. Candidate versus verified KG product

| You have | Where it goes | How |
|---|---|---|
| A name someone suggested | **Candidate registry** — `data/klup-product-candidate-registry.csv` | Add to a source file, then `npm run build-product-artefacts` |
| An unresolved family (`Ibanez PIA`, `Tokai ES models`) | Registry only, `hierarchy_role=discovery_only` | Never becomes a `kg_product` row |
| A navigation family (`Fender Stratocaster`) | Registry only, `hierarchy_role=navigation_family` | Groups children in browse; **never a match or price page** |
| An exact verified product (`Gibson Les Paul Custom`) | `kg_product` row, defaulting to `known` / private / unmonitored | Curate brand + exact model, then promote deliberately |

**Never fabricate an exact product from a discovery family.** "Tokai ES models"
is not a product; `Tokai ES-138` would be, once the model is verified.

### Source files and their status

| File | Rows | Mutability |
|---|--:|---|
| `data/klup-clean-product-candidates.csv` | 336 | **Immutable.** Original research evidence |
| `data/klup-music-vertical-candidate-additions.csv` | 182 | Additive overlay; append only |
| `data/klup-product-candidate-registry.csv` | 802 | **Derived.** Never hand-edit |
| `data/klup-launch-cohort-frozen.csv` | 48 | **Derived.** Never hand-edit |
| `data/klup-frozen-cohort-asset-inventory.csv` | 48 | **Derived.** Never hand-edit |

---

## 3. The promotion path

The existing admin surface is the seam. `/admin/products` →
`PATCH /api/admin/products/[id]`. There is no separate CLI and no parallel UI.

### What changed

The route previously accepted `tier`, `browse_visibility`, `year_released` and
`tags` in one body and applied them silently. It now:

- maps every field to one of the four axes;
- **requires explicit `intent`** for `visibility` and `monitoring`, so neither
  can ride along with a support change;
- validates every value against a closed set;
- refuses to promote an `inactive` identity to `supported`;
- returns a **before/after manifest** naming each changed axis and its
  consequence;
- supports **`?dryRun=1`**, which runs every decision rule and returns the same
  manifest **without writing**.

### Preview before you change anything

```bash
curl -X PATCH '/api/admin/products/<id>?dryRun=1' \
  -H 'content-type: application/json' \
  -d '{"support_state":"supported"}'
```

Returns `applied: false` plus the manifest. Nothing is written.

### The four operations

| Operation | Body | Effect |
|---|---|---|
| **Promote support** | `{"support_state":"supported"}` | Becomes a matcher target. **Does not publish. Does not add a marketplace query.** |
| **Publish** | `{"browse_visibility":"public","intent":["visibility"]}` | Page goes public. **Does not change support or monitoring.** |
| **Change monitoring** | `{"tier":"legendary","intent":["monitoring"]}` | **Expands scraper query sets.** Requires explicit intent |
| **Demote** | `{"support_state":"reserve"}` | Stops being a matcher target. Identity, page, article, images and existing matches are untouched |

Omitting `intent` for visibility or monitoring returns
`400 undeclared_axis` with the exact hint to resend. That is the fail-closed
default.

---

## 4. Product pages, articles and images

Existing assets are the baseline and are **never rebuilt by lifecycle work**.

| Asset | Where it lives |
|---|---|
| Page | `frontend/app/product/[slug]/page.tsx`, route `/product/<slug>` |
| Article | `kg_product.attributes` → `description`, `specs`, `history`, `external_links` |
| Images | `kg_product.image_url` (auto-derived, usually Supabase Storage webp) and `kg_product.hero_image_url` (editorial override; wins) |

### Readiness is not identity

A product can be verified and `supported` **while its copy and imagery are
still drafts**. Content gaps do **not** block KG import or private support.
They **do** block automatic public exposure — publishing is a separate,
explicitly reviewed action, and the asset inventory is the input to it.

Measured coverage across the frozen cohort's KG-present products
(`data/klup-frozen-cohort-asset-inventory.csv`):

- **3 of 34** carry an article (`attributes.description`) — Juno-106, Juno-60, Jupiter-8. All draft.
- **29 of 34** carry an `image_url`; **1** has a `hero_image_url`.
- **5** have no image at all: the three Rhodes pages, Wurlitzer 200A, Neve Portico II MBP.

**Never** download, rewrite, regenerate or delete an article or image as part of
a lifecycle change. During duplicate consolidation, the survivor must retain the
slug, article, images and every inbound reference; a retired duplicate slug with
consumers needs a redirect entry before it is retired.

---

## 5. Why a family is not matchable

A navigation family groups children whose markets differ by more than 3×. If
`Fender Stratocaster` aggregated its children, its price band would span a
2,400 DKK Squier and a 40,000 DKK Custom Shop — the page could not answer
"is this a good price?", which is the whole product.

Families therefore group in browse and search but **never** aggregate listings
or compute price statistics. Making a parent aggregate safely is an experience
and data-model problem, and it is **not** a reason to merge the children.

---

## 6. Editorial facets are separate

`The Squelch Boxes`, `The Time Machines`, `The Workhorses`, `The Glue
Machines`, `The Barking Reeds`, `The Wave Ensembles`, `Four-Bar Groove
Shapers`, `The Crown Jewels`, `Green-Screen Pioneers` are **future** many-to-many
editorial collections. They are:

- **not** the primary taxonomy — standard professional categories are;
- **never** matcher aliases or identity signals;
- not implemented anywhere yet.

Standard category and canonical product names stay visible in URLs, headings,
search and metadata. A user must never have to decode a nickname to find a
product they already know.

---

## 7. Commands

```bash
npm run build-product-artefacts      # regenerate registry, cohort, asset inventory
npm run validate-product-artefacts   # verify they reproduce exactly; non-zero on drift
npm test                             # 138 tests incl. lifecycle + guard regressions
npm run report-match-backlog         # read-only matcher report
bash scripts/verify-migrations-isolated.sh   # disposable-cluster migration harness
```

`validate-product-artefacts` fails if any of the 336 or 182 source rows is
unaccounted for, if a candidate id repeats, if the cohort leaves 30–50, or if a
`navigation_family` / `discovery_only` row reaches the core.

**No local command connects to production for writes.** The artefact builder
opens no database connection at all.

---

## 8. Reviewing a generated manifest

Every promotion returns, and every migration prints, a before/after manifest.
Check three things:

1. **Only the axes you named changed.** `axes_touched` should match your intent.
2. **The consequence text matches what you wanted.** In particular, a
   `monitoring` change says explicitly whether the scraper query set expands.
3. **`unchanged_axes` shows the axes you did not intend to move**, with their
   current values.

---

## 9. Prohibition: broad KG presence never triggers monitoring

The KG is the **identity universe** and is expected to grow far beyond the
launch catalogue. Presence in the KG means only "this is a verified music
product".

> **Do not run every KG product against every marketplace.** Query-driven
> monitoring stays limited to the supported cohort plus explicitly authorised
> reserve probes. A KG import must never widen `tier`, and no import,
> promotion or publish step may add a marketplace query as a side effect.

Historical population remains blocked until the frozen cohort has a
product-filtered, dry-run-first execution boundary.
