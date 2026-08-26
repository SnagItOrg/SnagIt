# Klup launch-catalogue selection

**Status:** decision-ready proposal after the **Prompt 04 music-vertical correction**. **Nothing was activated, populated, matched, scraped, migrated, committed or deployed.** All production access was `SELECT`-only. Migrations 053/054/055 remain `PRE`.

**Inputs**
- Gross list: `data/klup-clean-product-candidates.csv` — 336 families, 103 brands (untracked, **byte-for-byte unchanged**).
- Music-vertical overlay: `data/klup-music-vertical-candidate-additions.csv` — 182 rows (130 user-authoritative, 52 obvious challengers).
- KG manifest proposal: `docs/klup-music-vertical-kg-manifest.csv` — 88 rows.
- Companion data: `docs/klup-launch-catalogue-candidates.csv` — 795 reconciled rows.

Every count below is derived programmatically from those CSVs.

---

## 0. Music-vertical correction (Prompt 04)

Prompt 03A froze nothing, and correctly so. The 336-row gross list was complete **as a file** but incomplete **as Klup's music-vertical candidate universe**: it contained no guitars, no basses, no guitar effects and no amplifiers. Following it literally produced a 33-product cohort that was 84% Reverb by population scope and removed the strongest observed Danish liquidity in the dataset.

That is now corrected by an **additive overlay** — the gross list is preserved unchanged, and 182 guitar/bass/effect/amplifier candidates are added and scored under the same model as everything else.

**Result: 48 proposed core products.** Origin split: 32 from the gross list, 14 user-authoritative additions, 2 obvious challengers.

| Category | n |
|---|---:|
| Vintage synthesizers | 15 |
| Electric guitars | 11 |
| Drum machines & samplers | 5 |
| Studio outboard | 5 |
| Electric pianos | 4 |
| Acoustic guitars | 4 |
| Tape echo & effects | 2 |
| Studio microphones | 1 |
| Bass guitars | 1 |
| **Total** | **48** |

**The correction did what it was supposed to do.** Nordic + German evidence attached to the cohort rises from **107** (Prompt 03A) to **333** (matcher proposals plus lexical hits). Danish `dba.dk` evidence rises from 12 rows to 55.

**Guitars earned their places on evidence, not on a quota.** They carry a **−3 penalty** for lexical-only evidence and are capped at `low` confidence when no KG product exists, yet 16 still clear the bar — `Gibson Les Paul Custom` scores 81 on 122 clean active listings, 73 of them from DK/NO/SE/DE.

**9 of the 48 core products do not exist in the KG yet** and enter only with a precise KG prerequisite recorded in the manifest. They are listed separately in §5.

---

## 2. Gross-list reconciliation and changes from provisional cohort

### 2.1 Input validation

| Measure | Value |
|---|---:|
| Raw data rows (excluding header) | **336** |
| Unique `(Brand, Product)` families | **336** |
| Exact duplicate rows | 0 |
| Malformed rows (missing brand or product) | 0 |
| Distinct brands | 103 |
| Families expressing several variants via `/` | 119 |

**The expected 336 reproduces exactly**: the file holds 337 non-blank lines, one of which is the `Brand`/`Product` header, leaving 336 data rows; all 336 are unique pairs, so raw-row count and unique-family count coincide. No rows were invented, merged or dropped.

Three product strings appear under two brands each and are genuinely different products: `Solina String Ensemble` (ARP / Eminent), `Spirit` (Crumar / Aston Microphones), `V72 / V76` (TAB / Telefunken). They are kept separate.

One parsing subtlety was corrected: `Korg Mono/Poly` and `AMS Neve 33609/N` contain a `/` **inside** the product name, not as a variant separator. Treating them naively split `Mono/Poly` into "Mono" and "Poly" and produced false matches to `korg-poly-800` and `korg-poly-61`. Both are handled as atomic names.

### 2.2 Reconciliation states — all 336 families

Mapping used exact brand identity (an explicit 103-entry brand alias map, never fuzzy brand similarity) plus exact model equality or an exact bounded model phrase inside `canonical_name`. **No family was resolved by fuzzy model-token similarity alone.**

| State | n | Meaning |
|---|---:|---|
| `no_kg_match_brand_absent` | **119** | The brand has no KG product at all |
| `exact_match` | **89** | Exactly one KG product |
| `duplicate_consolidated` | **57** | Several KG rows, at most one evidence-bearing — duplicates/listing-title pollution |
| `no_kg_match` | **44** | Brand exists in the KG, this model does not |
| `variant_split` | **27** | Several genuinely distinct KG products (e.g. Rhodes Mark I/II, Roland System-100 / 100M) |
| **Total** | **336** | |

- Distinct KG products mapped from the gross list: **411**.
- Families with at least one evidence-bearing product: **125** (37%).
- Families represented in the companion CSV: **336 of 336** (verified programmatically; a product belonging to several families carries all of their names).

### 2.3 Coverage in both directions

**Gross-list families absent from the Prompt 03 CSV:** the Prompt 03 universe was reconstructed from Klup evidence, so every gross-list family with no Klup evidence was invisible to it — 211 of 336. Thirteen families with real evidence were missed entirely and are now in the core (§2.4); a further 26 gross-list families sit in reserve.

**Prompt 03 candidates absent from the gross list:** 39 rows carry `gross_list_status = not_on_gross_list`. Of these, 17 were Prompt 03 core or reserve products with genuine evidence (`out_of_gross_list_high_evidence`) and 19 were lower-ranked (`out_of_gross_list`). They are retained with full evidence and an explicit basis label; none is in the core.

Notably, three products that Prompt 03 removed as weak incumbents are now **also shown to be off the gross list**, which independently confirms the removals: `ampex-atr-700` (the list carries Ampex **350** and **ATR-102**, not the ATR-700), `wurlitzer-207` (the family is `200 / 200A / 204`) and `strymon-timeline`.

### 2.4 Changes from the provisional 36

**Exits — 16** (all: absent from the authoritative gross list)

| Product | Provisional rank | Now |
|---|--:|---|
| `fender-stratocaster` · `fender-telecaster` · `fender-jazz-bass` · `fender-precision-bass` · `fender-jazzmaster` | 11, 9, 5, 6, 31 | `out_of_gross_list_high_evidence` |
| `gibson-les-paul` · `gibson-es-335` · `gibson-j-45` · `gibson-hummingbird` · `gibson-sj-200-original` | 12, 3, 14, 15, 23 | `out_of_gross_list_high_evidence` |
| `martin-d-28` | 34 | `out_of_gross_list_high_evidence` |
| `oberheim-ob-x8` (modern; list has OB-X/OB-Xa/OB-8/OB-6/SEM/Xpander) | 16 | `out_of_gross_list_high_evidence` |
| `sequential-prophet-6` · `sequential-prophet-rev2` (list has SCI Prophet-5/-10/-600/-T8/-VS) | 26, 29 | `out_of_gross_list_high_evidence` |
| `ua-6176` (list has UA 1176LN/1176SE only) | 25 | `out_of_gross_list_high_evidence` |
| `manley-variable-mu` (list has Manley ELOP / Massive Passive / Reference Cardioid / VOXBOX) | 21 | `out_of_gross_list_high_evidence` |

