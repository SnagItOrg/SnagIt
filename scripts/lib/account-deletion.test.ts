/**
 * PAN-277 — deleting an account removes everything that is the user's, and
 * nothing that is not.
 *
 * Two halves:
 *
 *   THE GUARD reads every migration and finds each column that ties a row to a
 *   user (`user_id`, `REFERENCES auth.users`, an `email text` column) or to a
 *   user's watchlist (`REFERENCES watchlists`). Each must be named in
 *   ACCOUNT_DELETION_PLAN, so a new user table cannot ship without a decision
 *   about what deleting an account does to it.
 *
 *   THE EXECUTOR runs against a recording fake client. No test reaches a
 *   database: the plan's writes are asserted as calls, never performed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ACCOUNT_DELETION_PLAN,
  deleteAccount,
  emailPrefilter,
} from '../../frontend/lib/account-deletion'

type Db = Parameters<typeof deleteAccount>[0]

const REPO = join(__dirname, '..', '..')
const MIGRATIONS = join(REPO, 'scripts', 'migrations')

// ── the guard ────────────────────────────────────────────────────────────

const USER_LINK = /\buser_id\b|REFERENCES\s+auth\.users|^\s*\w*email\s+text\b|REFERENCES\s+(public\.)?watchlists\b/i

/** Every `table.column` in the SQL that ties a row to a user or a user's watchlist. */
function userLinkedColumns(sql: string): Set<string> {
  const found = new Set<string>()
  const create = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?(\w+)\s*\(/gi
  for (let m = create.exec(sql); m; m = create.exec(sql)) {
    let depth = 1
    let i = create.lastIndex
    for (; i < sql.length && depth > 0; i++) {
      if (sql[i] === '(') depth++
      else if (sql[i] === ')') depth--
    }
    const body = sql.slice(create.lastIndex, i - 1)
    for (const line of body.split('\n')) {
      const code = line.replace(/--.*$/, '')
      const col = /^\s*(\w+)\s+(uuid|text)\b/i.exec(code)
      if (col && USER_LINK.test(code)) found.add(`${m[1]}.${col[1]}`)
    }
  }
  const alter = /ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?(\w+)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?(\w+)\s+([^;,]*)/gi
  for (let m = alter.exec(sql); m; m = alter.exec(sql)) {
    if (USER_LINK.test(`${m[2]} ${m[3]}`)) found.add(`${m[1]}.${m[2]}`)
  }
  return found
}

function migrationColumns(): Set<string> {
  const all = new Set<string>()
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && !f.includes('rollback'))) {
    for (const c of userLinkedColumns(readFileSync(join(MIGRATIONS, f), 'utf8'))) all.add(c)
  }
  return all
}

const PLANNED = new Set(ACCOUNT_DELETION_PLAN.map((s) => `${s.table}.${s.column}`))

test('guard: every user-linked column in the migrations is in the deletion plan', () => {
  const missing = [...migrationColumns()].filter((c) => !PLANNED.has(c)).sort()
  assert.deepEqual(missing, [], `add these to ACCOUNT_DELETION_PLAN in frontend/lib/account-deletion.ts: ${missing.join(', ')}`)
})

test('guard: the scanner finds the tables it must, so it cannot pass vacuously', () => {
  const cols = migrationColumns()
  for (const c of [
    'watchlists.user_id',
    'saved_listings.user_id',
    'notification_preferences.user_id',
    'user_preferences.user_id',
    'price_observation.user_id',
    'kg_product_suggestions.reviewed_by',
    'user_feedback.email',
    'listings.watchlist_id',
    'reverb_price_history.watchlist_id',
    'watchlist_notification.watchlist_id',
    'claim_vote.user_id',
  ]) {
    assert.ok(cols.has(c), `scanner no longer finds ${c}`)
  }
})

test('guard: a new table with user_id fails the check', () => {
  const cols = userLinkedColumns(`
    CREATE TABLE IF NOT EXISTS public.price_alert (
      id      uuid PRIMARY KEY,
      user_id uuid NOT NULL,  -- no foreign key
      note    text
    );
    ALTER TABLE listings ADD COLUMN seller_email text;`)
  assert.deepEqual([...cols].filter((c) => !PLANNED.has(c)).sort(), ['listings.seller_email', 'price_alert.user_id'])
})

test('plan: every entry has a reason, and no table.column is planned twice', () => {
  for (const s of ACCOUNT_DELETION_PLAN) assert.ok(s.reason.length > 20, `${s.table}: give a reason`)
  assert.equal(PLANNED.size, ACCOUNT_DELETION_PLAN.length)
})

test('plan: market data is detached before the watchlists that would cascade it are deleted', () => {
  const at = (table: string) => ACCOUNT_DELETION_PLAN.findIndex((s) => s.table === table)
  for (const t of ['listings', 'reverb_price_history', 'auctionet_price_history', 'price_snapshots']) {
    assert.equal(ACCOUNT_DELETION_PLAN[at(t)].action, 'detach')
    assert.ok(at(t) < at('watchlists'), `${t} must be detached before watchlists are deleted`)
  }
})

// ── the executor ─────────────────────────────────────────────────────────

type Call = { table: string; op: string; values?: unknown; filters: Array<[string, string, unknown]> }

