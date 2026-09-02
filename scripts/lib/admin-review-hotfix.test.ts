/**
 * Admin product-page review — the two production bugs, and the contracts that
 * keep them fixed.
 *
 * BUG A. Reassigning a listing that already had a relation to the target failed
 * with Postgres 23505 against `lpm_listing_product_unique`, and the raw message
 * was rendered to the operator. The cause was modelling a move as a single
 * `UPDATE ... SET product_id`, which can only work when the destination is
 * empty. Production proof: "Roland Juno 6" held valid relations to BOTH
 * roland-juno-106 and roland-juno-6, so the one listing that most needed moving
 * was the one that could not be moved.
 *
 * BUG B. A rejected or moved card stayed on the wall. Two independent layers
 * caused it: the page never removed the row from local state, and the product
 * API declared no freshness contract, so Next's Data Cache served the listing
 * again after a reload. Fixing either alone leaves the bug visible.
 *
 * These tests assert behaviour where behaviour exists (the writer is a pure
 * function over a fake client) and source shape only where the property is
 * structural — the same split the surrounding suite already uses.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { applyReassign } from '../../frontend/lib/admin-match-decision'

const FRONTEND = join(__dirname, '..', '..', 'frontend')
const codeOf = (...seg: string[]) => readFileSync(join(FRONTEND, ...seg), 'utf8')

/** Comments are stripped so a test never matches its own explanation. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * IDENTITY, VERIFIED AGAINST PRODUCTION 2026-09-02 — NOT ASSUMED.
 *
 * `roland-juno-6` (Roland Juno-6) and `roland-ju-06` (Roland ju-06) are
 * DIFFERENT PRODUCTS: the 1982 analogue
 * polysynth versus the Boutique digital module. An earlier draft of this
 * fixture used `roland-ju-06` as the destination for a listing titled
 * "Roland Juno 6", which is the wrong instrument.
 *
 * The listing that motivated Bug A is titled "Roland Juno 6" and holds
 * `is_valid = true` on BOTH roland-juno-106 and roland-juno-6. Its correct
 * destination is roland-juno-6.
 */
const SRC = 'roland-juno-106'
const TGT = 'roland-juno-6'
const SRC_ID = 'p-source'
const TGT_ID = 'p-target'
const L = 'l-juno-6'   // stands in for the "Roland Juno 6" listing

type Row = Record<string, unknown>

/**
 * A fake PostgREST client covering exactly the three shapes `applyReassign`
 * uses: a slug lookup, the prior-rows read, and the upsert.
 */
function makeAdmin(opts: {
  products?: Record<string, string>
  matches?: Row[]
  upsertError?: string
  priorError?: string
}) {
  const products = opts.products ?? { [SRC]: SRC_ID, [TGT]: TGT_ID }
  const matches = opts.matches ?? []
  const upserts: Array<{ rows: Row[]; onConflict?: string }> = []

  function from(table: string) {
    const filters: Record<string, unknown> = {}
    const builder: Record<string, unknown> = {}
    Object.assign(builder, {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters[col] = val; return builder },
      in: (_col: string, vals: string[]) => {
        if (opts.priorError) return Promise.resolve({ data: null, error: { message: opts.priorError } })
        const data = matches.filter(
          (m) => m.listing_id === filters.listing_id && vals.includes(m.product_id as string),
        )
        return Promise.resolve({ data, error: null })
      },
      maybeSingle: () => {
        if (table !== 'kg_product') return Promise.resolve({ data: null, error: null })
        const id = products[filters.slug as string]
        return Promise.resolve({ data: id ? { id } : null, error: null })
      },
      upsert: (rows: Row[], o?: { onConflict?: string }) => {
        upserts.push({ rows, onConflict: o?.onConflict })
        return Promise.resolve({ error: opts.upsertError ? { message: opts.upsertError } : null })
      },
    })
    return builder
  }

  return { client: { from } as never, upserts }
}

const priorRow = (productId: string, isValid: boolean | null, extra: Row = {}): Row => ({
  product_id: productId,
  listing_id: L,
  method: 'FUZZY',
  score: 0.8,
  is_valid: isValid,
  rejected_reason: null,
  explain: {},
  ...extra,
})

const run = (admin: { client: never }, targetSlug = TGT) =>
  applyReassign(admin.client, { slug: SRC, listingId: L, targetSlug, actorUserId: 'u-1' })

const rowFor = (upserts: Array<{ rows: Row[] }>, productId: string) =>
  upserts[0].rows.find((r) => r.product_id === productId)!

