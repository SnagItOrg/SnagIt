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

  const page    = parseInt(req.nextUrl.searchParams.get('page')     ?? '0')
  const perPage = parseInt(req.nextUrl.searchParams.get('per_page') ?? '20')
  const from    = page * perPage
  const to      = from + perPage - 1

  const admin = getSupabaseAdmin()

  // Fetch pending rows (paginated)
  const { data: rows, error: rowsErr, count } = await admin
    .from('kg_product')
    .select('id, slug, canonical_name, cleanup_status, brand_id, kg_brand(name)', { count: 'exact' })
    .eq('cleanup_status', 'pending')
    .eq('status', 'active')
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

  // For each pending row, find up to 3 clean parent candidates via trigram similarity
  const results = await Promise.all(pending.map(async (row) => {
    const brandId = row.brand_id

    type CandidateRow = { id: string; slug: string; canonical_name: string; sim: number }
    let candidates: CandidateRow[] = []

    if (brandId) {
      const { data: cands } = await admin.rpc('find_clean_candidates', {
        p_canonical_name: row.canonical_name,
        p_brand_id: brandId,
        p_exclude_id: row.id,
      }) as { data: CandidateRow[] | null }

      candidates = cands ?? []
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
