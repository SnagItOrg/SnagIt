# Stage 3 — measurement and validation specification

**Status:** specification only. Nothing in this document is implemented.
**Written:** 2026-08-27, after activation (migrations 053–056 POST).
**Scope:** how Stage 3 decides whether the product-centred experience creates
real user value, using few users and high-signal behaviour.

**This document does not authorise any change.** It defines what to measure,
what evidence each decision requires, and what must be true before
instrumentation can be trusted. Implementation of the events, the middleware
change in §3.1, any schema change, any affiliate parameter and any production
write remain separately authorised work.

Read alongside:
- [`../CLAUDE.md`](../CLAUDE.md) — operating rules and the five-axis product-state model.
- [`klup-launch-catalogue-selection.md`](klup-launch-catalogue-selection.md) §11 — the supported-search contract this spec measures.
- [`klup-foundation-handover.md`](klup-foundation-handover.md) — activation record and the open operational items.

---

## 0. Executive summary

Klup has 48 supported products, 28 public products, and **14 that are both**.
Fourteen products is the entire surface on which a public, product-centred
measurement can be honest. Every metric in this spec therefore carries the
product's `support_state` and `browse_visibility` as event properties, so any
number can be re-read against "the real 14" rather than the nominal 48.

The measurement problem is not statistical power. It is that the current
instrumentation cannot answer a single Stage 3 question:

- there is **no `posthog.identify()` anywhere in the codebase**, so no
  person-level return, retention or activation metric is computable at all;
- there is **zero instrumentation on `/browse`, `/browse/[root]`,
  `/product/[slug]` and the landing carousels** — the entire product-centred
  journey Stage 3 is supposed to prove;
- the only outbound signal, `listing_clicked`, fires from a shared card
  component with **no product context**, so a click from a product page is
  indistinguishable from a click on a generic SERP;
- **no Thomann or affiliate outbound click is captured anywhere**, which is
  precisely the evidence the failed affiliate application needed;
- the onboarding funnel is in GA4 and the product funnel is in PostHog, so no
  single funnel spans acquisition to decision.

And one blocker outranks all of them: **anonymous users cannot reach a product
page** (§3.1). Until that is decided, the Stage 3 funnel measures a login wall.

The rest of this document assumes those are fixed. Where a metric depends on a
prerequisite, the prerequisite is named inline.

---

## 1. Primary product hypothesis

> **H1 (primary).** For a person who already wants a specific piece of used
> music equipment, a canonical Klup product page — one product identity, live
> listings from several markets, and an honest typical-used-price band — makes
> the *buy or skip* decision fast enough and confidently enough that they
> return to the product page instead of to a marketplace search box.

The hypothesis is about **decision confidence**, not about listing volume.
Klup will never have more listings than DBA. It can have a better answer to
"er 4.500 kr en god pris i dag?".

Three sub-hypotheses, each independently falsifiable:

| # | Sub-hypothesis | Falsified if |
|---|---|---|
| **H1a** | The price band is the thing that converts. A product page *with* a band produces materially more outbound listing clicks per view than one without. | Band-present and band-absent pages convert the same. Then the moat is listing aggregation, not price knowledge — a much weaker business. |
| **H1b** | Restricted search is a feature, not a wall. Being told "Klup follows this product / Klup does not follow this yet, here are the nearest ones" beats a generic result list. | Unsupported responses end the session, and supported responses do not out-convert the old generic SERP on decisions-per-session. |
| **H1c** | The product page is a destination, not a one-shot. People come back to the *same* product page without being emailed. | Zero unprompted product revisits across the whole cohort in 30 days. Then Klup is an alert service, and the product page is decoration. |

**Explicitly not being tested in Stage 3:** willingness to pay, catalogue
breadth, notification quality at scale, non-music verticals.

---

## 2. Activation event

Activation must be a *decision*, not a pageview or a signup. At this traffic
level a single vanity conversion would be indistinguishable from noise, so
activation is defined as a **conjunction** that is very hard to reach by
accident.

> **Activation = a person's first session containing a qualifying decision.**
>
> A **qualifying decision** is: a `product_viewed` on a product with
> `support_state = 'supported'`, followed in the same session by
> `price_context_shown` with `has_band = true`, followed by **either**
> `listing_click_out` on that product **or** `watch_created` with
> `origin_product_slug` equal to that product.

Notes on the definition:

- **It is a derived metric, not a written event.** Do not capture an
  `activated` event — a derived cohort in PostHog (or one HogQL query) is
  reproducible, correctable and cannot drift from the raw evidence.
- **Order matters.** The band must have been rendered *before* the commitment.
  A click that precedes any price context is counted as an outbound click but
  not as an activation — this is what makes H1a testable.
- **Band-absent decisions are tracked separately** as
  `decision_without_context`. The ratio of the two is the core H1a evidence.
- **The founder activates too, and that counts** — separately. See §14 on
  internal traffic: the founder is user zero, so founder activations are
  reported in their own column, never dropped and never mixed in.

Person property to set on first activation: `activated_at`,
`activation_product_slug`, `activation_kind` (`listing_click_out` | `watch_created`).

---

## 3. Core user journey

The journey Stage 3 must make work, expressed as the sequence the
instrumentation has to be able to reconstruct for a single person:

```
ENTRY          landing / · browse · direct product URL · alert email · external link
   ↓
DISCOVERY      carousel shelf (legendary | popular)   ← product-first
               browse root → browse leaf → product    ← navigation-first
               search → resolution → product          ← intent-first
   ↓
PRODUCT PAGE   identity (brand · model · era · tier)
               price context  (typical used band · median · n · Thomann new price)
               active listings (cross-market, price + source + age)
               depth (article · specs · history · related)
   ↓
DECISION       outbound listing click        → the buy intent
               watch created on this product → the "not yet, tell me" intent
               listing saved                 → the shortlist intent
   ↓
RETURN         unprompted revisit to the same product page
               alert email → click → product page
               saved list revisit
```

**Three entries, one destination.** Everything Stage 3 builds is judged on
whether it moves a person to the product page and whether the product page
resolves the decision.

### 3.1 Blocking prerequisite — the product page is login-walled

`frontend/middleware.ts:39-60`: `PUBLIC_PREFIXES` contains `/browse`,
`/search`, `/login`, `/signup`, `/auth/`, `/onboarding/`, and the exact paths
`/`, `/watchlists`, `/saved`. It does **not** contain `/product` or
`/api/product`. `isPublicPath('/product/roland-juno-106')` returns `false`, so
`frontend/middleware.ts:162` redirects unauthenticated visitors to `/login`.

Consequences, all verified in code:

1. The landing carousels (`frontend/app/page.tsx:113-156`) link to
   `/product/[slug]`. An anonymous visitor clicking the primary discovery
   element lands on `/login`.
2. `/browse` is public and its cards link to `/product/[slug]`
   (`frontend/components/ProductCard.tsx:32,62`). The public browse experience
   dead-ends at a login wall on every click.
3. `/api/product/[slug]` is likewise non-public, so even a client-side fetch
   from an anonymous context redirects.
4. A Thomann affiliate reviewer visiting klup.dk anonymously **cannot see a
   single product page**. This is a plausible direct contributor to the failed
   application (§13).

**Nothing downstream of "discovery" is measurable until this is decided.** It
is a product decision (public product pages vs. gated), not an analytics
decision, and it must be made before instrumentation ships — otherwise the
funnel measures the wall. The spec below assumes public product pages; if the
decision goes the other way, the funnel's second step becomes
`auth_completed` and every conversion number in §16 must be halved by
assumption, not by measurement.

### 3.2 Second prerequisite — identity

There is no `posthog.identify()` call in `frontend/`. Every event today is
attributed to an anonymous device id that resets on cookie clear and never
links across devices. `signup_completed` (`frontend/app/watchlists/page.tsx:39`)
cannot be joined to a Supabase user.

Until §12 identity rules ship, **all of §7 (repeat use) and §2 (activation) are
uncomputable**. This is the single highest-value instrumentation change in the
document and it is roughly ten lines of code.

