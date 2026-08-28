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
