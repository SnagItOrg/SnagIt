/**
 * scripts/scrape-reverb.ts
 *
 * Fetches listings from the Reverb API for every brand in kg_brand,
 * normalises them to the listings table schema, and upserts to Supabase.
 *
 * Usage:
 *   npm run scrape-reverb
 *
 * Env (loaded from .env.local or frontend/.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

// ── Env ───────────────────────────────────────────────────────────────────────
for (const p of [
  path.resolve(__dirname, '../.env.local'),
  path.resolve(__dirname, '../frontend/.env.local'),
]) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); break }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Types ─────────────────────────────────────────────────────────────────────
interface Brand {
  id:       string
  name:     string
  slug:     string
  synonyms: string[] | null
}

interface ReverbListing {
  id:           string | number
  title:        string
  price:        { amount: string }
  photos?:      Array<{ links?: { full?: { href?: string } } }>
  shipping?:    { local?: boolean }
  published_at?: string
  state?:       { slug?: string }
  condition?:   { display_name?: string }
  _links?:      { web?: { href?: string } }
}

interface ReverbResponse {
  listings?: ReverbListing[]
}

interface NormalizedListing {
  external_id:  string
  source:       string
  platform:     string
  url:          string
  title:        string
  price:        number | null
  currency:     string
  image_url:    string | null
  location:     string
  scraped_at:   string
  is_active:    boolean
  condition:    string | null
  brand_id:     string
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// ── Reverb fetch ──────────────────────────────────────────────────────────────
async function fetchReverbListings(brandName: string): Promise<ReverbListing[]> {
  const url = `https://api.reverb.com/api/listings?query=${encodeURIComponent(brandName)}&per_page=50`

  const res = await fetch(url, {
    headers: {
      'Accept':         'application/hal+json',
      'Accept-Version': '3.0',
    },
  })

  if (!res.ok) {
    throw new Error(`Reverb API error: ${res.status} ${res.statusText}`)
  }

  const data = await res.json() as ReverbResponse
  return data.listings ?? []
}

// ── Normalise ─────────────────────────────────────────────────────────────────
function normalise(listing: ReverbListing, brand: Brand): NormalizedListing {
  const rawAmount = listing.price?.amount ?? '0'
  const usd       = parseFloat(rawAmount)
  const dkk       = isNaN(usd) ? null : Math.round(usd * 7.5)

  return {
    external_id: `reverb_${listing.id}`,
    source:      'reverb',
    platform:    'reverb',
    url:         listing._links?.web?.href ?? `https://reverb.com/item/${listing.id}`,
    title:       listing.title,
    price:       dkk,
    currency:    'DKK',
    image_url:   listing.photos?.[0]?.links?.full?.href ?? null,
    location:    listing.shipping?.local ? 'Local' : 'International',
    scraped_at:  listing.published_at ?? new Date().toISOString(),
    is_active:   listing.state?.slug === 'live',
    condition:   listing.condition?.display_name ?? null,
    brand_id:    brand.id,
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { data: brands, error: brandErr } = await supabase
    .from('kg_brand')
    .select('id, name, slug, synonyms')

  if (brandErr) throw new Error(`Fetch brands: ${brandErr.message}`)
  if (!brands || brands.length === 0) {
    console.log('No brands found — nothing to scrape.')
    return
  }

  console.log(`[reverb] Scraping ${brands.length} brands…\n`)

  let total = 0

  for (let i = 0; i < brands.length; i++) {
    const brand = brands[i] as Brand
    if (i > 0) await delay(500)

    let listings: ReverbListing[]
    try {
      listings = await fetchReverbListings(brand.name)
    } catch (err) {
      console.error(`[reverb] ${brand.name}: fetch failed — ${(err as Error).message}`)
      continue
    }

    if (listings.length === 0) {
      console.log(`[reverb] ${brand.name}: 0 listings`)
      continue
    }

    const normalized = listings.map((l) => normalise(l, brand))

    const { error: upsertErr } = await supabase
      .from('listings')
      .upsert(normalized, { onConflict: 'external_id', ignoreDuplicates: false })

    if (upsertErr) {
      console.error(`[reverb] ${brand.name}: upsert failed — ${upsertErr.message}`)
      continue
    }

    total += normalized.length
    console.log(`[reverb] ${brand.name}: ${listings.length} listings fetched`)
  }

  console.log(`\n[reverb] Done. Total upserted: ${total}`)
}

main().catch((err: unknown) => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
