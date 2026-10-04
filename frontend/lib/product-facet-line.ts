/**
 * The spec line under a product title (PAN-236): the facet tokens a row
 * carries, in a fixed order, as i18n keys. Import-free, so the order and the
 * token → key map are testable from plain Node. Unknown tokens are skipped,
 * never shown raw.
 */

export type FacetValue = string | number | boolean | string[]

const TOKEN_KEY: Record<string, string> = {
  'mic_type:condenser': 'facetCondenser',
  'mic_type:dynamic': 'facetDynamic',
  'mic_type:ribbon': 'facetRibbon',
  'electronics:tube': 'facetTube',
  'electronics:fet': 'facetFet',
  'diaphragm:large': 'facetLargeDiaphragm',
  'diaphragm:medium': 'facetMediumDiaphragm',
  'diaphragm:small': 'facetSmallDiaphragm',
  'patterns:cardioid': 'facetCardioid',
  'patterns:supercardioid': 'facetSupercardioid',
  'patterns:hypercardioid': 'facetHypercardioid',
  'patterns:wide_cardioid': 'facetWideCardioid',
  'patterns:omni': 'facetOmni',
  'patterns:figure_8': 'facetFigure8',
  'phantom:required': 'facetPhantomRequired',
}

/** Booleans that mean "has this feature" when true; false and absent both say nothing. */
const FLAG_KEY: Record<string, string> = {
  pad: 'facetPad',
  low_cut: 'facetLowCut',
  transformerless: 'facetTransformerless',
}

const ORDER = ['mic_type', 'electronics', 'diaphragm', 'patterns', 'pattern_count', 'pad', 'low_cut', 'transformerless', 'phantom']

export type FacetLineItem = { key: string; count?: number }

/** One item per facet in display order; `patterns` yields one item per pattern. */
export function facetLine(facets: Record<string, FacetValue> | null | undefined): FacetLineItem[] {
  if (!facets) return []
  const out: FacetLineItem[] = []
  for (const name of ORDER) {
    const value = facets[name]
    if (value === undefined || value === null) continue
    if (name === 'pattern_count' && typeof value === 'number') { out.push({ key: 'facetPatternCount', count: value }); continue }
    if (name in FLAG_KEY) { if (value === true) out.push({ key: FLAG_KEY[name] }); continue }
    for (const token of Array.isArray(value) ? value : [value]) {
      const key = TOKEN_KEY[`${name}:${String(token)}`]
      if (key) out.push({ key })
    }
  }
  return out
}
