/**
 * scripts/lib/pan135-hero-guard.test.ts
 *
 * PAN-135. `scripts/set-hero-images.ts` wrote six hardcoded hero images on
 * every run, over whatever the operator had curated. These pin the three
 * behaviours that stop that, against an in-memory table so no database is
 * touched:
 *   1. a curated row is left alone, and the report says so;
 *   2. --force is required to overwrite, and reports before and after;
 *   3. a dry run writes nothing — the row is checked afterwards.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { parseHeroFlags, setHeroImages, type HeroWrite } from './hero-image-guard'

const CURATED = 'https://x.supabase.co/storage/v1/object/public/onboarding-assets/products/roland-tr-909.webp'
const LITERAL = 'https://images.pexels.com/photos/15786284/pexels-photo-15786284.jpeg'
const EMPTY_TARGET = 'https://images.unsplash.com/photo-1'

/** A two-row table and a compare-and-set writer over it, counting calls. */
function fixture() {
  const table = new Map<string, string | null>([
    ['roland-tr-909', CURATED],
    ['fender-jaguar', null],
  ])
  const targets = { 'roland-tr-909': LITERAL, 'fender-jaguar': EMPTY_TARGET }
  let calls = 0
  const write: HeroWrite = async (slug, before, after) => {
    calls++
    if (table.get(slug) !== before) return false
    table.set(slug, after)
    return true
  }
  const rows = () => [...table].map(([slug, current]) => ({ slug, current }))
  return { table, targets, write, rows, calls: () => calls }
}

test('a curated row is left alone by --apply, and the report says so', async () => {
  const f = fixture()
  const report = await setHeroImages(f.rows(), f.targets, parseHeroFlags(['--apply']), f.write)

  assert.equal(f.table.get('roland-tr-909'), CURATED, 'the curated image must survive')
  assert.equal(f.table.get('fender-jaguar'), EMPTY_TARGET, 'an empty row is still filled')
  assert.match(report.join('\n'), /roland-tr-909: kept, already has a curated image/)
})

test('--force is required to overwrite, and names each slug with before and after', async () => {
  const f = fixture()
  const report = (await setHeroImages(f.rows(), f.targets, parseHeroFlags(['--apply', '--force']), f.write)).join('\n')

  assert.equal(f.table.get('roland-tr-909'), LITERAL)
  assert.ok(
    report.includes(`roland-tr-909: wrote (OVERWRITE)\n    before: ${CURATED}\n    after:  ${LITERAL}`),
    report,
  )
})

test('a dry run writes nothing, with or without --force, and says what it would do', async () => {
  for (const argv of [[], ['--dry-run'], ['--force']]) {
    const f = fixture()
    const report = (await setHeroImages(f.rows(), f.targets, parseHeroFlags(argv), f.write)).join('\n')

    assert.equal(f.calls(), 0, `argv ${JSON.stringify(argv)} must not call the writer`)
    assert.equal(f.table.get('roland-tr-909'), CURATED, 'the curated row is untouched afterwards')
    assert.equal(f.table.get('fender-jaguar'), null, 'the empty row is untouched afterwards')
    assert.match(report, /^DRY RUN/)
    assert.match(report, /fender-jaguar: would write \(fill\)/)
  }
})
