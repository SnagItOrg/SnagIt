/**
 * PAN-187 — `safeNextPath`, the one gate on the post-sign-in return path.
 *
 * The feature is an open-redirect surface by construction: `next` arrives in a
 * URL anyone can craft. Every case below is a way a string that starts out
 * looking like a path ends up, after a browser parses it, on another origin.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { safeNextPath } from '../../frontend/lib/safe-next'

test('same-origin paths pass through, query and hash kept', () => {
  assert.equal(safeNextPath('/admin'), '/admin')
  assert.equal(safeNextPath('/admin/product/roland-juno-106'), '/admin/product/roland-juno-106')
  assert.equal(safeNextPath('/watchlists/abc/edit?tab=2#top'), '/watchlists/abc/edit?tab=2#top')
})

test('missing or non-path values fall back', () => {
  for (const raw of [null, undefined, '', 'admin', '?next=/admin', '#x']) {
    assert.equal(safeNextPath(raw), null, String(raw))
  }
})

test('absolute and scheme URLs are rejected', () => {
  for (const raw of [
    'https://evil.com',
    'http://evil.com/admin',
    'javascript:alert(1)',
    'data:text/html,x',
    'HTTPS://evil.com',
  ]) {
    assert.equal(safeNextPath(raw), null, raw)
  }
})

test('protocol-relative and backslash forms are rejected', () => {
  for (const raw of ['//evil.com', '//evil.com/admin', '/\\evil.com', '\\\\evil.com', '/\\/evil.com', '/admin\\..\\']) {
    assert.equal(safeNextPath(raw), null, raw)
  }
})

test('control characters a parser would strip are rejected', () => {
  // `/\t/evil.com` becomes `//evil.com` once the tab is stripped.
  for (const raw of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/\u0000/evil.com']) {
    assert.equal(safeNextPath(raw), null, JSON.stringify(raw))
  }
})

test('encoded variants never leave the origin', () => {
  // Decoded once by URLSearchParams already: a still-encoded value is not a path.
  assert.equal(safeNextPath('%2F%2Fevil.com'), null)
  assert.equal(safeNextPath('%2f%2fevil.com'), null)
  assert.equal(safeNextPath('https%3A%2F%2Fevil.com'), null)
  // The decoded form of `%2F%2Fevil.com` and `%5Cevil.com`.
  assert.equal(safeNextPath(decodeURIComponent('%2F%2Fevil.com')), null)
  assert.equal(safeNextPath(decodeURIComponent('%2F%5Cevil.com')), null)
  // A percent-encoded slash inside a path is not a separator: it stays a path.
  for (const raw of ['/%2F%2Fevil.com', '/%5Cevil.com', '/%09/evil.com']) {
    const out = safeNextPath(raw)
    assert.ok(out === null || new URL(out, 'https://www.klup.dk').origin === 'https://www.klup.dk', raw)
  }
})

test('sign-in pages are never a destination', () => {
  for (const raw of ['/login', '/login?next=/admin', '/signup', '/auth/confirm', '/auth/callback?code=x']) {
    assert.equal(safeNextPath(raw), null, raw)
  }
})

test('dot segments are resolved, and cannot climb out of the origin', () => {
  assert.equal(safeNextPath('/admin/../profile'), '/profile')
  assert.equal(safeNextPath('/../../evil.com'), '/evil.com')
  assert.equal(safeNextPath('/x/../login'), null)
  // Resolving can itself produce a protocol-relative path.
  for (const raw of ['/.//evil.com', '/a/..//evil.com', '/%2e//evil.com']) {
    assert.equal(safeNextPath(raw), null, raw)
  }
})
