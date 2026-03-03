/**
 * scripts/scrape-vintagesynth.ts
 *
 * Scrapes vintagesynth.com for all brands and instruments and merges them
 * into data/knowledge-graph.json under the `music-gear` category.
 *
 * Strategy:
 *   1. Fetch one brand taxonomy page to extract all 800+ instrument URLs
 *      from the embedded JS blob (no per-brand pagination needed).
 *   2. For each instrument page, extract name, type and era from JSON-LD
 *      and page content.
 *   3. Merge new entries into the knowledge graph (never overwrites existing).
 *
 * Usage:
 *   npm run scrape-vse                      # full run
 *   npm run scrape-vse -- --dry-run         # preview only
 *   npm run scrape-vse -- --brand=roland    # single brand
 *   npm run scrape-vse -- --limit=20        # max instruments total
 *
 * Output:
 *   data/knowledge-graph.json  (updated in place)
 *   scripts/vse-scrape-log.json (per-run audit log)
 */

import * as fs   from 'fs'
import * as path from 'path'

// ── CLI flags ─────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2)
const DRY_RUN  = args.includes('--dry-run')
const brandArg = args.find(a => a.startsWith('--brand='))?.split('=')[1]?.toLowerCase() ?? null
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1]
const LIMIT    = limitArg ? parseInt(limitArg, 10) : Infinity

// Delay between instrument page fetches (ms) — be polite
const FETCH_DELAY = 250

const BASE_URL    = 'https://www.vintagesynth.com'
// Any brand taxonomy page works — all instrument URLs are embedded in every page's JS
const SEED_URL    = `${BASE_URL}/taxonomy/term/841`  // Roland page

// ── Paths ─────────────────────────────────────────────────────────────────────
const KG_PATH  = path.resolve(__dirname, '../data/knowledge-graph.json')
const LOG_PATH = path.resolve(__dirname, 'vse-scrape-log.json')

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[áàâä]/g, 'a')
    .replace(/[éèêë]/g, 'e')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// ── Site catalogue ─────────────────────────────────────────────────────────────
interface VseEntry {
  key:       string   // numeric node id from VSE
  title:     string   // raw title from JS  e.g. "01/W"
  url:       string   // absolute URL       e.g. "https://www.vintagesynth.com/korg/01w"
  brandSlug: string   // e.g. "korg"
  modelSlug: string   // e.g. "01w"
}

/**
 * Fetch all instrument entries from the embedded JS blob on any VSE page.
 * Returns ~890 entries across all brands.
 */
