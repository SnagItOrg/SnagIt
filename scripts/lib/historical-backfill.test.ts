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

test('PAN-266 G4: --from excludes rows scraped before the cursor, inclusive, and the md5 covers it', () => {
  const rows = [
    row('old', { scraped_at: '2026-09-01T10:00:00+00:00' }),
    row('cursor', { scraped_at: '2026-09-23T00:04:20.064+00:00' }),
    row('later', { scraped_at: '2026-10-01T00:00:00+00:00' }),
    row('matched', { scraped_at: '2026-10-02T00:00:00+00:00' }),
  ]
  const ids = (xs: BackfillRow[]) => xs.map((r) => r.id)
  const withRow = new Set(['matched'])
  const from = '2026-09-23T00:04:20.064+00:00'

  // The previous round's printed "last" is this round's --from, and is selected again (its ties too); a
  // row it decided wrote nothing, so re-deciding it is harmless, and a row that holds a match row stays out.
  assert.deepEqual(ids(backfillCohort(rows, withRow, 10, undefined, from)), ['cursor', 'later'])
  assert.deepEqual(ids(backfillCohort(rows, withRow, 1, undefined, from)), ['cursor'])
  assert.deepEqual(ids(backfillCohort(rows, withRow, 10)), ['old', 'cursor', 'later'])
  // The digest names the cursor, so an --apply given a cursorless md5 is refused; without one it is the PAN-262 digest.
  const cohort = backfillCohort(rows, withRow, 10, undefined, from)
  assert.notEqual(selectionDigest(cohort, from), selectionDigest(cohort))
  assert.equal(selectionDigest(cohort, undefined), selectionDigest(cohort))
})
