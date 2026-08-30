/**
 * Kleinanzeigen in /admin/match, and durable supervised feedback.
 *
 * Three production defects are pinned here:
 *
 *   1. Kleinanzeigen was absent from the source list, so ~2,141 already-stored
 *      active rows were unreachable from the matching queue.
 *   2. The DBA chip filtered on `source = 'dba'`, a value no row has ever held —
 *      every DBA row is stored as 'dba.dk'. Selecting DBA alone returned nothing,
 *      indistinguishably from "nothing left to match".
 *   3. The cross button was local React state. Approve never wrote `is_valid`
 *      and reject never reached the server at all, so a rejected listing came
 *      back as an unresolved candidate on the next sweep, forever.
 *
 * The assertions that read route source text are deliberate: the defects were
 * not wrong logic inside a function, they were a missing filter and a missing
 * column in a query. There is no unit seam that would have caught them.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ALL_SOURCE_KEYS,
  MATCH_SOURCES,
  perSourceQuota,
  sourceForStored,
  storedSourcesFor,
} from '../../frontend/lib/admin-match-sources'

const ROOT = join(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')

const CANDIDATES_ROUTE = read('frontend', 'app', 'api', 'admin', 'match', 'candidates', 'route.ts')
const DECISION_ROUTE   = read('frontend', 'app', 'api', 'admin', 'match', 'approve', 'route.ts')
// The row-building moved into the pure planner in ./dispositions so the move
// and demote rules could be tested as data rather than grepped. The assertions
// that pin how a row is built follow it there.
const WRITE_PLANNER   = read('frontend', 'app', 'admin', 'match', 'dispositions.ts')
const MATCH_PAGE       = read('frontend', 'app', 'admin', 'match', 'page.tsx')
const PUBLIC_ROUTE     = read('frontend', 'app', 'api', 'product', '[slug]', 'route.ts')

/* ------------------------------------------------------------------ *
 * 1. Kleinanzeigen is a supported source
 * ------------------------------------------------------------------ */

test('Kleinanzeigen is selectable and carries its stored identifier', () => {
  const ka = MATCH_SOURCES.find((s) => s.key === 'kleinanzeigen')
  assert.ok(ka, 'kleinanzeigen must be an offered source')
  assert.deepEqual(ka.stored, ['kleinanzeigen'])
  assert.ok(ALL_SOURCE_KEYS.includes('kleinanzeigen'))
})

test('the page and the route both drive off the one registry', () => {
  // Kleinanzeigen being present in the registry proves nothing on its own — the
  // page used to carry its own hardcoded chip list, which is how a marketplace
  // with ~2,141 stored active rows stayed unreachable.
  assert.ok(
    MATCH_PAGE.includes("from '@/lib/admin-match-sources'"),
    'the page must render chips from the shared registry',
  )
  assert.ok(
    !/const SOURCE_CONFIG/.test(MATCH_PAGE),
    'the page must not keep a private source list that can drift from the column',
  )
  assert.ok(
    CANDIDATES_ROUTE.includes("from '@/lib/admin-match-sources'"),
    'the route must resolve stored identifiers from the same registry',
  )
})

test('the identifier matches what the Kleinanzeigen scraper actually writes', () => {
  // The whole class of bug here is a UI key drifting from the stored column.
  // The scraper is the writer, so it is the authority.
  const scraper = read('scripts', 'scrape-kleinanzeigen.ts')
  assert.ok(
    scraper.includes("source: 'kleinanzeigen'"),
    'scrape-kleinanzeigen.ts must still write the identifier the admin page filters on',
  )
})

/* ------------------------------------------------------------------ *
 * 2. The DBA identifier bug cannot come back
 * ------------------------------------------------------------------ */

test('DBA filters on the value its rows actually hold', () => {
  // `source = 'dba'` matches zero rows in production; `'dba.dk'` matches ~1,003.
  assert.deepEqual(storedSourcesFor(['dba']), ['dba.dk'])
  assert.ok(!storedSourcesFor(['dba']).includes('dba'))
})

