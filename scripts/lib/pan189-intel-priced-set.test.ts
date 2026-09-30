/**
 * PAN-189 — /intel prices products, never family labels.
 *
 * /intel selected `tier = 'legendary'`, which included the six family-label
 * rows (Gibson Les Paul, Fender Telecaster, …). Their matches mix every variant
 * of a line, and they went straight into /intel's medians and deltas — a price
 * at family level, which PAN-94 forbids.
 *
 * The rows are given the worst shape they can have: promoted to `supported` +
 * `public`, exactly the 2026-09-20 incident PAN-84 describes. The loader needs a
 * live Supabase client, so its wiring is guarded by source, as in
 * pan144-intel-pagination.test.ts.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FAMILY_SLUGS } from '../../frontend/lib/family-slugs'
import { pricedIntelProducts } from '../../frontend/app/intel/priced-products'

test('/intel: no family slug reaches the priced set, even promoted to supported', () => {
  const row = (slug: string, browse_visibility = 'public') => ({
    id: slug,
    slug,
    status: 'active',
    support_state: 'supported',
    browse_visibility,
  })
  const rows = [
    ...FAMILY_SLUGS.map((slug) => row(slug)),
    row('gibson-les-paul-standard-50s'),
    row('gibson-les-paul-studio', 'qa_only'),
  ]
  const music = new Map(rows.map((r) => [r.id, 'music']))

  assert.deepEqual(
    pricedIntelProducts(rows, music).map((r) => r.slug),
    ['gibson-les-paul-standard-50s', 'gibson-les-paul-studio'],
  )

  const src = readFileSync(join(__dirname, '..', '..', 'frontend', 'app', 'intel', 'page.tsx'), 'utf8')
  assert.ok(src.includes('pricedIntelProducts(supportedRows'), 'the product set must go through pricedIntelProducts')
  assert.ok(!src.includes(".eq('tier'"), 'tier is editorial and must not select /intel rows')
})