**Entries — 13** (all from gross-list families with evidence that Prompt 03 never saw)

| Product | Rank | Score | Gross-list family | Why it earns a place |
|---|--:|--:|---|---|
| `sequential-prophet-10` | 9 | 75 | Sequential Circuits Prophet-10 | 45 records, tight 20.5k–28.6k band, 5 deferrals |
| `emu-sp-1200` | 20 | 68 | E-MU Systems SP-12 / SP-1200 | 19 records, very tight 42.1k–58.3k; the reference sampler |
| `tube-tech-cl1b` | 21 | 68 | Tube-Tech CL 1B | 19 records, 27.4k–37.4k, 1 rejection; Danish manufacturer |
| `korg-mono-poly` | 23 | 66 | Korg Mono/Poly | 39 records, 10.0k–17.5k, zero rejections |
| `korg-polysix` | 24 | 66 | Korg Polysix | 38 records, 8.8k–14.8k, 2 sources |
| `roland-jupiter-4` | 25 | 66 | Roland Jupiter-4 | 31 records, 26.6k–61.5k, high value |
| `manley-voxbox` | 27 | 63 | Manley VOXBOX | 16 records, 25.3k–32.4k, zero deferrals |
| `roland-tr-606` | 28 | 63 | Roland TR-606 | 41 records, tight 3.1k–4.9k |
| `tube-tech-lca-2b` | 29 | 63 | Tube-Tech LCA 2B | 10 records, zero deferrals and zero rejections |
| `roland-system-100` | 30 | 62 | Roland System-100 / 100M | 25 records, 14.9k–27.4k, zero deferrals |
| `neve-portico-ii-master-buss-processor` | 31 | 61 | Rupert Neve Designs Master Buss Processor | 28 records, 25.4k–34.3k, zero deferrals (was Prompt 03 reserve) |
| `moog-source` | 32 | 58 | Moog Source | 14 trusted records, tight 13.6k–21.3k |
| `roland-tr-727` | 33 | 58 | Roland TR-707 / TR-727 | 16 records, very tight 5.0k–6.7k (variant split from TR-707) |

**Retained — 20.** Rank changes among them follow from re-scoring on the current production snapshot (§3.1), not from new judgement. The largest movements are `gibson-es-335` leaving rank 3 (exit) and `sequential-prophet-10` entering at 9.

**Displacement test.** Every entrant was compared against the bottom third of the provisional core (ranks 25–36) and the top reserve. Eleven of the thirteen entrants outscore the products they replaced; the two that do not (`moog-source` 58, `roland-tr-727` 58) enter only because the products above them were removed for being out-of-universe, and both are recorded at `medium`/`low` confidence. No provisional core product was displaced by a **weaker** challenger: every exit is a scope decision, not an evidence loss.

---

## 3. Evidence and limitations

### 3.1 Production snapshot — and drift since Prompt 03

All evidence was re-derived on the current snapshot. **Production moved between Prompt 03 and Prompt 03A** because the PM2 scrapers ran; no write of any kind came from this work.

| Measure | Prompt 03 | Prompt 03A | Δ |
|---|--:|--:|--:|
| `listings` total | 87,172 | **87,185** | +13 |
| Active on matcher sources | 37,379 | **36,135** | −1,244 |
| Active + unmatched (dry-run input) | 25,209 | **24,394** | −815 |
| `listing_product_match` | 30,794 | **30,794** | 0 |
| `kg_product` | 3,862 | **3,862** | 0 |
| Migrations 053 / 054 / 055 | PRE | **PRE** | — |

Because the evidence base moved for every candidate, the auto-computed dimensions (supply, breadth, value, operational readiness) were **recalculated deterministically for all scored candidates** rather than only for entrants. Judgement dimensions were carried forward unchanged except where a boundary decision changed (§4). Dry-run total on the new snapshot: **11,298 safe proposals** from 24,394 unmatched active listings, zero `listing_product_match` writes.

### 3.2 Evidence order and labels

1. Production, SELECT-only. 2. Repository configuration. 3. Dry-run matcher (`buildMatchIndex` + `decideMatch`, the shared production core). 4. Targeted external research. 5. Expert inference, labelled.

External propositions used (unchanged from Prompt 03, all retrieved 2026-08-12): Minimoog original/reissue/Voyager distinction; Rhodes Stage vs Suitcase amplification; Korg MS-20 vs Mini/Kit/FS; Prophet-5 Rev3 vs Rev4 pricing; Neumann U 87 vs U 87 Ai generations; Ampex ATR-700 resale range. Sources are listed in the companion CSV rationale fields and were used only for identity, generation boundaries and the existence of a resale market — never to infer Klup demand.

### 3.3 Limitations

- **No demand data.** Nothing here claims user demand.
- **No inflow measurement.** `first_seen_at` holds a bulk backfill; 7/30/90-day inflow is not computable. No recency dimension is scored.
- **Unequal source coverage.** DBA queries `legendary`+`classic` (30 products); Finn/Blocket/Kleinanzeigen query `legendary` only (28); Reverb sweeps all active music-gear. **For a non-incumbent, absence of Nordic/German evidence is unavailable evidence, not observed zero** — flagged per row in `evidence_basis`. 24 of the 33 core products are not incumbents and need a query seed before their Nordic supply is even observable.
- **Counts are Klup records, not market coverage.**
- **Currency.** All statistics use `price_dkk`, the existing scrape-time normalisation, with the Kleinanzeigen impossible-price predicate applied. Rows with NULL `price_dkk` are excluded from statistics, never counted as zero.
- **Trusted rows predate the matcher fixes** and are reported in a separate column from dry-run proposals throughout.
- **Blank means unavailable.** No unavailable fact is written as `0`.

---

## 4. Scoring model

**Weights unchanged** from the accepted 100-point model.

| Dimension | Max | Anchor |
|---|---:|---|
| Observable Klup supply | 25 | Combined records (trusted + safe): ≥200→25, ≥100→22, ≥50→19, ≥30→16, ≥20→13, ≥10→10, ≥5→6, ≥1→3; **minus** price-contamination discount (p25 < 20% of median → −4; < 40% → −2) |
| Supported-source breadth | 10 | 5→10, 4→8, 3→6, 2→4, 1→2, read against the unequal-coverage caveat |
| Matchability & canonical clarity | 20 | Judgement: deferral/rejection rates, alias safety, generic/short tokens, one-query-to-one-page |
| Used-value relevance | 10 | Level (median ≥20k→5, ≥10k→4, ≥5k→3, ≥2k→2, else 1) **plus** tightness (IQR/median ≤0.4→+5, ≤0.8→+3, ≤1.5→+1) |
| Recognisability & longevity | 15 | Judgement, external-evidence backed |
| Monitoring-value hypothesis | 10 | **Explicitly hypothetical** |
| Operational readiness | 10 | Incumbent query +4 (else +1), `reverb_csp_id` +2, `subcategory_id` +2, specific `model_name` +2 |

