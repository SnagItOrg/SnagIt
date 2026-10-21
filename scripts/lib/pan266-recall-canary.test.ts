/**
 * scripts/lib/pan266-recall-canary.test.ts
 *
 * PAN-266: the recall canary's decisions, without a network. Which hits name the product, how a
 * hit that is not on the page is classified, what counts as a correct refusal, and when the run
 * fails. The titles are the DBA ads of 2026-10-15.
 *
 * Run: npx tsx --test scripts/lib/pan266-recall-canary.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildMatchIndex, type Product } from '../../frontend/lib/matching/match-listings'
import { decideHit, namesProduct, productsFor, summarise, summaryLine, type CanaryProduct, type ProductResult, type ProductionState } from './recall-canary'

const row = (slug: string, brand_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `${brand_name} ${model_name}`, model_name, brand_name,
  status: 'active', support_state: 'supported',
})
const index = buildMatchIndex([
  row('roland-sp-404', 'roland', 'SP-404'),
  row('roland-sp-404-mkii', 'roland', 'SP-404MKII'),
  row('roland-sp-404sx', 'roland', 'SP-404SX'),
  row('roland-juno-106', 'roland', 'Juno-106'),
  row('shure-sm7b', 'shure', 'SM7B'),
], [], [], ['roland', 'shure', 'tc-helicon'])

const SP404: CanaryProduct = { q: 'roland sp-404', slugs: ['roland-sp-404-mkii', 'roland-sp-404sx'] }
const JUNO: CanaryProduct = { q: 'roland juno-106', slugs: ['roland-juno-106'] }
const SM7B: CanaryProduct = { q: 'shure sm7b', slugs: ['shure-sm7b'] }
const absent: ProductionState = { inListings: false, active: null, rows: [], onPage: false }
const held = (rows: ProductionState['rows'], onPage = false): ProductionState => ({ inListings: true, active: true, rows, onPage })

test('a hit names the product by its model code in any spelling, never by the matcher verdict', () => {
  assert.equal(namesProduct('Roland SP404 MKII', 'SP-404MKII'), true)
  assert.equal(namesProduct('Roland SP-404MKII sampler', 'SP-404MKII'), true)
  assert.equal(namesProduct('Roland SP 404MKII Linear Wave Sampler', 'SP-404MKII'), true)
  assert.equal(namesProduct('Roland SP-404 MK2', 'SP-404MKII'), true)
  assert.equal(namesProduct('Roland SP-404SX', 'SP-404MKII'), false)
  assert.equal(namesProduct('Roland SP-404A sampler', 'SP-404SX'), false)
  assert.equal(namesProduct('Juno 106 voice chips', 'Juno-106'), true)  // names it; the matcher refuses it below
  assert.equal(namesProduct('Roland Juno X til salg', 'Juno-106'), false)
  assert.equal(namesProduct('anything', null), false)
})

test('the slugs of an entry resolve to the index products', () => {
  assert.deepEqual(productsFor(SP404, index).map((p) => p.slug).sort(), ['roland-sp-404-mkii', 'roland-sp-404sx'])
  assert.deepEqual(productsFor({ q: 'x', slugs: ['nope'] }, index), [])
})

test('on the page is shown; a deliberate refusal is not a miss', () => {
  assert.deepEqual(decideHit('Roland SP404 MKII', SP404, index, { ...absent, onPage: true }), { kind: 'shown' })
  // The matcher's part guard: a correct absence.
  const chips = decideHit('Juno 106 voice chips', JUNO, index, held([]))
  assert.equal(chips.kind, 'refused')
  // A person's verdict stands.
  const manual = decideHit('Roland Juno-106 owner\'s manual', JUNO, index,
    held([{ slug: 'roland-juno-106', is_valid: false, rejected_reason: 'admin_rejected', admin: true }]))
  assert.equal(manual.kind, 'refused')
  // The plain SP-404 is refused on both public rows' boundaries? No — the MKII title is the MKII; it is a miss when absent.
  assert.equal(decideHit('Roland SP404 MKII', SP404, index, absent).kind, 'miss')
})

test('every miss has its class: not scraped, inactive, no match row, matched elsewhere, hidden', () => {
  assert.deepEqual(decideHit('Roland SP404 MKII', SP404, index, absent), { kind: 'miss', class: 'not_scraped', detail: 'not in listings' })
  const inactive = decideHit('Roland SP404 MKII', SP404, index, { ...held([]), active: false })
  assert.equal(inactive.kind === 'miss' && inactive.class, 'inactive')
  const noRow = decideHit('Roland SP404 MKII', SP404, index, held([]))
  assert.equal(noRow.kind === 'miss' && noRow.class, 'no_match_row')
  assert.match(noRow.kind === 'miss' ? noRow.detail : '', /matcher: matched roland-sp-404-mkii/)
  const other = decideHit('Roland SP404 MKII', SP404, index, held([{ slug: 'roland-sp-404', is_valid: null, rejected_reason: null, admin: false }]))
  assert.equal(other.kind === 'miss' && other.class, 'matched_other')
  const hidden = decideHit('Roland SP404 MKII', SP404, index, held([{ slug: 'roland-sp-404-mkii', is_valid: null, rejected_reason: null, admin: false }]))
  assert.deepEqual(hidden, { kind: 'miss', class: 'hidden', detail: 'matched, active, not on the page' })
  // A matcher rejection that is not a person's is a miss of the matched_other kind, so it stays visible.
  const rejected = decideHit('Shure SM7B dynamisk mikrofon', SM7B, index, held([{ slug: 'shure-sm7b', is_valid: false, rejected_reason: 'ai_rejected', admin: false }]))
  assert.equal(rejected.kind === 'miss' && rejected.class, 'matched_other')
})

test('the run fails below the threshold, or when a product with supply shows nothing', () => {
  const ok: ProductResult = { q: 'a', slugs: ['a'], hits: 10, expected: 5, shown: 5, refused: 0, misses: [] }
  const miss = (n: number, cls: 'hidden' | 'not_scraped'): ProductResult['misses'] =>
    Array.from({ length: n }, (_, i) => ({ id: String(i), title: 't', class: cls, detail: '' }))
  const some: ProductResult = { q: 'b', slugs: ['b'], hits: 10, expected: 6, shown: 4, refused: 1, misses: miss(1, 'hidden') }
  const none: ProductResult = { q: 'c', slugs: ['c'], hits: 9, expected: 5, shown: 0, refused: 0, misses: miss(5, 'not_scraped') }
  const config = { threshold: 0.8, zeroShownMin: 3 }
  const good = summarise([ok, some], config)
  assert.equal(good.ok, true)
  assert.equal(good.recall, 9 / 10)  // refused leaves the denominator
  const bad = summarise([ok, some, none], config)
  assert.equal(bad.ok, false)
  assert.deepEqual(bad.zeroShown, ['c'])
  assert.deepEqual(bad.byClass, { hidden: 1, not_scraped: 5 })
  assert.match(summaryLine(bad, 3), /^\[recall-canary\] FAIL recall=0\.60 shown=9 expected=16 refused=1 misses=6 products=3 hidden=1 not_scraped=5 zero_shown=c$/)
  assert.match(summaryLine(good, 2), /^\[recall-canary\] OK recall=0\.90 /)
  // A product below zeroShownMin with nothing shown is not alone a failure.
  assert.equal(summarise([ok, { ...none, expected: 2, misses: miss(2, 'not_scraped') }], config).ok, false)  // 7/12 < 0.8
  assert.equal(summarise([ok, ok, ok, { ...none, expected: 2, misses: miss(2, 'not_scraped') }], config).ok, true)  // 15/17, no zero_shown
})

test('the product set is the committed list, every entry a query and public slugs', () => {
  const raw = JSON.parse(readFileSync(join(__dirname, '..', '..', 'data', 'klup-recall-canary.json'), 'utf8'))
  assert.ok(raw.threshold > 0 && raw.threshold <= 1)
  assert.ok(raw.products.length >= 30)
  for (const p of raw.products) {
    assert.ok(typeof p.q === 'string' && p.q.length > 0)
    assert.ok(Array.isArray(p.slugs) && p.slugs.length > 0)
  }
  const qs = raw.products.map((p: CanaryProduct) => p.q)
  assert.equal(new Set(qs).size, qs.length, 'no duplicate query')
})
