# PAN-95 — qualify listings with a model, not a price threshold

**Status: a dry run and a measurement. Nothing has been written.**
No `is_valid` was set, no migration ran, no apply path exists in the code this
adds. Applying a pass is a separate action that needs the product owner's
authorisation, each time (CLAUDE.md §2).

Everything below is measured against production on **2026-09-20** by SELECT
only. The backlog grows while scrapers run — two reads twenty minutes apart
returned 1,764 and 1,769 unreviewed rows — so treat every count as a snapshot
of its run, not a constant.

---

## 1. Why the threshold goes

A price floor answers a different question from the one a match row asks. The
row asks *is this listing this product?*; a floor asks *is this listing
expensive enough?* The two come apart in both directions, and both directions
are already in the data:

- **Cheap and genuine.** `frontend/lib/matching/listing-intent.ts` records the
  class in its own comments: a Roland SH-101 at 7.500 DKK against a ~15.000 DKK
  band is exactly the bargain Klup exists to surface. In this run's sample a
  Yamaha DX7 at 1.863 DKK, a TR-606 at 2.935 DKK and a Les Paul Studio at 5.000
  DKK are all genuine and all kept.
- **Expensive and not the product.** A Moog Model D ATA flightcase at 7.076 DKK
  clears any floor that would keep those three.

There is also a plainer reason, which is the one that ends the argument:

> **5 of the 58 supported products carry a `price_min_dkk`/`price_max_dkk` band
> at all.** For the other 53 a price rule has nothing to compare against.

And per the standing note on price evidence, the five bands that do exist are
Reverb comps — asking-side US evidence, not Danish sold history. A threshold
built on them would be a threshold built on another market.

So price is removed **by construction, not by instruction**.
`buildIdentityPayload()` in `scripts/lib/match-qualification.ts` is the only
thing that builds the judge's view, `MODEL_PAYLOAD_KEYS` enumerates every key
it may contain, and a test fails if either admits a key matching
`/price|dkk|currency|msrp|thomann|cost|value/`. A later edit that softens a
sentence in the prompt cannot reintroduce the threshold; it would have to
change a list that a test compares against a deny-list.

Price still reaches the **manifest**, because the human vetoing a row should
see it. It just cannot reach the judgement.

---

## 2. What the judge sees instead

Identity, and the competition for it:

| field | why |
|---|---|
| `listing_title` | the only description the sources reliably give |
| `candidate_product`, `candidate_model_name` | the identity being claimed |
| `candidate_brand`, `candidate_subcategory` | disambiguates a shared word |
| `sibling_products` | **every other matchable row of the same brand** |
| `matcher_method`, `matcher_score` | context, never a verdict |
| `deterministic_signal` | `listing-intent`'s finding, if any — see §4 |

The sibling list is the part that fixes a live failure. Two
*Fender American Ultra II Telecaster* listings sit unreviewed on
`fender-telecaster-custom` (SYNONYM/80) while
`fender-american-ultra-ii-telecaster` has its own supported row. A judge shown
only the candidate cannot notice; a judge shown the sibling can. Brand is the
right axis because brand is where title-level confusion actually runs — the
matcher's brand guard has already separated everything else — and the lists are
small: Roland 13, Gibson 10, Fender 8, and one or two for most brands.

### There is no `move_to_existing_product`

When the judge believes a sibling owns the listing it returns `wrong` on the
reviewed product and names the sibling in `competing_slug`, **audit only**.
Nothing is written against the sibling. This is not a shortcut:
`planWrites()` in `frontend/app/admin/match/dispositions.ts` **refuses** a move
whenever a row already exists on the reviewed product — and in this pipeline one
always does, because the pipeline exists to qualify rows that already exist.
Re-pointing a persisted match needs both ends to move together and is specified
in `docs/admin-match-deferred-disposition-contract.md`. It is not approximated
here.

---

## 3. Abstain is a verdict

`abstain` maps to the existing `skipped` disposition, which persists nothing.
Under PAN-93 only `is_valid = true` prices a product, so an abstained row prices
nothing; the cost of abstaining is a later look, and the cost of deciding wrong
is a deleted bargain or a corrupted price history. The prompt says so in those
terms, and a judge that fails to answer at all is recorded as an abstention
rather than retried into a decision — one row in the sample came back unanswered
and abstained safely.

**16 of the 100 sampled rows abstained, and 14 of those 16 have the same
cause**, which is the most useful thing this exercise found:

> The guitar backlog's dominant problem is catalogue **depth**, not match
> correctness. A generic row (`fender-telecaster-thinline`,
> `gibson-les-paul-studio`, `gibson-hummingbird`) faces a listing naming a
> sub-model at a different market tier — Vintera II at 7.828 DKK and American
> Vintage II at 18.264 DKK and a Custom Shop '50 at 37.338 DKK, all "Telecaster
> Thinline"; Studio Session, Studio Deluxe II, Hummingbird Studio, Special
> Tribute.