**Negative adjustments after the subtotal:** severe generation/variant ambiguity (−5), parts/accessory/wanted/copy contamination (−4), shared identifiers or unsafe/generic tokens (−4), insufficient evidence (−5), lifecycle/source defects (−3); cumulative, largest applied −9.

**Confidence:** `high` = multi-source observed supply plus a stable band; `medium` = one strong axis with a known gap; `low` = single-source, unconverted proposals, lexical-only evidence, or a flat band indicating dealer rather than used pricing. Whole numbers only. Ranks are unique and deterministic (score desc, then slug/model).

### 4.1 Extension for lexical evidence (Prompt 04)

Overlay candidates with no KG product cannot produce trusted matches or matcher proposals, so their supply is measured as **lexical title evidence**: active listings whose title contains the exact offered brand **and** the exact model/series boundary, with the repo's own `detectNonProductIntent` and `tokenFollowedByReference` applied to strip parts, accessories, wanted ads and copy/reference titles.

To keep one evidence model across the whole universe:

- lexical hits feed the **same** supply band, breadth and value dimensions;
- a **−3 penalty** is applied because lexical evidence is not matcher-validated;
- confidence is **capped at `low`**;
- a further **−2 / −4** applies at ≥10% / ≥20% measured contamination;
- `discovery_only` rows take **−6** and can never be core.

Lexical evidence is reported in its own columns (`lexical_clean_hits`, `lexical_nordic_de_hits`) and is **never** summed with trusted rows or matcher proposals.

---

## 5. Final proposed core cohort — 48 products

| # | Canonical product | Category | Score | Conf | KG status | Origin | Primary reason |
|--:|---|---|--:|---|---|---|---|
| 1 | Juno-106 | Vintage synthesizers | 92 | high | in KG | gross list | T45/S31 — Best-evidenced product in the catalogue: 5 sources, 65 records, tight 11.3k-16.2k DKK band. |
| 2 | Juno-60 | Vintage synthesizers | 91 | high | in KG | gross list | T40/S23 — 5 sources, 62 records, tight 19.1k-29.0k band at a materially higher level than the 106. |
| 3 | TR-909 | Drum machines & samplers | 83 | high | in KG | gross list | T17/S24 — 42.9k median, tight 33.5k-52.2k band, 40 records. |
| 4 | Gibson Les Paul Custom | Electric guitars | 81 | low | in KG | user addition | T0/S0 — Excludes Custom Shop reissues. |
| 5 | Minimoog | Vintage synthesizers | 81 | medium | in KG | gross list | T45/S6 — 35.0k median, 50 records, 4 sources. |
| 6 | TR-808 | Drum machines & samplers | 80 | high | in KG | gross list | T14/S10 — Iconic, 46.8k median, tight 38.5k-53.8k band. |
| 7 | MS-20 | Vintage synthesizers | 78 | medium | in KG | gross list | T9/S38 — 5 sources, tight 8.9k-13.8k band. |
| 8 | Mark I Suitcase 73 | Electric pianos | 77 | medium | in KG | gross list | T9/S2 — 4 sources, 22.0k-29.3k band. |
| 9 | Gibson Hummingbird | Acoustic guitars | 76 | low | in KG (multi-row) | user addition | lex 214 — Square-shoulder. |
| 10 | Gibson Les Paul Standard '60s | Electric guitars | 76 | low | **KG needed** | user addition | lex 30 — Distinct from 50s. |
| 11 | RE-201 | Tape echo & effects | 76 | medium | in KG | gross list | T23/S0 — Tight 13.1k-18.4k band, 23 trusted records. |
| 12 | Gibson J-45 | Acoustic guitars | 75 | low | in KG (multi-row) | user addition | lex 307 — Reference slope-shoulder. |
| 13 | Prophet-10 | Vintage synthesizers | 75 | medium | in KG | gross list | T24/S21 — 45 records, tight 20.5k-28.6k band, only 5 deferrals. |
| 14 | Gibson SJ-200 | Acoustic guitars | 74 | low | in KG (multi-row) | challenger | lex 268 — Flagship jumbo. |
| 15 | Jupiter-8 | Vintage synthesizers | 74 | medium | in KG | gross list | T8/S4 — Highest-value instrument with a usable band (155k-187k). |
| 16 | SH-101 | Vintage synthesizers | 74 | medium | in KG | gross list | T3/S56 — Only 5-source mono-synth in the set; 55 records. |
| 17 | Gibson Les Paul Standard '50s | Electric guitars | 73 | low | **KG needed** | user addition | lex 22 — Distinct from 60s neck profile market. |
| 18 | Gibson Les Paul Studio | Electric guitars | 73 | low | **KG needed** | user addition | lex 82 — Lower tier. |
| 19 | Mark II Stage 73 | Electric pianos | 73 | medium | in KG | gross list | T9/S2 — The only 5-source product with ZERO deferrals and ZERO rejections. |
| 20 | U 87 Ai | Studio microphones | 72 | medium | in KG | gross list | T25/S51 — 76 records, 14.6k-21.4k band and ZERO deferrals. Best microphone candidate. |
| 21 | Juno-6 | Vintage synthesizers | 72 | medium | in KG | gross list | T8/S22 — Tight 12.0k-19.2k band across 3 sources; completes the Juno family. |
| 22 | Gibson Les Paul Special | Electric guitars | 71 | low | **KG needed** | user addition | lex 95 — P-90 tier. |
| 23 | Mark I Stage 73 | Electric pianos | 71 | medium | in KG | gross list | T7/S8 — Zero deferrals, 21.6k-33.5k band. |
| 24 | RE-501 | Tape echo & effects | 71 | medium | in KG | gross list | T15/S7 — 22 records, 14.4k-20.5k band, one deferral. |
| 25 | Gibson ES-335 Dot | Electric guitars | 70 | low | **KG needed** | user addition | lex 18 — Dot inlay. |
| 26 | Martin D-28 | Acoustic guitars | 70 | medium | in KG | user addition | T0/S43 — Excludes HD-28. |
| 27 | TR-707 | Drum machines & samplers | 70 | medium | in KG | gross list | T24/S17 — Clean 4.5k-7.0k band, 41 records, 3 sources. |
| 28 | Model D | Vintage synthesizers | 69 | medium | in KG | gross list | T42/S0 — 42 trusted records, 50.2k median. Exists so the vintage page is not polluted by reissue prices. |
| 29 | 200A | Electric pianos | 69 | medium | in KG | gross list | T12/S43 — 4 sources, 53 records, 27.5k median. |
| 30 | SP-1200 | Drum machines & samplers | 68 | medium | in KG | gross list | T12/S7 — 19 records, very tight 42.1k-58.3k band. The reference hip-hop sampler. |
| 31 | CL 1B | Studio outboard | 68 | medium | in KG | gross list | T12/S7 — 19 records, tight 27.4k-37.4k band, ZERO deferral pressure and 1 rejection. Danish manufacturer  |
| 32 | 1176LN | Studio outboard | 68 | medium | in KG | gross list | T25/S14 — 39 records, 19.4k median. The reference compressor. |
| 33 | Fender Telecaster Thinline | Electric guitars | 67 | low | **KG needed** | user addition | lex 24 — Semi-hollow; distinct market. |
| 34 | Fender Telecaster Custom | Electric guitars | 66 | low | **KG needed** | user addition | lex 26 — Excludes Custom Shop. |
| 35 | MONO/POLY | Vintage synthesizers | 66 | medium | in KG | gross list | T1/S38 — 39 records, tight 10.0k-17.5k band, ZERO rejections. |
| 36 | PolySix | Vintage synthesizers | 66 | medium | in KG | gross list | T1/S37 — 38 records, tight 8.8k-14.8k band across 2 sources. |
| 37 | Jupiter-4 | Vintage synthesizers | 66 | medium | in KG | gross list | T9/S22 — 31 records, 26.6k-61.5k band. Genuine vintage classic on the gross list at a high value level. |
| 38 | Fender American Vintage '52 Telecaster | Electric guitars | 65 | low | **KG needed** | user addition | lex 10 — 1952 reissue line. |
| 39 | DX7 | Vintage synthesizers | 65 | medium | in KG | gross list | T11/S91 — 5 sources and 91 records - the widest reach in the cohort. Accepted with the highest contaminati |
| 40 | Fender American Professional II Stratocaster | Electric guitars | 63 | low | **KG needed** | user addition | lex 16 — Series named explicitly in title. |
| 41 | VOXBOX | Studio outboard | 63 | medium | in KG | gross list | T8/S8 — 16 records, tight 25.3k-32.4k band, ZERO deferrals. |
| 42 | TR-606 | Drum machines & samplers | 63 | medium | in KG | gross list | T9/S32 — 41 records, tight 3.1k-4.9k band. Low value but unambiguous. |
| 43 | LCA 2B | Studio outboard | 63 | medium | in KG | gross list | T7/S3 — 10 records, 19.1k-30.4k band, ZERO deferrals and ZERO rejections. |
| 44 | Gibson SG Standard | Electric guitars | 62 | low | in KG | user addition | T0/S7 — Core model. |
| 45 | System 100 | Vintage synthesizers | 62 | low | in KG | gross list | T0/S25 — 25 records, 14.9k-27.4k band, ZERO deferrals and ZERO rejections. Zero trusted matches is why co |
| 46 | Portico II Master Buss Processor | Studio outboard | 61 | low | in KG | gross list | T16/S12 — 28 records, tight 25.4k-34.3k band, ZERO deferrals and ZERO rejections. |
| 47 | Fender Mustang Bass | Bass guitars | 60 | low | in KG (multi-row) | challenger | lex 74 — Short scale bass. |
| 48 | Source | Vintage synthesizers | 58 | medium | in KG | gross list | T14/S0 — 14 trusted records, tight 13.6k-21.3k band. |

