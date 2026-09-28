/**
 * PAN-137 — a bad year is refused, never dropped; and a product can state a
 * production range. Two tests, each able to fail on its own.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  formatProductionYears,
  validateProductionYears,
  yearDiscontinuedEnabled,
} from '../../frontend/lib/production-years'
import { productEntity } from '../../frontend/lib/search-index'

const ROOT = join(__dirname, '..', '..')
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8')

test('PAN-137: an unparsable year is refused with its field, never sent as NaN -> null', () => {
  // The mechanism of the bug, pinned: NaN does not survive JSON, it arrives as
  // null, and null used to mean "no year" to the route.
  assert.deepEqual(JSON.parse(JSON.stringify({ year_released: parseInt('Discontinued', 10) })), {
    year_released: null,
  })

  // Every one of these is refused with the field named — none becomes a year
  // or a silent null. '1960abc' is the one `parseInt` used to read as 1960.
  for (const bad of ['Discontinued', 'Disc', '1960abc', '19600', '196', '1899', '2031', NaN, 1960.5]) {
    const result = validateProductionYears({ year_released: bad, year_discontinued: null })
    assert.equal(result.ok, false, `accepted ${String(bad)}`)
    if (!result.ok) {
      assert.equal(result.field, 'year_released')
      assert.equal(result.code, 'invalid_year')
    }
  }
  // Empty is still "no year", and four digits in range still parse.
  assert.deepEqual(validateProductionYears({ year_released: ' ', year_discontinued: '' }), {
    ok: true, year_released: null, year_discontinued: null,
  })
  assert.deepEqual(validateProductionYears({ year_released: '1982', year_discontinued: undefined }), {
    ok: true, year_released: 1982, year_discontinued: null,
  })

  // No year-bearing client builds its body with parseInt any more, and both
  // write routes run the same validation.
  for (const client of [
    'frontend/app/admin/product/NewProductForm.tsx',
    'frontend/components/admin/ReassignPanel.tsx',
    'frontend/app/admin/products/page.tsx',
  ]) {
    assert.equal(/parseInt\([^)]*year/i.test(read(client)), false, `${client} still parses a year with parseInt`)
  }
  for (const route of [
    'frontend/app/api/admin/product/new/route.ts',
    'frontend/app/api/admin/products/[id]/route.ts',
  ]) {
    assert.match(read(route), /validateProductionYears\(/, `${route} must validate production years`)
  }
})

test('PAN-137: the range rule, its one rendering, and the migration agree', () => {
  // The rule — the same one migration 059's CHECK states.
  assert.equal(validateProductionYears({ year_released: 1960, year_discontinued: 1975 }).ok, true)
  assert.equal(validateProductionYears({ year_released: 1960, year_discontinued: 1960 }).ok, true)
  assert.deepEqual(validateProductionYears({ year_released: null, year_discontinued: 1975 }), {
    ok: false, field: 'year_discontinued', code: 'discontinued_without_released',
  })
  assert.deepEqual(validateProductionYears({ year_released: 1975, year_discontinued: 1960 }), {
    ok: false, field: 'year_discontinued', code: 'discontinued_before_released',
  })
  const migration = read('scripts/migrations/059_kg_product_year_discontinued.sql')
  assert.match(
    migration,
    /year_discontinued IS NULL\s+OR \(year_released IS NOT NULL AND year_discontinued >= year_released\)/,
  )

  // The rendering: a range, open-ended, or — when the column was not read
  // because the flag is off — the release year alone, exactly as before.
  assert.equal(formatProductionYears(1960, 1975), '1960–1975')
  assert.equal(formatProductionYears(1960, null), '1960–')
  assert.equal(formatProductionYears(1960, undefined), '1960')
  assert.equal(formatProductionYears(null, null), null)

  // …and it is what the public search label shows.
  const row = {
    slug: 'microtech-gefell-cmv-551',
    canonical_name: 'Microtech Gefell CMV 551',
    model_name: 'CMV 551',
    era: null,
    year_released: 1960,
    kg_brand: { name: 'Microtech Gefell' },
  }
  assert.equal(productEntity({ ...row, year_discontinued: 1975 }).label, 'Microtech Gefell CMV 551 (1960–1975)')
  assert.equal(productEntity(row).label, 'Microtech Gefell CMV 551 (1960)')

  // Deploy safety: nothing reads the column until the owner switches it on.
  assert.equal(yearDiscontinuedEnabled({}), false)
  assert.equal(yearDiscontinuedEnabled({ KLUP_YEAR_DISCONTINUED: 'true' }), false)
  assert.equal(yearDiscontinuedEnabled({ KLUP_YEAR_DISCONTINUED: 'on' }), true)
})
