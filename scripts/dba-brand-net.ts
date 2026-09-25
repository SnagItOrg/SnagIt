/**
 * scripts/dba-brand-net.ts — PAN-151. dba.dk brand net, DRY RUN ONLY.
 *
 * Casts a brand query over dba.dk, resolves every listing into one of five
 * states (scripts/lib/brand-net-resolution.ts) and writes a local candidate
 * report. It is a demand instrument, not an ingestion path:
 *
 *   - NO database write of any kind. The Supabase client is used for SELECTs
 *     only (the knowledge graph, and which dba URLs we already hold).
 *   - NO `kg_product` row is ever created. Candidates are a report for a human
 *     (merge-not-create; CLAUDE.md scraping lesson 1).
 *   - `--dry-run` is the only mode. Without it the script refuses.
 *
 * Three commands, so live requests are spent once and the resolution can be
 * re-run offline as often as needed:
 *
 *   sweep   fetch one query to a local raw JSON file (the only command that
 *           touches dba.dk)
 *   report  resolve one or more raw files and write the candidate report
 *   scope   the owner's caveat: compare an all-categories raw file against a
 *           scoped one for the same query
 *
 * Usage:
 *   npx tsx scripts/dba-brand-net.ts sweep --dry-run --q=roland --brand=roland \
 *     --sub-category=1.86.92 --sort=PUBLISHED_DESC --out=/tmp/roland.raw.json \
 *     [--known-from=<raw.json> --stop-after-known=K] [--ledger=<file> --budget=150]
 *   npx tsx scripts/dba-brand-net.ts report --dry-run --out-dir=/tmp/net a.raw.json b.raw.json
 *   npx tsx scripts/dba-brand-net.ts scope --dry-run --scoped=<raw> --all=<raw> [--hobby=<raw>]
 */

import * as fs from 'fs'
import * as path from 'path'
import dotenv from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  DBA_CONFIG,
  fetchSchibstedPage,
  buildSchibstedSearchUrl,
  type SchibstedSearchOptions,
  type SchibstedSort,
} from '../frontend/lib/scrapers/schibsted'
import {
  normalizeProductRow,
  PRODUCT_SELECT,
  type Product,
} from '../frontend/lib/matching/match-listings'
import {
  buildBrandNetContext,
  resolveBrandNetListing,
  type BrandNetResolution,
} from './lib/brand-net-resolution'

// ── CLI ─────────────────────────────────────────────────────────────────────
const [command, ...rest] = process.argv.slice(2)
const flag = (name: string) => rest.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const positional = rest.filter((a) => !a.startsWith('--'))

if (!rest.includes('--dry-run')) {
  console.error('[dba-brand-net] REFUSING: --dry-run is the only mode (PAN-151). Nothing was fetched or written.')
  process.exit(1)
}

// scripts/CLAUDE.md: >= 2s plus jitter. dba.dk gets 3–5s, as in scrape-dba.ts.
const DELAY_MIN_MS = 3000
const DELAY_JITTER_MS = 2000
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ── Raw sweep file ──────────────────────────────────────────────────────────
interface RawItem {
  id: string
  title: string
  description: string | null
  price: number | null
  url: string
  /** 1-based position in the sweep, i.e. the site's own order under `sort`. */
  position: number
  page: number
}

interface RawSweep {
  query: string
  brand: string
  options: SchibstedSearchOptions
  fetched_at: string
  requests: number
  termination: string
  pages: number
  items: RawItem[]
}

function listingId(url: string): string {
  return url.match(/\/item\/(\d+)/)?.[1] ?? url.match(/\/id-(\d+)/)?.[1] ?? url
}

// ── Request ledger: one line per live request, shared across invocations ────
function ledgerCount(file: string | undefined): number {
  if (!file || !fs.existsSync(file)) return 0
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).length
}

