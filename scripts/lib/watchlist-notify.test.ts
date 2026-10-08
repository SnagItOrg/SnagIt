/**
 * PAN-72 — a notification marker must mean the notification was sent.
 *
 * The defect these cover: `/api/cron/scrape` wrote `listings.notified_at`
 * outside both the `if (user?.email)` guard and the surrounding `try/catch`,
 * so the marker proved only that execution reached that line. The
 * provider-failure path is the one that produced the false marker, and it was
 * the one nothing watched.
 *
 * The route module cannot be imported outside Next, so the step itself is the
 * seam — `frontend/lib/watchlist-notify.ts` — exactly as PAN-62 moved its
 * write tally into `scripts/lib/scrape-health.ts` for the same reason.
 *
 * No test here can reach a mail provider: `notifyWatchlist` takes its sender
 * as a parameter, and the one test that exercises the real Resend client
 * replaces `globalThis.fetch` first.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { notifyWatchlist } from '../../frontend/lib/watchlist-notify'
import { sendNewListingsEmail } from '../../frontend/lib/email'
import { isHit, notifyHits } from './watchlist-hits'

type Db = Parameters<typeof notifyWatchlist>[0]

const NOW = '2026-09-19T12:00:00.000Z'
const LISTINGS = [
  { title: 'Roland Juno-106', price: 4500, currency: 'DKK', url: 'https://example.invalid/a' },
  { title: 'Korg MS-20', price: 6200, currency: 'DKK', url: 'https://example.invalid/b' },
]

/** Records every `listings` update the step attempts. */
function recordingDb(markError: { message: string } | null = null) {
  const marks: Array<{ table: string; values: unknown; watchlistId: string }> = []
  const db = {
    from(table: string) {
      return {
        update(values: unknown) {
          return {
            eq(_column: string, watchlistId: string) {
              return {
                is(_c: string, _v: null) {
                  marks.push({ table, values, watchlistId })
                  return Promise.resolve({ error: markError })
                },
              }
            },
          }
        },
      }
    },
  }
  return { db: db as unknown as Db, marks }
}

/** Captures the operational log lines the step emits. */
function captureErrors(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  return { lines, restore: () => { console.error = original } }
}

test('a rejected send leaves notified_at unwritten and is counted as a failure', async () => {
  const { db, marks } = recordingDb()
  const log = captureErrors()

  let outcome
  try {
    outcome = await notifyWatchlist(
      db,
      { watchlistId: 'w-1', query: 'juno 106', email: 'owner@example.invalid', listings: LISTINGS, now: NOW },
      async () => { throw new Error('resend_rejected:rate_limit_exceeded') },
    )
  } finally {
    log.restore()
  }

  // The marker is the whole point: a refused send must not stamp a single row.
  assert.equal(marks.length, 0, 'a refused send must attempt no notified_at write')
  assert.equal(outcome.notified, 0)
  assert.equal(outcome.unnotified, LISTINGS.length)
  assert.equal(outcome.failure, 'send_failed')
  assert.equal(outcome.detail, 'resend_rejected:rate_limit_exceeded')

  // Counted and logged, without PII.
  assert.equal(log.lines.length, 1)
  const logged = JSON.parse(log.lines[0])
  assert.equal(logged.event, 'watchlist_notification_failed')
  assert.equal(logged.failure, 'send_failed')
  assert.equal(logged.unnotified, LISTINGS.length)
  assert.ok(!log.lines[0].includes('owner@example.invalid'), 'the recipient must never be logged')
  assert.ok(!log.lines[0].includes('Roland Juno-106'), 'listing identity must never be logged')
})

test('a transport error that is not a known provider code is not forwarded as a reason', async () => {
  const { db, marks } = recordingDb()
  const log = captureErrors()

  let outcome
  try {
    // An arbitrary error message is not known to be free of PII, so it is
    // dropped rather than echoed into the log.
    outcome = await notifyWatchlist(
      db,
      { watchlistId: 'w-1', query: 'juno 106', email: 'owner@example.invalid', listings: LISTINGS, now: NOW },
      async () => { throw new Error('connect ECONNREFUSED owner@example.invalid') },
    )
  } finally {
    log.restore()
  }

  assert.equal(marks.length, 0)
  assert.equal(outcome.failure, 'send_failed')
  assert.equal(outcome.detail, null)
  assert.ok(!log.lines[0].includes('owner@example.invalid'))
})

test('an owner with no email address is never marked as notified', async () => {
  const { db, marks } = recordingDb()
  const log = captureErrors()

  let sendCalls = 0
  let outcome
  try {
    outcome = await notifyWatchlist(
      db,
      { watchlistId: 'w-2', query: 'ms-20', email: null, listings: LISTINGS, now: NOW },
      async () => { sendCalls += 1 },
    )
  } finally {
    log.restore()
  }

  assert.equal(sendCalls, 0)
  assert.equal(marks.length, 0, 'no recipient must attempt no notified_at write')
  assert.equal(outcome.notified, 0)
  assert.equal(outcome.unnotified, LISTINGS.length)
  assert.equal(outcome.failure, 'no_recipient')
})

test('a confirmed send stamps notified_at exactly once', async () => {
  const { db, marks } = recordingDb()

  const outcome = await notifyWatchlist(
    db,
    { watchlistId: 'w-3', query: 'juno 106', email: 'owner@example.invalid', listings: LISTINGS, now: NOW },
    async () => {},
  )

  assert.equal(marks.length, 1)
  assert.deepEqual(marks[0], { table: 'listings', values: { notified_at: NOW }, watchlistId: 'w-3' })
  assert.equal(outcome.notified, LISTINGS.length)
  assert.equal(outcome.unnotified, 0)
  assert.equal(outcome.failure, null)
})