---

## 4. North-star and guardrail metrics

### 4.1 North star

> **Weekly decision-supported outbound clicks (WDOC).**
> Count of `listing_click_out` events where the click was preceded in-session
> by `price_context_shown { has_band: true }` on the same supported product.
> Deduplicated per (person, product, day). Reported as an absolute integer
> with its denominator (distinct persons, distinct products) always visible.

Why this and not something else:

- It is the moment Klup produced value: someone decided, with price knowledge,
  to go get the thing.
- It is denominated in *people and products*, so it cannot be inflated by a
  single enthusiastic session.
- It is not revenue, and it is honest about that. Revenue proxies at 14 public
  products would be theatre.
- It degrades gracefully at N=1: "3 decisions, 2 people, 3 products, this week"
  is a legible sentence. A conversion percentage at N=6 is not.

**Reported alongside, never merged:** the same count for the founder cohort
(`is_internal = true, internal_role = 'founder'`). Klup's stated first job is
finding the founder good deals; suppressing that number would hide the only
signal that exists in week 1.

### 4.2 Guardrails

A guardrail breach blocks expansion even if the north star is rising.

| # | Guardrail | Definition | Threshold |
|---|---|---|---|
| G1 | **False navigation** | `search_resolved { auto_navigated: true }` on a query listed as a dangerous alias in the supported-search contract (selection doc §11). | **Exactly 0.** Any occurrence is a P0 correctness bug, not a metric. |
| G2 | **Dead product page** | Share of `product_viewed` on supported products where `active_listing_count = 0`. | < 35 % in month 1, < 25 % by month 3. Above that the page cannot answer the question it exists to answer. |
| G3 | **Dishonest band** | Share of `price_context_shown { has_band: true }` where `band_width_ratio = band_high / band_low > 10`. | < 10 %. A 100× band mixing three products (see `arp-2600`, `oberheim-ob-x` in the selection doc) is worse than no band. |
| G4 | **Thin band** | Share of bands with `band_count < 5`. | < 25 %, and every such band must be visually marked as provisional. |
| G5 | **Stale outbound** | Share of sampled outbound listing URLs that 404 or show a sold/expired state. Measured by a periodic server-side liveness sample of the last 50 clicked listings — never client-side. | < 15 %. |
| G6 | **Alert noise** | Alert emails per notified person per week; `notification_pref_changed { field: 'new_listings', value: false }` count. | < 5 emails/person/week; any opt-out is reviewed individually at this N. |
| G7 | **Search latency** | p75 `search_resolved.latency_ms`. Today `/search` runs a live multi-marketplace scrape (`frontend/app/api/scrape/route.ts`), which is seconds, not milliseconds. Restricted search over 48 products should be a lookup. | p75 < 800 ms once restricted search ships. |
| G8 | **Product page speed** | LCP on `/product/[slug]`, from the already-installed Vercel Speed Insights. | p75 LCP < 2.5 s. |
| G9 | **Scope leakage** | Share of `product_viewed` where `support_state != 'supported'` or `browse_visibility != 'public'`. `/api/product/[slug]` applies **no visibility gate** — any slug renders. | Tracked, not capped. If it is large, discovery is leaking users to pages the matcher cannot maintain. |
| G10 | **Silent unsupported loss** | Share of `search_unsupported` events with no `demand_signal_submitted` and no subsequent `product_viewed` in-session. | Tracked from day 1. This is the demand Klup is throwing away. |

---

## 5. Funnel: landing → product discovery → outbound listing click

One canonical funnel, six steps, session-scoped, sliced by entry path.

| Step | Event | Drop-off means |
|---|---|---|
| 1. Entry | `$pageview` (first in session) | — |
| 2. Discovery engaged | `discovery_product_clicked` ∪ `browse_category_clicked` ∪ `search_submitted` | Landing does not communicate what Klup is. Qualitative prompt Q-1. |
| 3. Product reached | `product_viewed` | Discovery promises something the catalogue cannot deliver, **or** the login wall (§3.1). |
| 4. Context rendered | `price_context_shown` | Not a user drop-off — a **data** drop-off. Split by `has_band`. This step measures the catalogue, not the person. |
| 5. Supply present | `product_viewed { active_listing_count > 0 }` | Monitoring coverage gap. Note only 14 of 48 supported products are also monitored-and-public. |
| 6. Decision | `listing_click_out` ∪ `watch_created` ∪ `listing_saved` | The page failed to resolve the decision. This is the H1 test. |

**Three parallel reads of the same funnel**, because the three entry paths test
different things:

- `entry_ref = 'shelf'` — product-first discovery (does curation work?)
- `entry_ref = 'browse'` — navigation-first (does the family/variant taxonomy work?)
- `entry_ref = 'search'` — intent-first (does the restricted-search contract work?)

**Presentation rule at low N:** every funnel step is shown as
`count (distinct persons)`. Percentages are suppressed below 20 persons at the
step's denominator. A "17 % conversion" from 6 sessions is a lie with a
decimal point.

---

## 6. Repeat use and return signals

All of §6 is blocked on §3.2 (identity).

| Signal | Definition | Why it matters |
|---|---|---|
| **Unprompted return** | A person's session ≥ 6 h after their previous session, with no `alert_email_clicked` and no `utm_source` in the entry URL. | The purest H1c evidence. One unprompted return is worth more than fifty pageviews. |
| **Product revisit** | ≥ 2 `product_viewed` for the same `product_slug` by the same person in ≥ 2 distinct sessions. | Product page as destination. This is the single behaviour that distinguishes Klup from a search engine. |
| **Return latency** | Hours between consecutive sessions, per person, as a raw list. | At N < 30, the distribution *is* the metric. Do not bucket into D1/D7/D30 yet — the buckets will all read zero and hide the shape. |
| **Weekly returning persons** | Distinct non-internal persons with ≥ 2 sessions in a 7-day window. | The headline retention integer. Target in §17. |
| **Alert-driven return** | `alert_email_clicked` → session. | Real, but a *different* product. Reported separately, never merged into unprompted return. Currently unmeasurable: see below. |
| **Saved-list revisit** | `$pageview` on `/saved` in a session after the one where the save happened. | Shortlist behaviour — the weakest of the three commitment signals but the cheapest to observe. |
| **Founder loop** | Founder sessions per week + founder qualifying decisions per week. | Klup's stated first job. Tracked from day 1 in its own column. |