/* ── 1-10: Bug A — the idempotency matrix ──────────────────────────────────── */

test('A1: target relation absent — the move is made', async () => {
  const admin = makeAdmin({ matches: [priorRow(SRC_ID, true)] })
  const res = await run(admin)
  assert.equal(res.ok, true)
  assert.equal(res.outcome, 'moved')
  assert.equal(admin.upserts.length, 1)
  assert.equal(admin.upserts[0].rows.length, 2)
})

test('A2: target relation already valid — no duplicate-key failure', async () => {
  // The exact production state that produced 23505.
  const admin = makeAdmin({ matches: [priorRow(SRC_ID, true), priorRow(TGT_ID, true)] })
  const res = await run(admin)
  assert.equal(res.ok, true, 'must not fail where the old route failed')
  assert.equal(res.outcome, 'already_linked')
  assert.equal(res.error, undefined)
})

test('A3: target relation previously rejected — it is reopened, not skipped', async () => {
  const admin = makeAdmin({ matches: [priorRow(SRC_ID, true), priorRow(TGT_ID, false)] })
  const res = await run(admin)
  assert.equal(res.ok, true)
  assert.equal(rowFor(admin.upserts, TGT_ID).is_valid, true)
})

test('A4: target equals the reviewed product — no write at all', async () => {
  const admin = makeAdmin({ matches: [priorRow(SRC_ID, true)] })
  const res = await run(admin, SRC)
  assert.equal(res.ok, true)
  assert.equal(res.outcome, 'noop_same_product')
  assert.equal(admin.upserts.length, 0, 'a no-op must not touch the database')
})

test('A5: both decisions are written in one statement', async () => {
  const admin = makeAdmin({ matches: [priorRow(SRC_ID, true)] })
  await run(admin)
  assert.equal(admin.upserts.length, 1, 'one round trip, so no half-moved window')
  assert.equal(admin.upserts[0].onConflict, 'listing_id,product_id',
    'the conflict is the mechanism, not an error')
})

test('A6: the move sets the target valid and the source invalid', async () => {
  const admin = makeAdmin({ matches: [priorRow(SRC_ID, true)] })
  await run(admin)
  assert.equal(rowFor(admin.upserts, TGT_ID).is_valid, true)
  assert.equal(rowFor(admin.upserts, SRC_ID).is_valid, false)
})

test('A7: repeating the move converges on the same two rows', async () => {
  const first = makeAdmin({ matches: [priorRow(SRC_ID, true)] })
  await run(first)
  // Replay against the state the first run produced.
  const second = makeAdmin({ matches: [priorRow(SRC_ID, false), priorRow(TGT_ID, true)] })
  const res = await run(second)
  assert.equal(res.ok, true)
  const shape = (u: Array<{ rows: Row[] }>) =>
    u[0].rows.map((r) => [r.product_id, r.is_valid]).sort()
  assert.deepEqual(shape(second.upserts), shape(first.upserts), 'idempotent')
})

test('A8: a listing with no relation to the reviewed product is a 404, not a write', async () => {
  const admin = makeAdmin({ matches: [] })
  const res = await run(admin)
  assert.equal(res.ok, false)
  assert.equal(res.status, 404)
  assert.equal(admin.upserts.length, 0)
})

test('A9: an unknown target or source slug is a 404, not a write', async () => {
  for (const [slug, target] of [[SRC, 'no-such-product'], ['no-such-product', TGT]] as const) {
    const admin = makeAdmin({ matches: [priorRow(SRC_ID, true)] })
    const res = await applyReassign(admin.client, {
      slug, listingId: L, targetSlug: target, actorUserId: 'u-1',
    })
    assert.equal(res.status, 404)
    assert.equal(admin.upserts.length, 0)
  }
})

test('A10: a stale admin_decision on the target is replaced, not carried forward', async () => {
  // Observed in production: ju-06 held `admin_decision.decision = 'rejected'`
  // on an is_valid=true row, because the old reassign never wrote provenance.
  const stale = { explain: { admin_decision: { decision: 'rejected' } } }
  const admin = makeAdmin({ matches: [priorRow(SRC_ID, true), priorRow(TGT_ID, true, stale)] })
  await run(admin)
  const explain = rowFor(admin.upserts, TGT_ID).explain as { admin_decision?: { decision?: string } }
  assert.ok(explain.admin_decision, 'the move records who decided')
  assert.notEqual(explain.admin_decision.decision, 'rejected',
    'a valid row must not keep a rejection as its stated decision')
})

