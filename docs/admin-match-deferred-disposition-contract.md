# Deferred `/admin/match` dispositions — the durable model they need

**Status: specification only. Nothing here is implemented, migrated or written.**
Companion to the shipped slice on `stage3/admin-match-dispositions-v1`.

This document exists because four operator judgements were designed, built, and
then deliberately **removed from the interactive path** before release:

- classify at the family / current-product level;
- variant cannot be determined;
- record an observed variant that has no node (Chamberlin *Model 30* / *Model 45*);
- cannot determine.

They were removed because the schema cannot store them without lying. They are
not abandoned — they are blocked on the columns below and a product-owner
decision. They are also **not** retained as session-only controls: a judgement
the operator makes, presses Save on, and silently loses is worse than one the
interface never offered.

---

## 1. Why `is_valid` cannot carry these meanings

`listing_product_match.is_valid` is a single three-valued column, and the
deployed system already assigns it a specific meaning:

| Value | Meaning today | Read by |
|---|---|---|
| `NULL` | Unreviewed automatic match; the matcher's contract treats it as trusted | Public product route (**rendered**) |
| `true` | Confirmed match | Public product route (**rendered**) |
| `false` | Explicit rejection | Public product route (**dropped**) |

The public product route filters `.not('is_valid','is',false)` — it keeps `NULL`
**and** `true`, and drops only the explicit rejection. So `is_valid` is
simultaneously acting as:

1. review disposition,
2. classification depth,
3. exact-product confidence,
4. public listing eligibility,
5. price-evidence eligibility.

Those five are independent, and the first release proves it by contradiction.

### The measured failure

An earlier draft of the shipped slice mapped `family_level → is_valid = true`.
Production holds `chamberlin-rhythmate` as **one** node; *Model 30* and *Model
45* do not exist as nodes. The two real listings are:

| Listing | Price | Honest classification |
|---|--:|---|
| Chamberlin Rhythmate 30 | 18.618 DKK | Rhythmate family, variant Model 30 |
| Chamberlin Rhythmate 45 (tape loop) | 38.520 DKK | Rhythmate family, variant Model 45 |

Both are genuinely "the Rhythmate family", so both would have been written
`is_valid = true` against the single node — and the public page would have
presented **one price history mixing two instruments that differ by more than
2x**, labelled as an exact product history. The operator's honest "I can see the
family but not the variant" would have been silently upgraded into "this is the
exact product, and this price is evidence for it".

`false` is no better: it is a semantic rejection, and these listings are not
wrong. `NULL` is worst of all — a candidate has no match row, so writing `NULL`
would **create** one, and because the public route keeps `NULL` the listing
would be published as evidence anyway, with no record that a human declined to
resolve it.

**There is no value of `is_valid` that means "correct family, unknown variant,
not price evidence".** That is the gap.

---

## 2. The minimum durable model

Five fields on `listing_product_match`. Each is independently justified; none is
derivable from the others.

### `review_disposition` — `text`, nullable

The operator's judgement, verbatim, separate from its eligibility consequence.

```
exact | family_level | variant_undetermined | accessory | wanted_ad
| wrong | cannot_determine | moved_to_other_product
```

Nullable because the matcher writes rows no human has judged. Today this is
squeezed into `explain.admin_decision.disposition`, which is fine for audit and
useless for querying: JSONB cannot be indexed usefully here without a decision
about which keys matter, and "how many listings await variant resolution" is a
question the operator will ask.

### `classification_depth` — `text`, nullable

How precisely the listing was resolved, which is **not** how confident the
operator is and **not** whether it is eligible.

```
exact_leaf | branch | family_only | unresolved
```

`family_only` is exactly the state that has no home today. It is a complete,
valid answer — the operator is not required to name a leaf — and the product
must be able to say "these 14 listings are Rhythmates, and we do not know which
model" without pretending they are one product.

### `suggested_product_id` — `uuid`, nullable, FK `kg_product(id)`

A *proposal*, not a match: "this probably belongs to that product, but I am not
asserting it". Distinct from the shipped `move_to_existing_product`, which is an
assertion and writes a real match on the target.

It must **never** confer ranking, price evidence, matcher eligibility,
`support_state` or promotion state on its target. A suggestion that silently
became evidence would reintroduce the same defect one level up.

### `observed_variant` — `text`, nullable

The variant label the operator read on the listing, when no node exists for it:
`"Model 45"`. An **audit string, never an identifier** — nothing resolves it
back to a node and nothing creates a node from it.

Its value is cumulative rather than immediate: once forty listings carry
`observed_variant = 'Model 45'`, the case for creating that node is evidence
rather than intuition. That is the intended path from "missing node" to "node",
and it runs through a product-owner decision, not through this surface.

### `price_evidence_eligible` — `boolean`, nullable

**The load-bearing field, and the one that makes the rest safe.**

