/**
 * PAN-140 — microphone attribute facets.
 *
 * The spike budgeted three tests, and each one guards a different promise:
 *
 *   1. the vocabulary is closed: nothing outside it can be written, and
 *      nothing outside it can be read back (fail-closed),
 *   2. with a facet chip in force, the count is still the rendered rows
 *      (PAN-98), under "can do" semantics,
 *   3. the public browse payload carries facet VALUES and never who set them.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  PRODUCT_ATTRIBUTE_FACETS,
  applyFacetWrite,
  facetChipAxes,
  facetKeysFor,
  filterByFacets,
  readActiveFacets,
  readFacetEntries,
  readFacets,
  validateFacetWrite,
} from '../../frontend/lib/product-facets'
import { translations } from '../../frontend/lib/i18n'
import { buildPositionSignal } from '../../frontend/lib/position-signal'

const MICS = 'pro-audio/microphones'
const PROVENANCE = { set_by: '6b1c2d3e-0000-4000-8000-000000000001', set_at: '2026-09-24T15:00:00.000Z' }

test('vocabulary: only known axes and values, on the product\'s own leaf, at the right cardinality', () => {
  // The three mic axes apply to the mic leaf and to nothing else.
  assert.deepEqual(facetKeysFor(MICS), ['capsule', 'circuit', 'polar_pattern'])
  assert.deepEqual(facetKeysFor('keyboards-and-synths/analog-synths'), [])
  assert.deepEqual(facetKeysFor(null), [])

  // Accepted, and normalised to vocabulary order with duplicates dropped.
  assert.deepEqual(
    validateFacetWrite({ key: 'polar_pattern', values: ['figure-8', 'omni', 'cardioid', 'omni'] }, MICS),
    { ok: true, key: 'polar_pattern', values: ['omni', 'cardioid', 'figure-8'] },
  )
  // `passive` is in the vocabulary (owner's call): a passive ribbon is not solid-state.
  assert.deepEqual(validateFacetWrite({ key: 'circuit', values: ['passive'] }, MICS), {
    ok: true,
    key: 'circuit',
    values: ['passive'],
  })
  // Empty is "unset", not an error.
  assert.deepEqual(validateFacetWrite({ key: 'capsule', values: [] }, MICS), { ok: true, key: 'capsule', values: [] })

  // Refused.
  const refused: Array<[unknown, string | null, string]> = [
    [{ key: 'diaphragm', values: ['large'] }, MICS, 'unknown_facet'],
    [{ key: 'capsule', values: ['condenser'] }, 'keyboards-and-synths/analog-synths', 'not_applicable'],
    [{ key: 'capsule', values: ['condenser'] }, null, 'not_applicable'],
    [{ key: 'circuit', values: ['FET'] }, MICS, 'unknown_value'],
    [{ key: 'circuit', values: ['tube', 'solid-state'] }, MICS, 'too_many_values'],
    [{ key: 'capsule', values: 'condenser' }, MICS, 'invalid_body'],
    [null, MICS, 'invalid_body'],
  ]
  for (const [body, leaf, error] of refused) {
    assert.deepEqual(validateFacetWrite(body, leaf), { ok: false, error }, JSON.stringify(body))
  }

  // Fail-closed reads: every invalid entry below is dropped, the valid one survives.
  const attributes = {
    type: 'instrument',
    facets: {
      circuit: { values: ['tube'], ...PROVENANCE },
      capsule: { values: ['condenser', 'dynamic'], ...PROVENANCE }, // single-valued axis, two values
      polar_pattern: { values: ['cardioid', 'figure-9'], ...PROVENANCE }, // unknown value
      diaphragm: { values: ['large'], ...PROVENANCE }, // unknown axis
    },
  }
  assert.deepEqual(readFacets(attributes, MICS), { circuit: ['tube'] })
  // A value with no provenance is not a human claim, so it is not read.
  assert.deepEqual(readFacets({ facets: { circuit: { values: ['tube'] } } }, MICS), {})
  // The same facets on a product outside the leaf are inert.
  assert.deepEqual(readFacets(attributes, 'pro-audio/channel-strips'), {})
  assert.deepEqual(readFacets(null, MICS), {})

  // A write carries other attributes and other axes over, and an empty write
  // removes the axis rather than storing an empty claim.
  const written = applyFacetWrite(attributes, { key: 'polar_pattern', values: ['omni'] }, PROVENANCE)
  assert.equal(written.type, 'instrument')
  assert.deepEqual(readFacetEntries(written, MICS).polar_pattern, { values: ['omni'], ...PROVENANCE })
  const unset = applyFacetWrite({ facets: { circuit: { values: ['tube'], ...PROVENANCE } } }, { key: 'circuit', values: [] }, PROVENANCE)
  assert.deepEqual(unset, {})

  // Every axis has a heading in both locales.
  for (const key of Object.keys(PRODUCT_ATTRIBUTE_FACETS) as Array<keyof typeof PRODUCT_ATTRIBUTE_FACETS>) {
    assert.ok(translations.da.productFacets[key], `da heading for ${key}`)
    assert.ok(translations.en.productFacets[key], `en heading for ${key}`)
  }
  assert.deepEqual(Object.values(translations.da.productFacets), ['Type', 'Elektronik', 'Karakteristik'])
})

// ─── The browse chip row ─────────────────────────────────────────────────────

const ROOT = join(__dirname, '..', '..', 'frontend')
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

/** The three public mics, with the values the spike measured. */
const U87 = { slug: 'neumann-u87ai', facets: { capsule: ['condenser'], circuit: ['solid-state'], polar_pattern: ['omni', 'cardioid', 'figure-8'] } }
const REF_C = { slug: 'manley-ref-c', facets: { capsule: ['condenser'], circuit: ['tube'], polar_pattern: ['cardioid'] } }
const REF_GOLD = { slug: 'manley-reference-gold', facets: { capsule: ['condenser'], circuit: ['tube'], polar_pattern: ['omni', 'cardioid', 'figure-8'] } }
const UNCURATED = { slug: 'some-new-mic', facets: {} }
const MIC_ROWS = [U87, REF_C, REF_GOLD, UNCURATED]
const MIC_KEYS = facetKeysFor(MICS)

