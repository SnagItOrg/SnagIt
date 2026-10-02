/**
 * scripts/lib/rematch-verdicts.test.ts
 *
 * The standing rule for the brand re-match scripts: a live match row that is
 * `is_valid=true` or carries `explain.admin_decision` is never re-decided,
 * released or rewritten. In every script the --apply release step and the
 * rollback file are built only from `pool`'s held/stale entries, and only
 * `pool`'s listing ids reach `matchListings`, so a row `pool` skips cannot be
 * released. Each of pan198/199/200/202/203's `pool` is run here against an
 * in-memory `listing_product_match`.
 *
 * Run: npx tsx --test scripts/lib/rematch-verdicts.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { AI_TRUE, HUMAN_DECISION } from './rematch-verdicts'
import { pool } from '../rematch-brand'
import gibson from '../rematch-configs/gibson'
import moog from '../rematch-configs/moog'
import roland from '../rematch-configs/roland'
import neumann from '../rematch-configs/neumann'
import warm from '../rematch-configs/warm-audio'

test('HUMAN_DECISION is explain.admin_decision, whatever is_valid says', () => {
  assert.equal(HUMAN_DECISION({ admin_decision: { verdict: 'approve' } }), true)
  assert.equal(HUMAN_DECISION({ admin_decision: null }), true)
  assert.equal(HUMAN_DECISION({ method: 'MODEL' }), false)
  assert.equal(HUMAN_DECISION(null), false)
  assert.equal(HUMAN_DECISION('admin_decision'), false)
})

test('AI_TRUE is is_valid=true only', () => {
  assert.equal(AI_TRUE(true), true)
  assert.equal(AI_TRUE(null), false)
  assert.equal(AI_TRUE(false), false)
})

type Row = Record<string, unknown>

/**
 * Just the PostgREST surface `pool` and `readActiveTitles` use: eq, in, gt,
 * an `or` of `col.is.null` / `col.eq.true|false`, order, limit, range, and a
 * `listings!inner(title)` embed.
 */
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      let embed = false
      let orderBy: string | undefined
      let slice: [number, number] | undefined
      const run = () => {
        let rows = tables[table].filter((r) => filters.every((f) => f(r)))
        if (embed) {
          rows = rows.flatMap((r) => {
            const l = tables.listings.find((x) => x.id === r.listing_id)
            return l ? [{ ...r, listings: { title: l.title } }] : []
          })
        }
        if (orderBy) rows = [...rows].sort((a, b) => String(a[orderBy!]).localeCompare(String(b[orderBy!])))
        return slice ? rows.slice(...slice) : rows
      }
      const q = {
        select(cols: string) { embed = cols.includes('listings!inner(title)'); return q },
        eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return q },
        in(col: string, vs: unknown[]) { filters.push((r) => vs.includes(r[col])); return q },
        gt(col: string, v: string) { filters.push((r) => String(r[col]) > v); return q },
        or(expr: string) {
          const conds = expr.split(',').map((c) => {
            const [col, op, val] = c.split('.')
            if (op === 'is' && val === 'null') return (r: Row) => r[col] === null || r[col] === undefined
            if (op === 'eq') return (r: Row) => r[col] === (val === 'true' ? true : val === 'false' ? false : val)
            throw new Error(`fake or(): ${c}`)
          })
          filters.push((r) => conds.some((c) => c(r)))
          return q
        },
        order(col: string) { orderBy = col; return q },
        limit(n: number) { slice = [0, n]; return q },
        range(from: number, to: number) { slice = [from, to + 1]; return q },
        then(resolve: (r: unknown) => void) { resolve({ data: run(), error: null }) },
      }
      return q
    },
  }
}

// A title every config's unmatched lines select, so a skipped listing would land in
// the unmatched cohort (and so in `matchListings`) if the live-match check missed it.
const TITLE = 'Gibson Les Paul Moog Roland Neumann Warm Audio'

const CONFIGS = [
  ['pan198 Gibson', gibson],
  ['pan199 Moog', moog],
  ['pan200 Roland', roland],
  ['pan202 Neumann', neumann],
  ['pan203 Warm Audio', warm],
] as const

for (const [name, cfg] of CONFIGS) {
  test(`${name}: an is_valid=true or admin_decision row is never held, stale or unmatched`, async () => {
    const slugs = [...cfg.labels, ...cfg.promoted, ...cfg.supportedToday]
    const ids = new Map(slugs.map((s) => [s, `p:${s}`]))
    // The held cohort (a family LABEL row) where the config has one, and the stale cohort.
    const targets = [...cfg.labels.slice(0, 1), cfg.promoted[0]]
    if (cfg.supportedToday.length) targets.push(cfg.supportedToday[0])

    const matches: Row[] = []
    const listings: Row[] = [{ id: 'free', title: TITLE, is_active: true }]
    for (const slug of targets) {
      const product_id = ids.get(slug)
      const rows: Row[] = [
        { listing_id: `${slug}/unreviewed`, is_valid: null, explain: { method: 'MODEL' } },
        { listing_id: `${slug}/ai-true`, is_valid: true, explain: { method: 'MODEL' } },
        { listing_id: `${slug}/human-null`, is_valid: null, explain: { admin_decision: { verdict: 'approve' } } },
        { listing_id: `${slug}/human-true`, is_valid: true, explain: { admin_decision: { verdict: 'approve' } } },
        { listing_id: `${slug}/rejected`, is_valid: false, explain: {} },
      ]
      for (const r of rows) {
        matches.push({ ...r, product_id, rejected_reason: null })
        listings.push({ id: r.listing_id, title: TITLE, is_active: true })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await pool(fakeDb({ listing_product_match: matches, listings }) as any, ids, cfg)

    const held = out.filter((l) => l.cohort !== 'unmatched')
    // Only the unreviewed rows are re-decided, each on its own row, with its prior state for rollback.
    assert.deepEqual(
      held.map((l) => [l.id, l.cohort, l.product_id, l.prior_is_valid]).sort(),
      targets.map((s) => [`${s}/unreviewed`, cfg.labels.includes(s) ? 'held' : 'stale', `p:${s}`, null]).sort(),
    )
    // A verdict's listing holds a live match, so it is not handed on as unmatched either. The
    // rejected row is not live, so its listing is unmatched: that is unchanged.
    assert.deepEqual(
      out.filter((l) => l.cohort === 'unmatched').map((l) => l.id).sort(),
      ['free', ...targets.map((s) => `${s}/rejected`)].sort(),
    )
    for (const l of out) assert.doesNotMatch(l.id, /ai-true|human-/, `${l.id} must never be re-decided or released`)
  })
}
