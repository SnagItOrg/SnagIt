/**
 * PAN-151, owner decision 2026-09-28: scrape-dba is scoped to Musikinstrumenter.
 *
 * No live dba request: fetch is replaced by a recorded-shape JSON-LD page.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { scrapeDbaWithCoverage, DBA_MUSIKINSTRUMENTER } from '../../frontend/lib/scrapers/dba'

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