test('A11: the two rows never share a conflict key, and never touch a third product', async () => {
  // Verified 2026-09-02: `.upsert([a,b])` emits ONE POST with
  // `on_conflict=listing_id,product_id` and `Prefer: resolution=merge-duplicates`,
  // which PostgREST compiles to a single INSERT ... ON CONFLICT DO UPDATE. That
  // is atomic, so there is no partial failure to handle — but Postgres refuses
  // a statement whose rows collide with EACH OTHER ("cannot affect row a second
  // time"), so the two product_ids must always differ.
  const admin = makeAdmin({
    matches: [priorRow(SRC_ID, true), priorRow('p-unrelated', true)],
  })
  await run(admin)
  const rows = admin.upserts[0].rows
  const keys = rows.map((r) => `${r.listing_id}:${r.product_id}`)
  assert.equal(new Set(keys).size, 2, 'the two rows must not collide with each other')
  assert.deepEqual(rows.map((r) => r.product_id).sort(), [SRC_ID, TGT_ID].sort())
  assert.equal(rows.some((r) => r.product_id === 'p-unrelated'), false,
    'a third relation on the same listing is never rewritten')
})

/* ── 11-20: Bug B — one explicit state machine ─────────────────────────────── */

const CONTROLS = ['components', 'admin', 'ProductReviewControls.tsx']
const PAGE = ['app', 'product', '[slug]', 'page.tsx']
const PANEL = ['components', 'admin', 'ReassignPanel.tsx']

async function actions() {
  // Imported from the dependency-free module, not the component: the root test
  // harness cannot resolve the `@/` aliases a React component pulls in.
  const mod = await import('../../frontend/lib/match-review-state')
  return mod.ACTIONS_FOR as unknown as Record<string, Record<string, boolean>>
}

test('B1: an unresolved match offers all three actions', async () => {
  assert.deepEqual((await actions()).unresolved, { approve: true, reject: true, move: true })
})

test('B2: an already-reviewed match no longer offers Godkend', async () => {
  const a = (await actions()).reviewed
  assert.equal(a.approve, false, 'approving twice is a no-op the operator should not be offered')
  assert.equal(a.reject, true, 'overturning a review must stay possible')
  assert.equal(a.move, true)
})

test('B3: a rejected match offers nothing — it is terminal', async () => {
  assert.deepEqual((await actions()).rejected, { approve: false, reject: false, move: false })
})

test('B4: the state machine is total over the status union', async () => {
  const a = await actions()
  for (const s of ['unresolved', 'reviewed', 'rejected']) {
    assert.ok(a[s], `${s} must have an entry, so an unreachable state is a no-op not a crash`)
  }
  assert.equal(Object.keys(a).length, 3, 'no state may be added without a decision about it')
})

