/**
 * scripts/match-listings.ts
 *
 * For each listing without an entry in listing_product_match:
 *   1. Normalise: lower(title) in JS only (not written back to DB)
 *   2. Identifier match: check normalised text for SKU/MODEL values from kg_identifier
 *      → score 95, method 'SKU' or 'MODEL'
 *   3. Synonym match: check normalised text against synonym.alias
 *      → score 80, method 'SYNONYM'
 *   4. Insert best match into listing_product_match
 *
 * Usage:
 *   npm run match-listings
 *
 * Env (loaded from frontend/.env.local or .env.local at repo root):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as fs from 'fs'
import * as path from 'path'
import dotenv from 'dotenv'
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
interface Listing {
  id:    string
  title: string
}

interface Identifier {
  product_id: string
  type:       string
  value:      string
}

interface Synonym {
  alias:           string
  canonical_query: string | null
}

interface Product {
  id:             string
  slug:           string
  canonical_name: string
}

interface MatchCandidate {
  product_id: string
  method:     'EAN' | 'SKU' | 'MODEL' | 'SYNONYM' | 'FUZZY'
  score:      number
  explain:    Record<string, unknown>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if `token` appears as a whole word/token in `text`.
 * Boundaries: not preceded or followed by a word char or hyphen.
 */
function containsToken(text: string, token: string): boolean {
  if (token.length < 3) return false
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(text)
}

/**
 * Converts a string to a URL-style slug: lowercase, ASCII, hyphen-separated.
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Resolves a canonical_query string to a product using slug/name heuristics:
 *   1. Exact slug match
 *   2. Product slug starts with cSlug + '-'
 *   3. cSlug ends with '-' + product.slug  (product.slug >= 4 chars)
 *   4. product.canonical_name.toLowerCase().startsWith(canonical.toLowerCase())
 */
function resolveCanonical(canonical: string, products: Product[]): Product | undefined {
  const cSlug  = slugify(canonical)
  const cLower = canonical.toLowerCase()

  return (
    products.find(p => p.slug === cSlug) ??
    products.find(p => p.slug.startsWith(cSlug + '-')) ??
    products.find(p => p.slug.length >= 4 && cSlug.endsWith('-' + p.slug)) ??
    products.find(p => p.canonical_name.toLowerCase().startsWith(cLower))
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Load reference data
  const [
    { data: productsData,    error: pErr },
    { data: identsData,      error: iErr },
    { data: synonymsData,    error: sErr },
    { data: alreadyMatched,  error: mErr },
    { data: listingsData,    error: lErr },
  ] = await Promise.all([
    supabase.from('kg_product')   .select('id, slug, canonical_name'),
    supabase.from('kg_identifier').select('product_id, type, value').in('type', ['SKU', 'MODEL']),
    supabase.from('synonym')      .select('alias, canonical_query').eq('match_type', 'alias'),
    supabase.from('listing_product_match').select('listing_id'),
    supabase.from('listings')     .select('id, title').not('title', 'is', null),
  ])

  if (pErr) throw new Error(`Fetch kg_product: ${pErr.message}`)
  if (iErr) throw new Error(`Fetch kg_identifier: ${iErr.message}`)
  if (sErr) throw new Error(`Fetch synonym: ${sErr.message}`)
  if (mErr) throw new Error(`Fetch listing_product_match: ${mErr.message}`)
  if (lErr) throw new Error(`Fetch listings: ${lErr.message}`)

  const products   = (productsData  as Product[])    ?? []
  const idents     = (identsData    as Identifier[]) ?? []
  const synonyms   = (synonymsData  as Synonym[])    ?? []
  const matchedIds = new Set(
    ((alreadyMatched as Array<{ listing_id: string }>) ?? []).map(r => r.listing_id)
  )

  console.log(`  ✓  ${products.length} products, ${idents.length} identifiers, ${synonyms.length} synonym aliases`)

  // 2. Pre-resolve canonical_query → product for each unique canonical
  const canonicalToProduct = new Map<string, Product>()
  for (const syn of synonyms) {
    if (!syn.canonical_query) continue
    if (canonicalToProduct.has(syn.canonical_query)) continue
    const product = resolveCanonical(syn.canonical_query, products)
    if (product) canonicalToProduct.set(syn.canonical_query, product)
  }

  // 3. Filter to unmatched listings
  const listings = ((listingsData as Listing[]) ?? []).filter(l => !matchedIds.has(l.id))
  console.log(`\n📋  ${listings.length} unmatched listings (${matchedIds.size} already matched)`)

  if (listings.length === 0) {
    console.log('\n✅  Nothing to do.')
    return
  }

  // Safety net: drop any rows where title is null (guards against DB filter gaps)
  const validListings = listings.filter(l => l.title != null)
  if (validListings.length < listings.length) {
    console.log(`  ⚠️   Skipped ${listings.length - validListings.length} listings with null title`)
  }

  // 4. Match each listing
  const matchRows: Array<{
    listing_id: string
    product_id: string
    method:     string
    score:      number
    explain:    Record<string, unknown>
  }> = []

  for (const listing of validListings) {
    const norm = listing.title.toLowerCase().trim()

    const candidates: MatchCandidate[] = []

    // ── Step 2: Identifier match (SKU / MODEL) ────────────────────────────────
    for (const ident of idents) {
      if (!containsToken(norm, ident.value)) continue
      const method = ident.type as 'SKU' | 'MODEL'
      candidates.push({
        product_id: ident.product_id,
        method,
        score:   95,
        explain: { matched_identifier: ident.value, type: ident.type },
      })
    }

    // ── Step 3: Synonym match ─────────────────────────────────────────────────
    if (candidates.length === 0) {
      for (const syn of synonyms) {
        if (!containsToken(norm, syn.alias)) continue
        if (!syn.canonical_query) continue
        const product = canonicalToProduct.get(syn.canonical_query)
        if (!product) continue
        candidates.push({
          product_id: product.id,
          method:     'SYNONYM',
          score:      80,
          explain:    { matched_alias: syn.alias, canonical_query: syn.canonical_query },
        })
        break // one synonym is enough at this tier
      }
    }

    if (candidates.length === 0) continue

    // Pick highest-scoring candidate (first wins on tie)
    const best = candidates.reduce((a, b) => b.score > a.score ? b : a)
    matchRows.push({
      listing_id: listing.id,
      product_id: best.product_id,
      method:     best.method,
      score:      best.score,
      explain:    best.explain,
    })
  }

  // 5. Insert match rows
  const BATCH = 100
  for (let i = 0; i < matchRows.length; i += BATCH) {
    const { error } = await supabase
      .from('listing_product_match')
      .insert(matchRows.slice(i, i + BATCH))
    if (error) throw new Error(`Insert listing_product_match batch ${i}: ${error.message}`)
  }

  console.log(`\n✅  Matched ${matchRows.length}/${validListings.length} listings`)
}

main().catch(err => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