test('with a facet chip in force the count is the rendered rows, under "can do"', () => {
  // Figure-8 "can do": both multi-pattern mics, not the fixed cardioid, and
  // not the uncurated row (a missing value is "unknown", never a match).
  const figure8 = filterByFacets(MIC_ROWS, readActiveFacets(new URLSearchParams('polar_pattern=figure-8'), MIC_KEYS))
  assert.deepEqual(figure8.map((r) => r.slug), ['neumann-u87ai', 'manley-reference-gold'])
  assert.equal(buildPositionSignal({ renderedRows: figure8 }).count, figure8.length)

  // Omni is the same two rows: one mic sits under several chips of one axis,
  // which is why a sum of chip counts would be a number no rendered set has.
  const omni = filterByFacets(MIC_ROWS, { polar_pattern: 'omni' })
  assert.deepEqual(omni.map((r) => r.slug), figure8.map((r) => r.slug))

  // Two axes are AND: tube and figure-8 is the Reference Gold alone.
  const both = filterByFacets(MIC_ROWS, readActiveFacets(new URLSearchParams('circuit=tube&polar_pattern=figure-8'), MIC_KEYS))
  assert.deepEqual(both.map((r) => r.slug), ['manley-reference-gold'])
  assert.equal(buildPositionSignal({ renderedRows: both }).count, 1)

  // A value outside the vocabulary, or an axis that does not apply, is ignored.
  assert.deepEqual(readActiveFacets(new URLSearchParams('circuit=FET&diaphragm=large'), MIC_KEYS), {})
  assert.deepEqual(readActiveFacets(new URLSearchParams('circuit=tube'), facetKeysFor('pro-audio/recording')), {})

  // Only chips that narrow. Among the three curated mics, all condenser, the
  // capsule axis is absent and Cardioid (all three) is hidden — the spike's
  // measured case. An uncurated row changes that honestly: Condenser and
  // Cardioid then exclude it, so they narrow and are shown.
  const curatedAxes = facetChipAxes([U87, REF_C, REF_GOLD], MIC_KEYS, {})
  assert.deepEqual(curatedAxes.map((a) => a.key), ['circuit', 'polar_pattern'])
  assert.deepEqual(
    curatedAxes.find((a) => a.key === 'polar_pattern')!.values.map((v) => v.value),
    ['omni', 'figure-8'],
  )
  const withUncurated = facetChipAxes(MIC_ROWS, MIC_KEYS, {})
  assert.deepEqual(withUncurated.map((a) => a.key), ['capsule', 'circuit', 'polar_pattern'])
  assert.deepEqual(
    withUncurated.find((a) => a.key === 'polar_pattern')!.values.map((v) => v.value),
    ['omni', 'cardioid', 'figure-8'],
  )
  // The value in force is always shown, so it can be removed, even though
  // within its own filtered set it no longer narrows.
  const inForce = facetChipAxes([U87, REF_C, REF_GOLD], MIC_KEYS, { circuit: 'tube' })
  assert.deepEqual(inForce.find((a) => a.key === 'circuit')!.values, [
    { value: 'tube', label: 'Tube', active: true },
    { value: 'solid-state', label: 'Solid-state', active: false },
  ])

  // The page wires the chip row and the count to the same array: the facet
  // filter produces `filteredProducts`, which the signal counts and the grid
  // maps (the latter two also pinned by pan121-position-signal.test).
  const page = stripComments(readFileSync(join(ROOT, 'app', '(shell)', 'browse', '[root]', 'page.tsx'), 'utf8'))
  assert.match(page, /const filteredProducts = filterByFacets\(subcategoryProducts, activeFacets\)/)
  assert.match(page, /facetChipAxes\(subcategoryProducts, /)
  assert.match(page, /renderedRows: filteredProducts/)
  assert.match(page, /\{filteredProducts\.map\(/)
})

test('the public browse payload carries facet values, never who set them', () => {
  const stored = {
    facets: {
      circuit: { values: ['tube'], ...PROVENANCE },
      polar_pattern: { values: ['cardioid'], ...PROVENANCE },
    },
    reverb_csp: { csp_id: 1865 },
  }
  const publicFacets = readFacets(stored, MICS)
  assert.deepEqual(publicFacets, { circuit: ['tube'], polar_pattern: ['cardioid'] })
  const json = JSON.stringify(publicFacets)
  for (const leak of ['set_by', 'set_at', PROVENANCE.set_by, 'reverb_csp']) {
    assert.equal(json.includes(leak), false, `public facets must not carry ${leak}`)
  }

  // The browse builder reaches the column only through readFacets, and
  // selects only the facets sub-object, never the whole attributes blob.
  const browse = stripComments(readFileSync(join(ROOT, 'lib', 'browse.ts'), 'utf8'))
  assert.match(browse, /\.select\('slug, facets:attributes->facets'\)/)
  assert.match(browse, /out\.set\(row\.slug, readFacets\(/)
  assert.equal(/select\([^)]*\battributes\b(?!->)/.test(browse), false, 'browse must not select attributes whole')
})
