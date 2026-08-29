---
name: klup-delivery-discipline
description: Use when scoping a work package, deciding what belongs in this change versus a follow-up, or when about to write a specification, an audit, a plan document or new test infrastructure. Klup's recurring failure is that supporting material outgrows the shipped product; this sets the stop rules that keep a change small, shippable and customer-visible.
---

# Klup delivery discipline

This exists because of a measured pattern in this repository, not as general
advice.

Stage 3 produced roughly **407 KB of specifications, build plans, readiness
audits and hand-off notes**, and shipped five work packages — with WP-3 not
shipping at all. The documentation about the work outweighed the work. The
instructions at the time rewarded that: three separately-stated scope gates, a
seven-item authorisation list, and a fixed verification ritual, with nothing
anywhere that rewarded landing a change.

The corrective is not "write less". It is: **the deliverable is the change a
customer can see. Everything else is overhead and must justify itself.**

## The smallest coherent shippable change

Coherent means it stands on its own: it works, it is verified for its own
failure mode, and nothing is left half-migrated behind it. Smallest means
nothing beyond that.

Before adding anything to the current change, ask: *would a customer notice if
I left this out?* If no, and it is not required for the change to be coherent,
it is follow-up work.

Prefer three landed changes to one large one. A branch that has not merged has
delivered nothing, however good it is.

## Blocker or follow-up

Only three things are genuine blockers:

1. **It is wrong now** — the change is incorrect, or it breaks existing
   behaviour.
2. **It is unsafe** — data loss, exposure, an irreversible action, a
   production-safety boundary.
3. **It cannot be fixed later without redoing this work** — a data shape, a
   public URL, a contract someone else will build on.

Everything else is follow-up: polish, a nearby defect you noticed, a missing
abstraction, a test you would like to exist, an inconsistency in code you were
not sent to change.

Record follow-ups where they will be seen — a line in the release record, an
inline `TODO` at the site — and move on. **Do not open a new document to hold
them.** The P1–P8 backlog already exists in release record §10; add to it
rather than starting a parallel list.

## Stop rules

Stop and ask before you:

- **Write a new `docs/*.md`.** Almost never correct. A durable fact belongs
  next to an existing durable document or in the code that owns it; a finding
  belongs in the release record; a decision belongs in a commit message. If the
  fact has genuinely no home, say so and propose the smallest one.
- **Write a specification for work you could just do.** If the change is small
  enough to implement and show, implement it and show it.
- **Add test infrastructure** — a harness, a fixture framework, a new runner, a
  shared helper — rather than a test. Infrastructure is justified by the third
  case that needs it, not the first.
- **Refactor code you were not asked to change.** Every changed line should
  trace to the request.
- **Generalise.** No abstraction for one caller, no configuration option nobody
  asked for, no handling for a state that cannot occur.

None of these is forbidden. Each needs a sentence saying why it is worth the
delay to shipping.

## Product-owner checkpoints stay

Discipline about overhead is not licence to skip the checkpoints that exist on
purpose. These are deliberate, and they hold:

- Production writes, migrations, imports, scrapers, publishing and monitoring
  changes need explicit authorisation — see the root `CLAUDE.md`.
- WP-3, the P1–P8 backlog, and any new foundation, matcher, KG or product-data
  branch are unauthorised until a product owner schedules them.
- An authorised branch is authorisation to **ship it**, not to re-justify it
  and not to widen it.

When you hit a checkpoint, stop and ask with a concrete proposal. Do not route
around it, and do not pre-emptively narrow the work to avoid needing to ask.

## Surface assumptions instead of guessing

If two readings of the request lead to materially different work, say which one
you took and why, then keep going. State the assumption at the point it
matters, not in a preamble. An assumption written down is cheap to correct; an
assumption silently built on is not.

If part of the work turns out to be blocked, finish everything else in full and
say exactly what you left out and why. Scaling the work down is the product
owner's call.

## Historical documents

Stage 3 specifications, the build plan, the readiness audit, the foundation
handover and the engineering history are **records of decisions as they were
made**.

- Never delete one, and never rewrite a dated report to describe a later state.
  Historical accuracy is evidence.
- If a fresh reader could mistake one for current instructions, add a status
  notice — state the date, the status, and where the current authority lives.
- Do not mass-edit old notes for consistency of terminology.
- Correct contradictions in *current* documents directly, at the source.