### 5.1 Core products that need KG work first

**9 have no KG product at all.** They may enter only with the precise prerequisite recorded in `docs/klup-music-vertical-kg-manifest.csv`: create a curated `kg_product` (brand + exact model, `model_name` set), then re-run the matcher dry run so lexical evidence becomes matcher-validated.

- `Gibson Les Paul Special` — 95 clean lexical hits, 42 from DK/NO/SE/DE
- `Gibson Les Paul Studio` — 82 clean lexical hits, 71 from DK/NO/SE/DE
- `Gibson Les Paul Standard '60s` — 30 clean lexical hits, 11 from DK/NO/SE/DE
- `Fender Telecaster Custom` — 26 clean lexical hits, 27 from DK/NO/SE/DE
- `Fender Telecaster Thinline` — 24 clean lexical hits, 23 from DK/NO/SE/DE
- `Gibson Les Paul Standard '50s` — 22 clean lexical hits, 10 from DK/NO/SE/DE
- `Gibson ES-335 Dot` — 18 clean lexical hits, 16 from DK/NO/SE/DE
- `Fender American Professional II Stratocaster` — 16 clean lexical hits, 15 from DK/NO/SE/DE
- `Fender American Vintage '52 Telecaster` — 10 clean lexical hits, 11 from DK/NO/SE/DE

**4 resolve to several KG rows** (`partial_family_multiple_kg_rows`) and need a consolidation decision before their page launches: `Gibson J-45`, `Gibson Hummingbird`, `Fender Mustang Bass`, `Gibson SJ-200`.

The remaining 35 core products have exactly one KG row and are ready for the matcher today.

---

## 6. Family navigation versus canonical match pages

The product-hierarchy contract is now explicit: **a family label is not automatically a price page.** Three roles are used, and only `matchable_canonical_product` may be core.

### 6.1 Navigation families — grouping only, never price aggregation

| Navigation family | Category | Matchable children in this cohort | Why it is not a match page |
|---|---|--:|---|
| Fender Jaguar | Electric guitars | 0 | Navigation only. |
| Fender Jazz Bass | Bass guitars | 1 | Navigation only; pickup spacing is an attribute, not a product. |
| Fender Jazzmaster | Electric guitars | 0 | Navigation only. |
| Fender Precision Bass | Bass guitars | 1 | Navigation only. |
| Fender Stratocaster | Electric guitars | 1 | Navigation only: origin/series/era price bands differ by >3x. |
| Fender Telecaster | Electric guitars | 3 | Navigation only. |
| Gibson ES family | Electric guitars | 0 | Navigation only; never merge on the token 335. |
| Gibson Les Paul | Electric guitars | 5 | Navigation only; Epiphone hard-blocked. |
| Gibson SG | Electric guitars | 1 | Navigation only. |
| Ibanez RG Series | Electric guitars | 0 | Navigation only; RG Series is not a product. |
| PRS SE Series | Electric guitars | 0 | Navigation only; SE Series is not a product. |

A navigation family may group its children in browse and search. It must **not** aggregate listings or compute a price band, because its children's markets differ by more than 3x. Making a parent aggregate safely is an **experience and data-model requirement**, not a reason to merge the children.

### 6.2 Discovery-only candidates — not match targets

