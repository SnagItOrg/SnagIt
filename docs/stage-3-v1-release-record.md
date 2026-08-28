# Klup Stage 3 V1 — release record

**Final verdict: `STAGE3_V1_LIVE_CRON_HELD`.**

Stage 3 V1 is live in production. The Vercel scrape cron is deliberately held
Disabled. This record closes Stage 3 administratively; it changes no runtime
code and authorises no further work beyond §11.

| | |
|---|---|
| Closed | 2026-08-28 |
| **Production SHA** | `14ee6f8bdb23731bf49712c2638b224fa7dc7921` |
| **Rollback SHA** | `703a117b37e38b8fb68c4d3a9606ce4f4ba126ef` |
| Release tag | `klup-stage3-v1-2026-08-28` → `14ee6f8` |
| Deployed by | fast-forward of `main` to `stage3/v1-integration`, no merge commit |

---

## 1. What shipped

Five packages plus one security patch, integrated and deployed as one release.

| Package | Delivered |
|---|---|
| WP-1 | eligibility spine: `/product/[slug]` public **and** gated on the four-axis predicate; browse correctness; route-access authority + posture reference; complete DA/EN key set |
| WP-2 | six navigation families, the six legacy family-label 308s, corrected promotion-API operator copy |
| WP-4 | restricted `/search` resolver over the supported catalogue; `/api/scrape` removed from the public surface |
| WP-4a | search client/server module boundary split |
| WP-5 | consent gate, `/privatliv`, PostHog EU identity and the analytics taxonomy |
| Security | S1, S2, S3 (§6) |

**WP-3 did not ship.** The canonical product page is still a client component;
`lib/price-band.ts`, `app/sitemap.ts`, `app/om-data/page.tsx` and
`app/product/[slug]/not-found.tsx` do not exist, and `/om-data` and
`/sitemap.xml` answer 404. `route-access.ts` still carries both as
`planned: true`. Asking-price bands, SSR product pages, per-product
`generateMetadata` and JSON-LD are therefore **not** part of V1.

## 2. Delivered customer-facing behaviour

Verified against production on 2026-08-28 (read-only GETs):

| Surface | Behaviour |
|---|---|
| `/product/roland-juno-106` | 200 — canonical product pages are public, with no login |
| `/product/gibson-les-paul-custom` | 404 — a private (`supported`+`qa_only`) product is not readable |
| `/family/gibson-les-paul` | 200 — family route renders, never aggregates |
| `/search` | 200 — catalogue resolver; `?q=juno106` resolves to `/product/roland-juno-106` |
| `/browse` | 200 |
| `/privatliv` | 200 |
| `/api/scrape` | **404** — the unauthenticated public write path is gone |
| `/api/webhooks/auth` | **404** — route deleted |

## 3. Deployment and manual-smoke evidence

- `main` fast-forwarded `703a117 → 14ee6f8`; reflog records
  `merge origin/stage3/v1-integration: Fast-forward`; HEAD has one parent.
- `local main = origin/main = 14ee6f8`. Working tree carries only the three
  known untracked paths (`.agents/`, `.mcp.json`, `skills-lock.json`).
- Pre-deploy gate: 453 tests / 449 pass / 0 fail / 4 declared boundaries;
  frontend TypeScript 0 errors; `git diff --check` clean.
- **Operator-attested:** Vercel production manually confirmed working at
  `14ee6f8`; public smoke completed; Vercel Cron Jobs confirmed Disabled.
- Machine corroboration of the deployed revision: `/api/webhooks/auth` now
  answers 404. That route existed until `14ee6f8`, so production is serving
  this revision or later.

## 4. Final catalogue counts

`SELECT`, 2026-08-28. All match the frozen contract exactly.

| Measure | Value |
|---|--:|
| Supported (`active` + `supported`) | **48** |
| Public (`active` + `public`) | **28** |
| Canonical (four-axis, publicly readable) | **14** |
| Private supported (`supported` + `qa_only`) | **34** |
| Legacy listings with NULL ingestion identity | **87,363** |
| `listings` | 99,047 |
| `listing_product_match` | 31,751 |

## 5. Writer state — no cron-attributable writes

PM2 on the Mac Mini (`Panters-Mac-mini`, user `panter`) holds **exactly 8**
cron-scheduled jobs; `match-listings` is absent from both the running set and
`~/.pm2/dump.pm2`. All show `restart_time = 0`. `stopped` is the correct
resting state for a cron-scheduled PM2 job between firings.

Last scheduled run: `scrape-reverb` ingested **966** rows in one batch,
00:00:05–02:43:49 UTC on 2026-08-28, completing `✅ Done / Upserted: 53142`.

**No cron-attributable writes occurred.** The Vercel cron path is the only
writer that sets `listings.watchlist_id`. That column has 772 rows in total and
its most recent value is **2026-03-16** — five months before this release, and
zero since 2026-08-27. Every row written since the release is `reverb`, with
`watchlist_id` null, at the PM2 job's scheduled time.