async function fetchCatalogue(): Promise<VseEntry[]> {
  const html = await fetch(SEED_URL).then(r => r.text())

  const pattern = /\{"title":"([^"]+)","url":"([^"]+)","key":"(\d+)"\}/g
  const entries: VseEntry[] = []

  for (const m of html.matchAll(pattern)) {
    const title   = m[1].replace(/\\'/g, "'").trim()
    const rawUrl  = m[2].replace(/\\\//g, '/')
    const key     = m[3]

    // Skip non-instrument paths
    if (!rawUrl.includes('vintagesynth.com/')) continue
    const rel = rawUrl.replace(/^https?:\/\/www\.vintagesynth\.com/, '')
    const parts = rel.split('/').filter(Boolean)
    if (parts.length !== 2) continue
    if (parts[0].startsWith('taxonomy') || parts[0].startsWith('node')) continue

    entries.push({
      key,
      title,
      url:       rawUrl,
      brandSlug: parts[0],
      modelSlug: parts[1],
    })
  }

  // Deduplicate by URL
  const seen  = new Set<string>()
  return entries.filter(e => {
    if (seen.has(e.url)) return false
    seen.add(e.url)
    return true
  })
}

// ── Instrument page parser ─────────────────────────────────────────────────────
interface VseInstrument {
  name:          string
  brandSlug:     string
  modelSlug:     string
  type:          string
  era:           string
  reference_url: string
  productKey:    string  // e.g. "roland-juno-60"
}

/** Keyword → instrument type */
function inferType(keywords: string): string {
  const kw = keywords.toLowerCase()
  if (/drum machine|drum computer/.test(kw))     return 'drum machine'
  if (/sampler/.test(kw))                        return 'sampler'
  if (/sequencer/.test(kw) && !/synth/.test(kw)) return 'sequencer'
  if (/workstation/.test(kw))                    return 'workstation'
  if (/groovebox|groove box/.test(kw))           return 'groovebox'
  if (/vocoder/.test(kw))                        return 'vocoder'
  if (/organ/.test(kw))                          return 'organ'
  if (/expander|module/.test(kw))                return 'module'
  if (/software|virtual/.test(kw))              return 'software synth'
  if (/effects/.test(kw) && !/keyboard/.test(kw)) return 'effects processor'
  return 'synthesizer'
}

/** Parse a VSE instrument page and return structured data */
async function parseInstrumentPage(entry: VseEntry): Promise<VseInstrument | null> {
  let html: string
  try {
    const res = await fetch(entry.url)
    if (!res.ok) return null
    html = await res.text()
  } catch {
    return null
  }

  // JSON-LD for name + type
  const jsonLdMatch = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/)
  if (!jsonLdMatch) return null

  let jsonLd: Record<string, unknown>
  try { jsonLd = JSON.parse(jsonLdMatch[1]) } catch { return null }

  const headline = (jsonLd['headline'] as string | undefined)?.trim()
  if (!headline) return null

  const keywords = (jsonLd['keywords'] as string | undefined) ?? ''
  const type     = inferType(keywords)

  // Era: look in body text for explicit production years
  const era = extractEra(html)

  return {
    name:          headline,
    brandSlug:     entry.brandSlug,
    modelSlug:     entry.modelSlug,
    type,
    era,
    reference_url: entry.url,
    productKey:    `${entry.brandSlug}-${entry.modelSlug}`,
  }
}

/** Extract production era from page HTML */
function extractEra(html: string): string {
  // Strip tags for text analysis
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')

  // Skip the first 500 and last 1000 chars (nav/copyright noise)
  const body = text.slice(500, text.length - 1000)

  // 1) Production year range in body: "1982-1984", "1982 to 1984"
  const rangeRe = /\b(19[5-9]\d|20[012]\d)\s*[-–to]+\s*(19[5-9]\d|20[012]\d)\b/g
  for (const m of body.matchAll(rangeRe)) {
    const a = parseInt(m[1]), b = parseInt(m[2])
    // Exclude site copyright range (1996-2024 style) and suspiciously wide ranges
    if (a === 1996 && b >= 2020) continue
    if (b - a > 30) continue
    if (a >= 1960 && b <= 2030) return `${m[1]}-${m[2]}`
  }

  // 2) Explicit intro/release year
  const introRe = /(?:introduced|released|launched|produced|manufactured|first appeared|built|designed|debuted)[^.]{0,60}\b(19[5-9]\d|20[012]\d)\b/i
  const introMatch = body.match(introRe)
  if (introMatch) return introMatch[1]

  // 3) Any instrument-era year in the body
  const yearRe = /\b(19[6-9]\d|20[01]\d)\b/g
  const candidates: number[] = []
  for (const m of body.matchAll(yearRe)) {
    const y = parseInt(m[1])
    if (y >= 1963 && y <= 2025) candidates.push(y)
  }
  if (candidates.length > 0) {
    const freq = new Map<number, number>()
    for (const y of candidates) freq.set(y, (freq.get(y) ?? 0) + 1)
    // Pick the most frequently mentioned year
    const [top] = [...freq.entries()].sort((a, b) => b[1] - a[1])
    if (top && top[1] >= 2) return String(top[0])
  }

  return ''
}

// ── Knowledge Graph types ──────────────────────────────────────────────────────
interface KgProduct {
  name:           string
  type:           string
  era?:           string
  related?:       string[]
  clones?:        string[]
  reference_url:  string
  price_range_dkk?: [number, number]
}
interface KgBrand    { products: Record<string, KgProduct>; note?: string }
interface KgCategory { brands: Record<string, KgBrand> }
interface KnowledgeGraph {
  version:     string
  description: string
  categories:  Record<string, KgCategory>
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`🎹  Vintage Synth Explorer scraper${DRY_RUN ? ' (DRY RUN)' : ''}`)
  if (brandArg) console.log(`    Brand filter: ${brandArg}`)
  if (LIMIT !== Infinity) console.log(`    Limit: ${LIMIT}`)
  console.log()

  // Load existing KG
  const kg: KnowledgeGraph = JSON.parse(fs.readFileSync(KG_PATH, 'utf8'))
  const musicGear = kg.categories['music-gear']
  if (!musicGear) { console.error('❌  music-gear category not found'); process.exit(1) }

  // Fetch full instrument catalogue from embedded JS
  console.log('Fetching instrument catalogue from VSE…')
  const catalogue = await fetchCatalogue()
  console.log(`Found ${catalogue.length} instruments.\n`)

  // Filter by brand if requested
  const entries = brandArg
    ? catalogue.filter(e => e.brandSlug === brandArg)
    : catalogue

  if (brandArg && entries.length === 0) {
    console.error(`❌  No instruments found for brand: ${brandArg}`)
    console.error('Available brands:', [...new Set(catalogue.map(e => e.brandSlug))].sort().join(', '))
    process.exit(1)
  }

  let totalAdded   = 0
  let totalSkipped = 0
  let totalErrors  = 0
  const log: Array<{ productKey: string; name?: string; status: string }> = []

  // Group by brand for nicer output
  const byBrand = new Map<string, VseEntry[]>()
  for (const e of entries) {
    const list = byBrand.get(e.brandSlug) ?? []
    list.push(e)
    byBrand.set(e.brandSlug, list)
  }

  let processed = 0

  for (const [brandSlug, brandEntries] of byBrand) {
    // Ensure brand bucket exists
    if (!musicGear.brands[brandSlug]) {
      musicGear.brands[brandSlug] = { products: {} }
    }

    console.log(`\n── ${brandSlug} (${brandEntries.length} instruments) ──`)

    for (const entry of brandEntries) {
      if (processed >= LIMIT) break

      // Skip if already in KG
      const productKey = `${entry.brandSlug}-${entry.modelSlug}`
      if (musicGear.brands[brandSlug].products[productKey]) {
        totalSkipped++
        log.push({ productKey, name: entry.title, status: 'skipped' })
        continue
      }

      await sleep(FETCH_DELAY)
      const instrument = await parseInstrumentPage(entry)

      if (!instrument) {
        console.log(`   ⚠️  Parse failed: ${entry.url}`)
        totalErrors++
        log.push({ productKey, status: 'error' })
        continue
      }

      const kgEntry: KgProduct = {
        name:          instrument.name,
        type:          instrument.type,
        ...(instrument.era ? { era: instrument.era } : {}),
        related:       [],
        clones:        [],
        reference_url: instrument.reference_url,
      }

      musicGear.brands[brandSlug].products[productKey] = kgEntry
      totalAdded++
      processed++

      const eraStr = instrument.era ? ` (${instrument.era})` : ''
      console.log(`   ✅  ${instrument.name} [${instrument.type}]${eraStr}`)
      log.push({ productKey, name: instrument.name, status: 'added' })
    }

    if (processed >= LIMIT) break
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60))
  console.log(`Added: ${totalAdded}  Skipped: ${totalSkipped}  Errors: ${totalErrors}`)
  console.log('═'.repeat(60))

  if (!DRY_RUN && totalAdded > 0) {
    const [major, minor, patch] = (kg.version ?? '1.0.0').split('.').map(Number)
    kg.version = `${major}.${minor + 1}.${patch ?? 0}`

    fs.writeFileSync(KG_PATH, JSON.stringify(kg, null, 2))
    console.log(`\n✅  knowledge-graph.json updated (v${kg.version})`)

    fs.writeFileSync(LOG_PATH, JSON.stringify({
      ran_at:  new Date().toISOString(),
      added:   totalAdded,
      skipped: totalSkipped,
      errors:  totalErrors,
      entries: log,
    }, null, 2))
    console.log(`📝  Log: ${LOG_PATH}`)
  } else if (DRY_RUN) {
    console.log('\n(Dry run — no files written)')
  } else {
    console.log('\n(Nothing new to add)')
  }
}

main().catch((err: unknown) => {
  console.error('❌', (err as Error).message ?? err)
  process.exit(1)
})