async function sweep(): Promise<void> {
  const q = flag('q')
  const brand = flag('brand')?.toLowerCase()
  const out = flag('out')
  if (!q || !brand || !out) throw new Error('sweep needs --q, --brand and --out')
  const options: SchibstedSearchOptions = {
    subCategory: flag('sub-category'),
    category: flag('category'),
    sort: flag('sort') as SchibstedSort | undefined,
  }
  const maxPages = Number(flag('max-pages') ?? 40)
  const ledger = flag('ledger')
  const budget = Number(flag('budget') ?? Infinity)
  const knownFrom = flag('known-from')
  const stopAfterKnown = Number(flag('stop-after-known') ?? 0)
  if (knownFrom && !stopAfterKnown) throw new Error('--known-from needs --stop-after-known=K')
  const known = knownFrom
    ? new Set((JSON.parse(fs.readFileSync(knownFrom, 'utf8')) as RawSweep).items.map((i) => i.id))
    : null

  const items: RawItem[] = []
  const seen = new Set<string>()
  let requests = 0
  let termination = 'max_pages_hit'
  let consecutiveKnown = 0
  let page = 1

  for (; page <= maxPages; page++) {
    if (ledgerCount(ledger) + 1 > budget) { termination = 'budget_exhausted'; break }
    if (page > 1) await sleep(DELAY_MIN_MS + Math.random() * DELAY_JITTER_MS)

    const url = buildSchibstedSearchUrl(DBA_CONFIG, q, page, options)
    const res = await fetchSchibstedPage(DBA_CONFIG, q, page, options)
    requests++
    if (ledger) fs.appendFileSync(ledger, `${new Date().toISOString()} ${url}\n`)
    console.log(`  page ${page}: schema=${res.schemaValid} raw=${res.rawCount} parsed=${res.listings.length}`)

    // Past the last page the CollectionPage block is simply absent — the same
    // signal schibsted.ts reads as `no_next_token`. Page 1 absent = broken.
    if (!res.schemaValid) { termination = page === 1 ? 'error_page1_schema' : 'no_next_token'; break }
    if (res.rawCount === 0) { termination = 'empty_page'; break }

    let stop = false
    for (const l of res.listings) {
      const id = listingId(l.url)
      if (seen.has(id)) continue
      seen.add(id)
      items.push({
        id, title: l.title, description: res.descriptions.get(l.url) ?? null,
        price: l.price, url: l.url, position: items.length + 1, page,
      })
      if (known) {
        consecutiveKnown = known.has(id) ? consecutiveKnown + 1 : 0
        if (consecutiveKnown >= stopAfterKnown) { stop = true; break }
      }
    }
    if (stop) { termination = `delta_${stopAfterKnown}_known`; break }
  }

  const raw: RawSweep = {
    query: q, brand, options, fetched_at: new Date().toISOString(),
    requests, termination, pages: Math.min(page, maxPages), items,
  }
  fs.writeFileSync(out, JSON.stringify(raw, null, 2))
  console.log(`[sweep] q=${q} ${JSON.stringify(options)} → ${items.length} unique, ${requests} requests, ` +
              `termination=${termination}, ledger total=${ledgerCount(ledger)}`)
}