## 6. Security closure — S1, S2, S3

| # | Closure |
|---|---|
| **S1** | All six `/api/admin/cleanup/**` handlers call `requireAdminInRoute()` as the first executable statement, before body parsing, before `getSupabaseAdmin()` and before any mutation. It replaces a local `requireAuth()` that checked only for a session — any signed-in visitor satisfied it, and these routes inactivate, merge and insert `kg_product` rows. Authorised behaviour is otherwise unchanged. |
| **S2** | `/api/webhooks/auth` is **deleted**, not gated: it was `machine_api`, authenticated nothing, sent mail from `notifications@klup.dk` with attacker-controlled text interpolated unescaped into HTML, and logged the posted body. Its route classification and posture-reference entry are removed; the path now classifies as unknown and answers 404. No replacement webhook protocol ships. Authentication, signup and user creation are untouched, and no unauthenticated mail path remains — the only mail sender, `lib/email.ts`, is called solely by the `CRON_SECRET`-gated cron route. |
| **S3** | `CRON_SECRET` is validated for presence and non-emptiness **before** authorisation and before any work: unset or empty returns **503 `cron_not_configured`** ahead of client construction and scraper work. The comparison reads the validated local, so the previous `Bearer undefined` admission — which let the public internet start the scraper — is structurally impossible. The secret never reaches a log line or a response. `frontend/vercel.json` is unchanged. |

## 7. The deleted auth webhook — external configuration

The application route is gone. **The Supabase-side hook still exists and is
enabled**, and could not be changed with the access available.

| | |
|---|---|
| Exists | **Yes** |
| Type | Supabase **Database Webhook** — a trigger on `auth.users`, `AFTER INSERT FOR EACH ROW`, executing `supabase_functions.http_request` |
| Name | `/api/webhooks/auth` (the trigger name is the path) |
| Target | `POST https://www.klup.dk/api/webhooks/auth`, 5000 ms timeout |
| Disposition | **Neither disabled nor deleted** — see below |
| Checked | 2026-08-28 |
| Delivery history | 7 recorded deliveries, most recent 2026-03-19 |

`ALTER TABLE auth.users DISABLE TRIGGER "/api/webhooks/auth"` was refused:
`must be owner of table users`. The available connection is `postgres`, which
is not a superuser and is not a member of `supabase_auth_admin`, the owner of
`auth.users`. No privilege escalation was attempted and nothing was guessed.

**Residual risk is low and bounded.** The target route returns 404, so no data
is exposed and the unauthenticated mail-send defect is closed at the
application layer. The residue is a failed delivery attempt per new signup and
a misleading dashboard entry. Supabase database webhooks dispatch
asynchronously through `pg_net`, so a failed delivery does not affect user
creation.

**This is the one unresolved operator action.** See §12.

## 8. Cron state and the unresolved ingestion conflict

- **Vercel Cron Jobs: Disabled**, operator-confirmed, and deliberately held.
- `frontend/vercel.json` still declares `/api/cron/scrape` on `*/10 * * * *`.
  It is **not** removed: deleting it would be a deployment-affecting change,
  and the disabled state lives at Vercel project level, not in the repository.
- The cron was **not** invoked during this release or its verification.
- **Why it stays held.** `/api/cron/scrape` ingests the same `dba.dk` source as
  the PM2 `scrape-dba` job through a different `ON CONFLICT` target on a shared
  unique index (`(url, watchlist_id)` versus `(external_id, source)`), so an
  insert whose `(external_id, source)` already exists under a different
  watchlist raises a unique violation instead of upserting. 772 rows already
  carry both. Re-enabling requires deciding whether watchlist ingestion routes
  through the staging/promotion path — a design decision, not a toggle.
- S3 has improved the failure mode: if the cron were enabled while
  `CRON_SECRET` is unset, it now answers 503 instead of running the scraper.

## 9. Local secret-state verification

Verified without displaying, copying, rotating or transmitting any secret.

| Check | Result |
|---|---|
| `frontend/.env.local` present | Yes — `-rw-r--r--`, `panter:staff`, 439 bytes |
| Permissions | **Unchanged**, mtime `2026-04-24 14:30:41` |
| `CRON_SECRET` present | **No — intentionally absent** |
| Pre-test state determinable | **Yes.** The file has not been modified since 2026-04-24, four months before the S3 verification, so that verification did not touch it. `CRON_SECRET` is a Vercel production variable and was never in this file. |
| Duplicate entries | None — each of the six keys appears exactly once; no commented-out remnant |
| Literal value in shell history | 0 mentions in `~/.zsh_history` and `~/.bash_history` |
| Literal value in repository files | 0 — every tracked reference is to the variable *name* (docs, `process.env` reads, tests); 0 assignments with a literal |
| Literal value in release documentation | 0 |
| Temporary modified copy of `.env.local` | None — exactly one `.env.local` in the workspace, no `.env.local.*` backups, none in any worktree |