test('every source resolves to at least one stored identifier', () => {
  for (const s of MATCH_SOURCES) {
    assert.ok(s.stored.length > 0, `${s.key} must map to a stored value`)
    for (const v of s.stored) {
      assert.equal(sourceForStored(v)?.key, s.key, `${v} must resolve back to ${s.key}`)
    }
  }
})

test('an unknown key contributes no filter rather than passing through', () => {
  // A hand-crafted ?sources= must not become an arbitrary column filter.
  assert.deepEqual(storedSourcesFor(['not-a-source']), [])
  assert.deepEqual(storedSourcesFor(['kleinanzeigen', 'not-a-source']), ['kleinanzeigen'])
})

/* ------------------------------------------------------------------ *
 * 3. The four existing marketplaces are unchanged
 * ------------------------------------------------------------------ */

test('DBA, Finn, Blocket and Reverb keep their identifiers and their place', () => {
  const expected: Record<string, string[]> = {
    dba:     ['dba.dk'],
    finn:    ['finn'],
    blocket: ['blocket'],
    reverb:  ['reverb'],
  }
  for (const [key, stored] of Object.entries(expected)) {
    const s = MATCH_SOURCES.find((m) => m.key === key)
    assert.ok(s, `${key} must still be offered`)
    assert.deepEqual([...s.stored], stored)
  }
})

/* ------------------------------------------------------------------ *
 * 4. No source can starve another
 * ------------------------------------------------------------------ */

test('the sweep reserves room for every selected source', () => {
  // Reverb holds ~40,850 active rows to Kleinanzeigen's ~2,141. A single pooled
  // query could fill all 50 scored slots from one marketplace.
  const quota = perSourceQuota(30, 5)
  assert.ok(quota > 0)
  assert.ok(quota * 5 >= 30, 'five sources must still be able to fill the requested limit')
  assert.ok(quota >= 5, 'a small source must never be squeezed below a usable floor')
})

test('a narrower selection gives each remaining source more room', () => {
  assert.ok(perSourceQuota(30, 1) > perSourceQuota(30, 5))
})

test('selecting nothing asks for nothing', () => {
  assert.equal(perSourceQuota(30, 0), 0)
})

test('the candidate query is per-source, not one pooled limit', () => {
  assert.ok(
    CANDIDATES_ROUTE.includes('perSourceQuota'),
    'the route must apply a per-source ceiling',
  )
  assert.ok(
    !/\.limit\(limit \* 3\)/.test(CANDIDATES_ROUTE),
    'the single pooled limit that allowed starvation must be gone',
  )
})

/* ------------------------------------------------------------------ *
 * 5. Absent price and location are states, not filters
 * ------------------------------------------------------------------ */

test('the candidate query never filters on price or location', () => {
  // 265 of ~2,141 active Kleinanzeigen rows have no price, and ~97% have no
  // location. Excluding them would hide the listings most needing a human.
  for (const column of ['price', 'location']) {
    assert.ok(
      !new RegExp(`\\.not\\(\\s*'${column}'`).test(CANDIDATES_ROUTE),
      `the route must not exclude rows for a missing ${column}`,
    )
    assert.ok(
      !new RegExp(`\\.eq\\(\\s*'${column}'`).test(CANDIDATES_ROUTE),
      `the route must not require a ${column}`,
    )
  }
})

test('the candidate contract carries the fields the operator has to see', () => {
  for (const field of ['currency', 'price_dkk', 'image_url', 'location', 'match_state']) {
    assert.ok(
      new RegExp(`${field}:`).test(CANDIDATES_ROUTE),
      `the normalized candidate must expose ${field}`,
    )
  }
})

test('missing price and missing location render explicitly', () => {
  assert.ok(MATCH_PAGE.includes('Ingen pris'), 'a priceless candidate must say so')
  assert.ok(MATCH_PAGE.includes('Ingen lokation'), 'a locationless candidate must say so')
})

test('a foreign price is not relabelled as kroner', () => {
  // Kleinanzeigen quotes EUR. The old card printed the raw number with " kr".
  assert.ok(
    !/\{c\.price\.toLocaleString\('da-DK'\)\} kr/.test(MATCH_PAGE),
    'the card must not hardcode "kr" onto a price of unknown currency',
  )
  assert.ok(MATCH_PAGE.includes('c.currency'), 'the card must render the stored currency')
})

