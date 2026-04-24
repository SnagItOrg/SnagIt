/**
 * Shared listing-to-product matching logic.
 *
 * Accepts a Supabase client and an array of listing IDs to match.
 * Used by:
 *   - scripts/match-listings.ts  (manual runs)
 *   - app/api/cron/scrape/route.ts  (automatic after each scrape)
 */

import type { SupabaseClient } from '@supabase/supabase-js'

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
  model_name:     string | null
}

interface MatchCandidate {
  product_id: string
  method:     'EAN' | 'SKU' | 'MODEL' | 'SYNONYM' | 'MODEL_NAME' | 'FUZZY'
  score:      number
  explain:    Record<string, unknown>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function containsToken(text: string, token: string): boolean {
  if (token.length < 3) return false
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(text)
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

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

// ── Core ──────────────────────────────────────────────────────────────────────

export async function matchListings(
  supabase: SupabaseClient,
  listingIds: string[],
): Promise<{ matched: number; total: number }> {
  if (listingIds.length === 0) return { matched: 0, total: 0 }

  const [
    { data: productsData,   error: pErr },
    { data: identsData,     error: iErr },
    { data: synonymsData,   error: sErr },
    { data: listingsData,   error: lErr },
  ] = await Promise.all([
    supabase.from('kg_product')   .select('id, slug, canonical_name, model_name'),
    supabase.from('kg_identifier').select('product_id, type, value').in('type', ['SKU', 'MODEL']),
    supabase.from('synonym')      .select('alias, canonical_query').eq('match_type', 'alias'),
    supabase.from('listings').select('id, title').in('id', listingIds).not('title', 'is', null),
  ])

  if (pErr) throw new Error(`Fetch kg_product: ${pErr.message}`)
  if (iErr) throw new Error(`Fetch kg_identifier: ${iErr.message}`)
  if (sErr) throw new Error(`Fetch synonym: ${sErr.message}`)
  if (lErr) throw new Error(`Fetch listings: ${lErr.message}`)

  const products = (productsData as Product[])    ?? []
  const idents   = (identsData   as Identifier[]) ?? []
  const synonyms = (synonymsData as Synonym[])    ?? []

  // Pre-resolve canonical_query → product for each unique canonical
  const canonicalToProduct = new Map<string, Product>()
  for (const syn of synonyms) {
    if (!syn.canonical_query) continue
    if (canonicalToProduct.has(syn.canonical_query)) continue
    const product = resolveCanonical(syn.canonical_query, products)
    if (product) canonicalToProduct.set(syn.canonical_query, product)
  }

  // Callers are responsible for passing only unmatched IDs
  const listings = ((listingsData as Listing[]) ?? [])

  if (listings.length === 0) return { matched: 0, total: 0 }

  const matchRows: Array<{
    listing_id: string
    product_id: string
    method:     string
    score:      number
    explain:    Record<string, unknown>
  }> = []

  for (const listing of listings) {
    const norm       = listing.title.toLowerCase().trim()
    const candidates: MatchCandidate[] = []

    // Identifier match (SKU / MODEL) — score 95
    for (const ident of idents) {
      if (!containsToken(norm, ident.value)) continue
      candidates.push({
        product_id: ident.product_id,
        method:     ident.type as 'SKU' | 'MODEL',
        score:      95,
        explain:    { matched_identifier: ident.value, type: ident.type },
      })
    }

    // Synonym match — score 80
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
        break
      }
    }

    // Model name match — score 70
    // Tries both hyphenated ("Juno-106") and space-normalised ("juno 106")
    if (candidates.length === 0) {
      for (const product of products) {
        if (!product.model_name) continue
        const mOrig = product.model_name.toLowerCase().trim()
        const mSpace = mOrig.replace(/-/g, ' ')
        if (
          (mOrig.length >= 3 && containsToken(norm, mOrig)) ||
          (mSpace !== mOrig && mSpace.length >= 3 && containsToken(norm, mSpace))
        ) {
          candidates.push({
            product_id: product.id,
            method:     'MODEL_NAME',
            score:      70,
            explain:    { matched_model_name: product.model_name },
          })
          break
        }
      }
    }

    if (candidates.length === 0) continue

    const best = candidates.reduce((a, b) => b.score > a.score ? b : a)
    matchRows.push({
      listing_id: listing.id,
      product_id: best.product_id,
      method:     best.method,
      score:      best.score,
      explain:    best.explain,
    })
  }

  const BATCH = 100
  for (let i = 0; i < matchRows.length; i += BATCH) {
    const { error } = await supabase
      .from('listing_product_match')
      .insert(matchRows.slice(i, i + BATCH))
    if (error) throw new Error(`Insert listing_product_match batch ${i}: ${error.message}`)
  }

  return { matched: matchRows.length, total: listings.length }
}