| Discovery-only candidate | Category | Why it cannot be a match target yet |
|---|---|---|
| Eastman AR models | Electric guitars | DISCOVERY: exact AR model numbers unresolved. |
| Fender MIJ/CIJ Stratocaster | Electric guitars | DISCOVERY: era/series unresolved (ST-54/57/62, Traditional, Heritage). |
| Fernandes Revival Series | Electric guitars | DISCOVERY: exact Revival models unresolved. |
| Greco SA models | Electric guitars | DISCOVERY: exact SA model numbers unresolved. |
| Hansen (brand discovery) | Electric guitars | DISCOVERY: no product/model identity established. |
| Ibanez PIA | Electric guitars | DISCOVERY: exact PIA model numbers unresolved. |
| Ibanez RG Prestige (named models) | Electric guitars | DISCOVERY: exact Prestige model numbers unresolved. |
| Music Man Pre-Ernie Ball StingRay | Bass guitars | DISCOVERY: pre-EB identification unreliable in titles. |
| Tokai ES models | Electric guitars | DISCOVERY: exact ES model numbers unresolved. |
| Vox AC30 (modern/reissue) | Amplifiers | DISCOVERY: modern sub-model boundary unreliable. |

### 6.3 Parent → child map (specification only, not implemented)

```
Fender Stratocaster            [navigation]
  ├─ Fender American Professional II Stratocaster   [core]
  ├─ Fender American Ultra Stratocaster             [reserve]
  ├─ Fender American Vintage II Stratocaster        [reserve]
  ├─ Fender Player Stratocaster                     [reserve]
  ├─ Fender MIJ/CIJ Stratocaster                    [discovery — era/series unresolved]
  └─ Squier Classic Vibe Stratocaster               [reserve — separate sub-brand, never merges up]
Fender Telecaster              [navigation]
  ├─ Fender Telecaster Thinline                     [core]
  ├─ Fender Telecaster Custom                       [core]
  ├─ Fender American Vintage '52 Telecaster         [core]
  ├─ Fender Telecaster Deluxe                       [reserve]
  └─ Fender American Standard Telecaster            [reserve — origin+era rarely explicit]
Gibson Les Paul                [navigation]
  ├─ Gibson Les Paul Custom                         [core]
  ├─ Gibson Les Paul Standard '50s                  [core]
  ├─ Gibson Les Paul Standard '60s                  [core]
  ├─ Gibson Les Paul Studio                         [core]
  ├─ Gibson Les Paul Special                        [core]
  ├─ Gibson Les Paul Junior                         [reserve]
  └─ Custom Shop R7 / R8 / R9 / R0                  [reserve — 4 separate pages, never one "Custom Shop" page]
Gibson ES family               [navigation]
  ├─ Gibson ES-335 Dot                              [core]
  ├─ Gibson ES-335 Block / ES-345 / ES-355 / ES-330 [reserve — four separate pages]
Gibson SG                      [navigation]
  ├─ Gibson SG Standard                             [core]
  └─ Gibson SG Special / SG '61 Reissue             [reserve]
Fender Jazz Bass / Precision Bass  [navigation]
  └─ pickup spacing ('60s / '70s) is an ATTRIBUTE, never a canonical product
Ibanez RG / PRS SE / Rickenbacker / Gretsch / Höfner / Music Man / Martin / Boss / EHX / amplifier families
  └─ children enumerated in the overlay CSV; none reaches core on current evidence
```

**Boundary rules applied throughout:** original ≠ reissue ≠ Custom Shop recreation ≠ lower-cost sub-brand ≠ signature ≠ mk generation ≠ rack/pedal format ≠ 6-/12-string. `Made in USA`, `American`, model year and series name are **not** equivalent, so no single "US Strat" page was created — `American Professional II` and `American Ultra` are separate because the title says which.

---

## 7. Legitimate vintage and vintage-inspired brands

The user's list adds Japanese and boutique brands that Klup currently treats as **copy/reference stop tokens**. This is a live contradiction.

| Brand | In `kg_brand`? | In `EXTERNAL_BRAND_TOKENS`? | Consequence today | Smallest later action |
|---|---|---|---|---|
| **Tokai** (4 candidates) | No | **Yes** | `detectOfferedBrand` reads Tokai as a competing offered brand, so a genuine Tokai listing can be deferred as copy/reference | Remove `tokai` from the token list **and** add Tokai to `kg_brand` in the same change |
| **Greco** (4 candidates) | No | **Yes** | Same | Same |
| **Burny** (1 candidate) | No | **Yes** | Same | Same |
| Fernandes, Nash, Suhr, Heritage, Eastman, Takamine, Hansen | No | No | No guard conflict; simply absent from the KG | Create `kg_brand` rows before any product curation |
| aria, esp, edwards, jackson, charvel, samick, cimar, vision, fenix, leader, harley benton | — | **Yes** | Latent: several are legitimate manufacturers. No candidate proposed for them yet | Review case by case only if a candidate appears |

**Neither half of the fix is safe alone.** Removing a brand from the stop list without a `kg_brand` row leaves its listings unmatchable *and* unguarded; adding the brand without removing the token leaves its own products fighting the copy/reference rule. Both are recorded as one paired action in the manifest.

**No code was changed.** `frontend/lib/matching/brand-guard.ts` is untouched.

---

## 8. Clean-vertical KG manifest

`docs/klup-music-vertical-kg-manifest.csv` — 88 proposal rows, 39 `deprecate_non_music`, 40 `keep_active_music`, 9 `manual_review_vertical`.

### 8.1 Non-music contamination — already contained

The audit found **43 non-music brands** (tech, cycling, photography, design-objects, danish-modern) holding **157 products**. The material finding is that **every one of those products is already `status='inactive'`** — zero active non-music products exist.

| Named expected case | KG state | Action |
|---|---|---|
| **Apple** | 9 products, all inactive, root `tech` | `deprecate_non_music` — already satisfied |
| **Samsung** | **absent from `kg_brand` entirely** | `manual_review_vertical` — nothing to deprecate; the expectation was mistaken |
| **Hans J. Wegner** | 34 products, all inactive, root `danish-modern` | `deprecate_non_music` — already satisfied |
| **Poul Kjærholm** | 3 products, all inactive, root `danish-modern` | `deprecate_non_music` — already satisfied |

The four named cases were **not exhaustive**: 39 more brands carry the same status, including Fritz Hansen, Herman Miller, Knoll, Louis Poulsen, Vitra, Arne Jacobsen, Specialized, Trek, Canyon, Giant, Nvidia, HP, Dell, Lenovo. Photography brands (Sony, Canon, Leica, Hasselblad) are marked `manual_review_vertical` rather than deprecated, because some also make professional audio equipment — that is a human call, not an automatic one.

**Two consequences worth recording:**
- Because `buildMatchIndex` derives `catalogueBrands` from **active** products only, no non-music brand can currently act as brand evidence. The handover's note that "`Apple` is a `kg_brand`, so 'Candy **Apple** Red' reads as brand evidence" is **no longer true** after the active-only eligibility fix.
- **No new state is needed.** `kg_product.status='inactive'` already preserves every historical `listing_product_match` reference. **No deletion and no new table is proposed**, and no blocker was found.