It separates *may this listing appear on the product page* from *may its price
enter the product's price history*. A family-level Rhythmate is legitimately
the former and must not be the latter.

The public product route would then read:

- listings: `is_valid IS NOT FALSE` (unchanged);
- price evidence: `is_valid IS NOT FALSE AND price_evidence_eligible IS NOT FALSE`.

Nullable, and `NULL` means eligible, so every one of the ~31,700 existing rows
keeps its current behaviour with no backfill.

---

## 3. Disposition → field mapping (deferred)

| Disposition | `is_valid` | `classification_depth` | `price_evidence_eligible` |
|---|---|---|---|
| `exact` | `true` | `exact_leaf` | `true` |
| `moved_to_other_product` | `true` on target | `exact_leaf` | `true` |
| `family_level` | `true` | `family_only` | **`false`** |
| `variant_undetermined` | `true` | `unresolved` | **`false`** |
| `accessory` / `wanted_ad` / `wrong` | `false` | — | `false` |
| `cannot_determine` | `NULL` | `unresolved` | **`false`** |

The two shipped positive dispositions are the top two rows. Every deferred row
needs a `false` in the last column, and that column does not exist — which is
precisely why they are deferred rather than approximated.

Note `cannot_determine` becomes *writable* under this model: with
`price_evidence_eligible = false` it can create a row at `is_valid = NULL`
without publishing the listing as evidence. Today it cannot, because `NULL` is
rendered.

---

## 4. What this needs, and what it must not become

**Needs:** one migration adding five nullable columns; a read-path change in the
public product route for price evidence only; and a product-owner decision,
since §2 and §5 of the root `CLAUDE.md` place migrations behind explicit
authorisation.

**Must not become:** a KG ontology. Parent/child plus an optional suggestion is
the entire relation model. No node types, no attribute schema, no equivalence
classes, no era or lineage graph. Nothing on this surface may create a
`kg_product` row, and `suggested_product_id` is a suggestion attached to one
listing decision — never a product-to-product relation.

---

## 5. Rewriting an already-persisted match needs a transactional writer

A sixth deferred capability, discovered during the first release rather than
designed: **reassigning a listing that already holds a match.**

The shipped assignment is safe because of an invariant, not because of a
transaction. `/api/admin/match/candidates` excludes any listing that already
holds a `listing_product_match` row for the reviewed product, whatever its
verdict, so a candidate reaching the UI has no row on that product. Assigning it
to another product is therefore a single insert with nothing left behind, and
the writer emits exactly one row per decision.

The moment the listing *does* hold a match on the reviewed product, the
operation changes shape. It becomes two facts that are only jointly correct:

1. the new product gains a positive match;
2. the old product loses its positive match.

Apply the first alone and the listing is price evidence for two products at
once. Apply the second alone and it is evidence for neither. Neither halfway
state is a state the operator asked for, and neither is self-correcting.

An earlier draft planned both rows and relied on them landing together. They did
— the route issues one multi-row upsert, which is a single
`INSERT ... ON CONFLICT` statement and therefore atomic in Postgres — but
nothing in the code stated it, no test pinned it, and the guarantee rested on an
implicit property of PostgREST rather than on anything this repository asserts.
A safety property that holds by accident is one refactor from not holding.

So the first release **refuses** the case with `409` and writes nothing. What it
needs to stop refusing:

- a writer that moves both rows in one explicit transaction — a Postgres
  function invoked through `rpc()`, since PostgREST offers no multi-statement
  transaction over the REST interface, and a migration to define it;
- a decision about what a demoted source row should say. `is_valid = false` with
  a `moved_to_other_product` reason is the obvious encoding, but it records a
  rejection the operator never made — they said "it belongs there", not "it is
  wrong here". Under §2 this is properly `price_evidence_eligible = false` with
  the disposition retained, which is another reason the two changes belong
  together;
- a concurrency answer. Two operators reassigning the same listing must not
  interleave into two positive matches; the unique index prevents duplicates per
  pair but not a contradictory pair of pairs.

Until all three exist, correcting a persisted match belongs on the product page
that owns it, and this surface says so instead of guessing.

---

## 6. Until then

The shipped release offers six actions, and every one of them resolves to an
exact product or writes nothing:

| Action | Persisted |
|---|---|
| Exact match on selected product | `is_valid = true` on the selected product |
| Match med andet produkt | `is_valid = true` on the named target, and nothing else. Refused with `409` if the listing already holds a match on the reviewed product — see §5 |
| Accessory/part | `is_valid = false`, structured reason |
| Wanted ad | `is_valid = false`, structured reason |
| Wrong/irrelevant | `is_valid = false`, structured reason |
| Skip | nothing |

A Chamberlin listing whose variant cannot be determined is therefore **skipped**,
not approved. It stays in the queue, and nothing false is written about it —
which is the correct behaviour for a system that cannot yet record the truth.
