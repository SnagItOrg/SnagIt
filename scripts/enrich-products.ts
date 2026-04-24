/**
 * scripts/enrich-products.ts
 *
 * Beriger 7 prioritetsprodukter med description, specs, history,
 * external_links og related_products via Wikipedia, Reverb CSP og Haiku.
 *
 * Gemmer til kg_product.attributes (JSONB).
 *
 * Usage:
 *   npm run enrich-products              — kør og skriv til DB
 *   npm run enrich-products -- --dry-run — print til console uden at skrive
 *   npm run enrich-products -- --slug roland-juno-106  — kun ét produkt
 */

import * as fs   from 'fs'
import * as path from 'path'
import dotenv    from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

// ── Env ───────────────────────────────────────────────────────────────────────
for (const p of [
  path.resolve(__dirname, '../.env.local'),
  path.resolve(__dirname, '../frontend/.env.local'),
]) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); break }
}

const SUPABASE_URL    = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!ANTHROPIC_KEY) {
  console.error('❌  Missing ANTHROPIC_API_KEY')
  process.exit(1)
}

const supabase   = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const anthropic  = new Anthropic({ apiKey: ANTHROPIC_KEY })

const DRY_RUN    = process.argv.includes('--dry-run')
const SLUG_FILTER = (() => {
  const i = process.argv.indexOf('--slug')
  return i !== -1 ? process.argv[i + 1] : null
})()

// ── Products to enrich ────────────────────────────────────────────────────────
interface ProductTarget {
  slug:           string
  canonicalName:  string
  wikipediaTitle: string
  reverbQuery:    string
  vsePath?:       string  // Vintage Synth Explorer path
}

const TARGETS: ProductTarget[] = [
  {
    slug:           'fender-telecaster',
    canonicalName:  'Fender Telecaster',
    wikipediaTitle: 'Fender_Telecaster',
    reverbQuery:    'Fender Telecaster',
  },
  {
    slug:           'fender-stratocaster',
    canonicalName:  'Fender Stratocaster',
    wikipediaTitle: 'Fender_Stratocaster',
    reverbQuery:    'Fender Stratocaster',
  },
  {
    slug:           'gibson-les-paul',
    canonicalName:  'Gibson Les Paul',
    wikipediaTitle: 'Gibson_Les_Paul',
    reverbQuery:    'Gibson Les Paul',
  },
  {
    slug:           'gibson-es-335',
    canonicalName:  'Gibson ES-335',
    wikipediaTitle: 'Gibson_ES-335',
    reverbQuery:    'Gibson ES-335',
  },
  {
    slug:           'roland-juno-60',
    canonicalName:  'Roland Juno-60',
    wikipediaTitle: 'Roland_Juno-60',
    reverbQuery:    'Roland Juno-60',
    vsePath:        '/roland/juno60',
  },
  {
    slug:           'roland-juno-106',
    canonicalName:  'Roland Juno-106',
    wikipediaTitle: 'Roland_Juno-106',
    reverbQuery:    'Roland Juno-106',
    vsePath:        '/roland/juno106',
  },
  {
    slug:           'roland-jupiter-8',
    canonicalName:  'Roland Jupiter-8',
    wikipediaTitle: 'Roland_Jupiter-8',
    reverbQuery:    'Roland Jupiter-8',
    vsePath:        '/roland/jupiter8',
  },
]

// ── Types ─────────────────────────────────────────────────────────────────────
interface HistoryEvent {
  year:  number
  title: string
  body:  string
}

interface RelatedProduct {
  slug:   string
  reason: string
}

interface ExternalLink {
  label: string
  url:   string
}

