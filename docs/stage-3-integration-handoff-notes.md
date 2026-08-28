# Stage 3 — integration hand-off notes

**Purpose.** Residual findings carried forward from the WP-1 independent review,
recorded for later disposition. **Nothing here is a code change**, and nothing
here blocks the integration base except where explicitly stated.

| | |
|---|---|
| Written | 2026-08-28 |
| Integration base | `a428ae49317fa5bdfb34815c57e4c7deead87a14` |
| Base branch | `stage3/v1-integration` — frozen at the reviewed WP-1 commit |
| WP-1 verdict | `WP1_REREVIEW_PASS` |
| Authority | [`stage-3-v1-decision-and-build-plan.md`](stage-3-v1-decision-and-build-plan.md) |

**The reviewed WP-1 commit is immutable.** None of the items below may be fixed
by amending it. Each is either scheduled into a later package or dispositioned
explicitly.

---

## Status summary

| # | Finding | Blocking? | Proposed owner |
|---|---|:-:|---|
| N1 | Supported-cohort assertion cannot detect a **missing** projection row | no | WP-3 or a follow-up to WP-1 |
| N2 | `BrandBreakdown.counts.public_count` is still support-blind | no | WP-3 (admin/audit surface) |
| N3 | Unexpected discover failures return a **success-shaped** 500 body | no | WP-3 |
| N4 | Browse-leaf genuine 404 lacks `no-store` and a machine error code | no | WP-3 |
| N5 | Branded product-segment 404 | **yes — mandatory WP-3 condition** | WP-3 |
| N6 | One stale "allowed supporting" line in the authority document | no | next authority amendment |

---

## N1 — the supported-cohort assertion cannot see a missing row

**Where.** `frontend/lib/catalogue.ts` → `assertSupportedCohortIsMusic()`,
called from `frontend/lib/browse.ts` → `fetchPublicBrowseRows()`.

**What it does today.** It iterates the projection rows it is given, skips any
slug outside the supported set, and raises when a supported slug's
`browse_domain` is not `music`.

**The gap.** The loop can only judge rows that *exist*. If a supported slug has
**no `browse_product_projection` row at all**, it is never iterated, so it can
never be an offender and the assertion passes. The function already computes a
`seen` set for exactly this comparison and then does not use it — the intent was
present, the check was not completed.

**Why it is non-blocking.** The projection is a view over `kg_product` with
`LEFT JOIN`s, so every `kg_product` row produces a projection row by
construction; a supported slug with no row would require the view definition to
change. The consequence would also be conservative: a missing row means the slug
is absent from the public result, i.e. under-serving, not over-serving. The
per-slug product gate is unaffected — it reads the projection directly and
fails closed on a null `browse_domain`.

**Proposed fix.** Compare `seen` against `supportedSlugs` and raise
`CatalogueUnavailableError('supported_cohort_missing_projection:<slugs>')` for
the difference. Add a unit test with a supported slug absent from the row set.

---

## N2 — `BrandBreakdown.counts.public_count` is still support-blind

**Where.** `frontend/lib/browse.ts` → `buildBrandBreakdown()`, incrementing on
`row.is_public`.

**The gap.** WP-1 relabelled the *rollup* counters —
`direct/subtree_browse_eligible_support_blind_count` (23) versus
`direct/subtree_canonical_public_count` (10) — precisely so that no consumer
could read a support-blind number as "public products". The **brand breakdown**
inside the same debug payload was not relabelled and still exposes a bare
`public_count` computed from `is_public` alone.

**Why it is non-blocking.** It appears only in the `?debug=1` payload, which is
admin-gated in-route and excluded from analytics. No public surface reads it.

**Proposed fix.** Rename to `browse_eligible_support_blind_count` and add
`canonical_public_count`, matching the rollup, so the whole audit payload uses
one vocabulary. Extend the existing counter-naming assertion in
`scripts/lib/wp1-public-contract.test.ts` to cover the brand breakdown.

---

## N3 — unexpected discover failures return a success-shaped 500

