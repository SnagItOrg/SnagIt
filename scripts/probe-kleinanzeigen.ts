const URLS = [
  'https://www.kleinanzeigen.de/s-roland-juno-60/k0',
  'https://www.kleinanzeigen.de/s-musikinstrumente/roland-juno-60/k0c74',
]

type JsonLike = Record<string, unknown>

function sanitizeText(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function preview(input: string, max = 500): string {
  return input.length <= max ? input : `${input.slice(0, max)}...`
}

function extractLdJsonScripts(html: string): string[] {
  const matches = html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )
  return Array.from(matches, (match) => match[1].trim()).filter(Boolean)
}

function safeParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function collectTypeLabels(node: unknown): string[] {
  const types = new Set<string>()

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!value || typeof value !== 'object') return

    const record = value as JsonLike
    const typeValue = record['@type']
    if (typeof typeValue === 'string') types.add(typeValue)
    if (Array.isArray(typeValue)) {
      for (const entry of typeValue) {
        if (typeof entry === 'string') types.add(entry)
      }
    }

    if (Array.isArray(record['@graph'])) {
      visit(record['@graph'])
    }
  }

  visit(node)
  return Array.from(types)
}

function findFirstStructuredSearchNode(node: unknown): JsonLike | null {
  const targetTypes = new Set(['CollectionPage', 'ItemList', 'SearchResultsPage'])

  function walk(value: unknown): JsonLike | null {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item)
        if (found) return found
      }
      return null
    }
    if (!value || typeof value !== 'object') return null

    const record = value as JsonLike
    const typeValue = record['@type']
    const typeList = typeof typeValue === 'string'
      ? [typeValue]
      : Array.isArray(typeValue)
        ? typeValue.filter((entry): entry is string => typeof entry === 'string')
        : []

    if (typeList.some((entry) => targetTypes.has(entry))) {
      return record
    }

    if (Array.isArray(record['@graph'])) {
      const found = walk(record['@graph'])
      if (found) return found
    }

    return null
  }

  return walk(node)
}

function countMatches(html: string, pattern: RegExp): number {
  return Array.from(html.matchAll(pattern)).length
}

function extractPriceTexts(html: string): string[] {
  const results: string[] = []
  const elementPattern =
    /<([a-z0-9-]+)\b[^>]*class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi

  for (const match of html.matchAll(elementPattern)) {
    const text = sanitizeText(match[2])
    if (text) results.push(text)
    if (results.length >= 5) break
  }

  return results
}

function extractArticleBlocks(html: string): string[] {
  const blocks: string[] = []
  const articlePattern = /<article\b[^>]*data-adid\s*=\s*["'][^"']+["'][^>]*>([\s\S]*?)<\/article>/gi

  for (const match of html.matchAll(articlePattern)) {
    blocks.push(match[0])
  }

  return blocks
}

function findFirstTitleAndPriceFromHtml(html: string): { title: string | null; price: string | null } {
  const articleBlocks = extractArticleBlocks(html)

  for (const block of articleBlocks) {
    const titleMatch =
      block.match(/<(?:h1|h2|h3|a)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|h3|a)>/i) ??
      block.match(/title=["']([^"']+)["']/i)
    const priceMatch =
      block.match(/<([a-z0-9-]+)\b[^>]*class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i) ??
      block.match(/(\d[\d.\s]*\s*(?:€|EUR))/i)

    const title = titleMatch ? sanitizeText(titleMatch[1]) : null
    const price = priceMatch ? sanitizeText(priceMatch[2] ?? priceMatch[1]) : null

    if (title || price) {
      return { title, price }
    }
  }

  const fallbackTitle =
    html.match(/<(?:h1|h2|h3)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|h3)>/i)?.[1] ?? null
  const fallbackPrice = html.match(/(\d[\d.\s]*\s*(?:€|EUR))/i)?.[1] ?? null

  return {
    title: fallbackTitle ? sanitizeText(fallbackTitle) : null,
    price: fallbackPrice ? sanitizeText(fallbackPrice) : null,
  }
}

