/**
 * scripts/lib/dba-elektronik-sweep.ts — PAN-151, owner decision 2026-09-28.
 *
 * `scrape-dba` is scoped to Musikinstrumenter. This is the net under it: a
 * weekly brand query over Elektronik og hvidevarer (`category=0.93`), where a
 * non-musician may list a synth or an amp as consumer electronics. Round 1
 * measured the tail at about 2.5% of a brand's resolving listings (Roland: ~9
 * outside vs 343 inside), sometimes priced below the in-category ones.
 *
 * Almost everything a brand query returns in Elektronik is not an instrument
 * (Roland: 46 results, a handful resolving), so a listing is KEPT only when
 * BOTH readings name the same product:
 *
 *   - the live matcher, `decideMatch()` over the production index (active AND
 *     supported products only) — the same decision `matchScrapedBatch` makes
 *     after promotion;
 *   - the brand-net resolver, which additionally refuses a bare model line
 *     (`juno`, `cube`) and a longer series name the KG row does not carry
 *     ("Pawn Shop Mustang Bass" is not "Mustang Bass").
 *
 * The resolver can only VETO here, never admit: its audited error (PAN-151
 * round 2) is not good enough to feed matching on its own. Everything else is
 * dropped — not staged, not reported.
 */

import type { SupabaseClient } from '../../frontend/node_modules/@supabase/supabase-js'
import {
  buildMatchIndex,
  decideMatch,
  normalizeProductRow,
  PRODUCT_SELECT,
  type MatchIndex,
  type Product,
} from '../../frontend/lib/matching/match-listings'
import {
  DBA_CONFIG,
  extractListingId,
  fetchSchibstedPage,
  type SchibstedPage,
  type SchibstedSearchOptions,
  type TerminationReason,
} from '../../frontend/lib/scrapers/schibsted'
import { DBA_ELEKTRONIK } from '../../frontend/lib/scrapers/dba'
import { normalizeQuery } from '../../frontend/lib/query-normalizer'
import { buildBrandNetContext, resolveBrandNetListing, type BrandNetContext } from './brand-net-resolution'

export const ELEKTRONIK_SWEEP_OPTIONS: SchibstedSearchOptions = { category: DBA_ELEKTRONIK, sort: 'PUBLISHED_DESC' }

/** The delta heuristic from PR #91: stop after K consecutive listings we already hold. */
export const STOP_AFTER_KNOWN = 40

/**
 * The request budget: about 2 per brand. Roland's whole Elektronik result set
 * was 46 listings on one page (round 1), and newest-first over a week sits
 * well inside two.
 */
export const MAX_PAGES_PER_BRAND = 2

export interface SweepKnowledge {
  live: MatchIndex
  net: BrandNetContext
}

type Ident = { product_id: string; type: string; value: string }
type Synonym = { alias: string; canonical_query: string | null }

/**
 * One KG load serves both readings. `buildMatchIndex` applies the matcher's
 * own eligibility (active, supported, not a family label) and derives brand
 * protection from every active product, so this index is the one
 * `matchListings()` builds.
 */
export function buildSweepKnowledge(products: Product[], idents: Ident[], synonyms: Synonym[]): SweepKnowledge {
  return {
    live: buildMatchIndex(products, idents, synonyms),
    net: buildBrandNetContext(products, idents, synonyms),
  }
}

/** The product a listing is kept for, or null when it is dropped. */
export function keepForSweep(title: string, brand: string, knowledge: SweepKnowledge): string | null {
  const live = decideMatch(title, knowledge.live)
  if (live.kind !== 'matched') return null
  const net = resolveBrandNetListing({ title }, brand, knowledge.net)
  if (net.kind !== 'kg_product' || net.ambiguous || !net.productIds.includes(live.best.product_id)) return null
  return live.best.product_id
}

async function selectAll<T>(
  build: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await build().range(offset, offset + 999)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < 1000) break
  }
  return rows
}

/** Read-only: the whole KG, its SKU/MODEL identifiers and alias synonyms. */
export async function loadSweepKnowledge(sb: SupabaseClient): Promise<SweepKnowledge> {
  const raw = await selectAll<Parameters<typeof normalizeProductRow>[0]>(
    () => sb.from('kg_product').select(PRODUCT_SELECT).order('id'))
  const idents = await selectAll<Ident>(
    () => sb.from('kg_identifier').select('product_id, type, value').in('type', ['SKU', 'MODEL']).order('product_id'))
  const synonyms = await selectAll<Synonym>(
    () => sb.from('synonym').select('alias, canonical_query').eq('match_type', 'alias').order('alias'))
  return buildSweepKnowledge(raw.map(normalizeProductRow), idents, synonyms)
}

/** Read-only: the dba listing ids we already hold, for the delta stop. */
export async function loadKnownDbaIds(sb: SupabaseClient): Promise<Set<string>> {
  const rows = await selectAll<{ url: string | null }>(
    () => sb.from('listings').select('url').eq('source', DBA_CONFIG.source).order('id'))
  return new Set(rows.map((r) => (r.url ? extractListingId(r.url) : '')).filter(Boolean))
}

export interface BrandSweep {
  listings: SchibstedPage['listings']
  pages: number[]
  rawCount: number
  /** Only `empty_page` / `no_next_token` mean exhausted; a delta stop is not. */
  termination: TerminationReason
  stoppedOnKnown: boolean
}

/**
 * One brand, newest first, at most MAX_PAGES_PER_BRAND requests. `pause` is
 * the caller's jittered delay, awaited between pages.
 */
export async function sweepBrand(brand: string, known: Set<string>, pause: () => Promise<void>): Promise<BrandSweep> {
  const q = normalizeQuery(brand)
  const out: BrandSweep = { listings: [], pages: [], rawCount: 0, termination: 'max_pages_hit', stoppedOnKnown: false }
  const seen = new Set<string>()
  let consecutiveKnown = 0

  for (let page = 1; page <= MAX_PAGES_PER_BRAND && !out.stoppedOnKnown; page++) {
    if (page > 1) await pause()
    let res: SchibstedPage
    try {
      res = await fetchSchibstedPage(DBA_CONFIG, q, page, ELEKTRONIK_SWEEP_OPTIONS)
    } catch {
      out.termination = 'error'
      break
    }
    out.pages.push(page)
    out.rawCount += res.rawCount
    // Past the last page the CollectionPage block is simply absent; on page 1
    // its absence means the parser no longer matches the site.
    if (!res.schemaValid) { out.termination = page === 1 ? 'error' : 'no_next_token'; break }
    if (res.rawCount === 0) { out.termination = 'empty_page'; break }

    for (const l of res.listings) {
      const id = extractListingId(l.url)
      if (seen.has(id)) continue
      seen.add(id)
      out.listings.push(l)
      consecutiveKnown = known.has(id) ? consecutiveKnown + 1 : 0
      if (consecutiveKnown >= STOP_AFTER_KNOWN) { out.stoppedOnKnown = true; break }
    }
  }
  return out
}
