/**
 * scripts/lib/pan268-badges.test.ts
 *
 * PAN-268, owner decision 2026-10-16 ("Ja, a+c"): most wall listings carried no
 * typisk / under / over badge. A: an unreviewed listing is badged too, against
 * the verified-only band, and never below a fifth of its median. C: a local
 * listing whose own market has no band is measured against the Reverb asking
 * band, and says so.
 *
 * Run: npx tsx --test scripts/lib/pan268-badges.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { classify } from '../../frontend/lib/price-check'
import { translations } from '../../frontend/lib/i18n'
import {
  buildPopulationStats,
  listingVerdict,
  MIN_VERDICT_PRICE_PERCENT,
  VERDICT_BASIS_REVERB_FALLBACK,
  type PopulationKey,
} from '../../frontend/lib/price-populations'

const rows = (prices: number[], source: string) =>
  prices.map((price) => ({ price, price_dkk: price, source, country: null, condition: null }))

// Eight Danish prices: median 4,900, Q1 4,350, Q3 5,550 (Type 7).
const dkBand = buildPopulationStats('dk-asking', rows([4000, 4200, 4400, 4800, 5000, 5400, 6000, 6500], 'dba.dk'))
// Eight Reverb asking prices: median 10,500, Q1 9,750, Q3 11,250.
const reverbBand = buildPopulationStats('reverb-asking', rows([9000, 9500, 10000, 10400, 10600, 11000, 11500, 12000], 'reverb'))
const dkThin = buildPopulationStats('dk-asking', rows([4000, 5000], 'dba.dk'))

const dba = (price_dkk: number) => ({ source: 'dba.dk', country: 'DK', price_dkk })

test('A: an unreviewed listing is badged against the verified band; a rejected one never is', () => {
  const unreviewed = listingVerdict(dba(4000), null, { 'dk-asking': dkBand })
  assert.equal(unreviewed.verdict, 'under')
  assert.equal(unreviewed.against, 'dk-asking')
  assert.equal(unreviewed.basisLabelKey, 'verdictBasisDk')

  const rejected = listingVerdict(dba(4000), false, { 'dk-asking': dkBand, 'reverb-asking': reverbBand })
  assert.equal(rejected.verdict, null)
  assert.equal(rejected.reason, 'rejected_match')
})

test('the guard: below 20 % of the median there is no badge, on the own band and on the borrowed one', () => {
  assert.equal(MIN_VERDICT_PRICE_PERCENT, 20)
  // 20 % of 4,900 is 980: a 979 kr manual gets nothing, 980 kr is still measured.
  const manual = listingVerdict(dba(979), null, { 'dk-asking': dkBand })
  assert.equal(manual.verdict, null)
  assert.equal(manual.reason, 'below_price_floor')
  assert.equal(listingVerdict(dba(980), null, { 'dk-asking': dkBand }).verdict, 'under')

  // 20 % of Reverb's 10,500 is 2,100.
  const part = listingVerdict(dba(2000), null, { 'dk-asking': dkThin, 'reverb-asking': reverbBand })
  assert.equal(part.verdict, null)
  assert.equal(part.basisLabelKey, null)
})

test('C: no band of its own, so a local listing is measured against Reverb asking, and labelled so', () => {
  for (const [source, country] of [['dba.dk', 'DK'], ['finn', 'NO'], ['blocket', 'SE'], ['kleinanzeigen', 'DE']]) {
    // tier 'listings-only' (DBA's two prices) and tier 'none' (an empty foreign market) both borrow.
    const ownKey = (source === 'dba.dk' ? 'dk-asking' : source === 'finn' ? 'no-asking' : source === 'blocket' ? 'se-asking' : 'de-asking') as PopulationKey
    const own = source === 'dba.dk' ? dkThin : buildPopulationStats(ownKey, [])
    const outcome = listingVerdict({ source, country, price_dkk: 8000 }, null, { [ownKey]: own, 'reverb-asking': reverbBand })
    assert.equal(outcome.verdict, 'under', source)
    assert.equal(outcome.against, 'reverb-asking', source)
    assert.equal(outcome.basisLabelKey, VERDICT_BASIS_REVERB_FALLBACK, source)
  }
  // The card says it in words, in both locales.
  assert.equal(translations.da[VERDICT_BASIS_REVERB_FALLBACK as keyof typeof translations.da], 'målt mod Reverb')
  assert.equal(translations.en[VERDICT_BASIS_REVERB_FALLBACK as keyof typeof translations.en], 'measured against Reverb')

  // Reverb SOLD is never a basis, and a Reverb listing has nothing to borrow from.
  const sold = buildPopulationStats('reverb-sold', rows([9000, 9500, 10000, 10400, 10600, 11000, 11500, 12000], 'reverb'))
  assert.equal(listingVerdict(dba(8000), null, { 'dk-asking': dkThin, 'reverb-sold': sold }).verdict, null)
  const thinReverb = buildPopulationStats('reverb-asking', rows([9000, 9500], 'reverb'))
  assert.equal(listingVerdict({ source: 'reverb', country: null, price_dkk: 8000 }, null, { 'reverb-asking': thinReverb }).verdict, null)
})

test('the own market takes precedence as soon as it has a band, even a 3–7 one or one too wide to judge', () => {
  const dkFew = buildPopulationStats('dk-asking', rows([4000, 4600, 5200], 'dba.dk'))
  const few = listingVerdict(dba(8000), null, { 'dk-asking': dkFew, 'reverb-asking': reverbBand })
  assert.equal(few.against, 'dk-asking')
  assert.equal(few.verdict, 'over')
  assert.equal(few.basisLabelKey, 'verdictBasisDk')

  // Q3/Q1 above ten: no Danish verdict, and no quiet swap to Reverb either.
  const wide = buildPopulationStats('dk-asking', rows([200, 300, 400, 500, 9000, 10000, 12000, 14000], 'dba.dk'))
  assert.equal(wide.widthOk, false)
  const outcome = listingVerdict(dba(8000), null, { 'dk-asking': wide, 'reverb-asking': reverbBand })
  assert.equal(outcome.verdict, null)
  assert.equal(outcome.reason, 'width_guard_failed')
})

test('tjek-prisen badges a pasted DBA ad the way the product page badges its card', () => {
  const borrowed = classify({
    source: 'dba', cause: null, matched: true, priceDkk: 8000,
    populations: { 'dk-asking': dkThin, 'reverb-asking': reverbBand }, dkAskingPrices: [4000, 5000],
  })
  assert.equal(borrowed.state, 'verdict')
  assert.equal(borrowed.verdict, 'under')
  assert.equal(borrowed.verdictBasis, VERDICT_BASIS_REVERB_FALLBACK)
  // The two Danish prices still show beside it, with their own caveat.
  assert.deepEqual(borrowed.dkFew, { n: 2, low: 4000, high: 5000, median: null })

  const danish = classify({
    source: 'dba', cause: null, matched: true, priceDkk: 4000,
    populations: { 'dk-asking': dkBand, 'reverb-asking': reverbBand }, dkAskingPrices: [],
  })
  assert.equal(danish.verdictBasis, 'verdictBasisDk')
  assert.equal(danish.verdict, 'under')
})