function findFirstTitleAndPriceFromJsonLd(node: unknown): { title: string | null; price: string | null } {
  function walk(value: unknown): { title: string | null; price: string | null } | null {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item)
        if (found && (found.title || found.price)) return found
      }
      return null
    }

    if (!value || typeof value !== 'object') return null
    const record = value as JsonLike

    const hasList = Array.isArray(record['itemListElement']) ? (record['itemListElement'] as unknown[]) : null
    if (hasList) {
      for (const item of hasList) {
        const found = walk(item)
        if (found && (found.title || found.price)) return found
      }
    }

    const item = record['item']
    if (item) {
      const found = walk(item)
      if (found && (found.title || found.price)) return found
    }

    const title =
      typeof record.name === 'string' ? record.name :
      typeof record.headline === 'string' ? record.headline :
      null

    const offers = record.offers
    let price: string | null = null
    if (offers && typeof offers === 'object') {
      const priceValue = (offers as JsonLike).price
      const currency = (offers as JsonLike).priceCurrency
      if (typeof priceValue === 'string' || typeof priceValue === 'number') {
        price = `${priceValue}${typeof currency === 'string' ? ` ${currency}` : ''}`.trim()
      }
    }

    if (title || price) return { title, price }
    return null
  }

  return walk(node) ?? { title: null, price: null }
}

async function main() {
  for (const url of URLS) {
    console.log(`\n=== Probing: ${url} ===`)

    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
      },
    })

    console.log(`HTTP ${res.status} ${res.statusText}`)

    const html = await res.text()
    const ldJsonScripts = extractLdJsonScripts(html)
    console.log(`JSON-LD script tags: ${ldJsonScripts.length}`)

    let foundStructuredSearchNode: JsonLike | null = null
    let parsedForTitlePrice: unknown = null

    ldJsonScripts.forEach((raw, index) => {
      const parsed = safeParseJson(raw)
      if (parsed == null) {
        console.log(`JSON-LD[${index}] parse failed`)
        return
      }

      parsedForTitlePrice = parsedForTitlePrice ?? parsed
      const types = collectTypeLabels(parsed)
      console.log(`JSON-LD[${index}] types: ${types.length > 0 ? types.join(', ') : '(none found)'}`)

      if (!foundStructuredSearchNode) {
        foundStructuredSearchNode = findFirstStructuredSearchNode(parsed)
      }
    })

    if (foundStructuredSearchNode) {
      console.log('First CollectionPage / ItemList / SearchResultsPage preview:')
      console.log(preview(JSON.stringify(foundStructuredSearchNode)))
    } else {
      console.log('No CollectionPage / ItemList / SearchResultsPage JSON-LD found.')

      const selectorChecks = [
        ['article[data-adid]', /<article\b[^>]*\bdata-adid\s*=\s*["'][^"']+["'][^>]*>/gi],
        ['.ad-listitem', /<[^>]+\bclass\s*=\s*["'][^"']*(?:^|[\s_-])ad-listitem(?:[\s_-]|$)[^"']*["'][^>]*>/gi],
        ['li[class*="aditem"]', /<li\b[^>]*\bclass\s*=\s*["'][^"']*aditem[^"']*["'][^>]*>/gi],
        ['[class*="ArticlesList"]', /<[^>]+\bclass\s*=\s*["'][^"']*ArticlesList[^"']*["'][^>]*>/gi],
      ] as const

      for (const [label, pattern] of selectorChecks) {
        console.log(`${label}: ${countMatches(html, pattern)}`)
      }
    }

    const priceTexts = extractPriceTexts(html)
    console.log('First 5 [class*="price"] texts:')
    if (priceTexts.length === 0) {
      console.log('  (none)')
    } else {
      priceTexts.forEach((text, index) => console.log(`  ${index + 1}. ${text}`))
    }

    const jsonLdResult = parsedForTitlePrice ? findFirstTitleAndPriceFromJsonLd(parsedForTitlePrice) : null
    const htmlResult = findFirstTitleAndPriceFromHtml(html)
    const title = jsonLdResult?.title ?? htmlResult.title ?? '—'
    const price = jsonLdResult?.price ?? htmlResult.price ?? '—'

    console.log(`First listing title: ${title}`)
    console.log(`First listing price: ${price}`)
  }
}

main().catch((error) => {
  console.error('Probe failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