/* ------------------------------------------------------------------ *
 * 6. Both decisions persist
 * ------------------------------------------------------------------ */

test('approval and rejection each write an explicit is_valid', () => {
  // Still the same invariant; the verdict is now derived from the operator's
  // disposition rather than a boolean argument, so the mapping is the thing to
  // pin. `admin-match-dispositions.test.ts` pins the mapping itself.
  assert.ok(
    /is_valid: isValid/.test(WRITE_PLANNER),
    'the verdict must be written, not left NULL as an unreviewed automatic match',
  )
  assert.ok(
    /IS_VALID_FOR\[decision\.disposition\] === true/.test(WRITE_PLANNER),
    'the verdict must come from the approved disposition mapping',
  )
})

test('the page submits rejections rather than dropping them in the browser', () => {
  // The cross reaches the server as a `wrong` disposition inside the one save
  // payload. What must never come back is a rejection that stays in the browser.
  assert.ok(
    /setDisposition\(c\.id, 'wrong'\)/.test(MATCH_PAGE),
    'the cross must record a rejecting disposition',
  )
  assert.ok(
    MATCH_PAGE.includes('savePayload'),
    'and it must travel through the one save authority',
  )
  assert.ok(
    !MATCH_PAGE.includes('saveApproved'),
    'the approve-only submit path must be gone',
  )
})

test('repeating or reversing a decision converges on one row', () => {
  // lpm_listing_product_unique (listing_id, product_id) is what makes the
  // upsert idempotent and a reversal an update instead of a duplicate.
  assert.ok(
    /onConflict:\s*'listing_id,product_id'/.test(DECISION_ROUTE),
    'the conflict target must match the unique index',
  )
})

test('a listing cannot be approved and rejected in one submission', () => {
  assert.ok(
    DECISION_ROUTE.includes('duplicate decision for listing'),
    'contradictory input must be refused, not resolved by row order',
  )
})

test('confirming a match does not erase the matcher evidence that produced it', () => {
  // The old upsert wrote a flat {method:'FUZZY', score:1} over everything, so
  // confirming a MODEL/95 match rewrote it as FUZZY/1.
  assert.ok(
    /prior\?\.method \?\? args\.manualMethod/.test(WRITE_PLANNER),
    'an existing method must be preserved',
  )
  assert.ok(
    /prior\?\.score \?\? args\.manualScore/.test(WRITE_PLANNER),
    'an existing score must be preserved',
  )
  assert.ok(
    /\.\.\.\(prior\?\.explain \?\? \{\}\)/.test(WRITE_PLANNER),
    'the matcher explain payload must be merged, not overwritten',
  )
})

test('the stored method stays inside the CHECK constraint', () => {
  // listing_product_match_method_check allows EAN|SKU|MODEL|SYNONYM|FUZZY only.
  // A 'MANUAL' method would need a migration, which this change does not have.
  const allowed = ['EAN', 'SKU', 'MODEL', 'SYNONYM', 'FUZZY']
  const match = DECISION_ROUTE.match(/const MANUAL_METHOD = '([A-Z]+)'/)
  assert.ok(match, 'the manual method must be a named constant')
  assert.ok(allowed.includes(match[1]), `${match[1]} would violate the CHECK constraint`)
})

test('the decision records who decided, when, and from where', () => {
  for (const field of ['actor_user_id', 'decided_at', 'decision_source']) {
    assert.ok(WRITE_PLANNER.includes(field), `the audit payload must carry ${field}`)
  }
})

test('this feedback is not described as training', () => {
  // These rows are a supervised label set. Nothing reads them to tune the
  // Haiku scorer, and claiming otherwise would misrepresent the system.
  assert.ok(
    /does not train|not train/.test(DECISION_ROUTE),
    'the write path must state plainly that it does not train the scorer',
  )
})

/* ------------------------------------------------------------------ *
 * 7. A decided listing never returns as undecided
 * ------------------------------------------------------------------ */

