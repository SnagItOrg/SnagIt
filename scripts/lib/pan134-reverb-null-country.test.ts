/**
 * PAN-134 — Reverb stops claiming a country.
 *
 * Reverb's search endpoint returns no `location` (0 of 394 listings measured
 * 2026-09-24), so `buildRow()` writes `country: null` instead of the literal
 * 'US'. The nightly upsert nulls `country` on every active row it sees again,
 * so for a while production holds Reverb rows in three states at once:
 * null (re-seen), 'US' (not yet re-seen) and 'DK' (20,200 inactive rows from
 * migration 037's currency backfill).
 *
 * Every one of them must still be Reverb, found by SOURCE: in the price
 * population and in the /intel "US" column. A test that only checked the
 * population would pass without the guard, because `SOURCE_TO_POPULATION`
 * also maps 'reverb'. The basis and the DK row are what make it able to fail.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { classifyListing, groupByPopulation } from '../../frontend/lib/price-populations'
import { listingMarket } from '../../frontend/app/intel/overview'

const REVERB_COUNTRY_STATES = [null, 'US', 'DK'] as const

test('the Reverb scraper writes country null, never the literal US', () => {
  const src = readFileSync(join(__dirname, '..', 'scrape-reverb.ts'), 'utf8')
  assert.equal(/country:\s*'US'/.test(src), false, "scrape-reverb.ts still writes country: 'US'")
  assert.ok(/country:\s*null,/.test(src), 'buildRow() must write country: null')
})

test('a Reverb row is reverb-asking by platform whatever its country', () => {
  for (const country of REVERB_COUNTRY_STATES) {
    const c = classifyListing({ source: 'reverb', country })
    assert.equal(c.population, 'reverb-asking', `country=${country}`)
    assert.equal(c.basis, 'source-platform', `country=${country}`)
  }
})

test('the transition mix never leaks a Reverb row into a national population', () => {
  const rows = [
    ...REVERB_COUNTRY_STATES.map((country) => ({ source: 'reverb', country, price_dkk: 30000 })),
    { source: 'dba.dk', country: 'DK', price_dkk: 20000 },
  ]
  const { byPopulation, unresolved } = groupByPopulation(rows)
  assert.equal(byPopulation['reverb-asking'].length, 3)
  assert.deepEqual(byPopulation['dk-asking'].map((r) => r.source), ['dba.dk'])
  assert.equal(unresolved.length, 0)
})

test('/intel counts Reverb in the US column by source, whatever its country', () => {
  for (const country of REVERB_COUNTRY_STATES) {
    assert.equal(listingMarket({ source: 'reverb', country }), 'US', `country=${country}`)
  }
})

test('/intel still places every other source by its own country', () => {
  assert.equal(listingMarket({ source: 'dba.dk', country: 'DK' }), 'DK')
  assert.equal(listingMarket({ source: 'kleinanzeigen', country: 'DE' }), 'DE')
  assert.equal(listingMarket({ source: 'finn', country: null }), null)
  assert.equal(listingMarket({ source: 'thomann', country: 'FR' }), null)
})
