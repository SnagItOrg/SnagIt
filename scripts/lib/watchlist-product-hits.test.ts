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

/* ── PAN-276 / PAN-278: the mail row, its links, and disengagement ───────── */

import { buildNewListingsEmail } from '../../frontend/lib/email'
import { MAIL_TOKEN, mailLinks, mailPrompt, newMailToken, type MailEngagement } from '../../frontend/lib/watchlist-mail'

/** Every write, by table, and the result each insert should give. */
function mailDb(opts: { insertError?: boolean } = {}) {
  const calls: Array<{ table: string; op: string; values?: unknown }> = []
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {
      eq: () => c, in: () => c, is: () => c,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    }
    return c
  }
  const db = {
    from(table: string) {
      return {
        upsert(input: Array<{ listing_id: string }>) {
          return { select: () => Promise.resolve({ data: input.map((r) => ({ listing_id: r.listing_id })), error: null }) }
        },
        insert(values: unknown) {
          calls.push({ table, op: 'insert', values })
          return Promise.resolve({ error: opts.insertError ? { code: 'PGRST205' } : null })
        },
        update(values: unknown) {
          calls.push({ table, op: 'update', values })
          return chain({ error: null })
        },
        delete() {
          calls.push({ table, op: 'delete' })
          return chain({ error: null })
        },
      }
    },
  }
  return { db: db as unknown as Parameters<typeof notifyHits>[0], calls }
}

const TWO = [LISTING, { ...LISTING, id: 'l-2', price_dkk: 3000 }]

test('PAN-276: with 070 applied the send writes one row and hands its token to the mail', async () => {
  const { db, calls } = mailDb()
  const sent: Array<{ mail?: { token: string; prompt: unknown } }> = []
  const result = await notifyHits(
    db,
    { watchlist: WATCH, hits: TWO, email: 'owner@example.invalid', optedOut: false, mailRows: true, prompt: 'ask' },
    async (input) => { sent.push(input) },
  )
  const insert = calls.find((c) => c.table === 'watchlist_mail' && c.op === 'insert')!.values as {
    token: string; watchlist_id: string; listing_ids: string[]; prompt: string
  }
  assert.match(insert.token, MAIL_TOKEN)
  assert.deepEqual(insert.listing_ids, ['l-1', 'l-2'], 'the mail\'s listings, in the mail\'s order')
  assert.equal(insert.prompt, 'ask')
  assert.deepEqual(sent[0].mail, { token: insert.token, prompt: 'ask' })
  assert.equal(result.prompt, 'ask')
  assert.equal(calls.some((c) => c.table === 'watchlists'), false, 'an ask never pauses')
})

test('PAN-278: a sent pause mail pauses the watchlist; a failed one deletes its row and pauses nothing', async () => {
  const ok = mailDb()
  await notifyHits(ok.db, { watchlist: WATCH, hits: TWO, email: 'o@example.invalid', optedOut: false, mailRows: true, prompt: 'pause' }, async () => {})
  assert.deepEqual(ok.calls.find((c) => c.table === 'watchlists')?.values, { active: false })

  const bad = mailDb()
  const result = await notifyHits(
    bad.db,
    { watchlist: WATCH, hits: TWO, email: 'o@example.invalid', optedOut: false, mailRows: true, prompt: 'pause' },
    async () => { throw new Error('resend_rejected:rate_limit_exceeded') },
  )
  assert.equal(result.outcome, 'failed')
  assert.ok(bad.calls.some((c) => c.table === 'watchlist_mail' && c.op === 'delete'), 'an undelivered mail never counts as ignored')
  assert.equal(bad.calls.some((c) => c.table === 'watchlists'), false)
})

test('PAN-276: no 070, or a row that will not write, still sends the PAN-273 mail without a prompt', async () => {
  for (const [label, opts, mailRows] of [['absent', {}, false], ['insert failed', { insertError: true }, true]] as const) {
    const { db, calls } = mailDb(opts)
    const sent: Array<{ mail?: unknown }> = []
    const result = await notifyHits(
      db,
      { watchlist: WATCH, hits: TWO, email: 'o@example.invalid', optedOut: false, mailRows, prompt: 'pause' },
      async (input) => { sent.push(input) },
    )
    assert.equal(result.outcome, 'sent', label)
    assert.equal(sent[0].mail, undefined, label)
    assert.equal(calls.some((c) => c.table === 'watchlists'), false, `${label}: the mail did not say so, so no pause`)
  }
})

