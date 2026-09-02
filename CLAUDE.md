# CLAUDE.md — Klup.dk

How to work safely in this repository. Everything here is either an
irreversible prohibition or a pointer. **None of it is pre-reading.** Start the
work; open a document from §7 when you need the fact it holds.

Klup is a **curated monitoring and comparison service for used music
instruments and studio equipment.** Canonical product pages are the core
experience; search navigates *within* a supported catalogue. The product
answers one question:

> "Er 4.500 kr for en Roland Juno-106 en god pris i dag?"

**Do not build:** a general marketplace, storefront or trading operation; an
arbitrage desk (`/intel` is a private founder tool, not the product);
multi-vertical coverage (design furniture, cycling, photography and tech are
out of scope and their KG rows stay inactive); a generic listing SERP
(unsupported searches are demand signals); auto-bidding or agent-assisted
purchasing.

---

## 1. Current work

**Stage 3 V1 closed** at release `14ee6f8` on 2026-08-28. Current work is
**`visual-foundation-v1`** — semantic colour, elevation and typography tokens.

What shipped, what deliberately did not (WP-3), the security closure, the open
operator actions and the P1–P8 backlog are in
[`docs/stage-3-v1-release-record.md`](docs/stage-3-v1-release-record.md). That
record — not this file — owns release SHAs, catalogue counts and deployment
evidence.

WP-3 and P1–P8 are **not authorised**, and neither is any new foundation,
matcher, KG or product-data branch. A product owner schedules those explicitly.

---

## 2. Production boundaries

**Production is SELECT-only.** Reads need no ceremony. Any write — DML, DDL,
migration, import, backfill, publish — needs explicit product-owner
authorisation, each time.

**Never, without that authorisation:**

- push to or deploy `main`;
- run a migration, importer, scraper, matcher apply, backfill, rescrape or
  population;
- publish a product, or widen marketplace monitoring in
  [`data/klup-source-monitoring.json`](data/klup-source-monitoring.json);
- alter PM2, Vercel or cron configuration;
- edit the immutable candidate sources
  `data/klup-clean-product-candidates.csv` (336 rows) and
  `data/klup-music-vertical-candidate-additions.csv` (182 rows);
- hand-edit a derived `data/*.csv` — regenerate with
  `npm run build-product-artefacts`;
- re-apply a migration that is already applied.

**Vercel Cron Jobs are Disabled, deliberately.** `/api/cron/scrape` duplicates
dba.dk ingestion and races the PM2 promotion path through a different
`ON CONFLICT` target on a shared unique index. `frontend/vercel.json` still
declares the schedule — that is intentional, because removing it is a
deployment-affecting change and the Disabled state lives at Vercel project
level. Do not re-enable the cron and do not "fix" `vercel.json`. Release
record §8.

**PM2 belongs to the Mac Mini** (`panter`), which holds 8 cron-scheduled jobs.
Run `hostname` first — both machines run Claude Code natively, so do not assume
an SSH hop and do not assume you are on the MacBook. Start a job with
`pm2 start ecosystem.config.js --only <name>`. **Never `pm2 resurrect`** — the
saved dump predates the retirement of `match-listings`.

**Deploy is `git push` to `main`**, through Vercel. **Never the Vercel CLI.**
A docs-only push to `main` still deploys production.

---

## 3. Secrets and PII

Never hardcode a secret, ask for one in chat, or let one reach a log line, a
response, a commit or a document. `frontend/.env.local` is read-only to you —
do not copy, rewrite or relocate it. Never log PII.

---

## 4. Branch and worktree safety

Ten worktrees share this repository (`git worktree list`). Work only in the one
you were given; never `cd` into another.

The **stash stack is shared** across all of them, and other sessions may use it
concurrently. Never bare `git stash` / `git stash pop`. Prefer a WIP commit; if
you must stash, use `git stash push -u -m "<unique-tag>"` and recover by SHA
with `git stash apply`.

`.agents/`, `.mcp.json` and `skills-lock.json` exist **only in the main
checkout** (`/Users/panter/Workspace/SnagIt`), untracked and never committed.
They are absent from every worktree. Leave them alone; never add them to git.

---

## 5. Product eligibility — one authority, and it is code

Do not restate the predicate in prose or re-derive it in an ad-hoc query. Two
functions own it:

| Question | Authority |
|---|---|
| May this slug render a public product page? | `isCanonical()` in [`frontend/lib/catalogue.ts`](frontend/lib/catalogue.ts) |
| May this product receive automatic matches? | `isMatchableProduct()` in [`frontend/lib/matching/match-listings.ts`](frontend/lib/matching/match-listings.ts) |

Both are exact-match and fail-closed: a row whose support axis cannot be read
is ineligible. `catalogue.ts` deliberately has no imports so the decision stays
testable from plain Node.

