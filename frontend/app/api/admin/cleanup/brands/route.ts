import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'

type Row = {
  brand_id: string | null
  kg_brand: { name: string; slug: string } | null
}

// GET /api/admin/cleanup/brands
// Returns distinct brands with pending product counts
export async function GET() {
  // S1. Admin authorisation runs FIRST — before the body is parsed, before a
  // Supabase client is constructed and before any read or write. The edge
  // classification in lib/route-access.ts already denies non-admins, and it
  // stays; this is the second layer, so a middleware regression cannot turn a
  // catalogue-mutating route into an open one.
  //
  // It replaces a local `requireAuth()` that checked only for A SESSION. Any
  // signed-in visitor satisfied it, and these routes inactivate, merge and
  // insert `kg_product` rows. requireAdminInRoute() is the repository's
  // existing helper: 401 without a session, 403 without `is_admin`.
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('kg_product')
    .select('brand_id, kg_brand(name, slug)')
    .eq('cleanup_status', 'pending')
    .eq('status', 'active') as { data: Row[] | null; error: unknown }

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  const map = new Map<string, { name: string; slug: string; count: number }>()
  for (const row of data ?? []) {
    if (!row.brand_id || !row.kg_brand) continue
    const key = row.brand_id
    if (!map.has(key)) map.set(key, { name: row.kg_brand.name, slug: row.kg_brand.slug, count: 0 })
    map.get(key)!.count++
  }

  const brands = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ brands })
}
