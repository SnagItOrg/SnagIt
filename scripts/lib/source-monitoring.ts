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

export type MonitoringMode = 'explicit_product_set' | 'broad_catalogue_sweep'

export interface SourceMonitoring {
  mode: MonitoringMode
  scraper: string
  products: string[] | null
  note?: string
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

/**
 * FAIL LOUD, NEVER SILENTLY SHRINK. A configured slug that no longer resolves to
 * an active product is a configuration error: silently dropping it would shrink
 * marketplace coverage with no signal at all.
 */
export function assertResolved(source: string, wanted: string[], found: string[]): void {
  const missing = wanted.filter((s) => !found.includes(s))
  if (missing.length) {
    throw new Error(
      `source-monitoring: ${missing.length} configured product(s) for '${source}' did not resolve to an active kg_product: ${missing.join(', ')}. ` +
      `Fix data/klup-source-monitoring.json or the products; the scraper refuses to run with a silently reduced set.`)
  }
}
