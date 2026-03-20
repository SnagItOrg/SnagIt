/**
 * scripts/download-thomann-sitemap.ts
 *
 * Downloads all 4 Thomann DK sitemaps and saves the combined URL list to
 * data/thomann-sitemap.json (~200K entries). Run once weekly before
 * build-thomann-urls.ts.
 *
 * sitemap4 is blocked from some machines (e.g. Mac Mini). Pass a locally
 * downloaded copy via --sitemap4=/path/to/sitemap4.xml.gz to use it instead
 * of fetching. Download on MacBook and scp to Mac Mini as needed.
 *
 * Usage:
 *   npx tsx scripts/download-thomann-sitemap.ts
 *   npx tsx scripts/download-thomann-sitemap.ts --sitemap4=/tmp/sitemap4.xml.gz
 */

import * as path from 'path'
import * as fs from 'fs'
import * as zlib from 'zlib'

const SITEMAP_URLS = [
  'https://www.thomann.dk/sitemap1.xml.gz',
  'https://www.thomann.dk/sitemap2.xml.gz',
  'https://www.thomann.dk/sitemap3.xml.gz',
  'https://www.thomann.dk/sitemap4.xml.gz',
]

const OUTPUT_PATH = path.resolve(__dirname, '../data/thomann-sitemap.json')

const args = process.argv.slice(2)
const sitemap4Override = args.find(a => a.startsWith('--sitemap4='))?.split('=')[1] ?? null

// ── Parse ─────────────────────────────────────────────────────────────────────
function parseXml(xml: string): string[] {
  const urls: string[] = []
  const locRe = /<loc>([^<]+)<\/loc>/g
  let m: RegExpExecArray | null
  while ((m = locRe.exec(xml)) !== null) {
    urls.push(m[1].trim())
  }
  return urls
}

async function gunzipBuffer(buf: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    zlib.gunzip(buf, (err, result) => {
      if (err) reject(err)
      else resolve(result.toString('utf8'))
    })
  })
}

// ── Fetch one sitemap from URL ─────────────────────────────────────────────────
async function fetchSitemap(url: string): Promise<string[]> {
  const name = url.split('/').pop()!
  try {
    const res = await fetch(url, {
      headers: { 'Accept-Encoding': 'gzip, deflate, br' },
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 403) {
      console.warn(`   ⚠️  ${name} — 403 Forbidden, skipping`)
      return []
    }
    if (!res.ok) {
      console.warn(`   ⚠️  ${name} — HTTP ${res.status}, skipping`)
      return []
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const xml = await gunzipBuffer(buf)
    return parseXml(xml)
  } catch (err) {
    const msg = (err as Error).message ?? String(err)
    console.warn(`   ⚠️  ${name} — ${msg}, skipping`)
    return []
  }
}

// ── Load one sitemap from local file ──────────────────────────────────────────
async function loadLocalSitemap(filePath: string): Promise<string[]> {
  const name = path.basename(filePath)
  try {
    const buf = fs.readFileSync(filePath)
    const xml = await gunzipBuffer(buf)
    return parseXml(xml)
  } catch (err) {
    const msg = (err as Error).message ?? String(err)
    console.warn(`   ⚠️  ${name} — ${msg}, skipping`)
    return []
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('📥 Thomann Sitemap Downloader')
  if (sitemap4Override) {
    console.log(`   sitemap4 override: ${sitemap4Override}`)
  }
  console.log()

  const all: string[] = []

  for (const url of SITEMAP_URLS) {
    const name = url.split('/').pop()!
    let urls: string[]

    if (name === 'sitemap4.xml.gz' && sitemap4Override) {
      console.log(`   ${name} → loading from ${sitemap4Override}`)
      urls = await loadLocalSitemap(sitemap4Override)
    } else {
      urls = await fetchSitemap(url)
    }

    if (urls.length > 0) {
      console.log(`   ${name} → ${urls.length.toLocaleString()} URLs`)
    }
    all.push(...urls)
  }

  console.log()
  console.log(`   Total: ${all.length.toLocaleString()} URLs`)
  console.log(`   Writing to ${OUTPUT_PATH}…`)

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(all))
  const kb = Math.round(fs.statSync(OUTPUT_PATH).size / 1024)
  console.log(`✅ Done — ${kb.toLocaleString()} KB written`)
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${(err as Error).message ?? err}`)
  process.exit(1)
})
