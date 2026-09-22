/**
 * Which marketplaces Klup watches for a given product.
 *
 * THE REGISTRY IS THE ONLY AUTHORITY. data/klup-source-monitoring.json is the
 * reviewed, checked-in configuration the four marketplace scrapers read to
 * decide what to query (scripts/lib/source-monitoring.ts is its Node-side
 * reader). A platform list must never be hardcoded in a component: that would
 * be a second declaration of monitoring, free to drift from the one the
 * scrapers obey, and CLAUDE.md §2 makes widening monitoring a product-owner
 * action. This module READS the registry and never writes it.
 *
 * MONITORING IS PER-SOURCE, NOT GLOBAL. Four sources carry an explicit product
 * set; `reverb` is a broad catalogue sweep and deliberately has no product
 * list, because asking a sweep source for one is a category error. So the
 * answer to "does this source watch this product" is a different question per
 * source, which is why this takes a slug rather than returning a constant.
 *
 * SERVER-ONLY, for the same reason lib/search-index.ts is. The registry holds
 * the complete monitored product set for every source. Bundling it into a
 * client component would ship Klup's operational monitoring posture to every
 * visitor. Callers pass the RESULT for one slug to the browser, never the
 * registry.
 */
if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
  throw new Error(
    'lib/source-monitoring.ts is server-only: it contains the full marketplace monitoring configuration.',
  )
}

import registry from '../../data/klup-source-monitoring.json'

/**
 * Registry order, which is the order the sources are declared in and therefore
 * stable across requests — a platform row must not reshuffle between products.
 */
export function monitoredSourcesFor(
  slug: string,
  { inCatalogueSweep }: { inCatalogueSweep: boolean },
): string[] {
  return Object.entries(registry.sources)
    .filter(([, cfg]) =>
      cfg.mode === 'broad_catalogue_sweep'
        ? inCatalogueSweep
        : (cfg.products ?? []).includes(slug),
    )
    .map(([source]) => source)
}
