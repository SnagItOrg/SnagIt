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

import {
  PRODUCT_ATTRIBUTE_FACETS,
  applyFacetWrite,
  facetKeysFor,
  readFacetEntries,
  readFacets,
  validateFacetWrite,
} from '../../frontend/lib/product-facets'
import { translations } from '../../frontend/lib/i18n'

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
