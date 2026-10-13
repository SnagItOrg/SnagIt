/**
 * scripts/lib/source-monitoring.ts
 *
 * The single explicit source -> product configuration. Replaces the implicit
 * `kg_product.tier` selector the marketplace scrapers used to run.
 *
 * WHY. `tier` is an EDITORIAL classification (migration 031): carousel, badges,
 * browse ranking, /intel. Four scrapers ALSO used it to decide what to query,
 * so an editorial promotion silently expanded marketplace monitoring. Reading
 * an explicit product set removes that coupling entirely.
 *
 * This file is checked in and reviewed. Nothing at runtime may edit it.
 */
import * as fs from 'fs'
import * as path from 'path'

export type MonitoringMode = 'explicit_product_set' | 'brand_net' | 'broad_catalogue_sweep'

export interface SourceMonitoring {
  mode: MonitoringMode
  scraper: string
  products: string[] | null
  /** `brand_net` only: kg_brand slugs, one search query each. */
  brands?: string[]
  /** `brand_net` only: kg_product slugs searched by model name, for ads that omit the brand. */
  model_queries?: string[]
  /** `brand_net` only: the marketplace sub-category every query is scoped to. */
  sub_category?: string
  note?: string
}

/** The brand net's query sets (PAN-254). */
export interface BrandNet {
  brands: string[]
  modelQueries: string[]
  subCategory: string
}

const CONFIG_PATH = path.resolve(__dirname, '../../data/klup-source-monitoring.json')

export function loadMonitoringConfig(): Record<string, SourceMonitoring> {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  return raw.sources as Record<string, SourceMonitoring>
}

/**
 * Exact product slugs this source queries. Throws for a sweep source, because
 * asking a broad-ingestion source for a product list is a category error and
 * must not silently return an empty set.
 */
export function monitoredSlugs(source: string): string[] {
  const cfg = loadMonitoringConfig()[source]
  if (!cfg) throw new Error(`source-monitoring: no configuration for '${source}'`)
  if (cfg.mode !== 'explicit_product_set' || !cfg.products) {
    throw new Error(`source-monitoring: '${source}' is ${cfg.mode}, not a per-product query source`)
  }
  const slugs = cfg.products
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i)
  if (dupes.length) throw new Error(`source-monitoring: duplicate slug(s) for '${source}': ${dupes.join(', ')}`)
  if (slugs.length === 0) throw new Error(`source-monitoring: '${source}' has an empty product set`)
  return slugs
}

function uniqueOrThrow(source: string, what: string, slugs: string[]): string[] {
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i)
  if (dupes.length) throw new Error(`source-monitoring: duplicate ${what} slug(s) for '${source}': ${dupes.join(', ')}`)
  return slugs
}

/**
 * The brand net of a `brand_net` source: the kg_brand slugs it queries, the
 * product slugs it queries by model name, and the sub-category scope. Throws
 * for any other mode, for the same reason `monitoredSlugs` does.
 */
export function monitoredBrands(source: string): BrandNet {
  const cfg = loadMonitoringConfig()[source]
  if (!cfg) throw new Error(`source-monitoring: no configuration for '${source}'`)
  if (cfg.mode !== 'brand_net' || !cfg.brands) {
    throw new Error(`source-monitoring: '${source}' is ${cfg.mode}, not a brand-net source`)
  }
  if (cfg.brands.length === 0) throw new Error(`source-monitoring: '${source}' has an empty brand set`)
  if (!cfg.sub_category) throw new Error(`source-monitoring: '${source}' brand net has no sub_category scope`)
  return {
    brands: uniqueOrThrow(source, 'brand', cfg.brands),
    modelQueries: uniqueOrThrow(source, 'model-query', cfg.model_queries ?? []),
    subCategory: cfg.sub_category,
  }
}

/**
 * FAIL LOUD, NEVER SILENTLY SHRINK. A configured slug that no longer resolves to
 * an active product is a configuration error: silently dropping it would shrink
 * marketplace coverage with no signal at all.
 */
export function assertResolved(source: string, wanted: string[], found: string[], what = 'product'): void {
  const missing = wanted.filter((s) => !found.includes(s))
  if (missing.length) {
    throw new Error(
      `source-monitoring: ${missing.length} configured ${what}(s) for '${source}' did not resolve to an active kg_${what === 'brand' ? 'brand' : 'product'}: ${missing.join(', ')}. ` +
      `Fix data/klup-source-monitoring.json or the ${what}s; the scraper refuses to run with a silently reduced set.`)
  }
}
