/**
 * PAN-308 — the welcome series' nightly step (mails 2 and 3).
 *
 * Pins: who is due which mail and when, mail 3's numbers, and the runner's
 * order of writes — the stop token before the mail, the sent stamp after it,
 * one idempotency key per mail and account, the one-click header, and a
 * welcome failure that can never fail the alert run.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  FIRST_WEEK_WINDOW, PRICE_TIP_WINDOW, SERIES_START, firstWeekStats, welcomeMailDue, type WelcomeAccount,
} from './welcome-series'

const ROOT = join(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')
/** Strip comments, so prose cannot satisfy a check. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const H = 60 * 60 * 1000
const D = 24 * H
const NOW = Date.parse('2026-11-12T05:00:00Z')
const account = (ageMs: number, meta: Record<string, unknown> = {}, email: string | null = 'a@example.test'): WelcomeAccount =>
  ({ id: 'u1', email, created_at: new Date(NOW - ageMs).toISOString(), app_metadata: { provider: 'email', ...meta } })
const due = (a: WelcomeAccount, ctx: Partial<{ optedOut: boolean; hasWatchlist: boolean }> = {}) =>
  welcomeMailDue(a, { nowMs: NOW, optedOut: false, hasWatchlist: true, ...ctx })

test('the windows: mail 2 on days 2–4, mail 3 on days 7–9', () => {
  assert.deepEqual(PRICE_TIP_WINDOW, { from: 2 * D, until: 4 * D })
  assert.deepEqual(FIRST_WEEK_WINDOW, { from: 7 * D, until: 9 * D })
  assert.equal(due(account(2 * D - 1)), null)
  assert.equal(due(account(2 * D)), 2)
  assert.equal(due(account(4 * D - 1)), 2)
  assert.equal(due(account(4 * D)), null)
  assert.equal(due(account(7 * D - 1)), null)
  assert.equal(due(account(7 * D)), 3)
  assert.equal(due(account(9 * D - 1)), 3)
  assert.equal(due(account(9 * D)), null)
})

test('each mail at most once: the sent stamp closes its window', () => {
  assert.equal(due(account(3 * D, { welcome_2_sent_at: '2026-11-10T05:00:00Z' })), null)
  assert.equal(due(account(8 * D, { welcome_3_sent_at: '2026-11-11T05:00:00Z' })), null)
  // Mail 2's stamp does not stop mail 3.
  assert.equal(due(account(8 * D, { welcome_2_sent_at: '2026-11-06T05:00:00Z' })), 3)
})

test('mail 3 only with a watchlist', () => {
  assert.equal(due(account(8 * D), { hasWatchlist: false }), null)
  assert.equal(due(account(3 * D), { hasWatchlist: false }), 2, 'mail 2 needs no watchlist')
})

test('nothing for a stopped, opted-out, address-less or pre-series account', () => {
  assert.equal(due(account(3 * D, { welcome_stopped_at: '2026-11-10T09:00:00Z' })), null)
  assert.equal(due(account(3 * D), { optedOut: true }), null)
  assert.equal(due(account(3 * D, {}, null)), null)
  const before = { ...account(3 * D), created_at: new Date(SERIES_START - 1).toISOString() }
  assert.equal(welcomeMailDue(before, { nowMs: SERIES_START + 3 * D, optedOut: false, hasWatchlist: true }), null)
  assert.equal(due({ ...account(3 * D), created_at: 'not a date' }), null)
})

test("mail 3's numbers: distinct listings, under from the model's own verdicts, null without one", () => {
  const watches = [{ id: 'w1', product_id: 'p1' }, { id: 'w2', product_id: null }]
  const pairs = [
    { watchlist_id: 'w1', listing_id: 'l1' },
    { watchlist_id: 'w1', listing_id: 'l2' },
    { watchlist_id: 'w2', listing_id: 'l2' }, // the same listing on two watches counts once
    { watchlist_id: 'w2', listing_id: 'l3' },
    { watchlist_id: 'other', listing_id: 'l9' }, // another account's watch
  ]
  const verdicts = new Map([['p1', new Map([
    ['l1', { verdict: 'under' as const, basisLabelKey: 'x', fewN: null }],
    ['l2', { verdict: 'typical' as const, basisLabelKey: 'x', fewN: null }],
  ])]])
  assert.deepEqual(firstWeekStats(watches, pairs, verdicts), { watchCount: 2, newListings: 3, underCount: 1 })
  assert.deepEqual(firstWeekStats(watches, pairs, new Map()), { watchCount: 2, newListings: 3, underCount: null })
  assert.deepEqual(firstWeekStats(watches, [], verdicts), { watchCount: 2, newListings: 0, underCount: 0 })
})

test('the runner: token before the mail, stamp after it, whole app_metadata, no address logged', () => {
  const src = code(read('scripts', 'lib', 'welcome-series.ts'))
  const token = src.indexOf('await write({ welcome_stop_token:')
  const send = src.indexOf('await sendWelcomeSeriesEmail(')
  const stamp = src.indexOf('await write({ [`welcome_${mail}_sent_at`]:')
  assert.ok(token > 0 && send > token && stamp > send, 'token → send → stamp')
  assert.match(src, /meta = \{ \.\.\.meta, \.\.\.patch \}/)
  assert.match(src, /updateUserById\(account\.id, \{ app_metadata: meta \}\)/)
  assert.ok(!/console\.\w+\([^)]*\.email/.test(src), 'the address must never be logged')
  // The dry run writes nothing: every write is after the dry run's `continue`.
  const dry = src.indexOf('if (!opts.apply)')
  assert.ok(dry > 0 && dry < src.indexOf('updateUserById'))
})

test('the send: one key per mail and account, and the RFC 8058 headers', () => {
  const email = code(read('frontend', 'lib', 'email.ts'))
  assert.match(email, /idempotencyKey: `welcome-\$\{mail\}\/\$\{userId\}`/)
  assert.match(email, /'List-Unsubscribe': `<\$\{oneClickUrl\}>`/)
  assert.match(email, /'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'/)
})

test('notify-watchlists: the series runs after the alerts and its failure never fails the run', () => {
  const src = code(read('scripts', 'notify-watchlists.ts'))
  const alertsDone = src.indexOf('would send ${wouldSend} email(s)')
  const step = src.indexOf('await runWelcomeSeries(supabase, { apply: APPLY')
  assert.ok(alertsDone > 0 && step > alertsDone, 'after the alert loop')
  assert.match(src, /try \{\s*const welcome = await runWelcomeSeries[\s\S]*?\} catch \{\s*console\.error\(JSON\.stringify\(\{ channel: 'operational', component: 'notify-watchlists', event: 'welcome_series_failed' \}\)\)/)
})