test('PAN-276: tokens are 12 base62 characters and do not repeat', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 2000; i++) {
    const t = newMailToken()
    assert.match(t, MAIL_TOKEN)
    seen.add(t)
  }
  assert.equal(seen.size, 2000)
})

test('PAN-276: links are short, tagged with the role, and a listing link carries no UTM', () => {
  const links = mailLinks('https://www.klup.dk', 'Ab3dE5fG7hJ9')
  assert.equal(links.seeAll, 'https://www.klup.dk/w/Ab3dE5fG7hJ9?utm_source=klup&utm_medium=email&utm_campaign=watchlist&utm_content=see_all')
  assert.equal(links.stop, 'https://www.klup.dk/w/Ab3dE5fG7hJ9?svar=stop&utm_source=klup&utm_medium=email&utm_campaign=watchlist&utm_content=stop')
  assert.ok(links.keep.includes('svar=fortsaet') && links.keep.endsWith('utm_content=keep'))
  assert.ok(links.resume.endsWith('utm_content=resume'))
  assert.equal(links.listing(2), 'https://www.klup.dk/w/Ab3dE5fG7hJ9/2')
})

test('PAN-278: the 3rd and 4th unclicked mail ask, the 5th pauses, and a click or a pause starts over', () => {
  const day = (d: number, clicked?: number, prompt: MailEngagement['prompt'] = null): MailEngagement => ({
    sent_at: `2026-10-${String(d).padStart(2, '0')}T05:00:00.000Z`,
    clicked_at: clicked ? `2026-10-${String(clicked).padStart(2, '0')}T12:00:00.000Z` : null,
    prompt,
  })
  assert.equal(mailPrompt([]), null, 'first mail')
  assert.equal(mailPrompt([day(1)]), null, 'second mail')
  assert.equal(mailPrompt([day(1), day(2)]), 'ask', 'third mail')
  assert.equal(mailPrompt([day(1), day(2), day(3, undefined, 'ask')]), 'ask', 'fourth mail asks again')
  assert.equal(mailPrompt([day(1), day(2), day(3, undefined, 'ask'), day(4, undefined, 'ask')]), 'pause', 'fifth mail')
  assert.equal(mailPrompt([day(1), day(2), day(3, 3)]), null, 'the latest mail was opened')
  assert.equal(mailPrompt([day(1, 5), day(2), day(3), day(4)]), null, 'an old mail opened yesterday counts too')
  assert.equal(mailPrompt([day(1), day(2), day(3), day(4), day(5, undefined, 'pause')]), null, 'switched back on after a pause')
})

test('PAN-276: the mail links through /w, names links in words, escapes titles, and asks in Danish', () => {
  const listings = [
    { title: 'Roland <Juno> & co', price: 4500, currency: 'DKK', url: 'https://dba.dk/x', source: 'dba' },
    ...Array.from({ length: 6 }, (_, i) => ({ title: `Juno ${i}`, price: 5000, currency: 'DKK', url: 'https://dba.dk/y', source: 'dba' })),
  ]
  const { subject, text, html } = buildNewListingsEmail({
    query: 'Roland Juno-106', listings, mail: { token: 'Ab3dE5fG7hJ9', prompt: 'ask' },
  })
  assert.equal(subject, '7 nye annoncer: "Roland Juno-106"')
  assert.ok(text.includes('/w/Ab3dE5fG7hJ9/1'), 'a listing goes through the click route')
  assert.ok(!text.includes('dba.dk/x'), 'not straight to the ad')
  assert.ok(text.includes('…og 2 annoncer mere.'))
  assert.ok(text.includes('Skal vi stoppe med at sende dig disse?'))
  assert.ok(text.includes('svar=stop') && text.includes('svar=fortsaet'))
  assert.ok(html.includes('Roland &lt;Juno&gt; &amp; co'))
  assert.ok(html.includes('>Se alle på Klup</a>'), 'the link is named, not printed')

  const legacy = buildNewListingsEmail({ query: 'reverb', listings: listings.slice(0, 1) })
  assert.ok(legacy.text.includes('https://dba.dk/x'), 'without a row the mail keeps the PAN-273 links')
  assert.ok(!legacy.text.includes('Skal vi stoppe'))

  const paused = buildNewListingsEmail({ query: 'reverb', listings: listings.slice(0, 1), mail: { token: 'Ab3dE5fG7hJ9', prompt: 'pause' } })
  assert.ok(paused.text.includes('Det her er den sidste mail om "reverb"'))
  assert.ok(paused.text.includes('utm_content=resume'))
})
