/**
 * PAN-197 — the card's "N til salg" and the page it links to count by one rule.
 *
 * `browse_product_projection.active_listing_count` is printed on every public
 * product card. The product page and the family page render a match unless it
 * is an explicit rejection: `.not('is_valid', 'is', false)`. Until migration
 * 061 the view counted rejections too, so the Juno-106 card said 146 while its
 * page rendered 86.
 *
 * A view cannot be redefined in part, so the NEXT migration that touches this
 * view will restate the whole body — and the likeliest source to copy is an
 * older file that still carries the unfiltered CTE. These tests make that
 * regression fail here rather than on a card. Behaviour is rehearsed in
 * `scripts/verify-migrations-isolated.sh` section 16.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const MIGRATIONS = join(ROOT, 'scripts', 'migrations')

/** SQL with `--` comment lines removed, so prose cannot satisfy an assertion. */
function code(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
}

/** The highest-numbered forward migration that (re)defines the view. */
function newestProjectionMigration(): string {
  const defining = readdirSync(MIGRATIONS)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.includes('rollback'))
    .filter((f) => /CREATE (OR REPLACE )?VIEW browse_product_projection\b/.test(code(readFileSync(join(MIGRATIONS, f), 'utf8'))))
    .sort()
  assert.ok(defining.length > 0, 'no migration defines browse_product_projection')
  return defining[defining.length - 1]
}

test('the newest projection migration counts only matches the pages render', () => {
  const file = newestProjectionMigration()
  assert.ok(file >= '061', `expected 061 or later to be the newest definition, found ${file}`)
  const sql = code(readFileSync(join(MIGRATIONS, file), 'utf8'))
  const cte = sql.match(/active_listing_counts AS \(([\s\S]*?)GROUP BY lpm\.product_id/)
  assert.ok(cte, `${file}: active_listing_counts CTE not found`)
  assert.match(cte[1], /WHERE l\.is_active = true\s+AND lpm\.is_valid IS NOT FALSE/, `${file}: the count must exclude is_valid = false`)
})

test('the product and family pages still render by the rule the view counts by', () => {
  // If either page changes its rule, the view's count must change with it.
  for (const page of ['frontend/app/api/product/[slug]/route.ts', 'frontend/app/(shell)/family/[slug]/page.tsx']) {
    const src = readFileSync(join(ROOT, page), 'utf8')
    assert.ok(src.includes(".not('is_valid', 'is', false)"), `${page} no longer filters .not('is_valid', 'is', false)`)
  }
})
