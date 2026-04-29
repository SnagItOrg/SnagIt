import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

async function requireAuth() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return user
}

type PendingRow = {
  id: string
  slug: string
  canonical_name: string
  cleanup_status: string | null
  brand_id: string | null
  kg_brand: { name: string } | null
}

type MatchRow = { product_id: string }

// GET /api/admin/cleanup?page=0&per_page=20
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const page      = parseInt(req.nextUrl.searchParams.get('page')     ?? '0')
  const perPage   = parseInt(req.nextUrl.searchParams.get('per_page') ?? '20')
  const brandSlug = req.nextUrl.searchParams.get('brand_slug') ?? null
  const from      = page * perPage
  const to        = from + perPage - 1

  const admin = getSupabaseAdmin()

  // Resolve brand slug to id if provided
  let brandId: string | null = null
  if (brandSlug) {
    const { data: brandRow } = await admin
      .from('kg_brand')
      .select('id')
      .eq('slug', brandSlug)
      .single()
    brandId = brandRow?.id ?? null
  }

  // Fetch pending rows (paginated, optionally filtered by brand)
  let baseQuery = admin
    .from('kg_product')
    .select('id, slug, canonical_name, cleanup_status, brand_id, kg_brand(name)', { count: 'exact' })
    .eq('cleanup_status', 'pending')
    .eq('status', 'active')

  if (brandId) baseQuery = baseQuery.eq('brand_id', brandId)

  const { data: rows, error: rowsErr, count } = await baseQuery
    .range(from, to) as { data: PendingRow[] | null; error: unknown; count: number | null }

  if (rowsErr) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  const pending = rows ?? []
  const productIds = pending.map((r) => r.id)

  // Listing match counts for this page
  const listingCountById: Record<string, number> = {}
  if (productIds.length > 0) {
    const { data: matches } = await admin
      .from('listing_product_match')
      .select('product_id')
      .in('product_id', productIds) as { data: MatchRow[] | null }

    for (const m of matches ?? []) {
      listingCountById[m.product_id] = (listingCountById[m.product_id] ?? 0) + 1
    }
  }

  // For each pending row, find up to 5 clean parent candidates via trigram similarity
  const results = await Promise.all(pending.map(async (row) => {
    const brandId = row.brand_id

    type CandidateRow = { id: string; slug: string; canonical_name: string; sim: number }
    let candidates: CandidateRow[] = []

    if (brandId) {
      const searchTerm = stripSearchTerm(row.canonical_name)
      const { data: cands } = await admin.rpc('find_clean_candidates', {
        p_canonical_name: searchTerm,
        p_brand_id: brandId,
        p_exclude_id: row.id,
      }) as { data: CandidateRow[] | null }

      candidates = cands ?? []

      // Apply similarity floor
      candidates = candidates.filter((c) => c.sim >= 0.4)

      // Deduplicate near-duplicate candidates
      const deduped: CandidateRow[] = []
      for (const c of candidates) {
        const isDupe = deduped.some(
          (accepted) => jsSimilarity(accepted.canonical_name, c.canonical_name) > 0.85
        )
        if (!isDupe) deduped.push(c)
      }
      candidates = deduped
    }

    // Reconstruct flags client-side from canonical_name/slug
    const flags = deriveFlags(row.slug, row.canonical_name)

    return {
      id: row.id,
      slug: row.slug,
      canonical_name: row.canonical_name,
      brand_name: row.kg_brand?.name ?? '',
      flags,
      listing_match_count: listingCountById[row.id] ?? 0,
      candidates,
    }
  }))

  return NextResponse.json({
    items: results,
    total_pending: count ?? 0,
    page,
    per_page: perPage,
  })
}

// ── Search term stripping ─────────────────────────────────────────────────────

const NOISE_WORDS_RE = /\b(Synthesizer|Monophonic|Analog|Polyphonic|Vintage|Black|White|Silver|Gold|Original|Standard|Classic|Serviced|Restored|Modified)\b/gi
const KEY_COUNT_RE   = /\s*\d+[-\s]?Keys?\b/gi  // e.g. "49-Key", "61 Keys", "25Key"

function stripSearchTerm(name: string): string {
  let s = name.trim()
  // Remove bracketed and parenthesised content first
  s = s.replace(/\[.*?\]/g, '')
  s = s.replace(/\(.*?\)/g, '')
  // Remove special characters
  s = s.replace(/[:|*!]/g, '')
  // Collapse after special char removal before further stripping
  s = s.replace(/\s+/g, ' ').trim()
  // Remove leading duplicate brand word: "Roland Roland Jupiter" → "Roland Jupiter"
  s = s.replace(/^(\S+)\s+\1\s+/i, '$1 ')
  // Remove 4-digit year and everything after it
  s = s.replace(/\s*\d{4}.*$/, '')
  // Remove keyboard key-count descriptors
  s = s.replace(KEY_COUNT_RE, '')
  // Remove noise words
  s = s.replace(NOISE_WORDS_RE, '')
  // Strip trailing punctuation artifacts and collapse whitespace
  s = s.replace(/[-\s]+$/, '').replace(/\s+/g, ' ').trim()
  // Truncate to first 4 words — prevents compound names from splitting trigram similarity
  s = s.split(' ').slice(0, 4).join(' ')
  return s || name.trim()  // fallback to original if stripping empties the string
}

// ── Bigram similarity helpers ─────────────────────────────────────────────────

function normalizeName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

function jsSimilarity(a: string, b: string): number {
  const na = normalizeName(a), nb = normalizeName(b)
  if (na === nb) return 1
  const ba: string[] = [], bb: string[] = []
  for (let i = 0; i < na.length - 1; i++) ba.push(na.slice(i, i + 2))
  for (let i = 0; i < nb.length - 1; i++) bb.push(nb.slice(i, i + 2))
  if (ba.length === 0 && bb.length === 0) return 1
  if (ba.length === 0 || bb.length === 0) return 0
  let intersection = 0
  for (const bg of ba) { if (bb.indexOf(bg) !== -1) intersection++ }
  return (2 * intersection) / (ba.length + bb.length)
}

// ── Flag reconstruction (mirrors flag-dirty-products.ts logic) ────────────────

const YEAR_RE = /\d{4}/
const CONDITION_RE = /refin|relic|(?:heavy |light |ultra light )?aged|murphy lab|played in/i
const LANGUAGE_RE = /chitarra|basso|clavier|guitare|elektrisch|gitarre|acustica|elettric[oa]/i
const MAX_WORDS = 8

function deriveFlags(slug: string, canonicalName: string): string[] {
  const flags: string[] = []
  if (YEAR_RE.test(canonicalName))       flags.push('has_year')
  if (CONDITION_RE.test(canonicalName))  flags.push('has_condition_word')
  if (LANGUAGE_RE.test(canonicalName))   flags.push('has_language_qualifier')
  if (canonicalName.trim().split(/\s+/).length > MAX_WORDS) flags.push('too_long')
  // duplicated_brand: check for repeated segment in slug
  const parts = slug.split('-')
  if (parts.length >= 2 && parts[0] === parts[1]) flags.push('duplicated_brand')
  return flags
}
