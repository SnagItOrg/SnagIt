/**
 * scripts/lib/recall-canary.ts — the pure half of the nightly recall canary (PAN-266).
 *
 * The canary asks, for a fixed set of public products, the question the owner asks: "every live
 * DBA ad for this product — is it on Klup?" It runs DBA's own search the way a user types it,
 * reads which hits name the product, and classifies every one that is not on the page. The
 * I/O (dba.dk, the database, the product API) is in scripts/recall-canary.ts; everything that
 * decides is here, so it is testable without a network.
 *
 * WHAT COUNTS AS "THE PRODUCT". A hit names the product when its title carries the product's
 * model code in the matcher's code form (modelCodeForm: "SP404 MKII", "SP-404 MK2" and
 * "SP-404MKII" are one code). That is deliberately NOT the matcher's verdict: a matcher
 * regression must show up as a miss, not shrink the denominator. The matcher's deliberate
 * refusals — a part, a wanted ad, another member of the line — are reported as `refused` and
 * left out of the denominator, because a canary that counted correct refusals as misses would
 * cry every night.
 */

import { decideMatch, lineBoundaryRefusal, modelCodeForm, type MatchIndex, type Product } from '../../frontend/lib/matching/match-listings'

export interface CanaryProduct {
  /** The query a user types on DBA: "roland juno-106". */
  q: string
  /** The public slug(s) the hits belong to; a family lists its public children. */
  slugs: string[]
}

export interface CanaryConfig {
  /** Fail below this recall (0–1). */
  threshold: number
  /** A product with at least this many expected ads and NONE shown fails the run on its own. */
  zeroShownMin: number
  products: CanaryProduct[]
}

/** What production holds for one DBA ad. */
export interface ProductionState {
  inListings: boolean
  active: boolean | null
  /** Match rows on the listing: product slug, verdict, reason. */
  rows: Array<{ slug: string; is_valid: boolean | null; rejected_reason: string | null; admin: boolean }>
  /** The ad is on the product page a user sees (the API's `listings`). */
  onPage: boolean
}

export type MissClass =
  | 'not_scraped'
  | 'inactive'
  | 'no_match_row'
  | 'matched_other'
  | 'hidden'

export type HitOutcome =
  | { kind: 'shown' }
  | { kind: 'refused'; by: string }
  | { kind: 'miss'; class: MissClass; detail: string }

/** True when the title names the model: its code form contains the model's code form as a token. */
export function namesProduct(title: string, modelName: string | null): boolean {
  if (!modelName) return false
  const code = modelCodeForm(modelName.toLowerCase().trim())
  if (code.length < 3) return false
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(modelCodeForm(title.toLowerCase()))
}

/** The products of the index that a canary entry's slugs name. */
export function productsFor(entry: CanaryProduct, index: MatchIndex): Product[] {
  return index.products.filter((p) => entry.slugs.includes(p.slug))
}

/**
 * One hit that names the product, decided. The matcher's own refusals are read first: a title
 * the line boundary refuses on every one of the entry's slugs, or that the matcher defers as a
 * part or a wanted ad, is a correct absence. Everything else that is not on the page is a miss.
 */
export function decideHit(
  title: string,
  entry: CanaryProduct,
  index: MatchIndex,
  state: ProductionState,
): HitOutcome {
  if (state.onPage) return { kind: 'shown' }

  const norm = title.toLowerCase().trim()
  const refusals = entry.slugs.map((slug) => lineBoundaryRefusal(norm, slug))
  if (refusals.length > 0 && refusals.every((r) => r !== null)) return { kind: 'refused', by: `line boundary: ${refusals[0]}` }
  const decision = decideMatch(title, index)
  if (decision.kind === 'deferred' && decision.reason === 'non_product_intent') return { kind: 'refused', by: decision.detail }
  if (decision.kind === 'rejected') return { kind: 'refused', by: `brand collision: ${decision.collision.detectedBrand} is not ${decision.collision.productBrand}` }
  const own = state.rows.filter((r) => entry.slugs.includes(r.slug))
  if (own.some((r) => r.is_valid === false && r.admin)) return { kind: 'refused', by: `admin: ${own.find((r) => r.admin)?.rejected_reason ?? 'rejected'}` }

  if (!state.inListings) return { kind: 'miss', class: 'not_scraped', detail: 'not in listings' }
  if (state.active === false) return { kind: 'miss', class: 'inactive', detail: 'listing inactive' }
  if (state.rows.length === 0) {
    const d = decision.kind === 'matched'
      ? `matcher: matched ${index.productById.get(decision.best.product_id)?.slug ?? '?'}`
      : decision.kind === 'deferred' ? `matcher: deferred ${decision.reason}` : `matcher: ${decision.kind}`
    return { kind: 'miss', class: 'no_match_row', detail: d }
  }
  if (own.length === 0) return { kind: 'miss', class: 'matched_other', detail: state.rows.map((r) => `${r.slug}:${r.is_valid}`).join(',') }
  if (own.every((r) => r.is_valid === false)) return { kind: 'miss', class: 'matched_other', detail: `rejected: ${own[0].rejected_reason ?? '?'}` }
  return { kind: 'miss', class: 'hidden', detail: 'matched, active, not on the page' }
}

export interface ProductResult {
  q: string
  slugs: string[]
  hits: number
  expected: number
  shown: number
  refused: number
  misses: Array<{ id: string; title: string; class: MissClass; detail: string }>
}

export interface Summary {
  ok: boolean
  recall: number
  expected: number
  shown: number
  refused: number
  misses: number
  zeroShown: string[]
  byClass: Record<string, number>
}

/** Recall over the whole run, and the two ways it fails: below threshold, or a product shown nowhere. */
export function summarise(results: readonly ProductResult[], config: Pick<CanaryConfig, 'threshold' | 'zeroShownMin'>): Summary {
  const expected = results.reduce((n, r) => n + r.expected, 0)
  const shown = results.reduce((n, r) => n + r.shown, 0)
  const refused = results.reduce((n, r) => n + r.refused, 0)
  const misses = results.reduce((n, r) => n + r.misses.length, 0)
  const byClass: Record<string, number> = {}
  for (const r of results) for (const m of r.misses) byClass[m.class] = (byClass[m.class] ?? 0) + 1
  const denominator = expected - refused
  const recall = denominator === 0 ? 1 : shown / denominator
  const zeroShown = results.filter((r) => r.expected - r.refused >= config.zeroShownMin && r.shown === 0).map((r) => r.q)
  return { ok: recall >= config.threshold && zeroShown.length === 0, recall, expected, shown, refused, misses, zeroShown, byClass }
}

/** The one line a log watcher greps for. */
export function summaryLine(s: Summary, products: number): string {
  const cls = Object.entries(s.byClass).sort().map(([k, v]) => `${k}=${v}`).join(' ')
  return `[recall-canary] ${s.ok ? 'OK' : 'FAIL'} recall=${s.recall.toFixed(2)} shown=${s.shown} expected=${s.expected} refused=${s.refused} misses=${s.misses} products=${products}` +
    (cls ? ` ${cls}` : '') + (s.zeroShown.length ? ` zero_shown=${s.zeroShown.join('|')}` : '')
}
