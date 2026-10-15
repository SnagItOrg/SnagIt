/**
 * PAN-264: the retention rules of scripts/purge-stale.ts. The SQL side of the
 * same predicate, the export and the restore are rehearsed on PGlite in
 * ~/klup-rollbacks/opus9-2026-10-15/pan264 (rehearse264.mjs).
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildManifest, deleteBatches, isStaleListing, isStaleStaging, listingFingerprint, parseArgs, timestampMicros,
  unreferenced, type Row,
} from './purge-stale'

const CUTOFF = '2026-09-15T00:00:00.000Z'
const listing = (over: Row = {}): Row => ({
  id: 'a0000000-0000-4000-8000-000000000001', is_active: false, watchlist_id: null, source: 'reverb',
  external_id: '123', url: 'https://reverb.com/item/123', scraped_at: '2026-09-01T10:00:00.123456+00:00',
  last_seen_at: null, delisted_at: null, ...over,
})

test('timestampMicros reads both PostgREST forms to the microsecond and refuses anything else', () => {
  assert.equal(timestampMicros('2026-09-14T23:59:59.999999+00:00'), Date.UTC(2026, 8, 15) * 1000 - 1)
  assert.equal(timestampMicros('2026-09-15 01:00:00.5+01'), Date.UTC(2026, 8, 15) * 1000 + 500000)
  assert.equal(timestampMicros('2026-09-15T00:00:00Z'), Date.UTC(2026, 8, 15) * 1000)
  assert.equal(timestampMicros(null), null)
  assert.throws(() => timestampMicros('15/09/2026'), /unreadable timestamp/)
})

test('rule 1: inactive since before the cutoff by every timestamp, and nothing else', () => {
  assert.equal(isStaleListing(listing(), CUTOFF), true)
  // The boundary: a microsecond before the cutoff goes, the cutoff itself stays.
  assert.equal(isStaleListing(listing({ scraped_at: '2026-09-14T23:59:59.999999+00:00' }), CUTOFF), true)
  assert.equal(isStaleListing(listing({ scraped_at: '2026-09-15T00:00:00+00:00' }), CUTOFF), false)
  // Seen or delisted after the cutoff: not 30 days inactive yet.
  assert.equal(isStaleListing(listing({ last_seen_at: '2026-09-20T00:00:00+00:00' }), CUTOFF), false)
  assert.equal(isStaleListing(listing({ delisted_at: '2026-09-16T00:00:00+00:00' }), CUTOFF), false)
  // Active, active unknown, a watchlist's own hit, or never scraped: kept.
  assert.equal(isStaleListing(listing({ is_active: true }), CUTOFF), false)
  assert.equal(isStaleListing(listing({ is_active: null }), CUTOFF), false)
  assert.equal(isStaleListing(listing({ watchlist_id: 'b0000000-0000-4000-8000-000000000001' }), CUTOFF), false)
  assert.equal(isStaleListing(listing({ scraped_at: null }), CUTOFF), false)
})

test('rule 1: any reference keeps a listing, by id, by url or by (source, external_id)', () => {
  const a = listing({ id: 'a1', url: 'u1', external_id: 'e1' })
  const b = listing({ id: 'b1', url: 'u2', external_id: 'e2' })
  const c = listing({ id: 'c1', url: 'u3', external_id: 'e3', source: 'dba.dk' })
  const d = listing({ id: 'd1', url: 'u4', external_id: 'e4' })
  const none = { ids: new Set<string>(), urls: new Set<string>(), externalKeys: new Set<string>(), saved: new Set<string>() }
  const keep = unreferenced([a, b, c, d], {
    ...none,
    ids: new Set(['a1']),
    urls: new Set(['u2']),
    externalKeys: new Set(['dba.dk\u0000e3', 'reverb\u0000e3']),
  })
  assert.deepEqual(keep.map((r) => r.id), ['d1'])
  // The same external id under another source is another listing.
  assert.equal(unreferenced([listing({ id: 'x', url: 'ux', external_id: 'e3', source: 'finn' })],
    { ...none, externalKeys: new Set(['dba.dk\u0000e3']) }).length, 1)
  // saved_listings.listing_id is free text: a save by id, by external id or by url each keeps the listing.
  for (const v of ['d1', 'e4', 'u4']) assert.equal(unreferenced([d], { ...none, saved: new Set([v]) }).length, 0, v)
})

test('rule 2: only rows the promote read: run promoted, staged at or before it, older than the cutoff', () => {
  const row = { id: 's1', run_id: 'r1', created_at: '2026-09-20T00:30:00+00:00', external_id: 'x' }
  const cutoff = '2026-10-01T00:00:00.000Z'
  assert.equal(isStaleStaging(row, '2026-09-20T00:45:00+00:00', cutoff), true)
  assert.equal(isStaleStaging(row, undefined, cutoff), false, 'quarantined, failed or never promoted: kept')
  assert.equal(isStaleStaging(row, '2026-09-20T00:10:00+00:00', cutoff), false, 'staged after the promotion: never read')
  // One microsecond after the promotion is after it, too.
  assert.equal(isStaleStaging({ ...row, created_at: '2026-09-20T00:45:00.000001+00:00' }, '2026-09-20T00:45:00+00:00', cutoff), false)
  assert.equal(isStaleStaging({ ...row, created_at: '2026-10-01T00:00:00+00:00' }, '2026-10-01T01:00:00+00:00', cutoff), false)
})

test('the manifest is per first hex digit, in uuid order, and moves with any fingerprint column', () => {
  const rows = [
    listing({ id: 'b0000000-0000-4000-8000-000000000002' }),
    listing({ id: 'b0000000-0000-4000-8000-000000000001' }),
    listing({ id: '10000000-0000-4000-8000-000000000001' }),
  ]
  const m = buildManifest(rows, listingFingerprint)
  assert.deepEqual(Object.keys(m), ['1', 'b'])
  assert.equal(m.b.n, 2)
  assert.deepEqual(buildManifest([...rows].reverse(), listingFingerprint), m, 'input order does not matter')
  const moved = buildManifest([rows[0], rows[1], listing({ id: rows[2].id, delisted_at: '2026-09-01T00:00:00+00:00' })], listingFingerprint)
  assert.equal(moved.b.fp_md5, m.b.fp_md5)
  assert.notEqual(moved['1'].fp_md5, m['1'].fp_md5)
})

test('dry run is the default; --apply is explicit; unknown arguments refuse', () => {
  const now = new Date('2026-10-15T04:30:00Z')
  const d = parseArgs([], now)
  assert.equal(d.apply, false)
  assert.deepEqual(d.rules, ['listings', 'staging'])
  assert.equal(d.listingsCutoff, '2026-09-15T04:30:00.000Z')
  assert.equal(d.stagingCutoff, '2026-10-01T04:30:00.000Z')
  assert.equal(parseArgs(['--apply'], now).apply, true)
  assert.equal(parseArgs(['--rule=listings', '--listings-cutoff=2026-09-15T00:00:00Z'], now).listingsCutoff, CUTOFF)
  assert.throws(() => parseArgs(['--apply', '--dry-run'], now))
  assert.throws(() => parseArgs(['--aply'], now), /unknown argument/)
  assert.throws(() => parseArgs(['--max-listings=lots'], now))
})

test('deletes stop at the first batch that does not delete exactly its ids', async () => {
  const ids = Array.from({ length: 450 }, (_, i) => `id-${String(i).padStart(3, '0')}`)
  const calls: string[][] = []
  const all = await deleteBatches('t', ids, async (batch) => {
    calls.push(batch)
    return { data: batch.map((id) => ({ id })), error: null }
  }, 0)
  assert.equal(all, 450)
  assert.deepEqual(calls.map((c) => c.length), [200, 200, 50])

  // The second batch finds one row changed since the check: it stays, and nothing after it runs.
  let n = 0
  await assert.rejects(deleteBatches('t', ids, async (batch) => {
    n += 1
    return { data: (n === 2 ? batch.slice(1) : batch).map((id) => ({ id })), error: null }
  }, 0), /deleted 199 of 200.*stopped after 399/)
  assert.equal(n, 2)

  // A foreign key refusing (a match written after the check) stops the run too.
  await assert.rejects(deleteBatches('t', ids, async () => ({ data: null, error: { message: 'violates foreign key constraint' } }), 0),
    /stopped after 0 rows: violates foreign key/)
})
