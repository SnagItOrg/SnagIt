/**
 * PAN-302, owner's option (a): "Genudgivelse af Neumann U 47" on a reissue's page, "Genudgivet af …" on the original's.
 * A link from `kg_relation` rows of type `reissue_of` — never a price (CLAUDE.md §7).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { REISSUE_OF, reissueContext, type ReissueLink } from '../../frontend/lib/reissues'
import { relationReason } from '../../frontend/lib/similar-gear'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

const U47 = 'neumann-u47-id', TF_U47 = 'telefunken-u47-id', U67 = 'neumann-u67-id', U67R = 'neumann-u67-reissue-id', HIDDEN = 'hidden-id'
const links = new Map<string, ReissueLink>([
  [U47, { slug: 'neumann-u47', label: 'Neumann U 47' }],
  [TF_U47, { slug: 'telefunken-u47', label: 'Telefunken U47' }],
  [U67, { slug: 'neumann-u67', label: 'Neumann U67' }],
  [U67R, { slug: 'neumann-u67-reissue', label: 'Neumann U 67 Reissue' }],
])
const rel = (from: string, to: string, type = REISSUE_OF) => ({ type, from_product_id: from, to_product_id: to })

test('the reissue links its original; the original links its reissue', () => {
  const rows = [rel(TF_U47, U47), rel(U67R, U67)]
  assert.deepEqual(reissueContext(TF_U47, rows, links), { of: [{ slug: 'neumann-u47', label: 'Neumann U 47' }], by: [] })
  assert.deepEqual(reissueContext(U47, rows, links), { of: [], by: [{ slug: 'telefunken-u47', label: 'Telefunken U47' }] })
})

test('an ineligible other end, another relation type or no relation gives no line', () => {
  assert.equal(reissueContext(U47, [rel(HIDDEN, U47)], links), null, 'a product isCanonical() refused is not in the map')
  assert.equal(reissueContext(U47, [rel(TF_U47, U47, 'clone'), rel(U67, U47, 'sibling')], links), null)
  assert.equal(reissueContext(U47, [rel(U47, U47)], links), null)
  assert.equal(reissueContext(U47, [], links), null)
})

test('two reissues of one original are listed once each, by name', () => {
  const ctx = reissueContext(U47, [rel(U67R, U47), rel(TF_U47, U47), rel(TF_U47, U47)], links)
  assert.deepEqual(ctx?.by.map((l) => l.slug), ['neumann-u67-reissue', 'telefunken-u47'])
})

test('a link is { slug, label } and nothing else, so no price can travel in it', () => {
  const src = read('frontend/lib/reissues.ts')
  const body = src.match(/export interface ReissueLink \{([^}]*)\}/)?.[1] ?? ''
  assert.deepEqual(body.split('\n').map((l) => l.trim()).filter(Boolean), ['slug: string', 'label: string'])
  assert.ok(!/from ['"]/.test(src), 'lib/reissues.ts stays import-free')
})

test('the route reads reissue_of rows for identity only and links only canonical products', () => {
  const src = read('frontend/app/api/product/[slug]/route.ts')
  assert.match(src, /\.from\('kg_relation'\)\s*\.select\('type, from_product_id, to_product_id'\)\s*\.eq\('type', REISSUE_OF\)/)
  assert.match(src, /\.from\('kg_product'\)\.select\('id, slug, canonical_name, status, support_state, browse_visibility'\)\.in\('id', reissueOtherIds\)/)
  const block = src.slice(src.indexOf('const reissueRelations'), src.indexOf('const reissueContext: ReissueContext'))
  assert.match(block, /isCanonical\(\{/)
  assert.ok(!/price|median|band|verdict|listing/i.test(block.replace(/\/\*[\s\S]*?\*\//g, '')), 'the reissue block reads no price')
  assert.ok(src.indexOf('const reissueRelations') > src.indexOf('const familyContext'), 'built after every price figure, like the family context')
})

test('the page says it in both languages, and the similar shelf leaves it to the line', () => {
  const i18n = read('frontend/lib/i18n.ts')
  for (const copy of ["reissueOf: 'Genudgivelse af'", "reissuedBy: 'Genudgivet af'", "reissueOf: 'Reissue of'", "reissuedBy: 'Reissued by'"]) {
    assert.ok(i18n.includes(copy), copy)
  }
  const page = read('frontend/app/(shell)/product/[slug]/page.tsx')
  assert.match(page, /\['reissueOf', reissueContext\.of\], \['reissuedBy', reissueContext\.by\]/)
  assert.equal(relationReason(REISSUE_OF, 'from_is_other'), null)
  assert.equal(relationReason(REISSUE_OF, 'to_is_other'), null)
})

test('migration 071 adds exactly reissue_of to the 008 CHECK, and its rollback refuses while rows exist', () => {
  const sql = read('scripts/migrations/071_kg_relation_reissue_of.sql')
  assert.match(sql, /CHECK \(type IN \('sibling', 'successor', 'predecessor', 'clone', 'alternative', 'compatible', 'reissue_of'\)\)/)
  const rb = read('scripts/migrations/071_rollback.sql')
  assert.match(rb, /WHERE type = 'reissue_of'[\s\S]*IF v_rows > 0 THEN\s+RAISE EXCEPTION/)
})