### 8.2 Other manifest contents

- **24 `kg_brand` rows to create** before their products can be curated: Ampeg, Burny, Eastman, Electro-Harmonix, Fernandes, Greco, Gretsch, Guild, Heritage, Höfner, Klon, MXR, Mesa/Boogie, Music Man, Nash, PRS, Pro Co, Rickenbacker, Squier, Sterling, Suhr, Takamine, Taylor, Tokai.
- **KG products to create** for the 9 missing-KG core products.
- **Three duplicate/consolidation cases** not covered by migration 053's 14 audited groups: `neumann-u87ai` + `neumann-u87-ai`, `korg-mono-poly` + `korg-monopoly`, `korg-poly-61` + `korg-poly61`.

The manifest is a **proposal**. No KG row, brand, alias, category or flag was changed.

---

## 9. Cohort changes

### 9.1 Versus the Prompt 03A cohort of 33

**Retained: 32.** **Exit: 1** — `roland-tr-727` (score 58, zero trusted matches) to reserve, outscored by guitar challengers carrying Danish and German liquidity. **Entries: 16**, all from the overlay:

| Rank | Product | Score | KG status | Origin |
|--:|---|--:|---|---|
| 4 | Gibson Les Paul Custom | 81 | exact kg product | user addition |
| 9 | Gibson Hummingbird | 76 | partial family multiple kg rows | user addition |
| 10 | Gibson Les Paul Standard '60s | 76 | missing from kg | user addition |
| 12 | Gibson J-45 | 75 | partial family multiple kg rows | user addition |
| 14 | Gibson SJ-200 | 74 | partial family multiple kg rows | challenger |
| 17 | Gibson Les Paul Standard '50s | 73 | missing from kg | user addition |
| 18 | Gibson Les Paul Studio | 73 | missing from kg | user addition |
| 22 | Gibson Les Paul Special | 71 | missing from kg | user addition |
| 25 | Gibson ES-335 Dot | 70 | missing from kg | user addition |
| 26 | Martin D-28 | 70 | exact kg product | user addition |
| 33 | Fender Telecaster Thinline | 67 | missing from kg | user addition |
| 34 | Fender Telecaster Custom | 66 | missing from kg | user addition |
| 38 | Fender American Vintage '52 Telecaster | 65 | missing from kg | user addition |
| 40 | Fender American Professional II Stratocaster | 63 | missing from kg | user addition |
| 44 | Gibson SG Standard | 62 | exact kg product | user addition |
| 47 | Fender Mustang Bass | 60 | partial family multiple kg rows | challenger |

### 9.2 Versus the Prompt 03 provisional 36

Prompt 03 carried family-level rows — `fender-stratocaster`, `gibson-les-paul`, `gibson-es-335`, `fender-jazz-bass`, `fender-precision-bass`, `fender-jazzmaster`, `gibson-j-45`, `gibson-hummingbird`, `gibson-sj-200-original`, `martin-d-28`, `fender-mustang-bass`. Prompt 03A removed them as out-of-gross-list. Prompt 04 **restores the concept but not the shape**: 14 of those rows are now marked `superseded_by_variant`, because a family label is not a price page. Each is replaced either by a navigation family plus concrete children, or by a single precise product.

So `Fender Stratocaster` does **not** return as a page; `Fender American Professional II Stratocaster` does. That is the substantive difference between Prompt 03 and Prompt 04.

---

## 10. Reserve catalogue — top 30 of 56

| Candidate | Score | Conf | Category | Evidence required to promote |
|---|--:|---|---|---|
| Gibson Les Paul Junior | 68 | low | Electric guitars | Create the KG product, then convert lexical evidence into matcher proposals. |
| Gibson Custom Shop Les Paul R9 | 67 | low | Electric guitars | Create the KG product, then convert lexical evidence into matcher proposals. |
| Strymon TimeLine | 67 | medium | Guitar effects | Supply or contamination drift. |
| Gibson L-00 | 65 | low | Acoustic guitars | Supply or contamination drift. |
| Gibson SG Special | 65 | medium | Electric guitars | Supply or contamination drift. |
| Fender Johnny Marr Jaguar | 63 | low | Electric guitars | Supply or contamination drift. |
| Fender American Ultra Stratocaster | 62 | low | Electric guitars | Create the KG product, then convert lexical evidence into matcher proposals. |
| Fender Player Stratocaster | 62 | low | Electric guitars | Create the KG product, then convert lexical evidence into matcher proposals. |
| Fender American Standard Jazz Bass | 61 | low | Bass guitars | Create the KG product, then convert lexical evidence into matcher proposals. |
| Jupiter-6 | 60 | medium | Vintage synthesizers | PROMOTE when p25 rises above 40% of median after parts exclusions. |
| Fender American Vintage II Jazzmaster | 59 | low | Electric guitars | Create the KG product, then convert lexical evidence into matcher proposals. |
| Gibson Custom Shop Les Paul R0 | 59 | low | Electric guitars | Create the KG product, then convert lexical evidence into matcher proposals. |
| Gibson Custom Shop Les Paul R8 | 59 | low | Electric guitars | Create the KG product, then convert lexical evidence into matcher proposals. |
| Gibson Custom Shop Les Paul R7 | 58 | low | Electric guitars | Create the KG product, then convert lexical evidence into matcher proposals. |
| TLM 103 | 58 | medium | Studio microphones | PROMOTE when rejections fall below 20. |
| TR-727 | 58 | low | Drum machines & samplers | Fails to convert proposals into trusted matches. |
| Fender American Standard Telecaster | 57 | low | Electric guitars | Create the KG product, then convert lexical evidence into matcher proposals. |
| Fender American Vintage II Stratocaster | 57 | low | Electric guitars | Create the KG product, then convert lexical evidence into matcher proposals. |
| Fender Telecaster Deluxe | 57 | low | Electric guitars | Create the KG product, then convert lexical evidence into matcher proposals. |
| Roland JC-120 | 57 | low | Amplifiers | Supply or contamination drift. |
| Boss PH-3 | 56 | low | Guitar effects | Supply or contamination drift. |
| U67 | 56 | low | Studio microphones | PROMOTE when split by generation. |
| Boss DS-1 | 55 | low | Guitar effects | Supply or contamination drift. |
| JX-3P | 55 | low | Vintage synthesizers | PROMOTE when ambiguity drops below 10%. |
| MPC2000XL | 55 | low | Drum machines & samplers | PROMOTE when the MPC family page boundaries are decided. |
| ELOP | 54 | low | Studio outboard | PROMOTE when supply exceeds 15. |
| Gibson ES-345 | 54 | low | Electric guitars | Create the KG product, then convert lexical evidence into matcher proposals. |
| PRS Custom 24 | 54 | low | Electric guitars | Create the KG product, then convert lexical evidence into matcher proposals. |
| Gibson ES-335 Block | 53 | low | Electric guitars | Create the KG product, then convert lexical evidence into matcher proposals. |
| MPC60 | 53 | low | Drum machines & samplers | PROMOTE when supply exceeds 15 and rejections fall. |

