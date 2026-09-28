import test from 'node:test'
import assert from 'node:assert/strict'

import { DAILY_SOURCES, staleSources } from '../../frontend/lib/scrape-freshness'

const now = new Date('2026-09-28T06:00:00Z')
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString()
const allAt = (at: string | null) => Object.fromEntries(DAILY_SOURCES.map((s) => [s, at]))

test('one missed night makes a source stale', () => {
  assert.deepEqual(staleSources({ ...allAt(hoursAgo(8)), finn: hoursAgo(32) }, now), ['finn'])
})

test('a source with no listings at all is stale (fail-closed)', () => {
  assert.deepEqual(staleSources({ ...allAt(hoursAgo(8)), blocket: null }, now), ['blocket'])
})