**Where.** `frontend/app/api/discover/route.ts`, the non-`CatalogueUnavailable`
branch: `NextResponse.json({ legendary: [], popular: [] }, { status: 500 })`.

**The gap.** A `CatalogueUnavailableError` correctly yields
`503 {"error":"catalogue_unavailable"}`. Any *other* unexpected error yields a
**200-shaped body** with a 500 status: a client that checks the payload rather
than the status reads it as "Klup follows nothing" — the exact
empty-catalogue-as-truth failure the no-store work was meant to prevent. The
status code is honest; the body is not.

**Why it is non-blocking.** The status is a correct 5xx, the response is
`no-store`, and the homepage gates each shelf on `length > 0`, so the visible
outcome is an empty shelf rather than a false claim. It is a shape defect, not a
staleness defect.

**Proposed fix.** Return `{ error: 'internal_error' }` with `no-store`, matching
`/api/browse`. The two browse routes were already fixed this way in WP-1;
discover's generic branch was missed.

---

## N4 — browse-leaf genuine 404 lacks `no-store` and a machine error code

**Where.** `frontend/app/api/browse/[root]/route.ts`:
`NextResponse.json({ error: 'Category not found' }, { status: 404 })`.

**The gap.** This is the *correct* absence path — WP-1 separated it from the
infrastructure-failure path, which now raises and returns 503. Two residues
remain: the body carries a human sentence rather than a machine code
(`category_not_found`), unlike every other error body in the surface; and the
response has no `Cache-Control`, so a 404 for a category that is later created
could be cached by an intermediary.

**Why it is non-blocking.** The category set is reviewed taxonomy and does not
change at runtime during V1, so the caching window has no live consequence. It
is a consistency defect.

**Proposed fix.** `{ error: 'category_not_found' }` with
`Cache-Control: no-store`.

---

## N5 — branded product-segment 404 (BLOCKING for WP-3)

**Already recorded as a mandatory WP-3 acceptance condition** in the authority
document, §15.8, row **M2**. Repeated here so it is not lost in the hand-off.

`frontend/app/not-found.tsx` is site-wide. An ineligible product URL currently
renders it: the status is a correct 404, but the page says nothing about the
catalogue. WP-3 must ship `app/product/[slug]/not-found.tsx` with
segment-specific copy, using the `notFound*` keys WP-1 already landed in
`lib/i18n.ts` in both locales.

Paired with §15.8 row **L7**: after the server-shell replacement, the client
island must not re-fetch and render its own not-found state. One gate, one
answer — an ineligible slug must produce exactly one 404 with no
200-then-flash.

---

## N6 — stale "allowed supporting" line in the authority document

**Where.** `docs/stage-3-v1-decision-and-build-plan.md`.

§15.1 now states plainly that WP-1's three test files live in `scripts/lib/`,
because `npm test` is `tsx --test` over `scripts/lib/*.test.ts` and anything
under `frontend/__tests__/` would never execute. The **WP-1 package table**
further down still lists its allowed supporting files as
*"new test files under `frontend/__tests__/` · `frontend/tsconfig.json`"*.

The prose supersedes the table, and the shipped commit follows the prose, so
this is a documentation inconsistency only.

**Second occurrence, same defect class.** The **WP-5 package table** carries the
identical stale phrase. WP-5 should be corrected in the same amendment rather
than reproducing the error.

**Already superseded, recorded for completeness.** The WP-4 package table says
its bounded middleware edit is *"removing the `/api/scrape` entry from
`PUBLIC_PREFIXES`"*. `PUBLIC_PREFIXES` no longer exists — §15.9 explicitly
supersedes that wording with "change `/api/scrape`'s classification in
`lib/route-access.ts`". No further action beyond folding the correction into the
package table.

**Proposed fix.** One documentation amendment correcting the WP-1, WP-4 and WP-5
package tables to match §15.1, §15.9 and §7.7.

---

## What WP-2, WP-4 and WP-5 inherit

All three package branches are cut from `a428ae`, so they inherit:

- the four-axis eligibility predicate and the uncached slug loaders;
- the public DTO — **`PUBLIC_PRODUCT_FIELDS` may not be widened** without a
  contract-test change and an explicit review;