**Constraint on alert-driven return:** the alert email path
(`frontend/app/api/cron/scrape/route.ts` → `sendNewListingsEmail`) runs on the
Vercel cron that the handover records as **disabled pending ingestion-path
unification** (handover follow-up #3). Until that is resolved, the alert loop
cannot be measured because it does not fire. Do not design a 30-day protocol
around it. Measure watch *creation* as an intent signal instead, and treat
alert delivery as a Later-instrumentation item (§19).

---

## 7. Favourite / watch / notification signals available today

Precise inventory of what exists, because two of the three are weaker than
they look.

| Capability | Exists? | Where | Measurement limitation |
|---|---|---|---|
| **Saved listing** ("Gem", heart) | Yes | `frontend/app/api/saved-listings/route.ts`; heart in `SearchResultCard.tsx:142-150,223-231,386-396` | Captures `listing_saved { listing_id, source }` only on the *first* save from the heart. Not captured on the product page path, not captured on unsave, and carries **no product context**. |
| **Watchlist** ("Tilføj til watchlist", bell) | Yes | `frontend/app/api/watchlists/route.ts` | **Free-text query, not product-bound.** `watchlists` has `query`, `type`, `source_url`, `min_price`, `max_price` — no `product_id`. A watch created from `/product/roland-juno-106` stores the string "Roland Juno-106" and is indistinguishable from one typed on `/search`. Its initial scrape is **DBA-only** (`route.ts:34`). |
| **Watch created event** | Partially | `frontend/app/search/page.tsx:182` | Fires on `/search` only. The identical flow on `/product/[slug]:123-134` and `/saved` captures **nothing**. |
| **Notification preferences** | Yes | `frontend/app/api/notification-preferences/route.ts` — `email_enabled`, `push_enabled`, `price_drops`, `new_listings` | No UI event on change. `push_enabled` defaults false and there is no push implementation. |
| **Alert email** | Yes, but dormant | `frontend/lib/email.ts` via the cron | Cron disabled (§6). No send/open/click instrumentation. No per-email identifier. |
| **Price-drop alert** | Preference flag only | — | `price_drops` is stored but nothing acts on it. Do not report it as a capability. |

**The cheap bridge.** Binding watchlists to products is a schema change and is
out of Stage 3's authorised scope. But the *event* can carry what the row
cannot: capture `watch_created { origin_surface, origin_product_slug }` at the
call site. That recovers product-bound watch intent for measurement without
touching the database, and it is the only way §2's activation definition can
count watches. Product-binding the row itself is a Later item (§19).

---

## 8. Product-page quality metrics

The frozen 48 have deliberately uneven content: 3 articles, 29 images, 5 with
no image at all. That unevenness is not a defect for measurement — it is a
**natural experiment** that works at low traffic (§15, E-2).

Per-page metrics, all sliced by the completeness properties carried on
`product_viewed`:

| Metric | Definition |
|---|---|
| **Decision rate** | Qualifying decisions ÷ product views, per product. The primary page-quality number. |
| **Context coverage** | Share of views where `has_band = true`. Reported per product and catalogue-wide. |
| **Band quality** | `band_count` (n of sales) and `band_width_ratio` distributions, per product. |
| **Supply density** | `active_listing_count` at view time, per product, over time. |
| **Depth engagement** | Share of views reaching the specs/history/related region (scroll-depth marker — Later, §19). |
| **Related-product traversal** | `discovery_product_clicked { shelf: 'related' }` ÷ views with `related_count > 0`. Tests whether family navigation works at the page level. |
| **Content-gap delta** | Decision rate on pages with an article vs. without; with a hero image vs. without; with a band vs. without. Three 2-way comparisons across the 14 public-and-supported pages. |
| **Zero-value view** | Views with `active_listing_count = 0` **and** `has_band = false`. A page that answers nothing. This count should approach zero before any expansion. |

**Product-quality scorecard**, refreshed weekly, one row per public-and-supported
product: `slug · views · decisions · has_band · band_count · band_width_ratio ·
active_listings · has_image · has_article`. At 14 rows this is read directly,
not charted.

---

## 9. Browse vs. restricted search — success metrics

These are different capabilities with different failure modes. Never combine
them into one "discovery conversion".

### Browse (navigation-first)

| Metric | Success looks like |
|---|---|
| Steps to first `product_viewed` | Median ≤ 2 (root → leaf → product). |
| Leaf abandonment | Share of `browse_leaf_viewed` with no subsequent product click. Below 60 %. |
| Category dispersion | Distinct root categories entered per person. If everyone enters one category, browse is a synonym for that category and the taxonomy is not earning its keep. |
| Family traversal | Share of product views arriving via a navigation family rather than a direct leaf card. Tests the family-vs-variant model from CLAUDE.md §9 — families group, never aggregate. |
| Browse-originated decision rate | Qualifying decisions ÷ browse-originated product views. |

### Restricted search (intent-first)

Measured directly against the supported-search contract
(selection doc §11). Every search produces exactly one `search_resolved`
carrying a `resolution` value drawn from the contract's own vocabulary:

| `resolution` | Contract behaviour | Success metric |
|---|---|---|
| `canonical_exact` | Navigate directly to the product page | **Resolution rate** — share of all searches ending on a supported product page. |
| `accepted_alias` | Navigate directly | Included in resolution rate. |
| `disambiguation` | Show the candidate set, never pick | **Disambiguation recovery** — share of disambiguation screens where a candidate is selected within the session. Below 50 % means the labels are not doing their job. |
| `dangerous_alias_blocked` | Never auto-navigate; show the set | Count must be > 0 (the guard is working) and G1 must be 0 (it never auto-navigated). |
| `unsupported` | "Klup følger ikke dette produkt endnu" + nearest supported products | **Recovery rate** — share where the user then views a suggested product, **plus** demand capture rate (§10). |
| `error` | — | Must be near zero. |

**The comparison that matters** is not browse-vs-search in the abstract. It is:
*decisions per session, by entry path*. If browse produces more decisions per
session than search, the search box should be de-emphasised on the landing
page — which is exactly the opposite of the current design
(`frontend/app/page.tsx:64-94` gives the search box the hero position, with
carousels below the fold).

---

## 10. No-result and unsupported-demand measurement

Today an unsupported query on `/search` runs a live multi-marketplace scrape
and returns whatever it finds, or an empty state (`frontend/app/search/page.tsx:374-385`)
with **no event and no record**. The selection doc §11 states plainly: a demand
signal "will be recorded when that capability is implemented; it does not
exist today."

**V1 requirement.** Every non-resolving search emits `search_unsupported` with:

- `query_norm` — case-folded, diacritics stripped, `-`/space/nothing collapsed
  inside model numbers, whitespace collapsed. Exactly the contract's own
  normalisation, so the demand log and the matcher speak the same language.
- `raw_token_count`, `suggested_slugs`, `suggested_count`, `nearest_distance`
- `resolution_class` — `unsupported` | `ambiguous` | `dangerous_alias_blocked` | `zero_results_supported`

**Store of record.** PostHog is the store of record for demand signals in V1.
A dedicated `demand_signal` table is a schema change and therefore a Later item
(§19) — but PostHog EU retention is finite, so the weekly export in §16 is
**mandatory**, not optional: the top-50 normalised unsupported terms with
distinct-person counts, exported to `data/` weekly. Losing this log loses the
only evidence that can justify expanding past 48.

**Active demand capture.** The passive log records what people typed. It does
not record what they *wanted enough to ask for*. Add a single control on the
unsupported screen — "Giv besked når Klup følger dette" — emitting
`demand_signal_submitted { query_norm, capture_method, has_email }`.
**Never send the email address to PostHog** (see §12); `has_email` is a boolean
and the address goes to Supabase.

Demand is reported three ways, and only the third can justify expansion:

1. **Volume** — total unsupported searches. Weakest; one person can inflate it.
2. **Breadth** — distinct persons per normalised term.
3. **Intensity** — `demand_signal_submitted` per term. Someone who leaves an
   address for a product Klup does not have is the strongest demand evidence
   available at this traffic level.

---

## 11. Price-context engagement

Price context is Klup's claimed moat. It has never been measured.

What exists (`frontend/app/api/product/[slug]/route.ts:116-136`,
`frontend/app/product/[slug]/page.tsx:228-341`):

- **Typical used band** — IQR-filtered min/max/median over Reverb + Auctionet
  sold prices, rendered only when ≥ 3 prices survive the filter.
- **Price history chart** — rendered only when ≥ 5 points exist.
- **Thomann new price** — rendered when `thomann_price_dkk` and `thomann_url`
  are both present.
- **Fallback copy** — "Ikke nok prisdata til at beregne typisk pris endnu."

V1 captures one event per product view, `price_context_shown`, carrying
`has_band`, `band_low`, `band_high`, `band_median`, `band_count`,
`band_width_ratio`, `history_points`, `has_thomann_reference`,
`thomann_price_dkk`. It fires on render, including when `has_band = false` —
the absence is the more interesting case.

Derived measures:

| Measure | Question it answers |
|---|---|
| **Band-conditioned decision lift** | Decision rate with band ÷ decision rate without band, over the same product set where possible. **This is the H1a test.** |
| **Band-relative click position** | On every `listing_click_out`, `band_delta_pct` = listing price vs. band median. Are people clicking *below* the band (bargain-hunting) or across it (browsing)? A tight below-band concentration is the strongest possible evidence that the band is being used as a decision tool. |
| **Fallback exposure** | Count of views hitting "Ikke nok prisdata". Feeds G2/G4 and the expansion gate. |
| **History depth** | `history_points` distribution across public-and-supported products. |
| **Thomann anchor exposure** | Views with `has_thomann_reference = true` — the denominator for §12's affiliate evidence. |

Chart interaction (hover, range selection) is a **Later** item. At 14 pages the
binary "was a band present, and did a decision follow" carries almost all of
the signal, and hover events are noisy on touch devices.

---

## 12. Affiliate outbound tracking

**Nothing exists.** A repository-wide search finds no affiliate parameter, no
redirect route, and no capture on either Thomann link — the product-page hero
link (`frontend/app/product/[slug]/page.tsx:251-264`) and the listing-card link
(`frontend/components/SearchResultCard.tsx:319-330`) are plain anchors.
Thomann results in `/search` come from `scrapeThomannSearch` with the raw
product URL (`frontend/app/api/scrape/route.ts:178-194`).

**V1 (client-side, no infrastructure).**

`outbound_retail_click` fires on every retail-destination click:

```
destination        'thomann'            // enum, extensible
placement          'product_hero' | 'listing_card' | 'saved_card' | 'search_card'
product_slug       string | null
thomann_price_dkk  number | null
click_id           uuid v4, generated at click time
affiliate_tagged   boolean              // false until a programme exists
```

`click_id` is generated even without an affiliate programme. When a programme
is approved, the same id becomes the reconciliation key between Klup's click
log and the network's report, and 30 days of pre-programme clicks become a
credible traffic-quality argument.

**V1.5 (needs one route — separately authorised).** Route retail links through
`/go/[destination]?slug=…&placement=…&click_id=…` which 302s to the tagged
destination. This makes outbound clicks server-observable (immune to ad
blockers, which disproportionately affect exactly the technically-literate
music-gear audience Klup targets) and puts the affiliate parameter in one place
instead of scattered across three components.

**Marketplace outbound** (DBA, Finn, Blocket, Kleinanzeigen, Reverb) is
**not** affiliate traffic and is never counted as such. It is captured as
`listing_click_out` and reported separately. Conflating the two would
misrepresent Klup to an affiliate partner — the exact failure mode that already
cost one application.

---

## 13. Instrumentation required on each major UI surface

`R` = required for V1. `L` = later (§19).

### `/` — landing (`app/page.tsx`)
Anonymous-only; authenticated users are redirected to `/watchlists`
(`middleware.ts:105`), so this page's audience is *new visitors only*. That
makes it the cleanest first-impression measurement in the product.

| Instrumentation | Tier |
|---|---|
| Sanitised `$pageview` | R |
| `discovery_product_clicked { shelf: 'legendary'\|'popular', product_slug, position, has_image, active_listing_count }` | R |
| `search_submitted { entry_surface: 'landing' }` on the hero form | R |
| `discovery_impression` — which shelf items were rendered and seen | L |
| Hero-vs-carousel first-interaction split | R (derivable from the two events above) |

### `/browse` and `/browse/[root]`
Currently zero instrumentation.

| Instrumentation | Tier |
|---|---|
| `browse_category_clicked { root_slug, position, product_count }` | R |
| `browse_leaf_viewed { root_slug, page, total_public_products, rendered_count, subcategory_count }` | R |
| `discovery_product_clicked { shelf: 'browse_grid', … }` | R |
| Pagination usage (`page > 1`) — page size is 48, so at 28 public products this should never fire; if it does, the projection is wrong | R |
| Subcategory-level engagement, filter usage | L |
| Debug-mode views must be excluded (`?debug=1` is admin-only) | R |

### `/search`
Today: generic live-scrape SERP. Stage 3 replaces it with the restricted
contract. Instrument the contract, not the current implementation.

| Instrumentation | Tier |
|---|---|
| `search_submitted { query_norm, query_length, token_count, entry_surface, input_method }` | R |
| `search_resolved { query_norm, resolution, candidate_count, product_slug, latency_ms, auto_navigated }` | R |
| `search_unsupported { … }` (§10) | R |
| `demand_signal_submitted { … }` (§10) | R |
| `search_failed { query_norm, error_kind, latency_ms }` | R |
| `search_disambiguation_selected { query_norm, product_slug, position, candidate_count }` | L |
| Retire `search_performed` at schema v2 with a documented mapping (§18) | R |
| Source-toggle and sort usage — these controls belong to the generic SERP and may not survive Stage 3 | L |

### `/product/[slug]`
The most important surface. Currently zero product-level instrumentation.

| Instrumentation | Tier |
|---|---|
| `product_viewed { … full property set, §18 }` | R |
| `price_context_shown { … }` | R |
| `listing_click_out { …, product_slug, band_delta_pct }` — the shared card must receive product context | R |
| `outbound_retail_click { placement: 'product_hero' }` | R |
| `watch_created { origin_surface: 'product', origin_product_slug }` | R |
| `listing_saved { …, product_slug }` | R |
| `discovery_product_clicked { shelf: 'related' }` | R |
| `product_external_link_clicked`, scroll-depth markers, chart interaction | L |
| Not-found renders (`notFound` state) — a broken link into the catalogue | R |

### `/saved`
| Instrumentation | Tier |
|---|---|
| Sanitised `$pageview` (feeds saved-list revisit, §6) | R |
| `listing_click_out { surface: 'saved' }` | R |
| `listing_unsaved`, save-list size on view | L |

### `/watchlists`
| Instrumentation | Tier |
|---|---|
| `signup_completed` — already present, add `days_since_first_seen`, `first_product_slug` | R |
| `watch_created` / `watch_deleted` from this surface | R / L |
| New-listing badge engagement (`new_count` → click) | L |

### `/onboarding/step1-4`
Currently GA4-only (`lib/onboarding.ts:43-47`). Split-brain: the acquisition
funnel and the product funnel live in different tools and cannot be joined.

| Instrumentation | Tier |
|---|---|
| Mirror `onboarding_step1/2/3` and `onboarding_complete` into PostHog with identical properties | R |
| Retain GA4 sends for historical continuity | R |
| Retire GA4 duplication once ≥ 30 days of parallel data exists | L |

### Auth
| Instrumentation | Tier |
|---|---|
| `auth_completed { method, is_new_user, entry_surface }` | R |
| `posthog.identify()` + `posthog.reset()` (§12/§14) | R |
| `auth_started { trigger }` — including the inline email capture on listing cards (`SearchResultCard.tsx:152-173`) | L |

### Email
| Instrumentation | Tier |
|---|---|
| `?utm_source=klup_alert&klup_click_id=…` on alert links; captured on landing | L (cron dormant, §6) |
| Server-side `alert_email_sent` | L |

### Admin / `/intel`
| Instrumentation | Tier |
|---|---|
| **Emit no product events.** These surfaces must not appear in any funnel. | R |

---

## 14. Event names, properties and identity rules

### 14.1 Naming

- `snake_case`, `object_verb_past_tense` (`product_viewed`, not `view_product`).
- Enumerated string properties, never free-text, except `query_norm`.
- Prices are numeric; currency is always a separate property. Never a
  formatted string. This mirrors the repository rule: store raw `price` +
  `currency`, convert at read time.
- Every product event carries `product_slug`, never only `product_id` — slugs
  are readable in the raw event stream, which matters enormously when the
  weekly review is *reading sessions* rather than charts.

### 14.2 Schema versioning

Set a global super-property `klup_schema_version = 2` on init. The five legacy
events (`search_performed`, `listing_clicked`, `listing_saved`,
`watchlist_created`, `signup_completed`) predate this spec and carry
incompatible property sets. Version 2 lets every query exclude pre-Stage-3
data cleanly instead of silently averaging two different definitions.

Mapping at the v1→v2 boundary:

| v1 event | v2 |
|---|---|
| `search_performed` | → `search_submitted` + `search_resolved` (split; the old event conflated intent and outcome) |
| `listing_clicked` | → `listing_click_out` (renamed; gains `product_slug`, `band_delta_pct`, `click_id`) |
| `listing_saved` | retained, name unchanged, properties extended |
| `watchlist_created` | → `watch_created` (renamed; gains `origin_product_slug`) |
| `signup_completed` | retained, name unchanged, properties extended |

### 14.3 Global super-properties (every event)

```
klup_schema_version   2
app_env               'production' | 'preview' | 'development'
surface               'landing' | 'browse_root' | 'browse_leaf' | 'search'
                      | 'product' | 'saved' | 'watchlists' | 'onboarding' | 'auth'
locale                'da' | 'en'
is_internal           boolean
internal_role         'founder' | 'admin' | null
```

### 14.4 Person properties

```
supabase_user_id      uuid          // set once, on identify
signup_at             iso timestamp
is_internal           boolean
internal_role         'founder' | 'admin' | null
locale_pref           'da' | 'en'
first_seen_surface    string        // $set_once
first_product_slug    string        // $set_once — which product brought them in
activated_at          iso timestamp // $set_once
activation_product_slug  string     // $set_once
activation_kind       'listing_click_out' | 'watch_created'
```

### 14.5 Identity rules

1. **Anonymous first.** PostHog's anonymous distinct id is the identity until
   authentication. Do not force login to measure.
2. **`posthog.identify(user.id)` on every authenticated session start** —
   after `supabase.auth.getUser()` resolves, not only on signup. Use the
   Supabase `user.id` UUID.
3. **Never send an email address to PostHog.** Not as distinct id, not as a
   person property, not in an event property, not embedded in a URL. Email is
   PII, the repository rule is "never log PII", and PostHog is a third-party
   processor. Capture `has_email: true` instead.
4. **`posthog.reset()` on sign-out.** Without it, a shared or handed-over
   browser merges two people into one — catastrophic at N=15.
5. **Cross-device is not solved and is not pretended to be.** A person who
   browses on mobile and buys on desktop appears as two persons unless both
   sessions authenticate. State this limitation next to every retention number.
6. **Sanitise `$current_url`.** `PostHogPageView.tsx:14` appends the full query
   string, so raw user search text lands in `$current_url` on every pageview.
   Strip `q` (and any future free-text param), and send normalised query text
   only as an explicit `query_norm` property on search events.
7. **Confirm the EU host.** `PostHogProvider.tsx:10` defaults to
   `https://app.posthog.com` (US) when `NEXT_PUBLIC_POSTHOG_HOST` is unset.
   The engineering record states PostHog **EU** cloud. Verify the production
   env var is `https://eu.i.posthog.com` before any of this ships — a silent
   fallback to the US region is a GDPR problem, not an analytics problem.
8. **One PostHog project.** Separate environments by the `app_env`
   super-property, not by project, so a person moving between preview and
   production is not split.

---

## 15. Bot and internal-traffic exclusion

At 15 users, one uncontrolled crawler destroys every number in this document.

| Rule | Mechanism |
|---|---|
| **Known bots** | PostHog's default user-agent blocklist. Leave `opt_out_useragent_filter` at its default (blocking). Verify after any SDK upgrade. |
| **Non-production** | Do not initialise PostHog when `NEXT_PUBLIC_VERCEL_ENV !== 'production'`. Preview deployments currently emit into the same project as production. |
| **Founder and admin** | `is_internal` / `internal_role` person properties, set from `user_preferences.is_admin` and an explicit founder user id. **Tagged, never dropped** — the founder is user zero and their behaviour is the first evidence Klup has. |
| **Founder's anonymous browsing** | A `?klup_internal=1` URL param that writes a persistent localStorage flag, so pre-login and logged-out founder sessions are also tagged. |
| **Admin surfaces** | `/admin` and `/intel` emit no product events at all (§13). |
| **Debug traffic** | Views with `?debug=1` are admin-only and excluded from browse metrics. |
| **Self-referred QA** | A documented convention: any deliberate testing session is opened with `?klup_internal=1`. Cheap, and it works. |
| **Datacentre / headless** | Not solvable client-side and not worth solving at this scale. Instead, apply a **plausibility filter** in analysis: exclude sessions with > 40 events in < 60 s, or > 25 distinct product views in one session. Log what was excluded — never silently. |
| **Uptime / synthetic monitors** | Do not run JS, so they do not reach PostHog. They *do* reach Vercel Analytics — do not use Vercel Analytics for behavioural conclusions. |

**Every reported figure states its exclusions.** The standard footer for all
reporting is: `external persons: N · founder sessions: N · admin sessions
excluded: N · plausibility-filtered: N`.

---

## 16. Minimum viable dashboard

One page. Nine tiles. Weekly cadence. Absolute integers with denominators.
**No percentage is displayed where the denominator is below 20.**

| # | Tile | Form |
|---|---|---|
| 1 | **North star** | WDOC this week vs. last 4 weeks. Sparkline + integer. Two series: external, founder. |
| 2 | **Activation ledger** | One row per external person: first seen · sessions · products viewed · activated (y/n) · activation product. At N ≤ 30 this table beats any funnel chart. |
| 3 | **Journey funnel** | The six steps of §5, as counts, split by the three entry paths. |
| 4 | **Product scorecard** | 14 rows (public-and-supported): slug · views · decisions · band? · band_count · band_width_ratio · active_listings · has_image · has_article. |
| 5 | **Price-context lift** | Decisions per view, band-present vs. band-absent. Two integers and their denominators. **The H1a readout.** |
| 6 | **Search resolution mix** | Stacked count of `search_resolved.resolution` values. G1 (dangerous auto-navigations) shown as a standalone red integer that must read 0. |
| 7 | **Unsupported demand** | Top 20 `query_norm` by *distinct persons*, with the demand-capture count beside each. |
| 8 | **Return ledger** | One row per person with ≥ 2 sessions: gap in hours · prompted/unprompted · product revisited. |
| 9 | **Guardrails** | G1–G10 as a red/amber/green strip with the raw number, never a percentage alone. |

**Two non-dashboard practices that matter more than the dashboard at this scale:**

- **Weekly session reading.** Enable PostHog session replay for non-internal
  production sessions with input masking on, and watch every external session
  end-to-end for the first four weeks. At 15 users this is under an hour a week
  and will produce more insight than all nine tiles combined.
- **Weekly raw export.** The unsupported-demand top-50 (§10) and the activation
  ledger, exported to `data/` every Monday. PostHog retention is finite; the
  expansion decision in §21 depends on this log existing months from now.

---

## 17. Qualitative research prompts

Five to eight interviews, 30 minutes, recruited from the external cohort. The
sample is too small for statistics and exactly right for finding out *why*.

**Before showing Klup:**

- Q-1. Walk me through the last time you bought used music gear. Start from the
  moment you decided you wanted it.
- Q-2. How did you decide the price was fair? What did you actually check?
- Q-3. What did you do when you were not ready to buy yet but did not want to
  lose track of it?
- Q-4. Has a deal ever got away from you? What happened?

**While using Klup (observed, thinking aloud, no guidance):**

- Q-5. Find out whether 4.500 kr is a good price for a Roland Juno-106.
  *(Watch: do they use the band, or scroll straight past it to the listings?)*
- Q-6. Search for something you own. *(Watch the unsupported response. Does the
  message read as curation or as brokenness?)*
- Q-7. Show me the point on this page where you decided. What made you decide?
- Q-8. What does this page tell you that DBA does not?

**After:**

- Q-9. How disappointed would you be if Klup disappeared tomorrow — very,
  somewhat, or not at all? Why? *(Sean Ellis framing, read directionally only
  at this N. Never quote a percentage.)*
- Q-10. What is missing that would make you come back next week?
- Q-11. If Klup only ever covered 48 products, does it stop being useful to
  you? *(Directly tests the expansion question in §21.)*

**Founder self-log protocol** (daily, five minutes, structured — this is the
highest-signal qualitative instrument Klup has in month one):

```
date · product · did Klup surface it first? (y/n) · would I have found it otherwise? (y/n/unsure)
minutes spent vs. the old manual routine · acted? (y/n) · outcome
what Klup should have told me and did not
```

---

## 18. Experiments meaningful at very low traffic

**Standing rule: no split test until ≥ 300 qualifying sessions per week.**
Below that, an A/B test cannot separate a real effect from a coin flip, and
running one produces a confident wrong answer — worse than no answer.

Use these instead:

| # | Design | Question | Why it works at low N |
|---|---|---|---|
| **E-1** | **Founder ground truth.** 14 days of the current manual routine logged, then 14 days using Klup. Compare deals found and minutes spent. | Does Klup beat the founder's own process? | N=1 by design, and that N is the customer. Within-subject, so individual variation is controlled. |
| **E-2** | **Content-gap natural experiment.** The 48 already differ: 3 articles, 29 images, 5 with none. Compare decision rate across these existing strata. | Which page assets actually change decisions? | The variation already exists — no experiment to run, only analysis. Confounded (better products got better assets first), so it is directional evidence that *ranks hypotheses*, not proof. |
| **E-3** | **Switchback by week.** Alternate one high-salience change weekly (e.g. price band above vs. below the listing block), holding everything else fixed, with a written change log. | Does placement change decisions? | Every person sees both variants across weeks. Sensitive to seasonality — never run across a holiday, and never run two switchbacks at once. |
| **E-4** | **Painted door.** Ship the "notify me when Klup follows this" control on the unsupported screen before any expansion capability exists. Measure `demand_signal_submitted`. | Is unsupported demand real or idle curiosity? | Intent-to-leave-contact is a strong signal at any N. Requires honest follow-up: everyone who leaves an address gets told what actually happened. |
| **E-5** | **Five-user task test.** Q-5/Q-6 above, scored binary (task completed unaided: y/n). | Is the experience usable? | Nielsen's rule: 5 users surface ~85 % of usability problems. Binary success needs no statistics. |
| **E-6** | **Pre/post with a frozen change log.** One change per week, dated, everything else held constant. | Did that change move the north star? | Weak causally, but honest if the log is kept and the confound is stated. Requires discipline: one change per week, no exceptions. |
| **E-7** | **Cohort-by-entry comparison.** Compare decisions-per-session across the three entry paths (§5). | Which discovery mode earns the landing page's hero slot? | Naturally occurring, no assignment needed, directly actionable. |
| **E-8** | **Band-presence quasi-experiment.** Compare decision rate on the same product before and after a band appears (bands appear as price history accumulates). | Does price context cause decisions, or do good products just have both? | Within-product, so product quality is controlled. The cleanest H1a evidence available without an assignment mechanism. |

**Never do, at this traffic:** multivariate tests · concurrent experiments ·
stopping a test when it "looks significant" · quoting a p-value from fewer than
100 conversions per arm · declaring a winner from one week of data.

---

## 19. Instrumentation tiers

### 19.1 Tier 1 — required for V1

Ordered by value per unit of effort.

1. **`posthog.identify()` / `reset()`** — unblocks §2, §6 and half the
   dashboard. Roughly ten lines.
2. **`product_viewed` + `price_context_shown`** — the two events that make the
   product page measurable at all.
3. **`listing_click_out` with product context** — the north star's raw input.
4. **`search_submitted` + `search_resolved` + `search_unsupported`** — the
   supported-search contract's own vocabulary.
5. **`outbound_retail_click` with `click_id`** — starts accruing Thomann
   evidence from day one.
6. **`discovery_product_clicked` + `browse_category_clicked` + `browse_leaf_viewed`**
   — closes the discovery blind spot.
7. **`watch_created` with `origin_product_slug`** — recovers product-bound
   watch intent without a schema change.
8. **`listing_saved` extended with `product_slug` and `surface`.**
9. **Global super-properties + person properties** (§14.3, §14.4).
10. **Internal/bot exclusion** (§15).
11. **`$current_url` sanitisation** and **EU host verification** (§14.5).
12. **Onboarding events mirrored into PostHog** (§13).
13. **`search_failed`** and the product-page not-found render.

### 19.2 Tier 2 — useful later

- Impression events (`discovery_impression`, `listing_impression`) and
  viewport-based visibility.
- Scroll-depth markers on `/product/[slug]` for article and specs engagement.
- Price-chart interaction (hover, range).
- `search_disambiguation_selected`, `listing_unsaved`, `watch_deleted`,
  `notification_pref_changed`, `product_external_link_clicked`, `auth_started`.
- **Server-side outbound redirect** `/go/[destination]` — ad-blocker-immune
  outbound truth and a single place for affiliate parameters (§12).
- **Alert email instrumentation** — send, open, click, with `klup_click_id`.
  Blocked on the cron being unified and re-enabled.
- **`demand_signal` database table** — durable server-side demand log to
  replace PostHog-as-store-of-record.
- **Product-bound watchlists** — `watchlists.product_id`, converting watch
  intent from a string into a real product relationship.
- **Listing liveness sampler** for G5.
- **A/B assignment infrastructure** — only after §18's 300-session threshold.
- **Retire GA4** once 30 days of parallel PostHog onboarding data exists.

### 19.3 Experiments possible immediately

E-1 (founder ground truth), E-2 (content-gap analysis), E-5 (five-user task
test) and the §17 interviews need **no instrumentation at all** and can start
this week. E-4 (painted door) needs one control and one event. E-7 and E-8 need
Tier 1 only.

### 19.4 Decisions that cannot yet be answered quantitatively

State these as open, and do not let a chart pretend otherwise:

1. **Family vs. variant navigation labels.** Whether `Fender Stratocaster`
   should be a navigation node at all is a taxonomy judgement. With 14 public
   products there is no traffic to decide it. Interview evidence (Q-8, Q-11)
   only.
2. **Evocative facets** (`The Time Machines`, `The Workhorses`). Editorial
   identity. Test qualitatively; never let click data promote them into
   taxonomy — CLAUDE.md §9 is explicit that they are never taxonomy
   replacements.
3. **Revealing the Kup-score.** Gated on per-variant price-history sufficiency,
   which is a data question, not a behavioural one.
4. **Monetisation.** Affiliate, subscription or neither. No user at this stage
   has been asked to pay anything.
5. **Danish-only vs. bilingual.** Depends on market strategy, not on the
   locale mix of 15 people.
6. **Push notifications.** `push_enabled` exists as a flag with no
   implementation. Whether to build it depends on whether the email loop works
   first — and the email loop is currently dormant.
7. **The right catalogue *composition*.** Demand data can say which products
   are missing. It cannot say whether 48 curated variants beats 200 shallow
   ones — that is a positioning decision.
8. **Whether the product page or the alert is the core loop.** Genuinely
   undecided, and Stage 3 should not prejudge it. The measurement is designed
   to let either win.

---

## 20. Exact V1 event taxonomy

Sixteen events. Types: `str`, `int`, `float`, `bool`, `uuid`, `enum`, `str[]`.
`?` marks nullable. All events additionally carry the §14.3 super-properties.

---

**1. `$pageview`** — every route change. *Modified: `$current_url` sanitised.*
```
$current_url        str    // free-text query params stripped
path_template       str    // '/product/[slug]', not '/product/roland-juno-106'
referrer_host       str?
```

**2. `discovery_product_clicked`** — a product card is clicked on any shelf or grid.
```
shelf               enum   'legendary' | 'popular' | 'browse_grid' | 'related'
product_slug        str
position            int    // 0-indexed within the shelf
shelf_size          int
has_image           bool
active_listing_count int
tier                enum   'legendary' | 'classic' | 'standard'
```

**3. `browse_category_clicked`** — a root category card on `/browse`.
```
root_slug           str
position            int
product_count       int
```

**4. `browse_leaf_viewed`** — `/browse/[root]` renders.
```
root_slug           str
page                int
page_size           int
total_public_products int
rendered_count      int
subcategory_count   int
```

**5. `search_submitted`** — a query is submitted from any surface.
```
query_norm          str    // contract normalisation (§10)
query_length        int
token_count         int
entry_surface       enum   'landing' | 'search' | 'mobile_bar' | 'nav'
input_method        enum   'typed' | 'suggestion' | 'url_param'
```

**6. `search_resolved`** — exactly one per submitted query.
```
query_norm          str
resolution          enum   'canonical_exact' | 'accepted_alias' | 'disambiguation'
                           | 'dangerous_alias_blocked' | 'unsupported' | 'error'
candidate_count     int
product_slug        str?   // present when resolution is a single product
auto_navigated      bool
latency_ms          int
```

**7. `search_unsupported`** — the query resolves outside the supported catalogue.
```
query_norm          str
resolution_class    enum   'unsupported' | 'ambiguous' | 'dangerous_alias_blocked'
                           | 'zero_results_supported'
raw_token_count     int
suggested_slugs     str[]  // nearest supported products shown
suggested_count     int
nearest_distance    float? // normalised edit/semantic distance to the nearest supported product
```

**8. `demand_signal_submitted`** — the user asks to be told when Klup covers it.
```
query_norm          str
capture_method      enum   'inline_email' | 'notify_button'
has_email           bool   // NEVER the address itself
suggested_shown     int
```

**9. `product_viewed`** — `/product/[slug]` renders with a product.
```
product_slug        str
product_id          uuid
brand_slug          str?
tier                enum   'legendary' | 'classic' | 'standard'
support_state       enum   'known' | 'reserve' | 'supported'
browse_visibility   enum   'public' | 'qa_only' | 'hidden'
active_listing_count int
has_hero_image      bool
has_article         bool
has_specs           bool
has_history_timeline bool
related_count       int
entry_ref           enum   'shelf' | 'browse' | 'search' | 'direct' | 'email'
                           | 'related' | 'external'
referrer_product_slug str?
```

**10. `price_context_shown`** — fires on product-page render, band present or not.
```
product_slug        str
has_band            bool
band_low            int?
band_high           int?
band_median         int?
band_count          int?
band_width_ratio    float? // band_high / band_low
history_points      int
has_thomann_reference bool
thomann_price_dkk   int?
```

**11. `listing_click_out`** — an outbound click to a marketplace listing.
```
listing_id          str
product_slug        str?   // null on the generic SERP
source              enum   'dba.dk' | 'finn' | 'blocket' | 'kleinanzeigen'
                           | 'reverb' | 'thomann'
price               float?
currency            str?   // raw source currency, never pre-converted
price_dkk           int?   // read-time conversion
band_delta_pct      float? // (price_dkk − band_median) / band_median
position            int
variant             enum   'list' | 'grid'
surface             enum   'product' | 'search' | 'saved' | 'watchlist'
click_id            uuid
```

**12. `outbound_retail_click`** — an outbound click to a retail/affiliate destination.
```
destination         enum   'thomann'
placement           enum   'product_hero' | 'listing_card' | 'saved_card' | 'search_card'
product_slug        str?
thomann_price_dkk   int?
click_id            uuid
affiliate_tagged    bool
```

**13. `listing_saved`** — *retained name, extended properties.*
```
listing_id          str
source              str
product_slug        str?
surface             enum   'product' | 'search' | 'saved'
price_dkk           int?
```

**14. `watch_created`** — *renamed from `watchlist_created`.*
```
query_norm          str
watch_type          enum   'query' | 'listing'
origin_surface      enum   'product' | 'search' | 'saved' | 'watchlists'
origin_product_slug str?   // the product-binding bridge (§7)
has_max_price       bool
max_price           int?
```

**15. `auth_completed`**
```
method              enum   'magic_link'
is_new_user         bool
entry_surface       str
trigger             enum   'save' | 'watch' | 'product_gate' | 'nav' | 'direct'
```

**16. `search_failed`**
```
query_norm          str
error_kind          enum   'upstream' | 'timeout' | 'client' | 'unknown'
latency_ms          int
```

*Retained unchanged for continuity:* `signup_completed { method,
days_since_first_seen, first_product_slug }`.

---

## 21. Five decisive product questions

Each has one primary metric, one falsifying observation, and one qualitative
counterpart. If Stage 3 answers only these five, it succeeded.

---

**Q1. Does the canonical product page actually change the decision, or do
people still leave for a marketplace search box?**

- **Metric:** decisions per product-page session vs. per generic-search session (§5, E-7).
- **Falsified if:** product-page sessions produce no more decisions than search sessions.
- **Qualitative:** Q-7, Q-8.
- **If falsified:** the product page is not the product. Stage 3's premise fails and the question becomes what the alert loop is worth on its own.

**Q2. Is the price band trusted, and is it sufficient?**

- **Metric:** band-conditioned decision lift (§11) and `band_delta_pct` distribution.
- **Falsified if:** band-present and band-absent pages convert identically, or clicks are distributed indifferently across the band.
- **Qualitative:** Q-2, Q-5.
- **If falsified:** the moat is aggregation, not price knowledge — a materially weaker position, and the Reverb/Auctionet price pipeline stops being the priority.

**Q3. Is restricted search a feature or a wall?**

- **Metric:** resolution rate; unsupported recovery rate; G10 (silent loss).
- **Falsified if:** most unsupported responses end the session with no recovery and no demand capture.
- **Qualitative:** Q-6 — does the message read as curation or as brokenness?
- **If falsified:** the honest framing of a narrow catalogue is not working, and either the copy or the catalogue floor must change before anything else.

**Q4. Does anyone come back without being emailed?**

- **Metric:** unprompted returning persons per week; product revisits (§6).
- **Falsified if:** zero unprompted returns across the whole external cohort in 30 days.
- **Qualitative:** Q-10.
- **If falsified:** Klup is a push service, not a destination. That is a different product with different priorities (and it needs the dormant cron before it can even be attempted).

**Q5. Is the 48-product catalogue the binding constraint, or is page quality?**

- **Metric:** unsupported demand breadth (§10) vs. zero-value-view rate and content-gap delta (§8).
- **Falsified if:** demand is diffuse — no term reaching 5 distinct persons — while existing pages show low decision rates.
- **Qualitative:** Q-11.
- **If falsified:** expanding the catalogue would scale a page that does not work. Fix the 14 before adding the 49th.

---

## 22. 30-day validation protocol

Assumes Tier 1 instrumentation ships in Week 0 and that §3.1 (the login wall)
and §3.2 (identity) are resolved first. **If they are not, run Weeks 1–4 with
qualitative instruments and E-1 only, and restart the quantitative clock when
they land** — do not run the protocol on instrumentation known to be blind.

### Week 0 — prerequisites (no users yet)

- [ ] Decide §3.1: are product pages public? Implement the decision.
- [ ] Ship `identify()` / `reset()` and person properties.
- [ ] Ship the 16 V1 events; verify each once in a staging session, event by event.
- [ ] Verify the PostHog EU host and `$current_url` sanitisation.
- [ ] Tag the founder and admin accounts; verify preview deployments emit nothing.
- [ ] Build the nine dashboard tiles with the low-N presentation rules.
- [ ] Enable session replay for non-internal production sessions, input masking on.
- [ ] Freeze the change log: **one change per week from here on, dated.**
- [ ] Baseline the catalogue: for all 48, record support_state, browse_visibility, band presence, band_count, band_width_ratio, active listings, image, article. This is the denominator for everything.
- [ ] Start E-1: 14 days of the founder's manual routine, logged before Klup is used for it.

### Week 1 — instrument truth

- Recruit 10–20 external participants (Danish/Nordic used-gear buyers).
- **No product changes.** Observe only.
- Daily: read the raw event stream for 10 minutes. Fix instrumentation bugs immediately; instrumentation fixes do not count against the one-change-per-week rule.
- End of week: verify every one of the 16 events has fired at least once from a real session. **Any event that has not fired is either broken or unreachable** — find out which.
- Run E-5 (five-user task test) and interviews 1–3.

### Week 2 — first read

- Weekly review, in this order: activation ledger → funnel → product scorecard → guardrails.
- Publish week 1 counts with full exclusion footers.
- Run E-4 (painted door on the unsupported screen) — the week's one change.
- Interviews 4–5.
- Compare E-1's manual-routine baseline against the first week of Klup-assisted founder use.

### Week 3 — first intervention

- Apply exactly one change, chosen by the week-2 evidence, from this ordered list:
  1. If G2 (dead pages) breaches → fix supply on the worst products (monitoring config, not new products).
  2. If context coverage is low → prioritise price history for the 14.
  3. If discovery drop-off dominates → change the landing hierarchy (search box vs. carousel).
  4. If unsupported loss dominates → improve the unsupported screen's nearest-product suggestions.
- Begin E-3 (switchback) only if the north star has non-zero weekly volume.
- Run E-2 (content-gap analysis) on the accumulated data.

### Week 4 — decide

- Full 30-day read on all five questions in §21.
- Founder E-1 verdict: deals found, minutes spent, would-not-have-found count.
- Export the unsupported-demand log and the activation ledger to `data/`.
- Apply §23's kill / continue / expand criteria and **write the decision down**,
  including which of the five questions remain unanswered and why.

### Reporting rules for the whole 30 days

- Absolute integers with denominators. No percentages below N=20.
- Founder and external cohorts reported side by side, never merged.
- Every figure carries its exclusion footer (§15).
- Anything the data cannot support is written as "unknown", not estimated.

---

## 23. Kill, continue and expand criteria

Thresholds are calibrated to a 15–30 person external cohort over 30 days. They
are deliberately low in absolute terms and deliberately strict about
*conjunction* — at this N, the pattern across signals is the evidence, not any
single number.

### 23.1 KILL — the product-page thesis fails as built

All three, simultaneously:

- **Activation:** < 3 of ≥ 12 external persons reach a qualifying decision (§2).
- **Return:** ≤ 1 unprompted returning person in 30 days.
- **Founder:** E-1 shows zero deals Klup surfaced that the founder would not
  otherwise have found, **and** no time saved.

**Then:** stop building the experience. Do not add products, do not add
sources, do not redesign. Return to problem definition — with five interviews
already in hand, that is a well-informed restart, not a failure. Explicitly:
adding products at this point would scale something that does not work.

### 23.2 CONTINUE — the thesis is alive, keep working the 48

Any of:

- Activation between 3 and 7 of ≥ 12 external persons; **or**
- ≥ 2 unprompted returning persons but no product revisits; **or**
- Founder E-1 positive (≥ 1 deal that would have been missed) while external
  signal is flat; **or**
- Strong price-context lift (Q2 supported) with weak discovery (Q1 ambiguous).

**Then:** continue Stage 3 on the existing 48. Work the ordered fix list from
Week 3. Re-run the 30-day protocol. **Do not expand the catalogue** — the
constraint is not breadth.

### 23.3 EXPAND — earn the right to go past 48

**All four gates, together.** Any single gate failing blocks expansion.

**Gate A — the experience works.**
- ≥ 8 of ≥ 12 external persons activated.
- ≥ 4 unprompted returning persons, including ≥ 2 product revisits.
- Band-conditioned decision lift ≥ 1.5× (Q2 supported, with denominators shown).

**Gate B — the existing catalogue is healthy.**
- ≥ 70 % of public-and-supported products have a price band.
- G2 (dead pages) < 25 %.
- G3 (bands wider than 10×) < 10 %.
- Zero-value views (no listings and no band) < 10 % of product views.
- G1 = 0 for the full 30 days.

**Gate C — demand is concentrated, not diffuse.**
- ≥ 10 distinct unsupported-demand sessions for the same normalised term in
  30 days, from **≥ 5 distinct persons**, for **≥ 3 distinct terms**.
- The top 10 unsupported terms account for ≥ 50 % of unsupported sessions.
- ≥ 1 `demand_signal_submitted` for each term proposed for promotion.

  *This tightens the existing rule in the engineering record ("≥ 10 PostHog
  unmatched search sessions for a category is a signal worth investigating")
  by adding a distinct-person requirement — ten sessions from one person is
  one person, not demand.*

**Gate D — expansion is operationally safe.**
- Each proposed product has a curated `kg_product` row with a clean
  `brand + model` canonical name, per the reserve promotion triggers in the
  selection doc §10.
- Adding it does **not** widen marketplace monitoring beyond the explicit
  per-source sets (CLAUDE.md §3).
- The matcher-eligibility rule is unchanged: `status='active' AND
  support_state='supported'`.
- Promotion goes through the existing promotion seam. No importer, no
  migration, no bulk activation.

**Expansion size when all gates pass:** promote **at most 10 products** from
the reserve, chosen by Gate C evidence, then re-run the 30-day protocol before
promoting any more. Doubling the catalogue on one month of 15-person evidence
would be exactly the mistake this specification exists to prevent.

### 23.4 Evidence required before reapplying to Thomann

The previous application failed because Klup did not communicate its
music-equipment focus clearly enough. That is a *legibility* failure, and the
first item below is almost certainly the largest single cause.

**Prerequisites (structural, must all be true):**

1. **Anonymous visitors can see product pages** (§3.1). Today an affiliate
   reviewer visiting klup.dk sees a login wall on every product link. No
   amount of traffic evidence overcomes a reviewer who cannot see the product.
2. **Public product pages are crawlable and indexable** — server-rendered or
   pre-rendered, with product metadata. The current page is a client component
   that fetches after mount; a reviewer's crawler sees a skeleton.
3. **Every public page is music equipment.** True by construction — the
   non-music KG rows are inactive and stay that way (CLAUDE.md §1). Make it
   *visible*: the landing page, browse taxonomy and copy must state the
   category unambiguously above the fold.
4. **A public "what Klup covers" page** naming the categories, the marketplaces
   monitored, and the curated-catalogue model. This is the single artefact that
   most directly answers the objection that sank the last application.
5. **Metadata and title** state the vertical. `frontend/app/layout.tsx:22-23`
   currently reads `title: "Klup"` / `description: "Kup efter kup – det er
   Klup"` — evocative, and it communicates nothing about musical equipment to a
   reviewer or a crawler.

**Behavioural evidence (30 consecutive days, external traffic only):**

| Evidence | Threshold |
|---|---|
| Thomann outbound clicks (`outbound_retail_click`) | ≥ 30, from ≥ 10 distinct persons |
| Product pages viewed | ≥ 300 views across ≥ 20 distinct products |
| Public products with a Thomann reference rendered | ≥ 20 |
| Share of product views that are music equipment | 100 %, demonstrable from the event log |
| Monthly distinct non-internal visitors | ≥ 150 |
| Guardrails G1–G5 | all within threshold for the full 30 days |

**What the application then submits:** the outbound-click log with `click_id`s,
the product-page inventory, the coverage page, and the category-purity figure.
Concrete, verifiable, and specific to musical equipment — which is precisely
what the first application lacked.

---

## 24. Open dependencies

Ordered by how much of this specification each one blocks.

| # | Dependency | Blocks | Owner decision |
|---|---|---|---|
| 1 | Product-page public access (§3.1) | The entire funnel, Thomann reapplication, SEO | Product owner |
| 2 | `posthog.identify()` (§3.2) | Activation, all return metrics, half the dashboard | Engineering (small) |
| 3 | Restricted search implementation | §9, §10, Q3 — the contract exists only on paper | Stage 3 build |
| 4 | Demand-signal capture | §10, Gate C, expansion | Stage 3 build |
| 5 | Cron unification (`/api/cron/scrape`, handover #3) | Alert loop, Q4's prompted-return half | Operations |
| 6 | PostHog EU host confirmation (§14.5) | GDPR posture of everything else | Operations |
| 7 | Product-bound watchlists | Precise watch attribution; the event bridge in §7 is the interim | Later, schema change |
| 8 | Affiliate redirect route (§12) | Ad-blocker-immune outbound truth | V1.5 |
| 9 | Monitoring/support overlap of 14 (handover #2) | Interpretation of every supply-dependent metric | Product owner |

---

## 25. What this document does not do

- It does not implement, enable or configure any analytics.
- It does not change application code, middleware, environment or production.
- It does not authorise a migration, importer, scraper, matcher run, promotion
  or monitoring change.
- It does not widen the catalogue or the monitored product sets.
- It does not commit or push.

Every item in §19.1 and §24 requires its own authorisation before any of it
becomes real.
