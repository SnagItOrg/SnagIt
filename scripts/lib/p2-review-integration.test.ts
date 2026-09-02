/**
 * P2 price answers and admin review mode, on one page.
 *
 * The two landed on separate branches and both rewrite `page.tsx` and the
 * product API. Each has its own suite; neither proves they COEXIST. These tests
 * cover only the seam — the ways the integration could be wrong while both
 * suites still pass:
 *
 *   - the price answer surviving the review-mode wrapper, and vice versa;
 *   - a decision refreshing the price evidence, not just the card list;
 *   - a rejected listing leaking back in through the statistics contract;
 *   - a verdict computed against the wrong population, or against sold data;
 *   - review mode changing the numbers merely by being switched on.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildPopulationStats,
  classifyListing,
  verdictFor,
  type PopulationKey,
} from '../../frontend/lib/price-populations'

const FRONTEND = join(__dirname, '..', '..', 'frontend')
const codeOf = (...seg: string[]) => readFileSync(join(FRONTEND, ...seg), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const PAGE = ['app', 'product', '[slug]', 'page.tsx']
const ROUTE = ['app', 'api', 'product', '[slug]', 'route.ts']

const obs = (n: number[]) => n.map((v) => ({ price: v, price_dkk: v })) as never

/* ── 1. both features render from the same page ────────────────────────────── */

test('I1: the price answer and the review controls coexist on one page', () => {
  const page = strip(codeOf(...PAGE))
  for (const p2 of ['<DanishMarketBlock', '<ReferencePopulationBlock', 'marketVerdict=']) {
    assert.ok(page.includes(p2), `P2 must survive integration: ${p2}`)
  }
  for (const hotfix of ['<ProductReviewControls', 'loadMatchStatuses', 'setMatchStatuses']) {
    assert.ok(page.includes(hotfix), `the hotfix must survive integration: ${hotfix}`)
  }
  // Local removal on reject/move — the half of the lingering-card fix that
  // lives on the client.
  assert.ok(page.includes('setListings((prev) => prev.filter((l) => l.id !== id))'),
    'a decided card still leaves the wall immediately')
  // The price answer is NOT inside the review-mode branch: it renders for
  // everyone, and switching review on must not be what reveals it.
  const answer = page.indexOf('<DanishMarketBlock')
  const controls = page.indexOf('<ProductReviewControls')
  assert.ok(answer !== -1 && controls !== -1 && answer < controls)
  assert.equal(page.slice(0, answer).includes('reviewMode && ('), false,
    'the price answer must not sit behind the review-mode guard')
})

/* ── 2. a decision refreshes the price basis, not only the card list ───────── */

test('I2: rejecting or moving refetches the populations, not just the listings', () => {
  const page = strip(codeOf(...PAGE))
  // `loadProduct` is what a decision calls; it must reload the price evidence
  // too, because rejecting a listing changes the population it was counted in.
  const at = page.indexOf('const loadProduct')
  const body = page.slice(at, page.indexOf('}, [slug])', at))
  for (const setter of ['setListings(', 'setPopulations(', 'setSoldCounts(', 'setPriceHistory(']) {
    assert.ok(body.includes(setter), `loadProduct must refresh ${setter}`)
  }
  for (const handler of ['onDecided', 'onReassigned']) {
    const h = page.indexOf(handler)
    assert.ok(page.slice(h, h + 900).includes('void loadProduct()'), `${handler} refetches`)
  }
})

/* ── 3. a reload cannot resurrect a rejected card ──────────────────────────── */

test('I3: the wall filter and the freshness contract both survived P2', () => {
  const route = codeOf(...ROUTE)
  assert.ok(route.includes("not('is_valid', 'is', false)"), 'rejections stay off the wall')
  assert.ok(/export const fetchCache = 'force-no-store'/.test(route), 'and are not re-served')
  assert.ok(/export const dynamic = 'force-dynamic'/.test(route))
  assert.ok(/export const revalidate = 0/.test(route))
})