function fakeDb(opts: {
  watchlists?: string[]
  feedback?: Array<{ id: string; email: string | null }>
  failOn?: string
  authError?: { status: number } | null
} = {}) {
  const calls: Call[] = []
  const authDeletes: string[] = []
  const db = {
    from(table: string) {
      const call: Call = { table, op: '', filters: [] }
      const builder = {
        select(cols: string) { call.op = `select:${cols}`; return builder },
        update(values: unknown) { call.op = 'update'; call.values = values; return builder },
        delete() { call.op = 'delete'; return builder },
        eq(col: string, v: unknown) { call.filters.push(['eq', col, v]); return builder },
        in(col: string, v: unknown) { call.filters.push(['in', col, v]); return builder },
        ilike(col: string, v: unknown) { call.filters.push(['ilike', col, v]); return builder },
        then(resolve: (r: { data: unknown; error: unknown }) => unknown) {
          calls.push(call)
          if (opts.failOn === table && call.op !== 'select:id') return resolve({ data: null, error: { message: 'x' } })
          if (table === 'watchlists' && call.op === 'select:id') {
            return resolve({ data: (opts.watchlists ?? []).map((id) => ({ id })), error: null })
          }
          if (table === 'user_feedback' && call.op.startsWith('select')) {
            return resolve({ data: opts.feedback ?? [], error: null })
          }
          return resolve({ data: null, error: null })
        },
      }
      return builder
    },
    auth: {
      admin: {
        async deleteUser(id: string) {
          authDeletes.push(id)
          return { data: null, error: opts.authError ?? null }
        },
      },
    },
  }
  return { db: db as unknown as Db, calls, authDeletes }
}

const USER = { id: 'u-1', email: 'Ann_B@Example.dk' }

test('executor: every write is keyed — no unscoped update or delete', async () => {
  const { db, calls } = fakeDb({ watchlists: ['w-1'], feedback: [{ id: 'f-1', email: 'ann_b@example.dk' }] })
  assert.deepEqual(await deleteAccount(db, USER), { ok: true })
  const writes = calls.filter((c) => c.op === 'update' || c.op === 'delete')
  assert.ok(writes.length > 0)
  for (const w of writes) assert.ok(w.filters.length > 0, `${w.table} ${w.op} has no filter`)
})

test('executor: detaches market data by the user\'s watchlist ids, then deletes, then the auth user', async () => {
  const { db, calls, authDeletes } = fakeDb({ watchlists: ['w-1', 'w-2'] })
  await deleteAccount(db, USER)
  const listings = calls.find((c) => c.table === 'listings')!
  assert.deepEqual(listings.values, { watchlist_id: null })
  assert.deepEqual(listings.filters, [['in', 'watchlist_id', ['w-1', 'w-2']]])
  const order = calls.filter((c) => c.op !== 'select:id').map((c) => c.table)
  assert.ok(order.indexOf('listings') < order.indexOf('watchlists'))
  assert.deepEqual(
    calls.find((c) => c.table === 'watchlists' && c.op === 'delete')!.filters,
    [['eq', 'user_id', 'u-1']],
  )
  assert.deepEqual(calls.find((c) => c.table === 'price_observation')!.values, { user_id: null })
  assert.deepEqual(calls.find((c) => c.table === 'kg_product_suggestions')!.filters, [['eq', 'reviewed_by', 'u-1']])
  assert.deepEqual(authDeletes, ['u-1'])
})

test('executor: no watchlists means no detach writes at all', async () => {
  const { db, calls } = fakeDb()
  await deleteAccount(db, USER)
  assert.equal(calls.filter((c) => c.table === 'listings').length, 0)
})

test('executor: plan steps for tables 064 has not created are never sent', async () => {
  const { db, calls } = fakeDb({ watchlists: ['w-1'] })
  await deleteAccount(db, USER)
  for (const t of ['product_claim', 'claim_vote', 'claim_flag', 'cocreation_user', 'claim_event', 'watchlist_notification']) {
    assert.equal(calls.filter((c) => c.table === t).length, 0, t)
  }
})

test('executor: feedback is deleted on an exact, case-insensitive address match only', async () => {
  const { db, calls } = fakeDb({
    feedback: [
      { id: 'mine', email: ' ann_b@example.DK ' },
      { id: 'wildcard-neighbour', email: 'annXb@example.dk' },
      { id: 'other', email: 'someone@example.dk' },
    ],
  })
  await deleteAccount(db, USER)
  const del = calls.find((c) => c.table === 'user_feedback' && c.op === 'delete')!
  assert.deepEqual(del.filters, [['in', 'id', ['mine']]])
})

test('executor: an account without an address touches no feedback', async () => {
  const { db, calls } = fakeDb({ feedback: [{ id: 'f', email: 'x@y.dk' }] })
  await deleteAccount(db, { id: 'u-1', email: null })
  assert.equal(calls.filter((c) => c.table === 'user_feedback').length, 0)
})

test('emailPrefilter: LIKE and PostgREST wildcards become single-character wildcards', () => {
  assert.equal(emailPrefilter('a%b_c\\d*e@x.dk'), 'a_b_c_d_e@x.dk')
})

test('executor: a failing step stops before the auth user is deleted, and names only the table', async () => {
  const { db, authDeletes } = fakeDb({ watchlists: ['w-1'], failOn: 'saved_listings' })
  const r = await deleteAccount(db, USER)
  assert.deepEqual(r, { ok: false, table: 'saved_listings', code: 'step_failed' })
  assert.deepEqual(authDeletes, [])
})

test('executor: idempotent — an auth user already gone is success, another auth error is not', async () => {
  assert.deepEqual(await deleteAccount(fakeDb({ authError: { status: 404 } }).db, USER), { ok: true })
  assert.deepEqual(
    await deleteAccount(fakeDb({ authError: { status: 500 } }).db, USER),
    { ok: false, table: 'auth.users', code: 'auth_delete_failed' },
  )
})
