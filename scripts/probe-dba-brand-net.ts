/**
 * scripts/probe-dba-brand-net.ts — PAN-125 dry-run probe. READ-ONLY.
 *
 * Fetches one dba.dk brand search and writes the parsed results to a local
 * JSON file. It has NO database client, NO supabase import and NO write path
 * of any kind: the only output is the file named by --out.
 *
 * Why this does not reuse frontend/lib/scrapers/dba.ts, which would otherwise
 * fit (see PAN-125 report):
 *   1. `schibsted.ts` hardcodes a Chrome User-Agent string. This probe is
 *      required to identify itself honestly, and dba.dk serves it happily.
 *   2. `fetchSchibstedPage()` builds `search?q=...` only. It has no category
 *      parameter, so the owner's own query (`category=0.86`) cannot be
 *      expressed through it at all.
 * The JSON-LD CollectionPage extraction below is deliberately the same shape
 * as the one in `schibsted.ts`, so results stay comparable.
 *
 * Usage:
 *   npx tsx scripts/probe-dba-brand-net.ts --q=roland --category=0.86 --out=/tmp/x.json
 */

const args = process.argv.slice(2)
const arg = (name: string, fallback?: string) =>
  args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback

const QUERY = arg('q', 'roland')!
const CATEGORY = arg('category', '0.86')!
const OUT = arg('out', '/tmp/dba-brand-probe.json')!
const MAX_PAGES = parseInt(arg('max-pages', '40')!, 10)

// scripts/CLAUDE.md: >= 2s between requests plus jitter, no exceptions.
// dba.dk is the bot-sensitive host, so match scrape-dba.ts's 3-5s.
const DELAY_MIN_MS = 3000
const DELAY_JITTER_MS = 2000

const USER_AGENT =
  'KlupBot/0.1 (+https://www.klup.dk; PAN-125 read-only capacity probe; contact owner@panter.media)'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

type Item = {
  title: string
  url: string
  price: number | null
  currency: string
  description: string | null
  image_url: string | null
  page: number
}

type PageResult = {
  page: number
  httpStatus: number
  schemaValid: boolean
  rawCount: number
  items: Item[]
  totalResultsLabel: string | null
}

function extractListingId(url: string): string {
  return url.match(/\/item\/(\d+)/)?.[1] ?? url.match(/\/id-(\d+)/)?.[1] ?? url
}

async function fetchPage(page: number): Promise<PageResult> {
  const url =
    `https://www.dba.dk/recommerce/forsale/search?${CATEGORY.startsWith("1.") ? "sub_" : ""}category=${CATEGORY}` +
    `&q=${QUERY.replace(/ /g, '+')}${page > 1 ? `&page=${page}` : ''}`

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'da-DK,da;q=0.9' },
  })
  if (!res.ok) {
    return { page, httpStatus: res.status, schemaValid: false, rawCount: 0, items: [], totalResultsLabel: null }
  }
  const html = await res.text()

  const totalResultsLabel = html.match(/(\d[\d.\s]*)\s*(?:annoncer|resultater)/)?.[1]?.trim() ?? null

  let collection: Record<string, unknown> | null = null
  const blocks = html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)
  for (const b of blocks) {
    try {
      const parsed = JSON.parse(b[1]) as Record<string, unknown>
      if (parsed?.['@type'] === 'CollectionPage') collection = parsed
    } catch {
      /* skip malformed */
    }
  }
  if (!collection) {
    return { page, httpStatus: res.status, schemaValid: false, rawCount: 0, items: [], totalResultsLabel }
  }

  const mainEntity = collection['mainEntity'] as Record<string, unknown> | undefined
  const list = mainEntity?.['itemListElement'] as unknown[] | undefined
  if (!Array.isArray(list)) {
    return { page, httpStatus: res.status, schemaValid: false, rawCount: 0, items: [], totalResultsLabel }
  }

  const items = list
    .map((entry): Item | null => {
      const p = (entry as Record<string, unknown>)['item'] as Record<string, unknown> | undefined
      if (!p?.['url'] || !p?.['name']) return null
      const offers = p['offers'] as Record<string, unknown> | undefined
      const raw = offers?.['price']
      const n = raw != null ? parseInt(String(raw), 10) : NaN
      return {
        title: String(p['name']),
        url: String(p['url']),
        price: Number.isNaN(n) ? null : n,
        currency: String(offers?.['priceCurrency'] ?? 'DKK'),
        description: p['description'] ? String(p['description']) : null,
        image_url: p['image'] ? String(p['image']) : null,
        page,
      }
    })
    .filter((i): i is Item => i !== null)

  return { page, httpStatus: res.status, schemaValid: true, rawCount: list.length, items, totalResultsLabel }
}

async function main() {
  console.log(`probe: q=${QUERY} category=${CATEGORY} maxPages=${MAX_PAGES}`)
  console.log(`probe: UA=${USER_AGENT}`)

  const pages: Omit<PageResult, 'items'>[] = []
  const all: Item[] = []
  const signatures = new Map<string, number>()
  let termination = 'unknown'

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await sleep(DELAY_MIN_MS + Math.random() * DELAY_JITTER_MS)

    let r: PageResult
    try {
      r = await fetchPage(page)
    } catch (e) {
      termination = `error: ${e instanceof Error ? e.message : String(e)}`
      break
    }

    const { items, ...meta } = r
    pages.push(meta)
    console.log(
      `  page ${page}: HTTP ${r.httpStatus} schema=${r.schemaValid} raw=${r.rawCount} parsed=${items.length}` +
        (r.totalResultsLabel ? ` total="${r.totalResultsLabel}"` : ''),
    )

    if (r.httpStatus !== 200) { termination = `http_${r.httpStatus}`; break }
    if (!r.schemaValid) { termination = page === 1 ? 'error_page1_schema' : 'no_next_token'; break }
    if (r.rawCount === 0) { termination = 'empty_page'; break }

    const sig = items.map(i => i.url).join('|')
    if (signatures.has(sig)) { termination = `repeat_of_page_${signatures.get(sig)}`; break }
    signatures.set(sig, page)

    all.push(...items)
    if (page === MAX_PAGES) termination = 'max_pages_hit'
  }

  const seen = new Set<string>()
  const deduped = all.filter(i => {
    const id = extractListingId(i.url)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })

  const out = {
    query: QUERY,
    category: CATEGORY,
    fetched_at: new Date().toISOString(),
    user_agent: USER_AGENT,
    termination,
    pages,
    raw_items: all.length,
    unique_items: deduped.length,
    items: deduped,
  }
  require('fs').writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`probe: ${all.length} raw, ${deduped.length} unique, termination=${termination}`)
  console.log(`probe: wrote ${OUT}`)
}

main().catch(e => {
  console.error('probe failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
