/**
 * PAN-151, owner decision 2026-09-28: scrape-dba is scoped to Musikinstrumenter,
 * and a weekly Elektronik sweep keeps only listings that resolve.
 *
 * No live dba request: fetch is replaced by a recorded-shape JSON-LD page.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import type { Product } from '../../frontend/lib/matching/match-listings'
import { scrapeDbaWithCoverage, DBA_MUSIKINSTRUMENTER } from '../../frontend/lib/scrapers/dba'
import { buildSweepKnowledge, keepForSweep } from './dba-elektronik-sweep'

test('the category scope reaches every request, including the query variants', async () => {
  const page = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'CollectionPage',
    mainEntity: { itemListElement: [{ item: {
      name: 'Roland Juno-106', url: 'https://www.dba.dk/recommerce/forsale/item/1',
      offers: { price: '9000', priceCurrency: 'DKK' },
    } }] },
  })}</script>`
  const requested: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    requested.push(String(url))
    return new Response(page, { status: 200 })
  }) as typeof fetch
  try {
    // `juno-106` also searches `juno106`, so two requests.
    await scrapeDbaWithCoverage('juno-106', 1, { subCategory: DBA_MUSIKINSTRUMENTER })
  } finally {
    globalThis.fetch = realFetch
  }
  assert.equal(requested.length, 2)
  for (const url of requested) assert.match(url, /[?&]sub_category=1\.86\.92(&|$)/)
})

test('the Elektronik sweep keeps a listing only when the live matcher and the resolver agree', () => {
  const product = (slug: string, model: string, support: string): Product => ({
    id: slug, slug, canonical_name: `Roland ${model}`, model_name: model,
    brand_name: 'roland', status: 'active', support_state: support,
  })
  const knowledge = buildSweepKnowledge(
    [
      product('roland-juno-60', 'Juno-60', 'supported'),
      product('roland-juno-106', 'Juno-106', 'supported'),
      product('roland-juno-d', 'Juno-D', 'known'),
      product('roland-cube-street', 'Cube Street', 'known'),
      product('roland-cube-lite', 'Cube Lite', 'known'),
    ],
    [],
    // The PAN-125 collision: a bare line alias the live matcher follows.
    [{ alias: 'juno', canonical_query: 'roland-juno-106' }],
  )

  assert.equal(keepForSweep('Roland Juno-106 synthesizer', 'roland', knowledge), 'roland-juno-106')
  // The live matcher alone would keep this (alias → Juno-106); the resolver
  // reads a bare model line and vetoes it.
  assert.equal(keepForSweep('Roland Juno synth', 'roland', knowledge), null)
  // The resolver alone would keep this (the KG holds it); it is not a
  // supported product, so the live matcher never matches it.
  assert.equal(keepForSweep('Roland Cube Street forstærker', 'roland', knowledge), null)
})
