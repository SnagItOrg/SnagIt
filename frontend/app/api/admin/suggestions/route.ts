import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

async function verifyAdmin(): Promise<{ ok: true; userId: string } | { ok: false }> {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const admin = getSupabaseAdmin()
  const { data: prefs } = await admin
    .from('user_preferences')
    .select('is_admin')
    .eq('user_id', user.id)
    .single()
  if (!prefs?.is_admin) return { ok: false }
  return { ok: true, userId: user.id }
}

// GET /api/admin/suggestions?status=pending&offset=0&limit=50
export async function GET(req: NextRequest) {
  const auth = await verifyAdmin()
  if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const status = req.nextUrl.searchParams.get('status') ?? 'pending'
  const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10)
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)

  const admin = getSupabaseAdmin()

  const { data, error, count } = await admin
    .from('kg_product_suggestions')
    .select('*', { count: 'exact' })
    .eq('status', status)
    .order('listing_count', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // For pending suggestions, check for possible duplicates in kg_product
  let duplicates: Record<string, { id: string; canonical_name: string }> = {}
  if (status === 'pending' && data && data.length > 0) {
    // Build ilike patterns: extract key words from each suggestion name
    // We check each suggestion against kg_product for close matches
    const suggestions = data as Array<{ id: string; canonical_name: string; brand_id: string | null }>

    // Batch check: for each suggestion with a brand_id, look for any kg_product
    // under that brand where the name contains the same model identifier
    const brandIds = Array.from(new Set(suggestions.filter(s => s.brand_id).map(s => s.brand_id!)))

    if (brandIds.length > 0) {
      const { data: existingProducts } = await admin
        .from('kg_product')
        .select('id, canonical_name, brand_id')
        .in('brand_id', brandIds)

      if (existingProducts && existingProducts.length > 0) {
        // Build a map of brand_id -> products for fast lookup
        const brandProducts = new Map<string, Array<{ id: string; canonical_name: string }>>()
        for (const p of existingProducts) {
          const list = brandProducts.get(p.brand_id) ?? []
          list.push({ id: p.id, canonical_name: p.canonical_name })
          brandProducts.set(p.brand_id, list)
        }

        for (const s of suggestions) {
          if (!s.brand_id) continue
          const products = brandProducts.get(s.brand_id)
          if (!products) continue

          const sLower = s.canonical_name.toLowerCase()
          for (const p of products) {
            const pLower = p.canonical_name.toLowerCase()
            // Check if one contains the other, or they share a significant overlap
            if (sLower === pLower || sLower.includes(pLower) || pLower.includes(sLower)) {
              duplicates[s.id] = { id: p.id, canonical_name: p.canonical_name }
              break
            }
          }
        }
      }
    }
  }

  return NextResponse.json({
    suggestions: data ?? [],
    total: count ?? 0,
    duplicates,
  })
}
