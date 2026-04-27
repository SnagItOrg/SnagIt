/**
 * scripts/enrich-from-reverb-csp.ts
 *
 * Backfills kg_product with Reverb CSP (Comparison Shopping Page) anchors.
 * For each kg_product with brand + canonical_name, queries Reverb's CSP API
 * filtered by `make=<brand_slug>`, picks the top match, and stores the CSP
 * metadata in `attributes.reverb_csp` (jsonb).
 *
 * Why jsonb: migration 030 will add a first-class `kg_product.reverb_csp_id`
 * integer column. Until that's applied, attributes is the carrier so this
 * script can run autonomously today. Migration 032 later promotes the value
 * out of jsonb into the typed column.
 *
 * Storage shape (under attributes.reverb_csp):
 *   {
 *     csp_id: 1677,
 *     slug: "roland-juno-60",
 *     title: "Roland Juno-60 61-Key Polyphonic Synthesizer",
 *     image_url: "https://rvb-img.reverb.com/...",
 *     used_total: 57,
 *     used_low_price_usd: 2000.0,
 *     score: 1.0,                    // 0..1, see scoreMatch()
 *     confidence: "high",            // high|medium|low|none
 *     resolved_at: "2026-04-27T..."
 *   }
 *
 * Ambiguous matches (low confidence) ALSO store top-3 candidates under
 * `attributes.reverb_csp_candidates` for later human or Haiku review.
 *
 * Usage:
 *   npm run enrich-from-reverb-csp
 *   npm run enrich-from-reverb-csp -- --dry-run
 *   npm run enrich-from-reverb-csp -- --limit=20
 *   npm run enrich-from-reverb-csp -- --slug=roland-juno-60
 *   npm run enrich-from-reverb-csp -- --brand=roland
 *   npm run enrich-from-reverb-csp -- --force      # re-resolve already-resolved rows
 */

import 'dotenv/config'
import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'

// ── Load env ──────────────────────────────────────────────────────────────────
for (const p of [
  path.resolve(__dirname, '../frontend/.env.local'),
  path.resolve(__dirname, '../.env.local'),
]) {
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, 'utf8').split('\n')
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
    break
  }
}

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── CLI flags ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const FORCE   = args.includes('--force')
const LIMIT   = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '0', 10)
const SLUG    = args.find(a => a.startsWith('--slug='))?.split('=')[1] ?? null
const BRAND   = args.find(a => a.startsWith('--brand='))?.split('=')[1] ?? null

// ── Reverb API ────────────────────────────────────────────────────────────────
const REVERB_HEADERS = {
  'Accept-Version': '3.0',
  'Accept': 'application/hal+json',
}
const RATE_LIMIT_MS = 2500

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

interface ReverbCsp {
  id: number
  slug: string
  title: string
  used_total?: number
  used_low_price?: { amount: string | number; currency: string }
  photos?: Array<{ _links?: { full?: { href?: string }; large_crop?: { href?: string } } }>
}

async function searchCsps(query: string, makeSlug: string | null): Promise<ReverbCsp[]> {
  const params = new URLSearchParams({ query })
  if (makeSlug) params.set('make', makeSlug)
  const url = `https://api.reverb.com/api/csps?${params.toString()}`
  try {
    const res = await fetch(url, { headers: REVERB_HEADERS })
    if (!res.ok) {
      console.warn(`    Reverb HTTP ${res.status} for "${query}"`)
      return []
    }
    const data = await res.json() as { comparison_shopping_pages?: ReverbCsp[] }
    return data.comparison_shopping_pages ?? []
  } catch (err) {
    console.warn(`    Reverb fetch error: ${(err as Error).message}`)
    return []
  }
}

// ── Match scoring ─────────────────────────────────────────────────────────────
function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
}