- the shared route-access authority: **every new route needs a classification**
  in `frontend/lib/route-access.ts`, or the completeness guard fails;
- the independently reviewed security reference — a posture *downgrade* must be
  made in `frontend/lib/route-posture-reference.json` as well, and is a security
  decision;
- the failure model: absence is 404, unavailability is 503, and no public body
  carries database detail;
- the complete DA/EN i18n key set. **`frontend/lib/i18n.ts` is WP-1-owned and
  read-only** for later packages.

Each package appends its own `scripts/lib/wp<N>-*.test.ts` to the root
`package.json` `test` script as a one-line bounded edit, and changes nothing
else in that file.

---

## Non-mutation statement

This document records findings. It changes no application code, no
configuration, no migration, no database state, no PM2 process and no Vercel
setting. The Vercel scrape cron remains disabled, and no production deployment
was created by the branch and worktree setup.

---

# Stage 3 parallel-integration checkpoint — 2026-08-28

**Status: three reviewed package branches pushed and frozen. Integration NOT
performed.** The next fresh context integrates them and then stops at a product
-architecture checkpoint before WP-3.

| | |
|---|---|
| Shared base | `8e04ffd6c7ec1550b699b7d88f184aa1723c33cf` |
| `stage3/v1-integration` | `8e04ffd` — **unchanged**, still the shared reviewed base |
| `main` | `703a117b37e38b8fb68c4d3a9606ce4f4ba126ef` — **unchanged** |
| WP-2 `stage3/wp2-families` | `75574f8efec641df3beafe33a17a6fcf8983f75b` |
| WP-4 `stage3/wp4-restricted-search` | `6980129e7fdd8e5c8cf05892ca325fe0aa1991fc` |
| WP-5 `stage3/wp5-consent-analytics` | `d76a25b673574150931664e5b049ac61f5723a4c` |

Each package branch is exactly one commit on the shared base, clean, pushed
without force, and reviewed. WP-3 does not exist yet, by design.

---

## 1. PRODUCT-OWNER DECISION — the four-axis gate is the V1 *live-market*
## boundary, not the permanent public-content boundary

**This is the most important item in this document. Read it before planning WP-3.**