test('a send that succeeded but could not be marked is not reported as notified', async () => {
  const { db, marks } = recordingDb({ message: 'statement timeout' })
  const log = captureErrors()

  let outcome
  try {
    outcome = await notifyWatchlist(
      db,
      { watchlistId: 'w-4', query: 'juno 106', email: 'owner@example.invalid', listings: LISTINGS, now: NOW },
      async () => {},
    )
  } finally {
    log.restore()
  }

  assert.equal(marks.length, 1, 'the write is attempted')
  assert.equal(outcome.notified, 0, 'a marker that did not land is not a marker')
  assert.equal(outcome.failure, 'mark_failed')
})

test('sendNewListingsEmail rejects when the provider refuses the message', async () => {
  // The Resend client RESOLVES with `{ data, error }` on a rejection rather
  // than throwing, so before PAN-72 the caller's try/catch never fired and a
  // refused send read as a delivery. `fetch` is replaced first, so this cannot
  // reach the network and cannot send anything.
  const originalFetch = globalThis.fetch
  const originalKey = process.env.RESEND_API_KEY
  const originalFrom = process.env.RESEND_FROM_EMAIL

  process.env.RESEND_API_KEY = 're_not_a_real_key_for_tests'
  process.env.RESEND_FROM_EMAIL = 'noreply@example.invalid'
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ name: 'rate_limit_exceeded', message: 'Too many requests', statusCode: 429 }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    )) as typeof globalThis.fetch

  try {
    await assert.rejects(
      () => sendNewListingsEmail({ to: 'owner@example.invalid', query: 'juno 106', listings: LISTINGS }),
      (err: Error) => {
        assert.equal(err.message, 'resend_rejected:rate_limit_exceeded')
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = originalKey
    if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL
    else process.env.RESEND_FROM_EMAIL = originalFrom
  }
})

/* ── PAN-12: the panter runner's step (scripts/lib/watchlist-hits.ts) ───── */

/** A watchlist_notification table: the claim inserts only unseen pairs. */
function notificationTable() {
  const rows = new Map<string, { outcome: string; detail: string | null }>()
  const db = {
    from(_table: string) {
      return {
        upsert(input: Array<{ watchlist_id: string; listing_id: string; outcome: string }>) {
          const inserted = input.filter((r) => !rows.has(`${r.watchlist_id}:${r.listing_id}`))
          for (const r of inserted) rows.set(`${r.watchlist_id}:${r.listing_id}`, { outcome: r.outcome, detail: null })
          return { select: () => Promise.resolve({ data: inserted.map((r) => ({ listing_id: r.listing_id })), error: null }) }
        },
        update(values: { outcome: string; detail: string | null }) {
          return {
            eq: (_c: string, watchlistId: string) => ({
              in: (_c2: string, ids: string[]) => {
                for (const id of ids) rows.set(`${watchlistId}:${id}`, { outcome: values.outcome, detail: values.detail })
                return Promise.resolve({ error: null })
              },
            }),
          }
        },
      }
    },
  }
  return { db: db as unknown as Parameters<typeof notifyHits>[0], rows }
}

const WATCHLIST = { id: 'w-9', query: 'Juno 60', min_price: null, max_price: 20000, created_at: '2026-10-01T00:00:00+00:00' }
const HIT = {
  id: 'l-1', title: 'Roland Juno-60 synth', price: 1800, currency: 'EUR', price_dkk: 13400,
  url: 'https://example.invalid/r', source: 'reverb', ingested_at: '2026-10-08T02:00:00+00:00',
}

test('PAN-12: a pair already handled is never mailed again, and only whole-word hits qualify', async () => {
  assert.equal(isHit(WATCHLIST, HIT), true)
  assert.equal(isHit({ ...WATCHLIST, query: 'ph 5' }, { ...HIT, title: 'MXR Phase 90' }), false)
  assert.equal(isHit(WATCHLIST, { ...HIT, price_dkk: 25000 }), false, 'over max_price')

  const { db, rows } = notificationTable()
  let sends = 0
  const send = async () => { sends += 1 }
  const args = { watchlist: WATCHLIST, hits: [HIT], email: 'owner@example.invalid', optedOut: false }

  assert.deepEqual(await notifyHits(db, args, send), { outcome: 'sent', listings: 1 })
  assert.deepEqual(await notifyHits(db, args, send), { outcome: null, listings: 0 })
  assert.equal(sends, 1, 'the second run must not send')
  assert.equal(rows.get('w-9:l-1')?.outcome, 'sent')
})

test('PAN-12: a rejected send is recorded without the address and the next watchlist still goes out', async () => {
  const { db, rows } = notificationTable()
  const log = captureErrors()
  const sentTo: string[] = []
  const send = async ({ to }: { to: string }) => {
    if (to === 'a@example.invalid') throw new Error('resend_rejected:validation_error')
    sentTo.push(to)
  }

  let first, second
  try {
    first = await notifyHits(db, { watchlist: WATCHLIST, hits: [HIT], email: 'a@example.invalid', optedOut: false }, send)
    second = await notifyHits(db, { watchlist: { ...WATCHLIST, id: 'w-10' }, hits: [HIT], email: 'b@example.invalid', optedOut: false }, send)
  } finally {
    log.restore()
  }

  assert.deepEqual(first, { outcome: 'failed', listings: 1 })
  assert.deepEqual(rows.get('w-9:l-1'), { outcome: 'failed', detail: 'resend_rejected:validation_error' })
  assert.deepEqual(second, { outcome: 'sent', listings: 1 })
  assert.deepEqual(sentTo, ['b@example.invalid'])
  assert.ok(!log.lines.join('\n').includes('a@example.invalid'), 'the recipient must never be logged')
})