// Score = |canonical tokens ∩ csp title tokens| / |canonical tokens|
// Bonus +0.1 if canonical is a contiguous prefix of CSP title.
function scoreMatch(canonical: string, cspTitle: string): number {
  const canTokens = tokenize(canonical)
  if (canTokens.length === 0) return 0
  const cspTokens = new Set(tokenize(cspTitle))
  const overlap   = canTokens.filter(t => cspTokens.has(t)).length
  let score = overlap / canTokens.length
  // Prefix bonus: CSP title starts with the canonical name (after normalization)
  const canNorm = tokenize(canonical).join(' ')
  const cspNorm = tokenize(cspTitle).join(' ')
  if (cspNorm.startsWith(canNorm)) score = Math.min(1.0, score + 0.1)
  return Math.round(score * 100) / 100
}

function classifyConfidence(score: number, canonicalTokens: number): 'high' | 'medium' | 'low' | 'none' {
  if (canonicalTokens < 2) return 'low'    // single-token canonical names (e.g. just "Fender") are too generic
  if (score >= 0.95) return 'high'
  if (score >= 0.75) return 'medium'
  if (score >= 0.5)  return 'low'
  return 'none'
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface ProductRow {
  id: string
  slug: string
  canonical_name: string
  brand_id: string | null
  attributes: Record<string, unknown> | null
}

interface BrandRow {
  id: string
  slug: string
  name: string
}

// ── Fetch products + brands ───────────────────────────────────────────────────
async function fetchBrands(): Promise<Map<string, BrandRow>> {
  const all: BrandRow[] = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('kg_brand')
      .select('id, slug, name')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`fetchBrands: ${error.message}`)
    if (!data?.length) break
    all.push(...data as BrandRow[])
    if (data.length < PAGE) break
    from += PAGE
  }
  return new Map(all.map(b => [b.id, b]))
}