interface Attributes {
  description?:      string
  specs?:            Record<string, string | number | boolean>
  history?:          HistoryEvent[]
  external_links?:   ExternalLink[]
  related_products?: RelatedProduct[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': 'klup.dk/1.0 (enrichment bot)', ...headers } })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.json()
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'klup.dk/1.0 (enrichment bot)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.text()
}

// ── Wikipedia ─────────────────────────────────────────────────────────────────
interface WikiSummary {
  extract:      string
  content_urls: { desktop: { page: string } }
}

async function fetchWikipedia(title: string): Promise<WikiSummary | null> {
  try {
    const data = await fetchJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
    ) as WikiSummary
    return data
  } catch (e) {
    console.warn(`  ⚠️  Wikipedia miss (${title}): ${(e as Error).message}`)
    return null
  }
}

// ── Reverb CSP ────────────────────────────────────────────────────────────────
interface ReverbCSP {
  title?:          string
  summary?:        string
  used_low_price?: { amount: string; currency: string }
  _links?: {
    web?:          { href: string }
    used_search?:  { href: string }
  }
}

async function fetchReverbCSP(query: string): Promise<{ csp: ReverbCSP | null; listingDesc: string }> {
  try {
    const data = await fetchJson(
      `https://api.reverb.com/api/csps?query=${encodeURIComponent(query)}&per_page=1`,
      { 'Accept-Version': '3.0' }
    ) as { csps: ReverbCSP[] }

    const csp = data.csps?.[0] ?? null

    // Log CSP links so we can see what Reverb returns
    console.log('  📋  Reverb CSP _links:', JSON.stringify(csp?._links ?? null, null, 2))

    let listingDesc = ''

    // Try to get a listing for extra spec context — log raw JSON for inspection
    const searchHref = csp?._links?.used_search?.href ?? csp?._links?.web?.href
    if (searchHref) {
      try {
        const searchUrl = searchHref.includes('/api/')
          ? `${searchHref}&per_page=1`
          : `https://api.reverb.com/api/listings?query=${encodeURIComponent(query)}&per_page=1`
        const listingsData = await fetchJson(searchUrl, { 'Accept-Version': '3.0' }) as { listings: Array<Record<string, unknown>> }
        const firstListing = listingsData.listings?.[0]
        if (firstListing) {
          const scalarFields = Object.fromEntries(
            Object.entries(firstListing).filter(([, v]) => typeof v !== 'object' || v === null)
          )
          console.log('  📋  Reverb listing scalar fields:', JSON.stringify(scalarFields, null, 2))
          listingDesc = (firstListing.description as string | undefined)?.slice(0, 500) ?? ''
        } else {
          console.log('  ℹ️   Reverb listings: ingen resultater')
        }
      } catch (le) {
        console.warn(`  ⚠️  Reverb listings fetch fejlede: ${(le as Error).message}`)
      }
    } else {
      console.log('  ℹ️   Reverb CSP: ingen used_search link')
    }

    return { csp, listingDesc }
  } catch (e) {
    console.warn(`  ⚠️  Reverb CSP miss (${query}): ${(e as Error).message}`)
    return { csp: null, listingDesc: '' }
  }
}

// ── Vintage Synth Explorer ────────────────────────────────────────────────────
interface VSEResult {
  text:  string
  specs: Record<string, string>
}

async function fetchVSE(vsePath: string): Promise<VSEResult> {
  try {
    const html = await fetchText(`https://www.vintagesynth.com${vsePath}`)

    // ── Parse specs table ──
    // Structure: <span class="specification-term" title="Polyphony" ...>
    //            <span class="specification-value">6 voices</span>
    const specs: Record<string, string> = {}
    const termRe = /class="specification-term"[^>]*title="([^"]+)"[^>]*>[\s\S]*?class="specification-value">([^<]+)/g
    let m: RegExpExecArray | null
    while ((m = termRe.exec(html)) !== null) {
      const key = m[1].trim()
      const val = m[2].trim()
      if (val && val.toLowerCase() !== 'none' && val !== '-') {
        specs[key] = val
      }
    }
    console.log(`  📋  VSE specs fundet (${Object.keys(specs).length}):`, JSON.stringify(specs, null, 2))

    // ── Extract body text for history/description ──
    const paragraphs: string[] = []
    const pRe = /<p>([^<]{40,})<\/p>/g
    while ((m = pRe.exec(html)) !== null) {
      paragraphs.push(m[1].replace(/<[^>]+>/g, '').trim())
    }
    const text = paragraphs.join('\n\n').slice(0, 1000)

    return { text, specs }
  } catch (e) {
    console.warn(`  ⚠️  VSE miss (${vsePath}): ${(e as Error).message}`)
    return { text: '', specs: {} }
  }
}