Identity, support, visibility, editorial tier and marketplace monitoring are
**five separate concerns — never infer one from another.** In particular
`tier` is editorial only. It is not a scraper selector, and reintroducing that
coupling would silently widen monitoring. The KG is a broad identity universe,
and brand-collision protection extends well past the supported cohort;
operations are narrow and explicit. **A KG import must never widen monitoring.**

Lifecycle axes and promotion authoring:
[`docs/klup-product-lifecycle-guide.md`](docs/klup-product-lifecycle-guide.md).

---

## 6. Verification

```bash
npm test                                     # root suite
npx tsc --noEmit -p frontend/tsconfig.json   # frontend types
cd frontend && npm run lint                  # frontend lint
npm run typecheck                            # root types — pre-existing error baseline
bash scripts/verify-migrations-isolated.sh   # migrations, disposable local cluster
npm run validate-activation                  # artefacts, disposition and migration reproduce exactly
```

Run what the change can actually break — not every change needs all six. **Run
the commands rather than trusting a written total:** counts belong to the run,
and the ones once recorded in this file went stale across three releases. The
last verified pre-deploy gate is in release record §3.

A fresh worktree has no dependencies installed, so `npm run typecheck` reports
`tsc: command not found` and a few root tests fail on a missing
`node_modules/.bin/tsx`. Those are environment failures, not regressions.
Establish the baseline before you change anything and compare against your own
run. **Never verify by invoking a production writer path.**

---

## 6b. How to work — applies to every task

These are standing behavioural rules, not a checklist for large changes. They
are here rather than in a skill because a skill loads only when it triggers,
and these apply before you know what the task is.

1. **Think before coding.** State your assumptions. If several readings exist,
   present them — do not pick one silently. If a simpler approach exists, say
   so. If something is unclear, stop and name the confusion.
2. **Simplicity first.** The minimum that solves the problem. No speculative
   features, no abstraction for single-use code, no configurability nobody
   asked for, no error handling for impossible cases.
3. **Surgical changes.** Every changed line traces to the request. Do not
   improve adjacent code, do not refactor what is not broken, match the
   surrounding style. Mention unrelated dead code; do not delete it. Remove
   only the orphans your own change created.
4. **Goal-driven execution.** Turn the task into verifiable criteria, and for
   multi-step work state a short plan with a verification step per item.

Full text: `.claude/skills/karpathy-guidelines/SKILL.md`.

**Shared method skills.** 75 skills — UX, code craftsmanship, architecture,
product, marketing — live in `SnagItOrg/skills`, not here. See
`.claude/skills/skills-catalogue/SKILL.md` for how to find and install them.
They give method, not permission: where one conflicts with this file or
`frontend/CLAUDE.md`, the repo wins.

## 7. Where facts live

Open these when you need them. None is pre-reading, and none supersedes this
file.

| I need | Read |
|---|---|
| What is live, what did not ship, open operator actions | [`docs/stage-3-v1-release-record.md`](docs/stage-3-v1-release-record.md) |
| Frontend design, i18n, API-route rules | [`frontend/CLAUDE.md`](frontend/CLAUDE.md) |
| Scraper, PM2 and migration authoring rules | [`scripts/CLAUDE.md`](scripts/CLAUDE.md) |
| The migration record, order and rollbacks | [`scripts/migrations/README.md`](scripts/migrations/README.md) |
| Lifecycle and promotion authoring | [`docs/klup-product-lifecycle-guide.md`](docs/klup-product-lifecycle-guide.md) |
| The frozen 48 and the reasoning behind it | [`docs/klup-launch-catalogue-selection.md`](docs/klup-launch-catalogue-selection.md) |
| Read-only SQL | [`scripts/queries/README.md`](scripts/queries/README.md) |
| Anything else, and what is historical | [`docs/klup-documentation-index.md`](docs/klup-documentation-index.md) |

The Stage 3 specifications, build plan and readiness audit, the foundation
handover and `docs/klup-engineering-history.md` are **historical records**.
They describe decisions as they were made. Do not act on them as current
instructions, and do not rewrite them.

Product families (`Fender Stratocaster`) are navigation concepts that group
children but never aggregate listings or prices; concrete variants
(`Fender American Professional II Stratocaster`) are the terminal
listing/price/monitoring identities. Evocative labels (`The Time Machines`)
are editorial facets — never taxonomy replacements, never matcher aliases.

---

## 8. Stack

Next.js 14 App Router · TypeScript · Tailwind · Supabase Pro (RLS on every
table) · Vercel · PM2 on the Mac Mini · Resend · PostHog EU · Frankfurter with
hardcoded fallbacks.

**DNS is Simply.com. The Protonmail MX records must never be touched.**

Repo `SnagItOrg/SnagIt` · production `www.klup.dk`.
