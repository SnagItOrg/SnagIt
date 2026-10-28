/**
 * scripts/lib/pan307-sold-by-product.test.ts
 *
 * PAN-307 2a: the Reverb sold writer reads a product's sales from Reverb's own product page — CSP → cp id →
 * `/api/listings?cp_ids[]=…&show_only_sold=true` — and falls back to the text search, unchanged, when the product
 * has no CSP or the CSP names no product id. The line boundary is the same on both paths: Reverb's product page
 * carries siblings too (6505+ sales on the 6505 page). Titles and the CSP body are production (2026-10-28).
 *
 * Run: npx tsx --test scripts/lib/pan307-sold-by-product.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PRODUCT_PER_PAGE, SOLD_MAX_PAGES, SOLD_TARGET, allSold, collectSold, cpIdsFromCsp, soldSearch, type SoldListing,
} from './sold-boundary'

test('PAN-307: the CSP body names Reverb\'s product id in its listings link', () => {
  // GET /api/csps/8435 (Peavey 6505): the CSP id is not the product id.
  assert.deepEqual(cpIdsFromCsp({ id: 8435, _links: { listings: { href: 'https://api.reverb.com/api/listings/all?cp_ids%5B%5D=17485' } } }), ['17485'])
  assert.deepEqual(cpIdsFromCsp({ _links: { listings: { href: 'https://api.reverb.com/api/listings/all?cp_ids[]=1&cp_ids[]=2' } } }), ['1', '2'])
})

test('PAN-307: a CSP body that names no product id gives null, so the writer falls back', () => {
  for (const body of [
    null, undefined, {}, { _status: 404 }, { _links: {} }, { _links: { listings: { href: 42 } } },
    { _links: { listings: { href: 'not a url' } } },
    { _links: { listings: { href: 'https://api.reverb.com/api/listings/all?query=peavey' } } },
    { _links: { listings: { href: 'https://api.reverb.com/api/listings/all?cp_ids%5B%5D=17485%26x' } } },
  ]) assert.equal(cpIdsFromCsp(body), null, JSON.stringify(body))
})

test('PAN-307: with a product id the writer reads the product page, 50 a page, sold only', () => {
  const s = soldSearch(['17485'], 'Peavey 6505', 20)
  assert.equal(s.perPage, PRODUCT_PER_PAGE)
  assert.equal(s.path(1), '/listings?cp_ids%5B%5D=17485&show_only_sold=true&per_page=50&page=1')
  assert.equal(s.path(3), '/listings?cp_ids%5B%5D=17485&show_only_sold=true&per_page=50&page=3')
  assert.equal(s.requireSoldState, true)
  assert.equal(soldSearch(['1', '2'], 'x', 20).path(1), '/listings?cp_ids%5B%5D=1&cp_ids%5B%5D=2&show_only_sold=true&per_page=50&page=1')
})

test('PAN-307: without a product id the text search is today\'s, byte for byte', () => {
  const s = soldSearch(null, 'Peavey 6505', 20)
  assert.equal(s.perPage, 20)
  assert.equal(s.path(2), '/listings?query=Peavey%206505&state=sold&per_page=20&page=2')
  assert.equal(s.requireSoldState, false)
})

test('PAN-307: a product-page listing that is not sold makes the page unusable', () => {
  const sold = { state: { slug: 'sold' } }
  assert.equal(allSold([sold, sold]), true)
  assert.equal(allSold([]), true)
  assert.equal(allSold([sold, { state: { slug: 'live' } }]), false)
  assert.equal(allSold([sold, {}]), false)
})

// ── the boundary on the product page ────────────────────────────────────────

const sale = (i: number, title: string): SoldListing => ({
  title, price: { amount: '800', currency: 'USD' }, state: { slug: 'sold' },
  _links: { web: { href: `https://reverb.com/item/${i}` } },
})
const own = (i: number) => sale(i, 'Peavey 6505 2-Channel 120-Watt Tube Guitar Amp')
const plus = (i: number) => sale(i, 'Peavey 6505+ 2-Channel 120-Watt Guitar Amp Head 2005 - 2022 - Black')
const range = <T>(from: number, n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, k) => f(from + k))
const pagesOf = (pages: SoldListing[][]) => {
  const asked: number[] = []
  return { asked, fetch: async (page: number) => { asked.push(page); return page <= pages.length ? pages[page - 1] : [] } }
}

test('PAN-307: the 6505+ sales on the 6505 product page are refused and never accepted', async () => {
  const { asked, fetch } = pagesOf([
    [...range(0, 12, own), ...range(12, 38, plus)],
    [...range(50, 10, own), ...range(60, 40, plus)].slice(0, 50),
  ])
  const got = await collectSold('peavey-6505', fetch, PRODUCT_PER_PAGE)
  assert.ok(got)
  // 12 usable on a full first page: below the target, so page 2 is read; 22 there reaches it.
  assert.deepEqual(asked, [1, 2])
  assert.equal(got.accepted.length, 22)
  assert.equal(got.refused, 38 + 40)
  assert.ok(got.accepted.every((l) => !/6505\+/.test(l.title ?? '')))
  assert.ok(got.accepted.length >= SOLD_TARGET)
})

test('PAN-307: a short product page ends the read; pages stay capped at five', async () => {
  const short = pagesOf([range(0, 7, own)])
  assert.equal((await collectSold('peavey-6505', short.fetch, PRODUCT_PER_PAGE))?.accepted.length, 7)
  assert.deepEqual(short.asked, [1])

  const siblings = pagesOf(range(0, 8, (p) => range(p * 50, 50, plus)))
  const got = await collectSold('peavey-6505', siblings.fetch, PRODUCT_PER_PAGE)
  assert.equal(siblings.asked.length, SOLD_MAX_PAGES)
  assert.equal(got?.accepted.length, 0)
  assert.equal(got?.refused, SOLD_MAX_PAGES * 50)
})