test('B5: a rejected card is removed from the wall immediately', () => {
  const code = stripComments(codeOf(...PAGE))
  assert.ok(/next === 'rejected'[\s\S]{0,120}setListings\(\(prev\) => prev\.filter/.test(code),
    'rejecting removes the row from local state, not only from the server')
})

test('B6: a moved card is removed from the wall immediately', () => {
  const code = stripComments(codeOf(...PAGE))
  const at = code.indexOf('onReassigned=')
  assert.ok(at > -1)
  assert.ok(code.slice(at, at + 500).includes('setListings((prev) => prev.filter'))
})

test('B7: an approved card stays — approval is not removal', () => {
  const code = stripComments(codeOf(...PAGE))
  const at = code.indexOf('onDecided=')
  const block = code.slice(at, code.indexOf('onReassigned='))
  assert.ok(block.includes("next === 'rejected'"), 'removal is conditional on rejection')
  assert.equal(/approved[\s\S]{0,80}setListings/.test(block), false)
})

test('B8: the counts follow the list rather than a second source of truth', () => {
  const code = stripComments(codeOf(...PAGE))
  // Both visible counts derive from listings.length, so removing a row updates
  // them. A separate count state would be a second thing to keep in sync.
  assert.ok(code.includes('listings.length'))
  assert.equal(/setListingCount|const \[count/.test(code), false, 'no parallel count state')
})

test('B9: clicking a search result selects and does not write', () => {
  const code = stripComments(codeOf(...PANEL))
  assert.ok(/onClick=\{\(\) => \{ if \(!alreadyLinked\) setSelected\(p\) \}\}/.test(code),
    'a result click only selects')
  const at = code.indexOf('role="radio"')
  const block = code.slice(at - 400, at + 400)
  assert.equal(/reassignTo\(/.test(block), false, 'no result click may submit')
})

test('B11: a result row wraps rather than truncating the product name', () => {
  const code = stripComments(codeOf(...PANEL))
  const at = code.indexOf('role="radio"')
  const row = code.slice(at - 900, at + 900)
  // "Roland Juno-6" and "Roland ju-06" are different instruments sharing a
  // prefix. A name clipped to "Roland Ju…" cannot distinguish them, and the
  // operator reads this row immediately before authorising a write.
  assert.equal(/truncate/.test(row), false, 'the canonical name is never clipped')
  assert.ok(/flex-wrap/.test(row), 'the row wraps when the name needs the width')
  assert.ok(/break-words/.test(row))
})

test('B10: the commit button is disabled until a target is chosen, and names it', () => {
  const code = stripComments(codeOf(...PANEL))
  assert.ok(code.includes('disabled={!selected || submitting}'), 'no selection, no write')
  assert.ok(code.includes('t.adminReview.confirmMove.replace('),
    'the button states its own destination')
  assert.ok(/if \(submitting\) return/.test(code), 'a double-click sends one request')
})

/* ── 21-26: security and data ──────────────────────────────────────────────── */

const REASSIGN_ROUTE = ['app', 'api', 'admin', 'product', '[slug]', 'reassign-match', 'route.ts']

test('S1: no database text can reach the operator', () => {
  const code = stripComments(codeOf(...REASSIGN_ROUTE))
  assert.equal(/error:\s*result\.error/.test(code), false,
    'the writer error is never the response body')
  assert.equal(/updateErr\.message|error\.message/.test(code), false,
    'no raw Postgres message is returned')
  assert.ok(code.includes('console.error'), 'the detail is logged instead')
})

test('S2: the product under review comes from the route, never the body', () => {
  const code = stripComments(codeOf(...REASSIGN_ROUTE))
  assert.ok(/slug: params\.slug/.test(code))
  assert.equal(/product_id/.test(code), false, 'no product id is read from the request')
})

test('S3: the route is admin-gated and takes the actor from the session', () => {
  const code = stripComments(codeOf(...REASSIGN_ROUTE))
  assert.ok(code.includes('requireAdminInRoute()'))
  assert.ok(code.includes('getCurrentAdminState()'))
  assert.ok(/actorUserId: userId/.test(code))
})

test('S4: no hardcoded listing or product is special-cased anywhere in the fix', () => {
  for (const seg of [REASSIGN_ROUTE, PANEL, CONTROLS, ['lib', 'admin-match-decision.ts']]) {
    const code = stripComments(codeOf(...seg))
    assert.equal(/juno|Juno/.test(code), false, `${seg.join('/')} must not name a product`)
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(code), false,
      `${seg.join('/')} must not embed a listing id`)
  }
})

test('S5: the review copy exists in both locales with identical keys', async () => {
  const { translations } = await import('../../frontend/lib/i18n')
  const da = Object.keys(translations.da.adminReview)
  const en = Object.keys(translations.en.adminReview)
  assert.deepEqual(da, en, 'da and en must carry the same keys in the same order')
  for (const [k, v] of Object.entries(translations.en.adminReview)) {
    assert.ok(String(v).trim().length > 0, `en.${k} must not be empty`)
  }
  // The component renders on a localised page, so no raw Danish may remain.
  assert.equal(/'[^']*[æøåÆØÅ][^']*'/.test(stripComments(codeOf(...CONTROLS))), false)
})

test('S6: the product API declares the freshness contract the reload depends on', () => {
  const code = codeOf('app', 'api', 'product', '[slug]', 'route.ts')
  assert.ok(/export const dynamic = 'force-dynamic'/.test(code))
  assert.ok(/export const revalidate = 0/.test(code))
  assert.ok(/export const fetchCache = 'force-no-store'/.test(code),
    'without this the Data Cache re-serves a listing the operator just rejected')
})


/* ── 27-31: the read path — a fresh response must omit a rejected match ────── */

/**
 * The cache directives explain how a STALE answer reached the browser. They do
 * not prove a FRESH answer is correct. These tests execute the route's actual
 * filter chain — `.eq('product_id', …)` composed with
 * `excludeRejectedMatches` — against fixture rows, so the visibility rule is
 * tested rather than read.
 */
const P106 = 'p-juno-106'
const P6 = 'p-juno-6'

type MatchFixture = {
  listing_id: string
  product_id: string
  is_valid: boolean | null
  listings: { id: string; is_active: boolean } | null
}

/** A PostgREST stand-in that interprets the two operators the route uses. */
function matchTable(rows: MatchFixture[]) {
  const filters: Array<{ kind: 'eq' | 'not'; column: string; value: unknown }> = []
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => { filters.push({ kind: 'eq', column, value }); return builder },
    not: (column: string, _op: string, value: unknown) => {
      filters.push({ kind: 'not', column, value }); return builder
    },
    order: () => builder,
    limit: () => builder,
    rows: () => rows.filter((r) => filters.every((f) => {
      const actual = (r as unknown as Record<string, unknown>)[f.column]
      return f.kind === 'eq' ? actual === f.value : actual !== f.value
    })),
  }
  return builder
}

/**
 * The route's own chain, minus the network.
 *
 * The filter is written here exactly as the route writes it, and test R6 pins
 * the route's source to the same two operators. It is NOT extracted into a
 * shared module: four existing tests across this suite deliberately assert
 * `.not('is_valid', 'is', false)` in the route itself, and moving it would
 * trade four guards for one.
 */
function visibleListings(rows: MatchFixture[], productId: string) {
  const q = matchTable(rows)
    .select()
    .eq('product_id', productId)
    .not('is_valid', 'is', false)
    .order()
    .limit()
  return q.rows()
    .map((m) => m.listings)
    .filter((l): l is { id: string; is_active: boolean } => l != null && l.is_active !== false)
    .map((l) => l.id)
}

const listingRef = (id: string) => ({ id, is_active: true })
const match = (listing: string, product: string, is_valid: boolean | null): MatchFixture =>
  ({ listing_id: listing, product_id: product, is_valid, listings: listingRef(listing) })

test('R1: a valid relation renders on the product page', () => {
  assert.deepEqual(visibleListings([match('L1', P106, true)], P106), ['L1'])
})

test('R2: flipping the relation to is_valid=false removes it from a FRESH response', () => {
  const before = visibleListings([match('L1', P106, true)], P106)
  const after = visibleListings([match('L1', P106, false)], P106)
  assert.deepEqual(before, ['L1'])
  assert.deepEqual(after, [], 'the rejection is what removes the card, not the cache')
})

test('R3: rejected on Juno-106 and valid on Juno-6 — gone from 106, present on 6', () => {
  // The exact state one successful reassign produces. No production row is in
  // this state yet, so it is constructed here rather than observed.
  const rows = [match('L1', P106, false), match('L1', P6, true)]
  assert.deepEqual(visibleListings(rows, P106), [], 'must not survive on the source product')
  assert.deepEqual(visibleListings(rows, P6), ['L1'], 'must appear on the destination')
})

test('R4: a reload cannot bring a rejected card back', () => {
  const rows = [match('L1', P106, false), match('L2', P106, true)]
  // Repeat the read: the filter is a pure function of the rows, so a second
  // fetch returns the same answer. The cache directives below are what make the
  // browser actually perform that second fetch.
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(visibleListings(rows, P106), ['L2'])
  }
  const route = codeOf('app', 'api', 'product', '[slug]', 'route.ts')
  assert.ok(/export const fetchCache = 'force-no-store'/.test(route))
})

