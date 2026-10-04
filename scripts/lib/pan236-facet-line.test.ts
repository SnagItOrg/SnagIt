/**
 * PAN-236: the spec line keeps a fixed order, expands patterns, shows flags only when true and never a raw token.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { facetLine } from '../../frontend/lib/product-facet-line'

test('facet line: order, patterns, flags and unknown tokens', () => {
  const items = facetLine({
    pad: true, low_cut: false, patterns: ['figure_8', 'cardioid', 'weird'], electronics: 'tube',
    mic_type: 'condenser', phantom: 'none', pattern_count: 9, colour: 'nickel',
  })
  assert.deepEqual(items, [
    { key: 'facetCondenser' }, { key: 'facetTube' }, { key: 'facetFigure8' }, { key: 'facetCardioid' },
    { key: 'facetPatternCount', count: 9 }, { key: 'facetPad' },
  ])
  assert.deepEqual(facetLine(undefined), [])
})