**Observation, no action taken.** One Claude Code session transcript under
`~/.claude/projects/` contains four *synthetic* `CRON_SECRET` values written
into disposable test `.env.local` files on localhost ports 3210–3250 during the
S3 verification. They are test fixtures, not the production secret — they
differ from one another, were generated inside the test scripts, and the real
value was never available locally to copy. They are outside the repository,
shell history and documentation. **No rotation is indicated.**

`frontend/.env.local` is mode 644; `600` would be tighter. Recorded as an
observation only — permissions were not changed.

## 10. Known non-blockers

Carried forward deliberately. None blocks the release.

| # | Item |
|---|---|
| **13 edge-only admin routes** | `/api/admin/{match/*, msrp, suggestions*, users*}` still rely on the edge classification alone for authorisation. Nothing is reachable today. The set is **pinned by name** in `scripts/lib/wp1-route-access.test.ts` so it may shrink but never grow — a fourteenth fails the suite immediately. |
| **Onboarding 308 without `Location`** | `/onboarding/step1..3` answer `308` with **no `Location` header** (verified in production), so a client is not forwarded to `/`. The pages are retired and unlinked; the effect is limited to an old bookmark landing on a blank 308. |
| **N1** | The supported-cohort assertion cannot detect a *missing* projection row; the failure mode is conservative (under-serving). |
| **N2** | `BrandBreakdown.counts.public_count` is still support-blind; admin-gated debug payload only. |
| **N3** | Unexpected `/api/discover` failures return a success-shaped body with a 500 status. |
| **N4** | The browse-leaf genuine 404 lacks `no-store` and a machine error code. |
| **N6** | Documentation inconsistencies in the build plan's package tables (partly corrected 2026-08-28). |
| **WP-3 M2** | No segment-specific `app/product/[slug]/not-found.tsx`; an ineligible product URL renders the site-wide 404. Status is correct; the copy says nothing about the catalogue. |
| **WP-3 L7** | The client-fetch soft-404 race is not yet eliminated, because the product page is still a client component. The server gate in `app/product/[slug]/layout.tsx` produces the real 404. |
| **P1** | Accessory and spare-part listings contaminate primary product listings, counts and any future band. Trust defect first, data defect second. Matcher-quality work. |
| **P2** | Asking-price context must replace the excessively broad sold-price range. P1 is a precondition. Deferred with WP-3. |
| **P3** | Price charts need legible axes, units, source and sample size, or must not render. |
| **P4** | Related-product cards need the product page's image fallback chain plus an `onError` fallback. |
| **P5** | Product and browse layouts need intrinsic responsive grids (`auto-fit`/`minmax()`, container queries); desktop leaves roughly half the viewport unused. |
| **P6** | `/intel` design reference: dense, operator-facing, admin-only, out of navigation. |
| **P7** | Shared design-system discipline — spacing scale, type scale, restraint, consistent interactive states. |
| **P8** | Public product and browse pages keep a distinct editorial identity: DM Serif Display headlines, Inter body, the sparse green accent rule. |

Sources: `docs/stage-3-integration-handoff-notes.md`,
`docs/stage-3-v1-decision-and-build-plan.md` §15.8, and the integration
hand-off branch `stage3/v1-integration-handoff` (P1–P8).

## 11. Next approved work

**`visual-foundation-v1`**, beginning with semantic colour, elevation and
typography tokens.

Its branch starts from **`stage3/v1-release-record`**, not from `main`, so this
record enters `main` with the next intentional product release. A docs-only
push to `main` would create another production deployment for no product
reason.

> **No further foundation, matcher, migration or product-architecture work is
> authorised by this record.** WP-3, P1–P5 and the deferred items in §10 remain
> unauthorised until a product owner schedules them explicitly. This record
> grants no authority to re-enable the Vercel cron, widen monitoring, change
> the frozen 48, run an importer or apply a migration.

## 12. Unresolved operator actions

1. **Remove the Supabase database webhook `/api/webhooks/auth`** (§7). It is
   still enabled and targets a deleted route. Requires an owner of
   `auth.users` — the dashboard (Database → Webhooks), or SQL as
   `supabase_auth_admin`:
   `DROP TRIGGER "/api/webhooks/auth" ON auth.users;`
   Until then, each new signup produces one failed delivery attempt. Signups
   are unaffected.
2. **Confirm Vercel Cron Jobs remains Disabled** after this deployment. A
   deploy re-reads `vercel.json`, which still declares the schedule.
3. **Keep the rollback path warm:** `703a117b37e38b8fb68c4d3a9606ce4f4ba126ef`.

## 13. Preserved recovery state

Not deleted, and not to be deleted: the five package branches, the integration
branch, the integration hand-off branch, the release tag, the clean worktrees,
and the release backups in `~/klup-release-2026-08-26/`.
