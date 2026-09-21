# PAN-95 — qualify listings with a model, and price as evidence not a rule

**Status: a design, two measurements, and no apply path.** The code here still
holds no `.update`, `.insert` or `.upsert` and takes no `--apply` flag.
Applying a pass is a separate action that needs the product owner's
authorisation, each time (CLAUDE.md §2).

**The 2026-09-20 pass WAS subsequently applied**, outside this branch: 1.254
rows carry `is_valid = true` and 237 `is_valid = false` under
`decision_source = 'pan-95/qualification-2026-09-20'`, read 2026-09-21. §7's
reversal statement is therefore live, not hypothetical, and §5b's revision is
measured against a database that already contains that pass. Five of its
approvals have since been reversed by hand under
`pan-95/price-context-review-2026-09-21`; those five are the fixture in §5b.

Everything below is measured against production by SELECT only — §1–§6b on
**2026-09-20**, §5b on **2026-09-21**. The backlog grows while scrapers run —
two reads twenty minutes apart returned 1,764 and 1,769 unreviewed rows — so
treat every count as a snapshot of its run, not a constant.

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

And the `kg_product` band is not a usable comparator anyway:

> **5 of the 58 supported products carry a `price_min_dkk`/`price_max_dkk` band
> at all.** For the other 53 it has nothing to compare against.

Per the standing note on price evidence, the five that do exist are Reverb
comps — asking-side US evidence, not Danish sold history. A threshold built on
them would be a threshold built on another market.

**None of that is an argument for hiding price from the judge, and the first
version of this design made exactly that mistake.** It removed price from
`buildIdentityPayload()` by construction and pinned the removal with a test.
That over-generalised: refusing to *threshold* on price and refusing to *show*
it are different acts, and §5b measures what the second one cost. What replaces
it is in §2b — the product's own **adjudicated** population, which is a real
comparator on 49 of the 50 products with unreviewed rows, and which no code in
this pass compares against a constant.

---

## 2. What the judge sees

Identity, and the competition for it:

| field | why |
|---|---|
| `listing_title` | the only description the sources reliably give |
| `candidate_product`, `candidate_model_name` | the identity being claimed |
| `candidate_brand`, `candidate_subcategory` | disambiguates a shared word |
| `sibling_products` | **every other matchable row of the same brand** |
| `matcher_method`, `matcher_score` | context, never a verdict |
| `deterministic_signal` | `listing-intent`'s finding, if any — see §4 |
| `price_context` | the listing's price against the product's own — see §2b |

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

## 2b. Price context — evidence, never a rule

`price_context` carries four things and a count:

| field | source |
|---|---|
| `listing_price_dkk` | the listing's asking price, normalised. `0` is not a price — on dba.dk that is how a *byttes* / *vurderes solgt* row renders, and three sit in the 2026-09-20 manifest. It becomes `null`. |
| `product_median_dkk` | median over listings a decision has already confirmed on this product (`is_valid = true` — PAN-93's `isPriceEvidence`), gated at `MIN_DESCRIPTIVE_MEDIAN_N` |
| `product_q1_dkk`, `product_q3_dkk` | the same population's quartiles, gated at `MIN_BAND_N` |
| `adjudicated_n` | how many confirmations the numbers rest on |
| `listing_pct_of_median` | the ratio, one decimal |

Both gates and the quantile estimator are the repo's own
(`price-populations.ts`, `statistics.ts`), so this pass cannot show a number a
product page would refuse to. Every field fails to `null` independently; none
is ever substituted with a default that would read as a measurement.

**Coverage, measured 2026-09-21.** Of the 50 products carrying unreviewed rows,
**49 have an adjudicated median and 44 have n ≥ 8**. That is the comparator the
`kg_product` band could not be: it exists, it is denominated in DKK, and it is
built from decisions this catalogue actually made.

**Nothing in the code thresholds on it.** There is no constant to compare a
ratio against, in this module or in the manifest planner. The ratio is text in
a payload; the prompt states in as many words that a low ratio is a reason to
look harder at the title and never a reason to reject, and §5b measures whether
that held.

**It is bootstrapped, and that is worth stating plainly.** Because the
2026-09-20 pass was applied, part of each product's adjudicated population is
that pass's own output — for `gibson-les-paul-custom`,
`gibson-les-paul-special`, `gibson-es-335-dot` and `fender-telecaster-thinline`,
all of it. Excluding the pass moves the median by 0–5% on most products, 11% on
`yamaha-dx7` and 27% on `roland-sh-101`. A median over n ≥ 8 is robust to the
handful of errors such a pass contains, which is why this is usable; it is not
an argument for letting a pass feed itself indefinitely without human sampling.

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

The abstain class is not an artefact of this judge, either. 152 of the
unreviewed rows already carry an `ai_pass1` verdict from the earlier Sonnet
sweep and 111 an `ai_pass2` second opinion, and they are still unreviewed —
two passes have now declined them. A third model will not settle them; a
catalogue decision will.

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
listing URL — evidence the judge was denied *in this run*; §5b re-measures the
same 100 rows once price is given back. Labels and one-line
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

**Superseded by §5b.** The design used to accept that trade deliberately — one
high-value false reject a human catches from the manifest, in exchange for
immunity from the class a threshold creates. That was a false choice: given the
price context this row comes back `exact` at 93.7% of median, and the immunity
is kept because nothing thresholds. It is also the row
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

## 5b. The revision — what the price context changed

Measured **2026-09-21**, same 100 rows, same hand labels, same model
(`claude-opus-5`, adaptive thinking), same scoring. Re-run from this branch
rather than quoted, so the before column is a run of mine and not the number in
§5.

| | approve n | approve precision | reject n | reject precision | abstain | recall on `exact` |
|---|---|---|---|---|---|---|
| §5, as published | 74 | 98.6% | 10 | 90.0% | 16 | 94.8% |
| **before**, my run 1 | 73 | **100.0%** | 10 | **90.0%** | 17 | 94.8% |
| **before**, my run 2 | 72 | **100.0%** | 10 | **90.0%** | 18 | 93.5% |
| after, first prompt | 81 | 93.8% | 10 | 100.0% | 9 | 98.7% |
| **after**, run 1 | 76 | **100.0%** | 9 | **100.0%** | 15 | **98.7%** |
| **after**, run 2 | 76 | **100.0%** | 9 | **100.0%** | 15 | **98.7%** |

The revision is **better on reject precision (90.0% → 100.0%), equal at ceiling
on approve precision, and better on recall (94.8% → 98.7%)** while abstaining
slightly less. Cost per 100 rows rises from $0.72 to $0.80 — input tokens
+26%, which extrapolates a full 1.764-row pass from ~$12.2 to ~$13.6.

**The one reject that price fixed** is the row §5 named as the honest cost of
withholding it: `Roland TR-909 Rhythm Composer eprom v4`, a complete TR-909 at
42.224 DKK, rejected `accessory` at confidence 95 in both before runs. With the
context it reads *93.7% of median* and comes back `exact`. That error was never
the model's; it was the input's.

### The middle row of that table is the finding

The first prompt gave the judge price and lost approve precision — 93.8%, five
bad approvals. Every one was a row hand-labelled `abstain`: *Les Paul Studio
Session*, *Studio Deluxe II*, *FSR American Vintage '72 Thinline*, a Custom
Shop *Hummingbird*. All sat at an ordinary ratio (60%, 102%, 116%, 157%), and
the judge read *ordinary* as *confirmed*, abstaining on 9 rows where it had
abstained on 17.

That is a real hazard of showing price and it needed the mirror statement, not
a tuning pass: **a normal ratio is not reassurance and settles nothing.** Two
sub-models of one line trade at similar levels — that similarity is precisely
why the catalogue cannot hold them under one identity — so the ratio can never
separate them, and the sub-model abstention rule is untouched by price. With
that sentence in the prompt the abstentions return (15) and both precisions sit
at 100%, reproducibly across two runs.

### The six held-back rows

Five were adjudicated by hand after the pass — four `wrong`, one `accessory`,
stamped `pan-95/price-context-review-2026-09-21`. The sixth, *Moog Source Mid
1980's* at 1.305 DKK, was deliberately left unreviewed as undecidable.

| row | DKK | % of median | before | after (both runs) |
|---|---|---|---|---|
| 1978 Gibson Les Paul Custom 1-ply Cream W/Bracket | 293 | 0.9% | `exact` 88 | **`accessory` 96** ✓ |
| made in Canada Gibson Les Paul Special Single Cut | 913 | 7.9% | `exact` 58 | **`wrong` / `accessory`** ✓ |
| Roland TR-808 Rhythm Composer 1982 - Black | 2.306 | 5.1% | `exact` 96 | `abstain` 70 |
| Roland Juno-106 synthesizer med tangenter | 740 | 5.4% | `exact` 93 | `abstain` 72 |
| Roland Juno-6 synthesizer keyboard | 740 | 5.1% | `exact` 95 | `abstain` 70 |
| Moog Source Mid 1980's | 1.305 | 7.5% | `exact` 92 | **`abstain` 65** ✓ |

**Before: six approvals out of six. After: none.** Three land on `abstain`
where the human reached `wrong`, and the target — five rejections and one
abstention — is not met.

That gap should not be closed by prompt pressure, and this revision does not
try. The judge's own stated reason on those three is that a bare title at 5% of
median gives it nothing concrete to name; the human who wrote `wrong` had the
listing page. "Very low ratio plus a bare title ⇒ reject" is a threshold
wearing a sentence, and it is the rule that would start deleting the cheap
genuine instrument again. An abstention writes nothing and leaves the row for
that human. The material change is that **none of this class now enters the
price evidence**, which is what the approvals were doing.

### The cheap-but-genuine class is intact

The sanity check the owner asked for, run on real rows rather than an invented
one: all **21 approvals in the 2026-09-20 manifest that sit between 12% and 50%
of their product's adjudicated median**.

**Zero were rejected.** 17 came back `exact`, 4 abstained — and all four
abstentions are sub-model rows (two *Telecaster Thinline* variants, a Limited
Edition '72 *Telecaster Custom*, a sparse *Korg MS 20 Synthesizer*), the
sub-model rule firing, not a price rejection. Among the approvals:

| row | % of median | verdict |
|---|---|---|
| Roland SH-101 32-Key Monophonic Synthesizer 1982-1986 - Gray | 42.6% | `exact` 90 |
| Yamaha DX7 FM-Synthesizer | 23.4% | `exact` 78 |
| Roland TR-909 Rhythm Composer Drum Machine **BAD SHAPE For Parts / Repair** | 35.8% | `exact` 88 |
| Roland Space Echo RE-201 | 37.3% | `exact` 90 |

The TR-909 row is the one to read twice: a title that says *For Parts / Repair*
at 36% of median is still the instrument, because condition is not identity.

### On "should we use better models?"

The numbers say the model was not the limit. `claude-opus-5` is the largest in
the family and it is what both columns ran on — same model, same rows, same
labels. Reject precision moved 90% → 100% and recall 94.8% → 98.7% because the
input changed, not because the judge did. The TR-909 is the clearest single
case: no amount of model capacity recovers a fact that was withheld.

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

### The sibling case, from the full run

Both rows named in the brief:

```
Fender American Ultra II Telecaster Ultraburst (Serial #US26001952)        15.003 DKK
Fender American Ultra II Telecaster Ultraburst Maple Fingerboard           14.754 DKK
```

on `fender-telecaster-custom`, matcher SYNONYM/80, both unreviewed. The judge
returned **`wrong` at confidence 94** on both, with
`competing_slug = fender-american-ultra-ii-telecaster` and the evidence
*"'American Ultra II Telecaster' is a listed sibling"*. Nothing is written
against the sibling; it is recorded so an operator can re-point the listing
through the path that owns that operation.

Ten rows in the full manifest name a competing sibling. The most interesting is
the pair that runs both ways: `Moog Model D 1974 Personally Owned/Built by Ken
Rich` at 109.587 DKK is rejected off `moog-model-d` as "the original Minimoog",
while `1973 Moog Minimoog Model D w/ Road Case` is kept on `moog-minimoog` with
`moog-model-d` sitting in front of it as a sibling. The 2016 reissue and the
1973 original are told apart in both directions, by the year in the title.

---

## 6b. The full dry run — 1,764 rows

[`pan-95-dry-run-manifest-2026-09-20.csv`](pan-95-dry-run-manifest-2026-09-20.csv),
one line per unreviewed match, `would_write_is_valid` naming what a pass would
set and `listing_url` so a row can be checked at source. The matching `.jsonl`
carries the full planned row and is regenerated by re-running the script; it is
too large to keep in the repository.

| verdict | rows | share |
|---|---|---|
| `exact` → would write `true` | 1.260 | 71.4% |
| `wrong` → would write `false` | 160 | 9.1% |
| `accessory` → would write `false` | 72 | 4.1% |
| `wanted_ad` → would write `false` | 5 | 0.3% |
| `abstain` → writes nothing | 267 | 15.1% |

1.497 rows would be written, 267 left alone. Six of the abstentions are rows the
judge did not answer for, which fail safe. Cost: **$12.21** (1.091.265 input /
270.278 output tokens), about 40 minutes at five concurrent batches.

Two things in it are worth reading before anything is authorised:

**54 approvals sit below confidence 70** — 4.3% of the approvals. That is the
band the one bad approval in §5 came from, and the band an approval floor would
convert to abstentions.

**79 rejections are on listings at or above 10.000 DKK**, which is where a
threshold would have been least able to help and most able to hurt. Spot-checked
from the top, they are the rejections the threshold could never have made:

| listing | price | rejected off | because |
|---|---|---|---|
| Gibson Les Paul Custom Shop 1959 Southern Rock Tribute | 130.502 | `gibson-les-paul-custom` | an R9 is a Les Paul **Standard** reissue |
| Moog Model D 1974 Personally Owned/Built by Ken Rich | 109.587 | `moog-model-d` | a 1974 unit is the original Minimoog, not the 2016 reissue |
| Limited WHITE MOOG MINIMOOG VOYAGER XL 2012 | 104.361 | `moog-minimoog` | a Voyager XL is a different instrument |
| Vintage Tube-Tech CL 1A Mono Opto Compressor 1980s | 53.797 | `tube-tech-cl1b` | a CL 1A; the title keyword-stuffs CL1B |

**The abstain rate splits the catalogue exactly where §3 predicted.** On the 907
electric-guitar and bass rows it is **19.3%**; on the other 857 rows it is
**10.7%**. Abstentions cluster on `gibson-les-paul-custom` (37),
`fender-telecaster-thinline` (36), `gibson-les-paul-special` (35),
`gibson-j-45` (30), `gibson-les-paul-studio` (24) and `gibson-hummingbird` (21)
— every one a generic row facing named sub-models at different tiers.

### The guard change, paid off

Of the 18 rows the deterministic guard flagged, the judge **overrode three** —
and all three are in the five I hand-checked as false rejects: both serviced
Juno-106s (10.430 and 16.728 DKK) and the DX7 with six cartridges. It kept the
two TR-909 EPROM rejections, which is the known price-blindness cost in §5.

| | correct on those 18 rows |
|---|---|
| guard deciding alone | 13 / 18 = 72.2% |
| guard as a signal, judge deciding | **16 / 18 = 88.9%** |

The change cost one extra batch of tokens and recovered two complete
synthesizers and a DX7 from deletion.

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

`explain - 'admin_decision'` is safe to run unconditionally here because
**none of the 1.764 unreviewed rows carries an `admin_decision` today** —
measured, 2026-09-20 — so the reversal cannot strip a human decision that was
already there. (152 of them do carry `ai_pass1` and 111 `ai_pass2` from the
earlier Sonnet sweep; those keys survive the reversal untouched.)

Two further properties make it safe, and both are pinned by
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
  where only `is_valid = true` prices a product. It has since merged, which is
  also what makes `price_context` well defined: the population it summarises is
  exactly the one `isPriceEvidence()` admits. This branch predates that commit,
  so the predicate is expressed as the server-side filter `is_valid = true` and
  the import lands on rebase.
- **No price threshold is introduced.** Price is given to the judge as evidence
  and compared to no constant anywhere in this pass (§2b). The test that used
  to fail on a money key now fails if the context is absent or misshaped — the
  guarantee is inverted, not dropped.

## 9. Recommendation

Proceed, with three conditions:

1. **Re-run the backlog before applying anything further.** The manifest in
   this PR was produced by the price-blind judge and has already been applied;
   §5b shows that design approving a pickguard at 1% of median. A fresh pass is
   what the revision is for.
2. **Set an approval confidence floor at the apply step**, and have the owner
   spot-check the low-confidence approvals and the high-value rejections in the
   manifest before the next pass. 70 is the number §5 supports; §5b's five bad
   approvals under the first revised prompt also all sat at 70 or below.
3. **Take the depth question to the product owner separately.** Roughly a sixth
   of the sample — and a much larger share of the 1.058 unreviewed guitar rows —
   is not a matcher problem at all. It is a catalogue that has one
   `fender-telecaster-thinline` row for instruments that trade between 7.828 and
   37.338 DKK. No prompt fixes that.