async function fetchProducts(): Promise<ProductRow[]> {
  const all: ProductRow[] = []
  let from = 0
  const PAGE = 500
  while (true) {
    let q = supabase
      .from('kg_product')
      .select('id, slug, canonical_name, brand_id, attributes')
      .eq('status', 'active')
      .not('brand_id', 'is', null)
      .order('slug', { ascending: true })
      .range(from, from + PAGE - 1)
    if (SLUG) q = q.eq('slug', SLUG)
    const { data, error } = await q
    if (error) throw new Error(`fetchProducts: ${error.message}`)
    if (!data?.length) break
    all.push(...data as ProductRow[])
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

// ── Resolve one product ───────────────────────────────────────────────────────
type ResolutionRecord = {
  csp_id: number
  slug: string
  title: string
  image_url: string | null
  used_total: number
  used_low_price_usd: number | null
  score: number
  confidence: 'high' | 'medium' | 'low' | 'none'
  resolved_at: string
}

function pickPhoto(c: ReverbCsp): string | null {
  return c.photos?.[0]?._links?.full?.href ?? c.photos?.[0]?._links?.large_crop?.href ?? null
}

async function resolveOne(p: ProductRow, brandSlug: string | null): Promise<{
  resolution: ResolutionRecord | null
  candidates: ResolutionRecord[]
}> {
  const csps = await searchCsps(p.canonical_name, brandSlug)
  if (!csps.length) return { resolution: null, candidates: [] }

  const now = new Date().toISOString()
  const canTokens = tokenize(p.canonical_name).length

  const ranked: ResolutionRecord[] = csps.slice(0, 3).map(c => {
    const score = scoreMatch(p.canonical_name, c.title)
    const lowPriceUsd = c.used_low_price?.currency === 'USD'
      ? parseFloat(String(c.used_low_price.amount))
      : null
    return {
      csp_id:             c.id,
      slug:               c.slug,
      title:              c.title,
      image_url:          pickPhoto(c),
      used_total:         c.used_total ?? 0,
      used_low_price_usd: lowPriceUsd,
      score,
      confidence:         classifyConfidence(score, canTokens),
      resolved_at:        now,
    }
  }).sort((a, b) => b.score - a.score || b.used_total - a.used_total)

  return { resolution: ranked[0] ?? null, candidates: ranked.slice(1) }
}

// ── Update Supabase ───────────────────────────────────────────────────────────
async function writeBack(p: ProductRow, resolution: ResolutionRecord | null, candidates: ResolutionRecord[]): Promise<void> {
  const merged = { ...(p.attributes ?? {}) } as Record<string, unknown>
  if (resolution) {
    merged.reverb_csp = resolution
  } else {
    merged.reverb_csp = { resolved_at: new Date().toISOString(), confidence: 'none' as const }
  }
  if (candidates.length > 0) {
    merged.reverb_csp_candidates = candidates
  } else {
    delete merged.reverb_csp_candidates
  }
  if (DRY_RUN) return
  const { error } = await supabase
    .from('kg_product')
    .update({ attributes: merged })
    .eq('id', p.id)
  if (error) throw new Error(`update kg_product ${p.slug}: ${error.message}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔗  Reverb CSP enrichment')
  console.log(`   Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE'}`)
  if (SLUG)  console.log(`   Filter: slug=${SLUG}`)
  if (BRAND) console.log(`   Filter: brand=${BRAND}`)
  if (LIMIT) console.log(`   Limit: ${LIMIT} products`)
  console.log(`   Force re-resolve: ${FORCE}`)
  console.log()

  const brands   = await fetchBrands()
  const products = await fetchProducts()

  // Filter: brand match (if --brand), drop already-resolved (unless --force)
  const queue = products.filter(p => {
    if (BRAND) {
      const b = p.brand_id ? brands.get(p.brand_id) : null
      if (!b || b.slug !== BRAND) return false
    }
    if (!FORCE) {
      const existing = (p.attributes as Record<string, unknown> | null)?.['reverb_csp']
      if (existing && (existing as { csp_id?: number }).csp_id != null) return false
    }
    return true
  })

  const work = LIMIT ? queue.slice(0, LIMIT) : queue
  console.log(`📋  ${work.length} products to resolve (queue size before limit: ${queue.length})\n`)
  if (work.length === 0) {
    console.log('Nothing to do.')
    return
  }

  let resolved = 0
  let high = 0, medium = 0, low = 0, none = 0
  let errors = 0

  for (let i = 0; i < work.length; i++) {
    const p = work[i]
    const brand = p.brand_id ? brands.get(p.brand_id) : null
    const idx = `[${i + 1}/${work.length}]`

    try {
      const { resolution, candidates } = await resolveOne(p, brand?.slug ?? null)
      if (resolution) {
        const flag = resolution.confidence === 'high'   ? '✓'
                   : resolution.confidence === 'medium' ? '~'
                   : resolution.confidence === 'low'    ? '?'
                                                        : '·'
        console.log(`${idx} ${flag} ${p.slug.padEnd(30)} → CSP ${resolution.csp_id} (${resolution.confidence}, ${resolution.score})  ${resolution.title.slice(0, 60)}`)
        if      (resolution.confidence === 'high')   high++
        else if (resolution.confidence === 'medium') medium++
        else if (resolution.confidence === 'low')    low++
        else                                          none++
      } else {
        console.log(`${idx} · ${p.slug.padEnd(30)} → no CSP candidates`)
        none++
      }
      await writeBack(p, resolution, candidates)
      if (resolution) resolved++
    } catch (err) {
      console.error(`${idx} ✗ ${p.slug}: ${(err as Error).message}`)
      errors++
    }

    if (i < work.length - 1) await sleep(RATE_LIMIT_MS)
  }

  console.log()
  console.log('─'.repeat(60))
  console.log(`Done. Resolved ${resolved}/${work.length}.`)
  console.log(`   high=${high}  medium=${medium}  low=${low}  none=${none}  errors=${errors}`)
}

main().catch((err: unknown) => {
  console.error(`\n❌  ${(err as Error).message ?? err}`)
  process.exit(1)
})