WP-1's four-axis canonical gate — `status='active' AND support_state='supported'
AND browse_visibility='public' AND browse_domain='music'` — is correct and stays.
It is what makes it safe for anonymous visitors to read product pages: it
guarantees that anything presented as a **live market surface** is a product Klup
actually monitors and can price honestly.

**It was never a statement that the other catalogue entities have no public
value, and it must not harden into one.**

The evidence is already in production. The Roland Juno-60 page carries a written
product history, specifications, a sourced image, external references and curated
related-product relationships. Every one of those is worth reading, and **none of
them depends on current matcher support**. A visitor researching a Juno-60 is
served by that page whether or not Klup can quote a price today. Treating "not
matcher-eligible" as "must not exist publicly" throws away real editorial value
that has already been paid for.

### The decision

**After integration and before WP-3, stop at a product-architecture checkpoint
that defines four page modes.** WP-3 must not begin until these are agreed,
because they determine what a product page *is*.

| Mode | Contains | Must NOT contain |
|---|---|---|
| **1. Live canonical** | editorial content · validated price context · eligible listings · watchlist/alert CTA | — |
| **2. Editorial reference** | reviewed product content (history, specs, images, external references) · approved related-product navigation | **no live-price claim · no listing count · no listings · no monitoring promise** |
| **3. Family** | navigation only, per §4.2 | never aggregates listings or prices |
| **4. Hidden** | not publicly reachable | — |

### Binding constraints on that checkpoint

- **The 14 supported+public products remain the live market surface.** Mode 2
  never acquires a price band, a listing feed, a listing count or an alert CTA.
  The honesty guarantee is that a price claim implies live monitoring; that link
  is not negotiable.
- **A reviewed subset** of additional music products may later become editorial
  reference pages. Reviewed means a named human approved that specific page's
  content — not a query, not a tier, not a heuristic.
- **Do not delete catalogue entities.** The current gate returns 404 for
  ineligible slugs; that is a routing decision, not a licence to remove rows.
- **Do not automatically expose all 4,004 rows.** Mode 2 is an allow-list, and
  the 307 inactive non-music rows are never candidates.
- **Do not reopen WP-1 or alter the current package commits** to achieve this.
  The extension is later, controlled, and additive.

### Recorded consequence: related-product breadth is temporarily reduced

WP-1 filters `attributes.related_products` through the full canonical predicate.
Measured on production 2026-08-27: **10 of the 15 related links authored on
canonical pages point at products that are not canonical** —
`roland-alpha-juno-1`, `roland-alpha-juno-2`, `roland-jp-8`, `roland-jp-6`,
`sequential-prophet-6`, `oberheim-dmx`. Juno-106 keeps 1 of 5 related links;
Juno-60 keeps 1 of 5; Jupiter-8 keeps 2 of 5.

That filtering is **correct today**: without it those links would 404, which is
worse than absence. But it is a *symptom* of the missing mode, not a desired end
state — those six are exactly the kind of product that should become an editorial
reference page.

**A later controlled eligibility extension may admit approved editorial reference
pages as related-product targets without weakening live market eligibility.** The
mechanism must keep the two questions separate:

- *may this page be linked and read?* → canonical **or** approved editorial reference;
- *may this page make a price claim?* → canonical only.

One predicate answering both is what created the coupling; the extension must not
recreate it.

---

## 2. Observed product-page defects — WP-3 and matcher-quality requirements

Observed on the live Juno-60 page. Recorded here so they are scheduled rather
than rediscovered.

### Trust and correctness

| # | Requirement |
|--:|---|
| **P1** | **Accessory and spare-part listings must not contaminate primary product listings, listing counts or price bands.** Accessory and parts listings are currently appearing as Juno-60 listings. This is the "parts pollution" class the Reverb FK join was migrated away from, reappearing through the matcher. It corrupts three things at once — the feed a visitor reads, the count shown on browse cards, and the band computed from those rows — so it is a trust defect first and a data defect second. Matcher-quality work, coordinated with WP-3's band. |
| **P2** | **Asking-price context replaces the excessively broad sold-price range.** The displayed range is too wide to support a decision. This is already the V1 design (§9): asking-price band from Klup's own matched listings, `n ≥ 8`, IQR-trimmed, p25–p75, with a 10× width gate. P1 is a precondition — a band computed over polluted rows will stay too broad however it is calculated. |
| **P3** | **Price charts require meaningful axes and explanation.** The chart currently has no legible axes and no statement of what it plots. An unlabelled chart of international sold prices next to a Danish asking-price band invites exactly the wrong reading. Axes, units, source and sample size, or the chart does not render. |

### Presentation

| # | Requirement |
|--:|---|
| **P4** | **Broken related-product images require fallback handling.** A related-product image is broken today. The product page already has a fallback chain (`hero_image_url ?? image_url ?? neutral asset`); related-product cards need the same, plus an `onError` fallback for a URL that resolves but fails to load. |
| **P5** | **Product and browse layouts require intrinsic responsive grids.** Desktop composition leaves roughly half the viewport unused. Related-product and content sections must use `auto-fit` / `minmax()` and container queries rather than fixed column counts and fixed breakpoints, so a section fills the space it is given instead of the space it was designed for. |

### Design references

| # | Requirement |
|--:|---|
| **P6** | **Factory is the design reference for `/intel`.** Dense, operator-facing, information-first. `/intel` stays admin-only and out of navigation. |
| **P7** | **Linear informs shared design-system discipline** — spacing scale, type scale, restraint, consistent interactive states. Discipline, not visual imitation. |
| **P8** | **Public product and browse pages retain a distinct editorial identity.** DM Serif Display headlines, Inter body, the sparse green accent rule. The catalogue is the argument; it must not read as a generic SaaS dashboard. |

---

## 3. Integration instruction for the next fresh context

**Integrate in this order, linearly, no merge commits:**

1. **WP-5** `d76a25b` — consent boundary first; WP-2 and WP-4 both consume `track()`.
2. **WP-2** `75574f8`
3. **WP-4** `6980129`

**Then STOP at the product-architecture checkpoint in §1. Do not start WP-3.**

### Registered integration points

| # | Point | Resolution |
|--:|---|---|
| 1 | Root `package.json` | Union every required test file exactly once; preserve all 33 scripts. Conflicts on each of WP-2 and WP-4. |
| 2 | `frontend/lib/route-access.ts` | Merges cleanly (verified). Retain `/privatliv`, `/family/[slug]`, `/api/search/resolve`; `/api/scrape` must remain **absent**. |
| 3 | Search index | Regenerate **after** WP-2 and WP-4 are both present: `frontend/scripts/build-search-index.ts`. Expected: **48 supported identities + 6 families**. Runtime eligibility stays authoritative; no private result may reach the client. |
| 4 | WP-4 analytics seam | Replace `useEmit()`'s body with WP-5 `track()`. **Keep the generic signature** `<E extends KlupEventName>(event: E, props: KlupEventMap[E])`. A cast — `as never`, `as any`, or a `Record<string, unknown>` wrapper — silently defeats the check that caught the taxonomy drift. |
| 5 | Family demand flow | Already implemented in WP-4. Verify: `demand=family:<slug>` renders confirmation, emits `search_unsupported` + `demand_signal_submitted` under granted consent, emits nothing under undecided/rejected, and never redirects to the originating family. |
| 6 | Tests | Supersede only documented pre-WP-2 assumptions. Do not weaken WP-1 eligibility or posture guards. |
| 7 | Authority | Correct §15.9: `/family/[slug]` is **`public_page_data_gated`**, not `public_page`. Record the final integration order and bounded resolutions. Retain the pre-release security package as R6-blocking. |

### Verified during the trial integration (not committed)

Cherry-picks applied cleanly in this order; only `package.json` conflicted.
`route-access.ts` merged with no conflict across all three. After index
regeneration the combined suite was **406/406 passing, 0 skipped**, frontend
`tsc` 0 errors, root typecheck 7 (baseline), lint 4 (baseline), production build
OK, and the full anonymous route sweep passed with 0 mismatches. The trial was
discarded; the integration itself is unperformed.

---

## 4. Remaining work after integration

1. **Product-architecture checkpoint** (§1) — four page modes. Blocks WP-3.
2. **WP-3** — server shell, `generateMetadata`, asking-price band, SEO, plus the
   mandatory conditions in build plan §15.8 (**M2** branded product-segment 404,
   **L7** no client-fetch soft-404 race) and defects **P1–P8** above.
3. **Pre-release security package** — R6-blocking, not built by any current
   package:
   - **S1** six `/api/admin/cleanup/**` routes must enforce admin in-route;
   - **S2** `/api/webhooks/auth` needs signature/secret verification with a
     constant-time comparison and safe output escaping;
   - **S3** an unset `CRON_SECRET` must fail closed **before** string comparison.
4. **Four `@r6-confirm` human confirmations** (build plan §12.4.5, §16.6 H) —
   each removed from the product if it cannot be confirmed:
   - `privatliv@klup.dk` actually receives mail;
   - PostHog EU project retention really is 12 months;
   - the Supabase project region is inside the EU;
   - the Vercel project region is inside the EU.
5. **N1–N4, N6** from §Status summary above — still non-blocking.

---

## 5. Operational state at this checkpoint

- `main` and `origin/main`: `703a117`. Not merged into, not deployed.
- `stage3/v1-integration` and its remote: `8e04ffd`. Unmoved.
- **The Vercel scrape cron remains DISABLED** at project level.
  `frontend/vercel.json` is byte-identical across `main` and every stage3 branch
  — WP-2's `_comment` was withdrawn after review, because a `vercel.json`
  property is a deployment input and Stage 3 changes none.
- No production deployment was created. Branch pushes may produce previews;
  none was promoted or aliased.
- Every production database access in this checkpoint was a `SELECT`.
