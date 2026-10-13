import test from 'node:test'
import assert from 'node:assert/strict'

import { backfillCohort, selectionDigest, type BackfillRow } from './historical-backfill'

const TIED = '2026-10-13T20:40:28.181106+00:00'
const row = (id: string, over: Partial<BackfillRow> = {}): BackfillRow =>
  ({ id, title: `ad ${id}`, external_id: null, scraped_at: TIED, is_active: true, ...over })

test('PAN-262: the cohort is active, titled, row-less listings, oldest first, ties broken by id', () => {
  const rows = [
    row('c'),
    row('a'),
    row('old', { scraped_at: '2026-09-01T10:00:00+00:00' }),
    row('matched'),
    row('inactive', { is_active: false }),
    row('untitled', { title: null }),
    row('b'),
  ]
  const ids = (xs: BackfillRow[]) => xs.map((r) => r.id)
  const withRow = new Set(['matched'])

  assert.deepEqual(ids(backfillCohort(rows, withRow, 10)), ['old', 'a', 'b', 'c'])
  // The PAN-254 promote tied ~4,300 scraped_at values: the cut must not depend on input order.
  assert.deepEqual(ids(backfillCohort([...rows].reverse(), withRow, 2)), ['old', 'a'])
  assert.equal(selectionDigest(backfillCohort(rows, withRow, 10)), selectionDigest(backfillCohort([...rows].reverse(), withRow, 10)))
  // --ids narrows the cohort but never admits a listing that holds a match row.
  assert.deepEqual(ids(backfillCohort(rows, withRow, 10, new Set(['c', 'matched']))), ['c'])
})
