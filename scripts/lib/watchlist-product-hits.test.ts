/**
 * PAN-273 — a product watchlist hits on the matcher's say-so, not on words.
 *
 * The free-text rule in `watchlist-hits.ts` could never hit a pasted ad title
 * or a typo, and it hit parts and wanted ads until a guard was bolted on. The
 * product rule has none of that: the listing is a hit when the matcher tied
 * it to the watched product and the price, the age and the listing's own
 * state agree. These cases pin that the rule reads exactly those inputs —
 * and that the query rule is unchanged by sharing its window check.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  matchesProductWatchlist,
  matchesWatchlist,
  notifyHits,
  type HitListing,
  type HitWatchlist,
} from './watchlist-hits'

const JUNO = '11111111-1111-4111-8111-111111111111'
const MS20 = '22222222-2222-4222-8222-222222222222'

const WATCH: HitWatchlist = {
  id: 'w-1',
  query: 'Roland Juno-106',
  min_price: null,
  max_price: 5000,
  created_at: '2026-10-01T00:00:00.000Z',
  product_id: JUNO,
}

// The title is deliberately one the word rule cannot hit: that is the point.
const LISTING: HitListing = {
  id: 'l-1',
  title: 'Den legendariske studio synth (The King) – sælges',
  price: 4500,
  currency: 'DKK',
  price_dkk: 4500,
  url: 'https://example.invalid/a',
  source: 'dba',
  ingested_at: '2026-10-18T03:00:00.000Z',
  is_active: true,
}

test('PAN-273: a matched, active, in-budget listing hits regardless of its title', () => {
  assert.equal(matchesProductWatchlist(WATCH, LISTING, new Set([JUNO])), true)
  assert.equal(matchesWatchlist(WATCH, LISTING), false, 'the word rule would never have found it')
})

test('PAN-273: no match row, or a match to another product, is no hit', () => {
  assert.equal(matchesProductWatchlist(WATCH, LISTING, undefined), false, 'unmatched')
  assert.equal(matchesProductWatchlist(WATCH, LISTING, new Set()), false, 'only rejected matches')
  assert.equal(matchesProductWatchlist(WATCH, LISTING, new Set([MS20])), false, 'another model')
  assert.equal(matchesProductWatchlist(WATCH, LISTING, new Set([JUNO, MS20])), true, 'one of several')
})

test('PAN-273: price, age and activity gate the product rule exactly as the query rule', () => {
  const hit = new Set([JUNO])
  assert.equal(matchesProductWatchlist(WATCH, { ...LISTING, price_dkk: 5000 }, hit), true, 'at max_price')
  assert.equal(matchesProductWatchlist(WATCH, { ...LISTING, price_dkk: 5001 }, hit), false, 'over max_price')
  assert.equal(matchesProductWatchlist(WATCH, { ...LISTING, price_dkk: null }, hit), false, 'no DKK price')
  assert.equal(matchesProductWatchlist({ ...WATCH, min_price: 4600 }, LISTING, hit), false, 'under min_price')
  assert.equal(matchesProductWatchlist({ ...WATCH, max_price: null }, LISTING, hit), true, 'no ceiling')
  assert.equal(
    matchesProductWatchlist(WATCH, { ...LISTING, ingested_at: '2026-09-30T23:59:59.000Z' }, hit),
    false,
    'ingested before the watch was created',
  )
  assert.equal(matchesProductWatchlist(WATCH, { ...LISTING, is_active: false }, hit), false, 'sold or removed')
  assert.equal(matchesProductWatchlist(WATCH, { ...LISTING, is_active: null }, hit), true, 'unknown state is not inactive')
})

test('PAN-273: a query watchlist never takes the product path, and vice versa', () => {
  const query: HitWatchlist = { ...WATCH, product_id: null, query: 'juno 106' }
  assert.equal(matchesProductWatchlist(query, LISTING, new Set([JUNO])), false)
  assert.equal(matchesWatchlist(query, { ...LISTING, title: 'Roland Juno-106 med MIDI' }), true)
  // The product watchlist carries the model's name as `query` for display; it
  // is not a search, so a title that happens to contain it is not a hit here.
  assert.equal(matchesProductWatchlist(WATCH, { ...LISTING, title: 'Roland Juno-106' }, new Set()), false)
})

/** The claim table and the send, recorded. */
function fakeDb() {
  const rows: Array<{ outcome: string }> = []
  const db = {
    from(_table: string) {
      return {
        upsert(input: Array<{ watchlist_id: string; listing_id: string; outcome: string }>) {
          return { select: () => Promise.resolve({ data: input.map((r) => ({ listing_id: r.listing_id })), error: null }) }
        },
        update(values: { outcome: string }) {
          rows.push(values)
          return { eq: () => ({ in: () => Promise.resolve({ error: null }) }) }
        },
      }
    },
  }
  return { db: db as unknown as Parameters<typeof notifyHits>[0], rows }
}

test('PAN-273: the product watchlist mail links to the product page, the query mail still to the search', async () => {
  const sent: Array<{ query: string; seeAllUrl?: string }> = []
  const send = async (input: { query: string; seeAllUrl?: string }) => { sent.push(input) }

  const { db, rows } = fakeDb()
  const product = await notifyHits(
    db,
    { watchlist: WATCH, hits: [LISTING], email: 'owner@example.invalid', optedOut: false, seeAllUrl: 'https://www.klup.dk/product/roland-juno-106' },
    send,
  )
  const query = await notifyHits(
    db,
    { watchlist: { ...WATCH, product_id: null, query: 'juno 106' }, hits: [LISTING], email: 'owner@example.invalid', optedOut: false },
    send,
  )

  assert.deepEqual([product.outcome, query.outcome], ['sent', 'sent'])
  assert.equal(sent[0].query, 'Roland Juno-106', 'the mail names the model')
  assert.equal(sent[0].seeAllUrl, 'https://www.klup.dk/product/roland-juno-106')
  assert.equal(sent[1].seeAllUrl, undefined, 'the query mail keeps its default')
  assert.deepEqual(rows.map((r) => r.outcome), ['sent', 'sent'], 'both claims recorded')
})
