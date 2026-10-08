/**
 * PAN-247: the demand list. The ad-state predicate the nightly re-check and
 * the route share, and the posture of /admin/demand.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { adStateFrom } from '../../frontend/lib/price-check-demand'
import { classifyPath, requiresAdmin, requiresAuth } from '../../frontend/lib/route-access'

test('ad state: a 404 or 410 is removed, a stated non-InStock availability is sold, everything else stays active', () => {
  assert.equal(adStateFrom('Error: dba.dk fetch failed: 404 Not Found'), 'removed')
  assert.equal(adStateFrom('Error: dba.dk fetch failed: 410 Gone'), 'removed')
  // An unreachable page proves nothing about the ad; the next night tries again.
  assert.equal(adStateFrom('Error: dba.dk fetch failed: 503 Service Unavailable'), 'active')
  assert.equal(adStateFrom('TypeError: fetch failed'), 'active')
  assert.equal(adStateFrom(null), 'active')
  assert.equal(adStateFrom({ availability: 'https://schema.org/InStock' }), 'active')
  assert.equal(adStateFrom({ availability: 'http://schema.org/InStock' }), 'active')
  assert.equal(adStateFrom({ availability: 'https://schema.org/SoldOut' }), 'sold')
  assert.equal(adStateFrom({ availability: 'https://schema.org/OutOfStock' }), 'sold')
  // A page that states no availability is a live ad as far as it tells.
  assert.equal(adStateFrom({ availability: null }), 'active')
  assert.equal(adStateFrom({}), 'active')
})

test('/admin/demand is an admin page: anon and a signed-in non-admin are sent away, an admin gets through', () => {
  assert.equal(classifyPath('/admin/demand')?.access, 'admin_page')
  assert.equal(requiresAuth('/admin/demand'), true, 'anon → 307 /login')
  assert.equal(requiresAdmin('/admin/demand'), true, 'non-admin session → 307 /')
})