**Deliberate reserve holds:** low-price high-liquidity pedals (`Boss DS-1` 453 DKK, `Boss PH-3` 861 DKK, `Boss SD-1` 165 DKK) stay in reserve because monitoring value is weak at that price — classic status alone is not sufficient. `Strymon TimeLine` (2,909 DKK) is held on the same rule. High-value variants with thin title distinction (`Gibson Custom Shop R7/R8/R0`, `PRS Custom 24`, `Rickenbacker 4003`, `Marshall JCM800 2204`) stay in reserve until query evidence improves.

**Amplifiers reach no core slot.** Every amp candidate has 0–1 lexical hits, because no scraper has ever queried an amplifier brand. That is **unavailable evidence, not observed zero**, and it is why amps are held rather than excluded.

---

## 11. Supported-search contract

**Specification only. No search, autocomplete, demand capture or analytics is implemented by this work.**

| Rule | Behaviour |
|---|---|
| Canonical exact | `brand + canonical model` → navigate directly to the product page |
| Accepted alias | Normalised alias in the product's accepted list → navigate directly |
| Normalisation | Case-fold; strip diacritics; treat `-`, space and nothing as equivalent inside model numbers (`TR-808` ≡ `TR 808` ≡ `TR808`); collapse whitespace |
| Generation qualifier | `Mini`, `Kit`, `FS`, `II`, `Mk2`, `Rev4`, `Boutique`, `Suitcase`, `Stage`, `73`, `88`, `100M`, `727` are **significant** and must be matched, not discarded |
| Dangerous alias | Present in a product's dangerous list → **never auto-navigate**; show the disambiguation set |
| Ambiguous across catalogue | Term maps to >1 core product → show those products; never pick one |
| Unsupported query | Outside the core catalogue → show "Klup følger ikke dette produkt endnu" plus the nearest supported products. **A demand signal will be recorded when that capability is implemented; it does not exist today.** No empty SERP and no generic listing list |

**Dangerous terms excluded from automatic navigation:** `Juno` · `Jupiter` · `Prophet` · `Rhodes` · `Fender Rhodes` · `Space Echo` · `Model D` · `Minimoog` (brandless) · `808` · `909` · `707` · `727` · `606` · `System 100` · `Poly` · `Mono` · `Source` · `Spirit` · `1176` (brandless) · `U 87` without `Ai` · `CL 1B` (brandless) · `SP-12` when the page is SP-1200 · `MS-20` qualified by `Mini`/`Kit`/`FS` · `Synthesizer` · `Studio` · `Custom` · `Standard` · `Vintage` · `Reissue` · `Clone` · `Type` · `Style`. Where the guitar pages are ever promoted, `Squier` and `Epiphone` are never navigation terms for a Fender or Gibson page.

**Expected autocomplete labels** carry the qualifier so a wide band is honest at the point of navigation: `Roland Juno-106` · `Roland TR-808 (Rhythm Composer)` · `Rhodes Mark I Suitcase 73` · `Korg MS-20 (original, 1978)` · `Moog Minimoog (original)` · `Moog Minimoog Model D (2016 reissue)` · `Neumann U 87 Ai (1986–)` · `Roland System 100 (semi-modular)` · `Yamaha DX7 (1983)`.

---

## 12. Superseded reserve notes (Prompt 03A)

The Prompt 03A reserve table is superseded by §10, which ranks the combined universe. Every Prompt 03A reserve candidate is retained in `docs/klup-launch-catalogue-candidates.csv` with its score, confidence and promotion trigger intact; nothing was dropped, only re-ranked against the overlay.

---

## 13. Exclusions and incumbent removals

### 9.1 Incumbent configured products held from launch — 10 of 30

| Slug | Status | Score | Why it must not launch |
|---|---|--:|---|
| `strymon-timeline` | classic/public | 64 | 90 records with ZERO deferrals and ZERO rejections, but a 2,905 DKK median. **Not on the gross list.** |
| `sequential-prophet-5` | legendary/public | 62 | 87 records across 4 sources but 76 deferrals and p25 272 DKK. A vintage Rev3 sells ~USD 5,000 above a Rev4. |
| `rhodes-mark-i-stage-88` | legendary/public | 54 | Two records. |
| `arp-2600` | legendary/public | 52 | 27 records but p25 648 and p75 75,710 - a 100x band mixing three products. Zero trusted matches. |
| `oberheim-ob-xa` | legendary/public | 48 | ZERO trusted matches, 28 records, median 2,721 with p75 46,642. |
| `oberheim-ob-x` | legendary/public | 47 | ZERO trusted matches, 18 records, 16 ambiguous ties, p25 1,455 vs median 103,617. |
| `wurlitzer-200` | legendary/qa_only | 46 | Median 2,222 with p75 29,151, 35 deferrals. |
| `linn-electronics-linndrum` | legendary/public | 44 | Three records, single source. Iconic but no observable supply. |
| `ampex-atr-700` | legendary/public | 35 | Zero trusted matches, Reverb-only, 3,239 DKK median against an external asking range of ~6,500-19,000 DKK. **Not on the gross list.** |
| `wurlitzer-207` | classic/qa_only | 33 | Eleven records, 577 DKK median - the matches are parts. **Not on the gross list.** |

### 9.2 Non-gross-list products retained with high evidence — 17

These outscore several retained gross-list products on evidence alone and are held out purely on vertical scope. Promotion requires extending the gross list, not new data.

`fender-stratocaster` · `gibson-les-paul` · `fender-telecaster` · `fender-jazz-bass` · `fender-precision-bass` · `gibson-es-335` · `gibson-j-45` · `gibson-hummingbird` · `gibson-sj-200-original` · `fender-jazzmaster` · `martin-d-28` · `oberheim-ob-x8` · `sequential-prophet-6` · `sequential-prophet-rev2` · `ua-6176` · `manley-variable-mu` · plus 1 lower-ranked.

### 9.3 Gross-list families with no KG product — 163

| Reason | n | Examples |
|---|--:|---|
| Brand entirely absent from the KG | **119** | AKG, Telefunken, Schoeps, Sennheiser, Solid State Logic, Pultec, Fairchild, EMT, Studer, RCA, Coles, Royer, Sony, SPL, Thermionic Culture, Chandler Limited, Prism Sound, PSI Audio, Siemens, TAB, WSW, Microtech Gefell, Retro Instruments, Tegeler, Elysia, Aston, Audient, Lexicon, Eventide, Binson, Maestro, Mellotron, Fairlight, Buchla, PPG, Synclavier, Optigan, Mattel, Vako, Welte |
| Brand present, model absent | **44** | Roland Promars MRS-2, Korg PE-1000/PE-2000, Moog Liberation, Yamaha GX-1, Akai AX60/AX73/AX80, Casio VL-1, Ensoniq Fizmo |