// ── Read-only knowledge graph + "already ours" ──────────────────────────────
function supabase(): SupabaseClient {
  for (const p of [path.resolve(__dirname, '../.env.local'), path.resolve(__dirname, '../frontend/.env.local')]) {
    if (fs.existsSync(p)) { dotenv.config({ path: p }); break }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

async function selectAll<T>(build: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> }): Promise<T[]> {
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

async function loadKnowledgeGraph(sb: SupabaseClient) {
  const raw = await selectAll<Parameters<typeof normalizeProductRow>[0]>(
    () => sb.from('kg_product').select(PRODUCT_SELECT).order('id'))
  const products: Product[] = raw.map(normalizeProductRow)
  const idents = await selectAll<{ product_id: string; type: string; value: string }>(
    () => sb.from('kg_identifier').select('product_id, type, value').in('type', ['SKU', 'MODEL']).order('product_id'))
  const synonyms = await selectAll<{ alias: string; canonical_query: string | null }>(
    () => sb.from('synonym').select('alias, canonical_query').eq('match_type', 'alias').order('alias'))
  return { products, idents, synonyms }
}

async function loadKnownDbaIds(sb: SupabaseClient): Promise<Set<string>> {
  const rows = await selectAll<{ url: string | null }>(
    () => sb.from('listings').select('url').eq('source', 'dba.dk').order('id'))
  return new Set(rows.map((r) => (r.url ? listingId(r.url) : '')).filter(Boolean))
}

// ── report ──────────────────────────────────────────────────────────────────
interface Resolved extends RawItem {
  brand: string
  resolution: BrandNetResolution
  ours: boolean
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

async function report(): Promise<void> {
  const outDir = flag('out-dir')
  if (!outDir || positional.length === 0) throw new Error('report needs --out-dir and one or more raw files')
  fs.mkdirSync(outDir, { recursive: true })

  const sb = supabase()
  const kg = await loadKnowledgeGraph(sb)
  const ctx = buildBrandNetContext(kg.products, kg.idents, kg.synonyms)
  const ours = await loadKnownDbaIds(sb)
  const productById = new Map(kg.products.map((p) => [p.id, p]))

  const resolved: Resolved[] = []
  for (const file of positional) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as RawSweep
    for (const item of raw.items) {
      resolved.push({
        ...item, brand: raw.brand, ours: ours.has(item.id),
        resolution: resolveBrandNetListing({ title: item.title, description: item.description }, raw.brand, ctx),
      })
    }
  }
  fs.writeFileSync(path.join(outDir, 'resolved.json'), JSON.stringify(resolved, null, 2))

  const KINDS = ['kg_product', 'candidate', 'family_only', 'brand_only', 'noise'] as const
  const brands = Array.from(new Set(resolved.map((r) => r.brand)))
  const split: Record<string, Record<string, number>> = {}
  const newToUs: Record<string, { kg_product: number; kg_product_new: number; all: number; all_new: number }> = {}
  const candidates: Record<string, Array<{ model: string; listings: number; example_title: string; example_url: string; median_price_dkk: number | null }>> = {}
  const kgProducts: Record<string, Array<{ slug: string; supported: boolean; listings: number; new_to_us: number; via: string }>> = {}

  for (const brand of brands) {
    const rows = resolved.filter((r) => r.brand === brand)
    split[brand] = Object.fromEntries(KINDS.map((k) => [k, rows.filter((r) => r.resolution.kind === k).length]))
    split[brand].total = rows.length
    const kgRows = rows.filter((r) => r.resolution.kind === 'kg_product')
    newToUs[brand] = {
      kg_product: kgRows.length, kg_product_new: kgRows.filter((r) => !r.ours).length,
      all: rows.length, all_new: rows.filter((r) => !r.ours).length,
    }

    // Grouped by the normalised model, so `MF-108M` and `MF-108-M` are one row.
    const byModel = new Map<string, Resolved[]>()
    for (const r of rows) {
      if (r.resolution.kind !== 'candidate') continue
      const key = r.resolution.model.replace(/[^a-z0-9]/g, '')
      const list = byModel.get(key) ?? []
      list.push(r)
      byModel.set(key, list)
    }
    candidates[brand] = Array.from(byModel.values())
      .map((list) => ({
        model: (list[0].resolution as { model: string }).model, listings: list.length,
        example_title: list[0].title, example_url: list[0].url,
        median_price_dkk: median(list.map((l) => l.price).filter((p): p is number => p != null && p > 0)),
      }))
      .sort((a, b) => b.listings - a.listings || a.model.localeCompare(b.model))

    const bySlug = new Map<string, { rows: Resolved[]; via: Set<string> }>()
    for (const r of kgRows) {
      if (r.resolution.kind !== 'kg_product') continue
      const slug = r.resolution.productIds.map((id) => productById.get(id)?.slug ?? id).sort().join(' | ')
      const entry = bySlug.get(slug) ?? { rows: [], via: new Set<string>() }
      entry.rows.push(r)
      entry.via.add(r.resolution.via)
      bySlug.set(slug, entry)
    }
    kgProducts[brand] = Array.from(bySlug.entries())
      .map(([slug, e]) => ({
        slug,
        supported: slug.split(' | ').every((s) => kg.products.find((p) => p.slug === s)?.support_state === 'supported'),
        listings: e.rows.length, new_to_us: e.rows.filter((r) => !r.ours).length, via: Array.from(e.via).join(','),
      }))
      .sort((a, b) => b.listings - a.listings)
  }

  const summary = { generated_at: new Date().toISOString(), inputs: positional, split, new_to_us: newToUs, candidates, kg_products: kgProducts }
  fs.writeFileSync(path.join(outDir, 'candidate-report.json'), JSON.stringify(summary, null, 2))
  fs.writeFileSync(path.join(outDir, 'candidate-report.md'), renderMarkdown(summary))
  console.log(JSON.stringify({ split, new_to_us: newToUs }, null, 2))
  console.log(`[report] wrote ${outDir}/candidate-report.{json,md} and resolved.json`)
}

function renderMarkdown(s: {
  split: Record<string, Record<string, number>>
  candidates: Record<string, Array<{ model: string; listings: number; example_title: string; median_price_dkk: number | null }>>
}): string {
  const lines: string[] = ['# dba.dk brand net — candidate models (PAN-151, dry run)', '']
  for (const [brand, split] of Object.entries(s.split)) {
    lines.push(`## ${brand}`, '')
    lines.push(`Split of ${split.total}: kg_product ${split.kg_product} · candidate ${split.candidate} · ` +
               `family_only ${split.family_only} · brand_only ${split.brand_only} · noise ${split.noise}`, '')
    lines.push('| model | listings | median DKK | example title |', '|---|---:|---:|---|')
    for (const c of s.candidates[brand] ?? []) {
      lines.push(`| ${c.model} | ${c.listings} | ${c.median_price_dkk ?? '—'} | ${c.example_title.replace(/\|/g, '/')} |`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

// ── scope: the owner's caveat ───────────────────────────────────────────────
async function scope(): Promise<void> {
  const scopedFile = flag('scoped')
  const allFile = flag('all')
  const hobbyFile = flag('hobby')
  if (!scopedFile || !allFile) throw new Error('scope needs --scoped and --all')
  const scoped = JSON.parse(fs.readFileSync(scopedFile, 'utf8')) as RawSweep
  const all = JSON.parse(fs.readFileSync(allFile, 'utf8')) as RawSweep
  const hobby = hobbyFile ? (JSON.parse(fs.readFileSync(hobbyFile, 'utf8')) as RawSweep) : null

  const sb = supabase()
  const kg = await loadKnowledgeGraph(sb)
  const ctx = buildBrandNetContext(kg.products, kg.idents, kg.synonyms)
  const resolve = (i: RawItem) => resolveBrandNetListing({ title: i.title, description: i.description }, all.brand, ctx)
  const key = (r: BrandNetResolution) => (r.kind === 'kg_product' ? r.productIds.slice().sort().join('|') : null)

  const scopedIds = new Set(scoped.items.map((i) => i.id))
  const hobbyIds = hobby ? new Set(hobby.items.map((i) => i.id)) : null
  // The product the QUERY is about: the most common resolution in scope.
  const counts = new Map<string, number>()
  for (const i of scoped.items) { const k = key(resolve(i)); if (k) counts.set(k, (counts.get(k) ?? 0) + 1) }
  const target = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const resolvingScoped = scoped.items.filter((i) => key(resolve(i)) === target)
  const outside = all.items.filter((i) => !scopedIds.has(i.id))
  const resolvingOutside = outside.filter((i) => key(resolve(i)) === target)
  const scopedMedian = median(resolvingScoped.map((i) => i.price).filter((p): p is number => p != null && p > 0))

  const result = {
    query: all.query, brand: all.brand, target_product_ids: target,
    all_categories: all.items.length, scoped: scoped.items.length,
    resolving_scoped: resolvingScoped.length, resolving_outside: resolvingOutside.length,
    scoped_median_dkk: scopedMedian,
    outside_resolving: resolvingOutside.map((i) => ({
      title: i.title, price: i.price, url: i.url,
      where: hobbyIds ? (hobbyIds.has(i.id) ? 'underholdning-og-hobby (0.86), not Musikinstrumenter' : 'outside 0.86') : 'unknown',
      below_scoped_median_pct: scopedMedian && i.price ? Math.round((1 - i.price / scopedMedian) * 100) : null,
    })),
    // Every outside listing and what it resolved to, for the human reading this.
    outside_all: outside.map((i) => {
      const r = resolve(i)
      return { title: i.title, price: i.price, resolution: r.kind === 'noise' ? `noise:${r.reason}` : r.kind }
    }),
    // Scoped listings the all-categories sweep did not return — offset
    // pagination over a live index drops rows, so this should be ~0.
    scoped_missing_from_all: scoped.items.filter((i) => !all.items.some((a) => a.id === i.id)).length,
  }
  console.log(JSON.stringify(result, null, 2))
  const out = flag('out')
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2))
}

const commands: Record<string, () => Promise<void>> = { sweep, report, scope }
const run = commands[command ?? '']
if (!run) {
  console.error(`[dba-brand-net] unknown command '${command}'. Use sweep | report | scope.`)
  process.exit(1)
}
run().catch((e) => {
  console.error('[dba-brand-net] failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