Approving those is precisely the Chamberlin Rhythmate Model 30/45 failure that
`dispositions.ts` exists to prevent — one price history mixing instruments that
differ by more than 2x, presented as exact. Rejecting them throws away real
supply. Neither is available, so the judge declines, and **no model can fix
this** — it needs rows the catalogue does not have. That is a product-owner
decision about catalogue depth, not a matcher or a prompt problem.

Context for how large that is: 855 of the 1,764 unreviewed rows are on
electric guitars, 203 more on acoustic guitars, and 864 sit on 18 products with
**zero** approved matches ever.

---

## 4. The deterministic guard signals; it does not decide

The brief said guards run first and the model handles only what survives them.
Guards do run first. They no longer decide alone, and the measurement is why.

Running `detectNonProductIntent()` across all 1,764 unreviewed rows:

- it fires on **18 rows — 1.0% of the backlog**. Letting it decide alone saves
  one batch of tokens, not a tier of the pipeline;
- hand-checked, **13 of the 18 are right**. The five that are not are the
  expensive class:

| listing | price | token | truth |
|---|---|---|---|
| Roland TR-909 Rhythm Composer eprom v4 | 49.903 DKK | `eprom` | complete TR-909, condition Fair |
| Roland TR-909 Rhythm Composer eprom v4 | 42.224 DKK | `eprom` | same listing, second row |
| Roland Juno-106 &#124; Fully Serviced &#124; Borish Voice Chips | 16.728 DKK | `chips` | complete serviced Juno-106 |
| Roland Juno-106 Poly Synth (Serviced) New Voice Chips/Sliders/Knobs | 10.430 DKK | `chips` | complete serviced Juno-106 |
| Yamaha DX7 - 6 Cartridges & Flightcase | 5.215 DKK | `cartridges` | reads as a DX7 sold with cartridges |

`listing-intent.ts` was derived as a **deferral** rule for the matcher, where
firing writes no row and the listing stays recoverable by the next run. Here the
same token would write `is_valid = false` on a row that already exists, and
after PAN-93 that is the difference between a 49.903 DKK instrument being priced
and being deleted. Same vocabulary, different cost of being wrong.

So the finding travels to the judge as `deterministic_signal` and is carried
into the manifest either way, so a human can see what fired and disagree. The
guard keeps its cheapness and its reviewability; it loses only the authority to
be wrong on its own.

`chip`/`chips` and `eprom` belong to `listing-intent.ts`, which **PAN-96 owns**.
This change does not edit that file. The five rows above are handed over as
evidence, not patched around.

---

## 5. The measurement — 100 hand-checked rows

**Sample.** The 100 rows with the lowest `md5(match_id)` among all unreviewed
matches on the matchable cohort — reproducible, and independent of insert order
or of anything the judge can see.

**Protocol.** Every row was hand-labelled **before the judge ran**, from the
listing title, price, currency, source, condition and (where it mattered) the
listing URL — evidence the judge is deliberately denied. Labels and one-line
reasons are in [`pan-95-handcheck-sample.tsv`](pan-95-handcheck-sample.tsv), so
the labels can be vetoed as readily as the verdicts.

The labelling rule, stated so it can be argued with: **exact** when the listing
denotes the product identity, differing only in finish, colour, year, serial,
fingerboard, handedness, condition, bundled accessories or a fitted upgrade;
**abstain** when it names a sub-model at a distinct market tier the catalogue
has no row for; **wrong/accessory/wanted_ad** otherwise.

### Result

| | n | correct | precision |
|---|---|---|---|
| **approve (`exact` → `is_valid = true`)** | **74** | **73** | **98.6%** |
| **reject (→ `is_valid = false`)** | **10** | **9** | **90.0%** |
| decided, either way | 84 | 82 | 97.6% |
| abstained | 16 | — | — |

Recall on the class that matters: 77 rows were hand-labelled `exact`, and 73 of
them were approved — **94.8%**. Of the four not approved, three abstained and
one was the TR-909 below.

Cost: **$0.67 for 100 rows** on `claude-opus-5` with adaptive thinking
(60.842 input / 14.606 output tokens).

### Both errors, in full

**The one bad approval** — `Gibson Les Paul Custom Pro Gold Mist Finish Custom
Shop Original` on `gibson-les-paul-custom`, approved at **confidence 62**. Hand
label: abstain — "Custom Pro" is a named Gibson USA variant and the title also
claims Custom Shop, which cannot both be true.

It was the **only approval below confidence 70** in the sample. The other 73
approvals sit at 70+ and every one is correct, so an approval floor at 70 would
have given 73/73 = 100% approval precision at zero recall cost *on this sample*.
That rests on a single data point, so it is **not implemented in the code** — the
manifest carries `confidence` on every row and the floor belongs to the apply
step, where the owner sets it against a number they have seen.

**The one bad rejection** — `Roland TR-909 Rhythm Composer eprom v4`, rejected
`accessory` at confidence 95. It is a complete TR-909 at 49.903 DKK. This is the
honest cost of withholding price: on the title alone the listing genuinely reads
as an EPROM, and the two things that disambiguate it are the price and the
Reverb URL, neither of which the judge is given. The correct verdict was
abstain.

