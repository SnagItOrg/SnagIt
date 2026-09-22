/**
 * PAN-113 — every monitored platform renders, inactive when it has nothing.
 *
 * Two tests, which is the ticket's budget. The first pins that the platform row
 * is driven by the monitoring registry rather than by a listing count or a
 * hardcoded list; the second pins that active and inactive stay distinguishable
 * with colour ignored.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { monitoredSourcesFor } from '../../frontend/lib/source-monitoring'

const ROOT = join(__dirname, '..', '..')
const COMPONENT = readFileSync(
  join(ROOT, 'frontend', 'components', 'MonitoredPlatforms.tsx'),
  'utf8',
)

test('every monitored source renders regardless of listing count', () => {
  const registry = JSON.parse(
    readFileSync(join(ROOT, 'data', 'klup-source-monitoring.json'), 'utf8'),
  ).sources as Record<string, { mode: string; products: string[] | null }>

  // oberheim-ob-x is the product this ticket exists for: watched by every
  // source and matched by none of them. The whole registry must come back, so
  // the page can render five badges for a product with zero listings.
  const watched = monitoredSourcesFor('oberheim-ob-x', { inCatalogueSweep: true })
  assert.deepEqual(watched, Object.keys(registry))
  assert.ok(watched.length > 0)

  // Monitoring is per-source, not global: a slug outside the explicit sets is
  // watched only by the sweep source, and nothing invents coverage for it.
  const sweepOnly = monitoredSourcesFor('not-a-monitored-slug', { inCatalogueSweep: true })
  assert.deepEqual(
    sweepOnly,
    Object.entries(registry)
      .filter(([, cfg]) => cfg.mode === 'broad_catalogue_sweep')
      .map(([source]) => source),
  )
  assert.deepEqual(
    monitoredSourcesFor('not-a-monitored-slug', { inCatalogueSweep: false }),
    [],
  )

  // The component renders what the registry handed it. A literal platform name
  // in this file would be a second declaration of monitoring, free to drift
  // from the one the scrapers obey.
  assert.match(COMPONENT, /monitoredSources\.map\(/)
  for (const source of Object.keys(registry)) {
    assert.equal(
      COMPONENT.includes(`'${source}'`),
      false,
      `MonitoredPlatforms must not hardcode the source '${source}'`,
    )
  }

  // SourceBadge is exact-match with a DBA fall-through, so an unrecognised key
  // renders as DBA rather than failing. Every registry key must be one it
  // actually knows, or a future source would silently be mislabelled DBA.
  const badge = readFileSync(join(ROOT, 'frontend', 'components', 'SourceBadge.tsx'), 'utf8')
  for (const source of Object.keys(registry)) {
    const known = badge.includes(`source === '${source}'`)
    assert.ok(
      known || source === 'dba.dk',
      `SourceBadge would render '${source}' as DBA via its fall-through`,
    )
  }
})

test('active and inactive platforms differ without colour', () => {
  // The inactive state carries a glyph the active state does not have, and the
  // active state carries an ink weight the inactive one does not. Both survive
  // colour being ignored — the MarketVerdictBadge precedent (PAN-63).
  assert.match(COMPONENT, /visibility/)
  assert.match(COMPONENT, /font-semibold/)
  assert.match(COMPONENT, /border-dashed/)

  // The inactive chip must not be produced by fading it. Opacity composites
  // ink and fill toward the canvas together, which measured 2.61:1 — below AA
  // — where emptying the fill leaves the label at full strength.
  assert.equal(/opacity-\d/.test(COMPONENT), false, 'inactive must not be a faded chip')

  // Green is Klup's own judgement and nothing else. "We are watching" is not on
  // the exhaustive list, and no brand hex is re-declared here either.
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(COMPONENT), false, 'no hardcoded colour values')
  // Usage, not prose: the comment explains why the accent is absent, and a
  // word-level match would read that explanation as the violation.
  assert.equal(
    /(?:bg|text|border)-accent|var\(--accent/.test(COMPONENT),
    false,
    'the accent is reserved for Klup’s own judgements',
  )

  // Every user-facing string comes from i18n, in both locales.
  const i18n = readFileSync(join(ROOT, 'frontend', 'lib', 'i18n.ts'), 'utf8')
  const keys = ['heading', 'note', 'listingCount', 'listingCountOne', 'none']
  const blocks = i18n.split('monitoredPlatforms: {')
  assert.equal(blocks.length, 3, 'monitoredPlatforms must exist in exactly da and en')
  for (const block of blocks.slice(1)) {
    const body = block.slice(0, block.indexOf('},'))
    for (const key of keys) assert.match(body, new RegExp(`\\b${key}:`))
  }
})