test('exclusion covers every decided listing, not the first hundred', () => {
  // roland-juno-106 alone holds 193 match rows, 62 of them rejections, so the
  // truncated `not.in` filter let already-rejected listings back into the queue.
  assert.ok(
    /decided\.has\(row\.id\)/.test(CANDIDATES_ROUTE),
    'the authoritative exclusion must be the full decided set',
  )
  assert.ok(
    CANDIDATES_ROUTE.includes('excludeIds.slice(0, 100)'),
    'the truncated database filter may remain, but only as a volume reducer',
  )
  const sliceLine = CANDIDATES_ROUTE.split('\n').findIndex((l) => l.includes('excludeIds.slice(0, 100)'))
  const setLine   = CANDIDATES_ROUTE.split('\n').findIndex((l) => l.includes('decided.has(row.id)'))
  assert.ok(setLine > sliceLine, 'the full set filter must run after the query')
})

test('the exclusion set is built from the verdict column', () => {
  assert.ok(
    /select\('listing_id, is_valid'\)/.test(CANDIDATES_ROUTE),
    'the route must read is_valid so a decided row is recognisable',
  )
})

/* ------------------------------------------------------------------ *
 * 8. Authorization
 * ------------------------------------------------------------------ */

test('both match routes use the shared admin helper', () => {
  for (const [name, src] of [['candidates', CANDIDATES_ROUTE], ['approve', DECISION_ROUTE]] as const) {
    assert.ok(
      src.includes('requireAdminInRoute'),
      `${name} must authorize through lib/admin-auth`,
    )
    assert.ok(
      !/async function verifyAdmin/.test(src),
      `${name} must not keep a private copy of the admin check`,
    )
  }
})

test('authorization runs before anything is read or written', () => {
  for (const [name, src] of [['candidates', CANDIDATES_ROUTE], ['approve', DECISION_ROUTE]] as const) {
    const guard = src.indexOf('requireAdminInRoute()')
    const write = src.indexOf('getSupabaseAdmin()')
    assert.ok(guard > -1 && write > -1 && guard < write, `${name} must deny before touching data`)
  }
})

test('the admin match endpoints stay classified as admin-only', () => {
  const access = read('frontend', 'lib', 'route-access.ts')
  for (const route of ['/api/admin/match/approve', '/api/admin/match/candidates']) {
    const line = access.split('\n').find((l) => l.includes(`'${route}'`))
    assert.ok(line, `${route} must be classified`)
    assert.ok(line.includes('admin_api'), `${route} must remain admin_api`)
  }
})

/* ------------------------------------------------------------------ *
 * 9. The public product page still refuses rejected matches
 * ------------------------------------------------------------------ */

test('a rejected match is still excluded from the public product page', () => {
  // This is what makes the negative label worth storing: the operator's "no"
  // has to reach the customer-facing page.
  assert.ok(
    /\.not\('is_valid', 'is', false\)/.test(PUBLIC_ROUTE),
    'the public route must keep dropping is_valid = false',
  )
})

/* ------------------------------------------------------------------ *
 * 10. No scraper is reachable from this surface
 * ------------------------------------------------------------------ */

test('the matching queue reads stored listings and never scrapes', () => {
  // `scraped_at` is a stored column, so the word alone proves nothing. What must
  // be absent is an actual fetch: a scraper import, a scrape endpoint, or an
  // outbound request to a marketplace.
  for (const [name, src] of [['candidates', CANDIDATES_ROUTE], ['approve', DECISION_ROUTE], ['page', MATCH_PAGE]] as const) {
    assert.ok(!/from '[^']*scrapers?\//.test(src), `${name} must not import a scraper`)
    assert.ok(!/\/api\/[^'"`]*scrape/.test(src),   `${name} must not call a scrape endpoint`)
    assert.ok(!/puppeteer|cheerio/.test(src),      `${name} must not pull in a scraping runtime`)
    assert.ok(!/fetch\(\s*['"`]https?:/.test(src), `${name} must not fetch a marketplace directly`)
  }
})