/* ── 4-5. verdicts are server-side, on the filtered population ─────────────── */

test('I4: the deal verdict is computed server-side from the filtered population', () => {
  const route = strip(codeOf(...ROUTE))
  assert.ok(route.includes('verdictFor('), 'the server computes it')
  assert.ok(route.includes('marketVerdict:'), 'and serialises it onto the listing')
  const page = strip(codeOf(...PAGE))
  assert.equal(page.includes('verdictFor('), false, 'the client never recomputes a verdict')
  // Only verified listings are eligible; the gate is the verified id set.
  assert.ok(route.includes('verifiedIds.has(listing.id)'))
})

test('I5: a rejected listing can never receive a verdict', () => {
  // Rejected rows are absent from `verifiedIds`, so the route passes a null
  // population — and a null population is refused outright.
  const stats = buildPopulationStats('dk-asking', obs([9000, 10000, 11000, 12000, 13000, 14000, 15000, 16000]))
  assert.equal(stats.tier, 'band', 'a band-tier population, so nothing else is masking the result')
  assert.equal(verdictFor(12000, null, stats).verdict, null)
  assert.equal(verdictFor(12000, null, stats).reason, 'population_mismatch')
})

/* ── 6. sold data is never a card verdict basis ────────────────────────────── */

test('I6: reverb-sold is never used as the basis for a card verdict', () => {
  // No listing can be classified into it — it is built from reverb_price_history.
  for (const source of ['reverb', 'dba.dk', 'kleinanzeigen', 'blocket', 'finn', 'thomann']) {
    for (const country of ['DK', 'DE', 'SE', 'NO', 'US', null]) {
      assert.notEqual(classifyListing({ source, country }).population, 'reverb-sold')
    }
  }
  // And even if one were, the population/stats keys must match.
  const sold = buildPopulationStats('reverb-sold', obs([9000, 10000, 11000, 12000, 13000, 14000, 15000, 16000]))
  assert.equal(verdictFor(12000, 'reverb-asking' as PopulationKey, sold).verdict, null)
  assert.equal(verdictFor(12000, 'reverb-asking' as PopulationKey, sold).reason, 'population_mismatch')
})

/* ── 7. the public page is unchanged for a visitor ─────────────────────────── */

test('I7: without admin auth the page renders no review controls', () => {
  const page = strip(codeOf(...PAGE))
  const controls = page.indexOf('<ProductReviewControls')
  const guard = page.lastIndexOf('reviewMode && (', controls)
  assert.ok(guard !== -1 && guard < controls, 'controls stay behind reviewMode')
  // reviewMode itself requires a server-verified admin flag AND the query flag.
  assert.ok(/const reviewMode = isAdmin && reviewRequested/.test(page))
  assert.ok(page.includes("fetch('/api/admin/me')"), 'isAdmin comes from the server')
})

/* ── 8. review mode does not move the numbers ──────────────────────────────── */

test('I8: turning review mode on does not change the statistics', () => {
  const route = strip(codeOf(...ROUTE))
  // The statistics are built from the verified population on the server, with
  // no notion of who is asking. A review flag reaching the population build
  // would make the numbers depend on the viewer.
  const at = route.indexOf('buildPopulationStats(')
  const region = route.slice(Math.max(0, at - 2000), at + 2000)
  for (const viewerFlag of ['reviewMode', 'review=1', 'isAdmin']) {
    assert.equal(region.includes(viewerFlag), false,
      `population building must not read ${viewerFlag}`)
  }
  // adminPreview only changes cache headers and eligibility, never the maths.
  assert.ok(route.includes('adminPreview'))
  const page = strip(codeOf(...PAGE))
  const answer = page.indexOf('<DanishMarketBlock')
  assert.equal(page.slice(answer - 300, answer).includes('reviewMode'), false)
})