None can be scraped, matched or priced today. Adding any of them means creating a curated `kg_product` row (brand + model) first — that is KG curation work, explicitly out of scope here.

### 9.4 Structural exclusions — 345 mapped products

Gross-list-mapped KG products that fall below the threshold for a canonical page: listing-title pollution rows (the `duplicate_consolidated` families contribute most of these), rows with fewer than 5 combined records, and rows whose entire evidence is parts or accessories. Grouped, not enumerated, in the CSV.

---

## 14. Close calls

| Candidate | Tension | **Recommendation** | Residual uncertainty |
|---|---|---|---|
| **All 11 guitar/acoustic products** | Strongest evidence in the whole dataset vs total absence from a 336-family, 103-brand authoritative list | **REMOVE from core, retain ranked** | Whether the gross list is complete. This is the ratification decision |
| `yamaha-dx7` | 5-source reach vs worst contamination in the core (median 3,353, p25 551) | **INCLUDE**, ranked 26, strictest exclusions | Most likely core demotion |
| `roland-system-100` | Clean 14.9k–27.4k band, zero deferrals — but **zero trusted matches** | **INCLUDE** at low confidence | First to drop if proposals do not convert |
| `roland-tr-727` | Very tight band, but zero trusted matches and it exists mainly to keep TR-707 clean | **INCLUDE** at low confidence | Structural justification, not demand |
| `moog-source` | 14 trusted records, tight band, but 39 deferrals against the Minimoog line | **INCLUDE** | Ambiguity may not be separable |
| `neumann-u87ai` | Best microphone evidence — but split across a duplicate KG row | **INCLUDE**, consolidation as a launch prerequisite | Consolidation is unscheduled work |
| `tube-tech-lca-2b` | Zero deferrals and zero rejections, but only 10 records | **INCLUDE** | Very thin supply |
| `neumann-tlm-103` | Tight 5.5k–8.4k band, 36 records — but 78 rejections | **RESERVE** | Rejections are TLM-line collisions, likely fixable |
| `roland-jupiter-6` | 50 records, 36.0k median | **RESERVE** | p25 1,166 shows parts dominance |
| `akai-mpc2000xl` | Iconic sampler, 28 records | **RESERVE** | The whole MPC family needs one page policy first |

---

## 15. Product-scoped population plan

**Nothing executed.** Two scopes, kept strictly separate because they are different kinds of evidence.

### A. Matcher scope — the 35 core products that already have a KG row

| Source | Dry-run safe proposals |
|---|--:|
| `reverb` | 605 |
| `kleinanzeigen` | 94 |
| `dba.dk` | 12 |
| `finn` / `blocket` | 0 |
| **Total** | **711** |

Plus **504 already-trusted active records** on those products, which need review rather than population. 711 fits one pass under the existing `--max` ceiling of 5,000.

### B. Lexical scope — the 13 core products with no usable KG row

**Not runnable through the matcher yet.** These are title matches, not matcher proposals, and they only become population candidates after the KG rows in the manifest exist.

| Source | Clean lexical hits |
|---|--:|
| `reverb` | 990 |
| `kleinanzeigen` | 92 |
| `blocket` | 49 |
| `dba.dk` | 43 |
| `finn` | 43 |
| **Total** | **1,186** |

**This is where the music-vertical correction pays off.** Scope B contributes **227 Nordic + German rows** that the Prompt 03A cohort did not reach at all, and it is the first time Finn and Blocket appear in a cohort scope.

### Sequence and controls

1. Apply the KG manifest (brands, then products, then the three duplicate consolidations) — a separate, separately authorised task.
2. Re-run the matcher dry run so scope B converts from lexical to matcher-validated. **Do not populate from lexical evidence directly.**
3. Then populate: `dba.dk` → `finn` → `blocket` → `kleinanzeigen` → `reverb`, dry-run first, sample-reviewed, capped per source, verifying the `listing_product_match` delta between passes.

### Current CLI capability

`scripts/match-listings.ts --historical-backfill` accepts **`--sources=` and `--max=` only** — no product, slug or cohort filter. The single bounded future requirement (unchanged): a `--products=`/`--cohort=` filter, active-only, dry-run by default, per-source cap, deterministic resume, sample review, no scheduler access. **Not implemented here.** Processing the whole catalogue remains an unacceptable substitute.

### Boundaries that must hold

- **Rescraping is freshness, not population.** Migration 055's trigger preserves a legacy row's `ingestion_batch_id = NULL` through every `ON CONFLICT DO UPDATE`.
- **Never delete and reinsert legacy rows** to manufacture ingestion identity.
- **Migration 055 must be active** before normal new-inflow matching works.
- **Product selection must be frozen** before cohort population begins.

---

## 16. Removal and review rules

Reviewed per product at 30 and 90 days after launch.

| Condition | Action |
|---|---|
| Fewer than 5 active listings across all sources for 90 days | **Demote to reserve** |
| Contamination (parts/accessories/wanted) above 20% of matched listings for 30 days | **Demote** until exclusions tighten |
| Cross-brand leakage above 2% | **Immediate demotion** — trust failure |
| Wrong-generation leakage above 10% (MS-20 Mini, Boutique TR-0x, SP-12, System-100M, reissue vs vintage) | **Split or demote** |
| IQR/median above 1.5 for 60 days | **Split** into variant sub-pages |
| Price band collapses to a single value | **Review for dealer-listing dominance** |
| Zero trusted matches after the first cohort population pass | **Demote** (`roland-system-100`, `roland-tr-727` are on watch) |
| Duplicate KG rows not consolidated before launch | **Hold the page** (`neumann-u87ai`, `korg-mono-poly`) |
| More than 5 manual corrections per month in `/admin/product/[slug]` | **Review the page boundary** |
| Reserve candidate meets promotion evidence **and** a core product meets a demotion condition | **Swap**, keeping the core between 30 and 50 |
| Two core pages repeatedly compete for the same listings | **Merge or re-split** |

---

## 17. Next roadmap gate

1. **Human freeze of the music-vertical cohort and the KG manifest.** The 48 core products, the family/child boundaries in §6, the three brand-guard reclassifications in §7 and the non-music actions in §8 need a founder decision.
2. **Apply the KG manifest** (brands → products → duplicate consolidations) as a separate authorised task, then re-run the dry run so scope B becomes matcher-validated.
3. **Activation prerequisites** (handover §11–§12): Vercel cron control, a PostgreSQL connection for backup, an agreed migration channel; then 053 → 054 → 055.
4. **Product-scoped population preparation**: decide build-the-filter vs populate-manually, then run the bounded passes in §15.
5. **Experience specification**: canonical product pages, navigation families and restricted search over the populated cohort.

**No new infrastructure phase is proposed.**
