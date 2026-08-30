# Brand vertical classification

**Kind:** prepared data change — *not executed, not a migration.*
**Related:** `frontend/lib/kg/brand-identity.ts`,
`scripts/expand-knowledge-graph.ts`,
`scripts/lib/kg-suggestion-integrity.test.ts`.

## The rule

A brand may receive music-vertical suggestions when, and only when, its stored
provenance says so:

```
kg_brand.category_id -> kg_category.domain = 'music'
```

`isActiveMusicBrand()` reads exactly that and nothing else. There is no
brand-name list in the runtime, no allow-list, no deny-list and no
brand-specific branch — the test suite asserts their absence. **Changing which
brands are eligible is therefore a data change, never a code change.** This
document is what such a change looks like.

Measured 2026-08-30: 231 brands under `domain = 'music'`, all of them attached
to the single root category `music-gear`
(`ea2a98e8-8fac-44ac-bdff-cf29fa0df665`); 43 brands under `design` and `other`.

## Sony — reclassify to the music vertical

**Finding.** `Sony` sits under `photography` (`domain = 'other'`) and is
therefore excluded, but the evidence says it is a music brand:

| Evidence | Value |
|---|--:|
| Pending suggestions Sony already owns | 46 |
| …that are studio microphones | the majority — `C-800G`, `C-100`, `C-80`, `ECM-100N`, `ECM-727P` |
| Sony products already filed under `music-gear` | 1 (`sony-cdp-c900`) |
| Sony products under `photography` | 12, all Alpha/FX cameras |
| Sony products that are `active`, `supported` or `public` | **0** |
| `listing_product_match` rows on any Sony product | **0** |

The `C-800G` is a studio vocal microphone; excluding the brand that makes it
from the music vertical is a classification error, not a guard working
correctly.

**Target category.** `music-gear`, id `ea2a98e8-8fac-44ac-bdff-cf29fa0df665`.
This is not a judgement call: every one of the 231 eligible music brands is
attached to that one root category, and no other music category holds a brand.

### The change — idempotent, guarded, NOT RUN

```sql
-- Re-point the Sony BRAND row to the music vertical.
--
-- Idempotent: re-running is a no-op because the WHERE clause no longer
-- matches once the row has moved. Both ids are pinned, and the category is
-- resolved by slug so a wrong-but-plausible uuid cannot be pasted in.
UPDATE kg_brand b
SET    category_id = (SELECT id FROM kg_category WHERE slug = 'music-gear' AND domain = 'music')
WHERE  b.id = '76242652-0d8b-45c2-bc1f-b1147c14009e'          -- Sony
  AND  b.category_id = '099b4c01-c3df-47f1-af1f-f4f31b735717' -- photography
  AND  EXISTS (SELECT 1 FROM kg_category WHERE slug = 'music-gear' AND domain = 'music');
```

**What this does NOT do, by construction:**

- It does not touch `kg_product`. The 12 Alpha/FX camera products keep
  `category_id = photography`, because product classification and brand
  eligibility are separate columns and separate concerns. Historical camera
  rows stay filed as photography.
- It does not change `status`, `support_state` or `browse_visibility` on
  anything. No product becomes public, supported or matchable as a result.
  Klup's public eligibility is decided by `isCanonical()` and
  `isMatchableProduct()`, which never read a brand's category.
- It creates nothing and deletes nothing.

**What it does change:** from the next expansion run onward, Sony titles
produce suggestions instead of being dropped as unclassified. The 46 existing
pending Sony suggestions are unaffected either way — they already exist and
remain pending review.

### Verification, before and after

```sql
SELECT b.name, c.slug AS category, c.domain,
       (SELECT count(*) FROM kg_product p
         WHERE p.brand_id = b.id AND p.browse_visibility = 'public') AS public_products
FROM   kg_brand b JOIN kg_category c ON c.id = b.category_id
WHERE  b.name IN ('Sony', 'Apple', 'Canyon');
```

Expected after the change: `Sony -> music-gear/music`, `Apple -> tech/other`,
`Canyon -> cycling/other`, and `public_products = 0` on all three, unchanged.

## Brands that stay excluded

`Apple` remains under `tech` (`domain = 'other'`) and stays out of the music
vertical. So do the other 41 legacy-vertical brands (cycling, tech,
photography, design-objects, danish-modern). No change is proposed for any of
them, and the guard excludes them by provenance rather than by name — if one of
them is ever found to be misfiled, the fix is another data change exactly like
Sony's, not a code exception.

## Historical data is preserved

The design-vertical products and their matches — 194 rows on
`herman-miller-…-eames-plastic-armchair-daw`, 21 on `le-klint-model-101`, 15 on
`mac-pro`, plus a handful more — are **historical records outside Klup's MVP.**
They are not deleted, migrated, reassigned or rejected by this branch or by
this document. They are inactive, `known` and `qa_only`, so they reach no
public surface; that is sufficient, and touching them is not.

## Electro Harmonix Canyon — already resolved by the operator

`electro-harmonix-canyon` exists as an `active` product under `music-gear` with
14 aliases and 4 merged suggestions. **It must not be re-created, altered or
rolled back.** Nothing in this branch writes `kg_product`; the expansion script
only ever upserts suggestions, and it skips canonical names that already exist.
The 62 Canyon suggestions still pending are legacy rows from before the fix and
are left for operator review — the remediation inventory covers them.