// ── Map VSE spec keys → our canonical keys ────────────────────────────────────
function normaliseVSESpecs(raw: Record<string, string>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  const map: Record<string, string> = {
    'Polyphony':     'polyphony',
    'Oscillators':   'oscillators',
    'LFO':           'lfo',
    'Filter':        'filter',
    'VCA':           'vca',
    'Keyboard':      'keys',
    'Memory':        'memory',
    'Control':       'control',
    'Date Produced': 'production_years',
    'Arpeg/Seq':     'arpeggiator',
    'Effects':       'effects',
  }
  for (const [vseKey, ourKey] of Object.entries(map)) {
    if (raw[vseKey]) out[ourKey] = raw[vseKey]
  }
  // Parse midi bool from control field
  if (typeof out.control === 'string' && /midi/i.test(out.control)) {
    out.midi = true
  }
  return out
}

// ── Haiku helpers ─────────────────────────────────────────────────────────────
async function haikuText(systemPrompt: string, userContent: string): Promise<string> {
  const msg = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userContent }],
  })
  return (msg.content[0] as { type: string; text: string }).text.trim()
}

async function haikuJson<T>(systemPrompt: string, userContent: string): Promise<T | null> {
  const raw = await haikuText(systemPrompt, userContent)
  // Extract JSON from code fence if present
  const jsonStr = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()
  try {
    return JSON.parse(jsonStr) as T
  } catch {
    console.warn('  ⚠️  Haiku JSON parse failed. Raw output:\n', raw.slice(0, 300))
    return null
  }
}

