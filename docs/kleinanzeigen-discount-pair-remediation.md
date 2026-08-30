# Kleinanzeigen discount pairs — correction and remediation

**Status: the code fix is deployed. The data remediation below is NOT RUN.**

## What the value actually is

A discounted Kleinanzeigen card nests the struck-through former price *inside*
the current-price element. That is invalid HTML, and every parser recovers from
it differently:

```html
<div class="aditem-main--middle--price-shipping">          <!-- wrapper -->
  <p class="aditem-main--middle--price-shipping--price">   <!-- CURRENT -->
    220 €
    <p class="aditem-main--middle--price-shipping--old-price">250 €</p>
  </p>                                                     <!-- PREVIOUS -->
</div>
```

The old parser selected *the first element whose class contains `price`* — the
**wrapper** — and read all of its text: `"220 € 250 €"`. Stripping non-digits
welded that into `220250`.

**So the ordering is fixed by the markup, not inferred:** the current price is
emitted first, the former price second. In the welded integer the **left half is
what the seller is asking today**.

`220250` is an ad asking **220 EUR**, reduced from 250. It is not corrupt, and
it is not one implausible price.

## The error being corrected

A previous release recognised this exact shape and concluded the row was
corrupt, blanking `price` and `price_dkk` at every boundary. That threw away 77
real asking prices rather than protecting anyone from a false one. A prepared
`UPDATE ... SET price = NULL` for those rows was written and, correctly, never
run.

## Normalisation table

| Input | Result | Why |
|---|--:|---|
| `220.250 €` | **220** | pair 220 \| 250 |
| `235.240 €` | **235** | pair 235 \| 240 |
| `1.2491.299 €` | **1249** | first token only |
| stored `12491299` | **1249** | pair 1249 \| 1299 |
| stored `62006800` | **6200** | pair 6200 \| 6800 |
| `220 €` · `235 €` | 220 · 235 | odd digit count, never split |
| `800 € VB` | 800 | negotiable suffix on a real price |
| `1.200 €` · `1.200,00 €` | 1200 | halves `12\|00` — leading zero, refused |
| `16.500 €` | 16500 | odd digit count, never split |
| `150000` | 150000 | halves `150\|000` — leading zero, refused |
| `2345`, `17934` | unchanged | fewer than six digits |
| `+ Versand ab 5,49 €` | null | shipping only |
| `450 € · Versand möglich` | 450 | real price, shipping note after |

Recovery requires **all** of: even digit count ≥ 6 · equal halves · no leading
zero in either half · both halves between 20 and 25,000 EUR · the second half
greater than or equal to the first (an ordered discount). An ordinary four- or
five-figure asking price cannot satisfy that, which is why nothing is split
merely for having an even number of digits.

Applied identically at the parser, the scraper write boundary, the admin and
public read boundaries, and snapshot eligibility.

## Scope of the stored data

Measured by SELECT on 2026-08-30: **77 rows**, all `is_active`, all with a
`price_dkk`. 64 six-digit, 13 eight-digit. Recovered prices span 100–6,200 EUR —
every one an ordinary asking price.

The read boundaries already show the recovered price, so the product page, the
admin queue and snapshot eligibility are correct *now*, with no migration. The
remediation below only makes the stored column agree with what is displayed.

## Remediation — idempotent, NOT RUN

```sql
-- Rewrite a welded discount pair to the current price, and rescale price_dkk
-- by the same ratio so the two columns cannot disagree.
--
-- Rescaling rather than re-deriving preserves the conversion rate actually
-- applied at write time; re-deriving from today's rate would silently restate
-- historical observations.
--
-- Idempotent: after the update `price` holds the 3- or 4-digit current value,
-- which no longer satisfies the even-length >= 6 shape, so the subquery
-- selects nothing on a second run. The final predicate is a belt-and-braces
-- guard that the row still looks exactly as it did when it was selected.
UPDATE listings l
SET    price     = pair.cur,
       price_dkk = round(l.price_dkk * pair.cur::numeric / l.price)
FROM (
  SELECT id,
         substr(price::text, 1, length(price::text) / 2)::bigint     AS cur,
         substr(price::text, length(price::text) / 2 + 1)::bigint    AS prev
  FROM   listings
  WHERE  source = 'kleinanzeigen'
    AND  price IS NOT NULL
    AND  price > 0
    AND  length(price::text) >= 6
    AND  length(price::text) % 2 = 0
    AND  substr(price::text, 1, 1) <> '0'
    AND  substr(price::text, length(price::text) / 2 + 1, 1) <> '0'
) AS pair
WHERE  l.id = pair.id
  AND  pair.cur  BETWEEN 20 AND 25000
  AND  pair.prev BETWEEN 20 AND 25000
  AND  pair.prev >= pair.cur
  AND  l.price = (pair.cur::text || pair.prev::text)::bigint;
```

Verification, before and after:

```sql
SELECT count(*) AS remaining_welded
FROM   listings
WHERE  source = 'kleinanzeigen'
  AND  price IS NOT NULL
  AND  length(price::text) >= 6
  AND  length(price::text) % 2 = 0
  AND  substr(price::text, 1, 1) <> '0'
  AND  substr(price::text, length(price::text) / 2 + 1, 1) <> '0'
  AND  substr(price::text, 1, length(price::text) / 2)::bigint  BETWEEN 20 AND 25000
  AND  substr(price::text, length(price::text) / 2 + 1)::bigint BETWEEN 20 AND 25000
  AND  substr(price::text, length(price::text) / 2 + 1)::bigint
       >= substr(price::text, 1, length(price::text) / 2)::bigint;
```

Expected: **77** before, **0** after.

**What it does not touch:** `external_id`, `scraped_at`, `is_active`, `url`,
`ingestion_batch_id`, the `ON CONFLICT` identity, any non-Kleinanzeigen row, and
any row without the pair shape. It creates nothing and deletes nothing.

**The previously prepared `SET price = NULL` remediation is withdrawn.** It
would have destroyed all 77 recoverable prices.
