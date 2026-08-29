---
name: risk-based-verification
description: Use when deciding how to verify a change, before claiming something works, or when a verification step looks expensive and you are tempted to skip it. Selects verification from the change's actual failure mode — unit test, real-browser smoke, rendered visual check, HTTP truth table, isolated migration rehearsal — instead of running a fixed command list or writing tests to raise a count.
---

# Risk-based verification

Verification is chosen by asking **how would this break, and what would notice?**
A fixed ritual run against every change is not rigour: it is expensive on
changes that cannot fail that way, and silent on the way they actually fail.

Two hard rules:

- **Never write a test whose only purpose is to increase the test count.** A
  test that cannot fail for a real defect is a maintenance cost pretending to
  be safety.
- **Never verify by invoking a production writer path.** Not once, not with a
  small input, not "to see what happens". If the only way to check something is
  to write to production, the answer is to ask, not to write.

## Pick the check that matches the failure mode

| The change is… | It fails as… | So verify with |
|---|---|---|
| Pure logic — a predicate, a normaliser, a resolver, a price calculation | wrong output for an input | one focused unit test per real branch, on the boundary case that motivated the change |
| Browser behaviour — hydration, client/server module boundaries, consent, event wiring | correct on the server, broken in the browser | a real-browser smoke run of the actual page; a unit test cannot see this |
| Visual — tokens, colour, elevation, typography, layout | renders wrong, or unreadable | render it and look: both themes, narrow and wide viewports, and a contrast check on text over its real background |
| Authentication or route access | the wrong person gets a 200 | an HTTP truth table: each role × each route → expected status, run and recorded |
| A database migration | destroys or exposes data, and cannot be undone | rehearsal on the disposable local cluster, `bash scripts/verify-migrations-isolated.sh`, plus its rollback |
| Any writer path — ingestion, promotion, matcher apply | writes the wrong rows, irreversibly | a scratch or isolated environment only, never production |
| Derived data artefacts | silently drift from their immutable sources | `npm run validate-activation` |

If a change spans two rows, it needs both checks. If it matches none, say what
you did to convince yourself and why that was enough.

## Scale the check to the blast radius

Ask what the worst realistic outcome is, then spend proportionately.

- **Reversible and local** — a token value, a copy string, a comment. Render it
  or read it. Do not run the full suite.
- **Reversible but user-visible** — a component, a route, a query. Run the
  tests that cover it, plus the smoke that matches its failure mode.
- **Hard to reverse** — anything touching data shape, auth, or a writer.
  Rehearse in isolation first, and write down what you expected before you run
  it so you cannot rationalise the result afterwards.

A change that cannot affect the matcher does not need the matcher suite. A
change that cannot affect migrations does not need the migration harness.
Skipping an irrelevant check is correct; say which checks you skipped and why.

## Run it, do not quote it

Counts belong to the run. Do not report a number you did not just produce, and
do not carry a number forward from a document — the totals once written into
`CLAUDE.md` went stale across three releases and turned a real gate into
decoration.

A fresh worktree has no dependencies installed. `npm run typecheck` then
reports `tsc: command not found`, and a few root tests fail on a missing
`node_modules/.bin/tsx`. **Those are environment failures, not regressions.**
Establish the baseline before you change anything, and compare your run against
your own baseline — never against a written one.

## Reporting

Say what you ran, what it showed, and what you did not run. If a check could
not execute, say so plainly rather than implying it passed. "I could not run
the migration harness because there is no local PostgreSQL" is a useful
sentence; silence in its place is not.

If something failed, show the output. Do not describe a failure you have
paraphrased.