// ── Main enrichment logic ─────────────────────────────────────────────────────
async function enrichProduct(target: ProductTarget, allSlugs: string[]): Promise<Attributes> {
  const { slug, canonicalName, wikipediaTitle, reverbQuery, vsePath } = target

  console.log(`\n▶  ${canonicalName}`)
  console.log('   Fetching Wikipedia…')
  const wiki = await fetchWikipedia(wikipediaTitle)
  const wikiExtract = wiki?.extract ?? ''
  const wikiUrl     = wiki?.content_urls?.desktop?.page ?? ''

  console.log('   Fetching Reverb CSP…')
  const { csp, listingDesc } = await fetchReverbCSP(reverbQuery)
  const reverbSummary = csp?.summary ?? ''
  const reverbUrl     = csp?._links?.web?.href ?? ''

  let vseText = ''
  let vseRawSpecs: Record<string, string> = {}
  if (vsePath) {
    console.log('   Fetching Vintage Synth Explorer…')
    const vseResult = await fetchVSE(vsePath)
    vseText     = vseResult.text
    vseRawSpecs = vseResult.specs
  }

  // Prioritér VSE som primær kilde til history hvis Wikipedia-extract er kort
  const wikiIsShort = wikiExtract.length < 200
  if (wikiIsShort && vseText) {
    console.log(`   ℹ️   Wikipedia kort (${wikiExtract.length} tegn) — VSE er primær historikkilde`)
  }

  const combinedText = (wikiIsShort && vseText
    ? [vseText, wikiExtract, reverbSummary, listingDesc]
    : [wikiExtract, reverbSummary, vseText, listingDesc]
  ).filter(Boolean).join('\n\n').slice(0, 3000)

  // ── Description ──
  console.log('   Haiku → description…')
  const description = await haikuText(
    'Du er redaktør på et dansk musikudstyr-site. Skriv altid på dansk. Returner KUN den rå tekst — ingen overskrifter, ingen markdown.',
    `Skriv en beskrivelse på dansk på præcis 120-150 ord af ${canonicalName}.
Stil: faktuel, engageret, ikke salgsorienteret.
Inkluder: hvad gør den unik, hvem brugte den, hvornår den blev produceret.
Brug disse kildetekster som grundlag:
---
${combinedText}
---`
  )

  // ── History ──
  console.log('   Haiku → history…')
  const history = await haikuJson<HistoryEvent[]>(
    'Du er en historisk redaktør for et dansk musikudstyr-site. Output KUN valid JSON — ingen markdown, ingen forklaring.',
    `Lav 3-4 historiske milepæle for ${canonicalName}.
Brug kildeteksten nedenfor som grundlag. Hvis kildeteksten er tynd, suppler med din viden om instrumentet.
Milepæle bør dække: lancering, gennembrud/popularitet, produktionsstop/arv.
Output KUN et JSON array:
[{ "year": number, "title": "string (max 4 ord, dansk)", "body": "string (max 30 ord, dansk)" }]

Kildetekst:
---
${combinedText}
---`
  )

  // ── Related products ──
  console.log('   Haiku → related products…')
  const related = await haikuJson<RelatedProduct[]>(
    'Du er musikekspert. Output KUN valid JSON — ingen markdown, ingen forklaring.',
    `Foreslå 3-5 relaterede musikinstrumenter til ${canonicalName}.
Disse produkter SKAL eksistere i denne liste (brug kun slugs herfra):
${allSlugs.join(', ')}

Output KUN et JSON array:
[{ "slug": "string (fra listen ovenfor)", "reason": "string (max 8 ord, dansk)" }]
Prioritér: forgængere, efterfølgere, samtidige konkurrenter.`
  )

  // ── External links ──
  const external_links: ExternalLink[] = []
  if (wikiUrl)   external_links.push({ label: 'Wikipedia',              url: wikiUrl })
  if (vsePath)   external_links.push({ label: 'Vintage Synth Explorer', url: `https://www.vintagesynth.com${vsePath}` })
  if (reverbUrl) external_links.push({ label: 'Reverb',                 url: reverbUrl })

  // ── Specs: 1) VSE parse, 2) Wikipedia year fallback, 3) Haiku fallback ──
  let specs: Record<string, string | number | boolean> = {}
  let specsSource = 'none'

  if (Object.keys(vseRawSpecs).length > 0) {
    specs = normaliseVSESpecs(vseRawSpecs)
    specsSource = 'vse'
    console.log(`  ✅  Specs fra VSE (${Object.keys(specs).length} felter)`)
  } else {
    // Wikipedia production years fallback
    const yearsMatch = wikiExtract.match(/introduced in (\d{4})|(\d{4})[–-](\d{4})|since (\d{4})/i)
    if (yearsMatch) {
      const start = yearsMatch[1] || yearsMatch[2] || yearsMatch[4]
      const end   = yearsMatch[3]
      specs.production_years = end ? `${start}–${end}` : `${start}–`
      specsSource = 'wikipedia'
    }

    // Haiku fallback — bruges kun hvis ingen anden kilde har specs
    if (Object.keys(specs).length === 0) {
      console.log('   Haiku → specs fallback…')
      const haikuSpecs = await haikuJson<Record<string, unknown>>(
        'You are a precise music gear encyclopedia. Output ONLY valid JSON — no markdown, no prose.',
        `List technical specs for ${canonicalName} as JSON with these exact keys (omit any you are unsure of):
{
  "polyphony": "string e.g. '6 voices'",
  "oscillators": "string",
  "filter": "string",
  "keys": "string e.g. '61 keys'",
  "midi": true or false,
  "production_years": "string e.g. '1984–1985'",
  "weight_kg": number or null
}
Output ONLY valid JSON.`
      )
      if (haikuSpecs && typeof haikuSpecs === 'object') {
        for (const [k, v] of Object.entries(haikuSpecs)) {
          if (v !== null && v !== undefined && v !== '') specs[k] = v as string | number | boolean
        }
        if (Object.keys(specs).length > 0) {
          specs._source = 'haiku'
          specsSource = 'haiku'
          console.log(`  ⚠️   Specs fra Haiku (ikke verificerede) — ${Object.keys(specs).length} felter`)
        }
      }
    }
  }
  console.log(`  📊  Specs-kilde: ${specsSource}`)

  // Filter related products mot faktiske KG-slugs, log hvad der fjernes
  let related_products: RelatedProduct[] | undefined
  if (related?.length) {
    const valid   = related.filter(r => allSlugs.includes(r.slug))
    const removed = related.filter(r => !allSlugs.includes(r.slug))
    if (removed.length > 0) {
      console.log(`  🗑️   Related fjernet (ikke i KG): ${removed.map(r => r.slug).join(', ')}`)
    }
    related_products = valid.length > 0 ? valid : undefined
  }

  return {
    description: description || undefined,
    specs:       Object.keys(specs).length > 0 ? specs : undefined,
    history:     history?.length ? history : undefined,
    external_links: external_links.length > 0 ? external_links : undefined,
    related_products,
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
  // Fetch all kg_product slugs for related_products validation
  const { data: allProducts, error: pErr } = await supabase
    .from('kg_product')
    .select('slug')
  if (pErr) { console.error('❌  Fetch kg_product:', pErr.message); process.exit(1) }
  const allSlugs = (allProducts ?? []).map((p: { slug: string }) => p.slug)
  console.log(`ℹ️   ${allSlugs.length} produkter i KG`)

  const targets = SLUG_FILTER
    ? TARGETS.filter(t => t.slug === SLUG_FILTER)
    : TARGETS

  if (targets.length === 0) {
    console.error(`❌  Ingen targets matcher --slug ${SLUG_FILTER}`)
    process.exit(1)
  }

  console.log(`\n${DRY_RUN ? '🔍  DRY RUN' : '✍️   LIVE RUN'} — ${targets.length} produkt(er)\n`)

  for (const target of targets) {
    try {
      const attrs = await enrichProduct(target, allSlugs)

      console.log('\n─────────────────────────────────────────')
      console.log(`📦  ${target.slug}`)
      console.log('─────────────────────────────────────────')
      console.log('DESCRIPTION:')
      console.log(attrs.description ?? '(ingen)')
      console.log('\nHISTORY:')
      console.log(JSON.stringify(attrs.history ?? [], null, 2))
      console.log('\nSPECS:')
      console.log(JSON.stringify(attrs.specs ?? {}, null, 2))
      console.log('\nEXTERNAL LINKS:')
      console.log(JSON.stringify(attrs.external_links ?? [], null, 2))
      console.log('\nRELATED PRODUCTS:')
      console.log(JSON.stringify(attrs.related_products ?? [], null, 2))

      if (!DRY_RUN) {
        // Merge med eksisterende attributes
        const { data: existing } = await supabase
          .from('kg_product')
          .select('attributes')
          .eq('slug', target.slug)
          .single()

        const merged = { ...(existing?.attributes ?? {}), ...attrs }

        const { error } = await supabase
          .from('kg_product')
          .update({ attributes: merged })
          .eq('slug', target.slug)

        if (error) {
          console.error(`  ❌  DB write failed: ${error.message}`)
        } else {
          console.log(`  ✅  Gemt til DB`)
        }
      } else {
        console.log('\n  (dry-run — ikke skrevet til DB)')
      }
    } catch (e) {
      console.error(`  ❌  ${target.slug}: ${(e as Error).message}`)
    }

    if (targets.indexOf(target) < targets.length - 1) {
      console.log('\n  ⏱️   2s pause…')
      await sleep(2000)
    }
  }

  console.log('\n✅  Færdig')
}

main().catch(e => {
  console.error('❌', (e as Error).message)
  process.exit(1)
})