test('R5: is_valid=NULL still renders, and multiple rows create no duplicates', () => {
  // NULL is the normal state of an automatic match. Production 2026-09-02:
  // every roland-juno-60 listing is NULL and must keep rendering.
  assert.deepEqual(visibleListings([match('L1', P106, null)], P106), ['L1'])
  // `lpm_listing_product_unique` allows at most one row per (listing, product),
  // and the query is scoped to one product, so a listing matched to several
  // products contributes exactly one row here.
  const rows = [match('L1', P106, true), match('L1', P6, true), match('L2', P106, null)]
  const seen = visibleListings(rows, P106)
  assert.deepEqual(seen, ['L1', 'L2'])
  assert.equal(new Set(seen).size, seen.length, 'no duplicate cards')
})

test('R6: the route applies exactly the rule these tests execute', () => {
  const route = stripComments(codeOf('app', 'api', 'product', '[slug]', 'route.ts'))
  assert.ok(/\.not\('is_valid', 'is', false\)/.test(route),
    'the fixtures above are only evidence if the route filters the same way')
  assert.equal(/\.eq\('is_valid'/.test(route), false,
    'eq(is_valid,true) would drop every automatic match, which is most of them')
  assert.ok(/\.eq\('product_id', productId\)/.test(route), 'scoped to the reviewed product')
})
