/**
 * Scrapes Thomann search results for a given query.
 *
 * Thomann renders results via a JS bootstrap call:
 *   tho.bootstrapModule('search.index', [{articles: [...]}], {})
 *
 * We extract the JSON from that call and parse each article for:
 *   title, price, product URL, thumbnail image
 *
 * Results are upserted into thomann_product by the caller.
 */

const BASE_URL = 'https://www.thomannmusic.com'
const IMAGE_BASE = 'https://fast-images.static-thomann.de/pics/images'
const MAX_RESULTS = 5
const TIMEOUT_MS = 10_000

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'da-DK,da;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': BASE_URL + '/',
}

export type ThomannProduct = {
  thomann_url:    string
  canonical_name: string
  image_url:      string | null
  price_dkk:      number | null
}

// ── Parse the bootstrap JSON ──────────────────────────────────────────────────

interface ThomannArticle {
  texts?:      { title?: string }
  price?:      { primary?: { rawPrice?: string | number } }
  relativeLink?: string
  mainImage?:  { fileName?: string }
}

function extractBootstrapArray(html: string): string | null {
  // Find the start of tho.bootstrapModule('search.index', [
  const marker = html.indexOf("bootstrapModule('search.index'")
  if (marker === -1) return null

  // Find the opening bracket of the data array
  const bracketStart = html.indexOf('[', marker)
  if (bracketStart === -1) return null

  // Walk forward tracking bracket depth to find the matching close bracket
  let depth = 0
  for (let i = bracketStart; i < html.length; i++) {
    const ch = html[i]
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return html.slice(bracketStart, i + 1)
    }
  }
  return null
}

function parseBootstrap(html: string): ThomannProduct[] {
  const raw = extractBootstrapArray(html)
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return []

  const first = parsed[0] as Record<string, unknown>
  const articles = first['articles']
  if (!Array.isArray(articles)) return []

  const results: ThomannProduct[] = []

  for (const article of articles as ThomannArticle[]) {
    const title = article.texts?.title?.trim()
    if (!title) continue

    const relLink = article.relativeLink
    if (!relLink) continue

    // Strip any query params (e.g. ?type=quickSearch) from the relative link
    const cleanPath = relLink.split('?')[0]
    const thomann_url = `${BASE_URL}/${cleanPath}`

    const rawPrice = article.price?.primary?.rawPrice
    const price_dkk = rawPrice != null ? Math.round(parseFloat(String(rawPrice))) : null

    const fileName = article.mainImage?.fileName
    const image_url = fileName ? `${IMAGE_BASE}/${fileName}` : null

    results.push({ thomann_url, canonical_name: title, image_url, price_dkk })

    if (results.length >= MAX_RESULTS) break
  }

  return results
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function scrapeThomannSearch(query: string): Promise<ThomannProduct[]> {
  const url = `${BASE_URL}/search.html?sw=${encodeURIComponent(query)}`

  const res = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) return []

  const html = await res.text()
  return parseBootstrap(html)
}
