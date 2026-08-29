---
name: klup-production-safety
description: Use before any action that touches Klup's live systems — reading or writing the production Supabase database, PM2 jobs on the Mac Mini, Vercel or cron configuration, .env files or secrets, or git operations across the ten shared worktrees. Covers what is a read, what is a write, what only the operator can do, and how to hand work over instead of guessing.
---

# Klup production safety

The **prohibitions** live in the root `CLAUDE.md` and are always loaded. This
skill does not restate, soften or reinterpret them — it explains how to work
correctly inside them, and what to do when you hit their edge.

If this skill and `CLAUDE.md` ever disagree, `CLAUDE.md` wins.

## Reads and writes are not the same act

**Reads need no ceremony.** `SELECT`, a read-only script in `scripts/queries/`,
`GET` against production, inspecting PM2 status, reading a Vercel setting. Do
these freely when they answer a real question. A read that informs a decision
is cheaper than a guess.

**Writes need explicit product-owner authorisation, every time.** Authorisation
for one write is not authorisation for the next one, and "the user asked me to
fix X" is not authorisation to write to production in order to fix X.

A write is anything that changes durable state:

- any `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `CREATE`, `DROP`, `TRUNCATE`;
- running a migration, an importer, a scraper, a matcher apply, a backfill, a
  rescrape or a population script;
- publishing a product, or widening the monitored set in
  `data/klup-source-monitoring.json`;
- changing PM2, Vercel, cron or DNS;
- pushing to `main` — which deploys, even for a docs-only change.

Some paths are writers even when they look like reads. `/api/cron/scrape` is a
writer. The admin cleanup routes are writers. `promote_scrape_run` is a writer.
`npm run import-kg` **full-replaces** identifiers, relations and synonyms and
would destroy the 053/054 curation — it is a fresh-database seeder, never a
production path.

When you need a write you are not authorised for: **stop, state exactly what
you would run, what it changes and how it is reversed, and ask.** Do not run a
smaller version of it to "check". Do not run it against production to see what
would happen.

## The Mac Mini and PM2

Run `hostname` first. Both the MacBook (`dev`) and the Mac Mini (`panter`) run
Claude Code natively, so do not assume you need an SSH hop, and do not assume
you are on the MacBook.

The Mac Mini owns the scraper runtime: 8 cron-scheduled PM2 jobs defined in
`ecosystem.config.js`.

- Start one job explicitly: `pm2 start ecosystem.config.js --only <name>`.
- **Never `pm2 resurrect`.** The saved dump predates the retirement of
  `match-listings`; resurrecting it would restore a job that must not run.
- `stopped` is the correct resting state for a cron-scheduled one-shot between
  firings. It is not a fault and does not need fixing.
- `pm2 stop` does not neutralise `cron_restart`. If a job genuinely must not
  fire, the schedule has to be removed or the job deleted — which is a
  configuration change and therefore operator work.

## The Vercel cron is Disabled, and stays Disabled

`/api/cron/scrape` ingests the same dba.dk source as the PM2 `scrape-dba` job
through a different `ON CONFLICT` target on a shared unique index, so an insert
whose `(external_id, source)` already exists under a different watchlist raises
a unique violation instead of upserting.

`frontend/vercel.json` still declares the schedule. **That is deliberate.** The
Disabled state lives at Vercel project level, not in the repository, and
deleting the declaration would be a deployment-affecting change. Do not "tidy"
`vercel.json`, and do not re-enable the cron. Re-enabling requires deciding
whether watchlist ingestion routes through the staging/promotion path — a
design decision, not a toggle.

Deployment is `git push` to `main`, through Vercel. **Never the Vercel CLI.**

## Secrets and local environment files

Never hardcode a secret, ask for one in chat, or let one reach a log line, a
response, a commit, a test fixture that gets committed, or a document.

`frontend/.env.local` is read-only to you. Do not copy it, rewrite it, relocate
it, or create `.env.local.*` variants. If a test needs a secret, generate a
synthetic value inside the test and keep it in a disposable file outside the
repository.

`CRON_SECRET` is a Vercel production variable and is intentionally absent
locally. Its absence is correct; do not add it.

Never log PII.

## Worktrees and branches

Ten worktrees share this repository. `git worktree list` shows them. Work only
in the one you were given, and never `cd` into another to "just check
something" — read the file through git instead (`git show <ref>:<path>`).

The **stash stack is shared across every worktree**, and other sessions may
push or pop it concurrently. A bare `git stash pop` can silently take someone
else's work.

- Prefer a WIP commit to set work aside.
- If you must stash: `git stash push -u -m "<unique-tag>"`, then recover with
  `git stash apply <sha>` — never `pop` — and drop the entry by re-finding it
  via your tag.

Commit and push only when asked. `main` deploys on push; a documentation-only
merge to `main` still redeploys production, so cleanup work waits and rides the
next intentional product release.

## Operator-only actions

These cannot be done from a coding session, whatever the reason. Name them and
hand them over:

- pausing or enabling Vercel cron, and any Vercel dashboard change;
- a real PM2 freeze (deleting jobs or removing schedules);
- direct PostgreSQL access for a logical backup **and a verified restore** — a
  backup that has not been restore-verified is not a backup;
- applying a migration through the Supabase Studio SQL editor;
- anything requiring ownership of `auth.users` (the still-enabled Supabase
  database webhook in release record §7 and §12);
- DNS at Simply.com. The Protonmail MX records must never be touched.

When you hand over, give the exact commands or dashboard steps, what the
expected result looks like, and how to tell if it went wrong.
