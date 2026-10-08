import test from 'node:test'
import assert from 'node:assert/strict'

import { missedNight } from '../../frontend/lib/scrape-freshness'

// The real 2026-10-07 night: panter rebooted and PM2 waited for a login.
const night = {
  'dba.dk': '2026-10-06T22:37:00Z',
  finn: '2026-10-06T23:10:00Z',
  reverb: '2026-10-07T02:37:00Z',
}

test('the 2026-10-08 missed night emails once, and fresh data stays silent', () => {
  // The morning after: both watched sources are past 26 h; finn is stale too but never emails.
  const first = missedNight(night, new Date('2026-10-08T06:00:00Z'), [])
  assert.deepEqual(first, { stale: ['dba.dk', 'reverb'], alert: true })

  // A day later, still down: the same incident, no second email.
  assert.equal(missedNight(night, new Date('2026-10-09T06:00:00Z'), first.stale).alert, false)

  // The morning before, after a normal night: silent.
  assert.deepEqual(missedNight(night, new Date('2026-10-07T06:00:00Z'), []), { stale: [], alert: false })
})
