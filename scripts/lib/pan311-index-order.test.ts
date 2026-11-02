/**
 * scripts/lib/pan311-index-order.test.ts
 *
 * PAN-311 (2026-11-02): loadMatchIndex paged kg_product, kg_identifier and synonym with `.range()` and no
 * `.order()`. Offset pages over an unordered query can skip or repeat rows between requests, so each index load
 * dropped a different handful of the 1,107 matchable products and the backfill writer decided "none" on 270 titles
 * its dry run had matched. Every paged query must be totally ordered before it is ranged.
 *
 * Run: npx tsx --test scripts/lib/pan311-index-order.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadMatchIndex } from '../../frontend/lib/matching/match-listings'

test('every query loadMatchIndex pages is ordered by id before it is ranged', async () => {
  const ranged: Array<{ table: string; orderedBy: string[] }> = []
  const fake = {
    from(table: string) {
      const orderedBy: string[] = []
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: (column: string) => { orderedBy.push(column); return chain },
        range: async () => { ranged.push({ table, orderedBy: [...orderedBy] }); return { data: [], error: null } },
      }
      return chain
    },
  } as unknown as SupabaseClient

  await loadMatchIndex(fake)

  assert.equal(ranged.length, 4)
  for (const r of ranged) assert.deepEqual(r.orderedBy, ['id'], `${r.table} is paged without .order('id')`)
})