The design accepts that trade deliberately: one high-value false reject that a
human catches from the price column in the manifest, in exchange for immunity
from the entire class of false rejects a threshold creates. It is also the row
where the guard's signal and the judge agreed — the hint propagated the guard's
bias, which is worth watching if the signal is ever weighted more heavily.

### What this number is not

I labelled the sample. I am not an independent human reviewer, and on the
sub-model rows the judge and I are drawing the same line for the same reasons.
The number is a real measurement of a real disagreement rate, but the owner
should spot-check a block of the manifest before authorising anything — the two
places to look are the low-confidence approvals and the rejections above 10.000
DKK.

---

## 6. The four scenarios, on production rows

| scenario | row | verdict |
|---|---|---|
| cheap genuine instrument kept | `Yamaha Dx7,,Softcase.+Hc 701 Card 15000,+,Ser-7,,+OLED Display` — **1.863 DKK**, Kleinanzeigen | `exact` (85) |
| | `Gibson Les Paul Studio` — **5.000 DKK**, dba.dk | `exact` (88) |
| expensive part rejected | `Moog Music Model D ATA Flightcase (RES-RC-008)` — **7.076 DKK** | `accessory` (93) — dearer than the two instruments above |
| sibling's listing not stolen | see §7 | |
| | `1973 Moog Minimoog Model D w/ Road Case Signed by Herbie Hancock` on `moog-minimoog`, with `moog-model-d` (the 2016 reissue) offered as a sibling | `exact` (95) — the sibling was **not** taken |
| ambiguous title abstained | `2019 Fender Custom Shop '50 Telecaster Thinline in Orange Sparkle` — 37.338 DKK | `abstain` (65) |
| | `Gibson ES-335 Dot Left-Handed 1991 - 2014` — judge returned no verdict | `abstain` — unanswered fails safe |

---

## 7. Reversing a pass

Every planned write carries one key, in the shape the sweep already in
production uses (`pan-96/pickguard-sweep-2026-09-20`, 160 rows):

```
explain -> admin_decision ->> decision_source  =  'pan-95/qualification-<run-id>'
```

Count what a pass touched, before or after:

```sql
select explain->'admin_decision'->>'decision' as decision, is_valid, count(*)
from listing_product_match
where explain->'admin_decision'->>'decision_source' = 'pan-95/qualification-2026-09-20'
group by 1, 2;
```

Undo it completely — one statement, restoring the unreviewed state the pass
found, and no other pass can be caught by it:

```sql
update listing_product_match
set is_valid        = null,
    rejected_reason = null,
    explain         = explain - 'admin_decision'
where explain->'admin_decision'->>'decision_source' = 'pan-95/qualification-2026-09-20';
```

Two properties make that safe, and both are pinned by
`scripts/lib/match-qualification.test.ts`:

- **the pass never touches a row it did not decide.** Abstentions write nothing,
  so a row it declined is not in the set and cannot be disturbed by the reversal.
- **`explain - 'admin_decision'` restores the matcher's own explain**, because
  the planner merges into a prior explain rather than replacing it, and keeps
  the prior `method`/`score` — a SYNONYM/80 row stays SYNONYM/80 rather than
  being stamped FUZZY/1.

The reversal is only complete for rows this pass was the **first** to decide,
which is exactly its scope: it reads `is_valid IS NULL` only, so every row it
plans was unreviewed when it read it. A row a human decides between the dry run
and the apply must be excluded at apply time by re-reading `is_valid IS NULL`,
not assumed away.

---

## 8. What this does not change

- **`isMatchableProduct()` is untouched.** The pipeline imports it and filters
  with it. Qualification decides which of the matches that already exist may
  price a product; it does not widen what may be matched. The five axes stay
  separate (CLAUDE.md §5).
- **No writer path exists.** `scripts/qualify-matches-dry-run.ts` contains no
  `.update`, `.insert`, `.upsert`, `.delete` or `.rpc`, and no `--apply` flag.
- **`listing-intent.ts` is not edited** — PAN-96 owns it.
- **PAN-93 is assumed, not implemented.** This design is written for the world
  where only `is_valid = true` prices a product. Applied *before* PAN-93 lands,
  the 84 approvals in a 100-row pass change nothing (an unreviewed row is
  already trusted) while the rejections take effect immediately — so the safe
  order is PAN-93 first, then a pass, then the abstentions.

## 9. Recommendation

Proceed, with three conditions:

1. **PAN-93 first.** Until only `true` prices a product, an abstention is not
   actually safe — an unreviewed row is trusted today.
2. **Set an approval confidence floor at the apply step**, and have the owner
   spot-check the low-confidence approvals and the high-value rejections in the
   manifest before the first pass. 70 is the number this sample supports; it
   rests on one row.
3. **Take the depth question to the product owner separately.** Roughly a sixth
   of the sample — and a much larger share of the 1.058 unreviewed guitar rows —
   is not a matcher problem at all. It is a catalogue that has one
   `fender-telecaster-thinline` row for instruments that trade between 7.828 and
   37.338 DKK. No prompt fixes that.
