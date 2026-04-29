import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

async function requireAuth() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return user
}

type Row = {
  brand_id: string | null
  kg_brand: { name: string; slug: string } | null
}

// GET /api/admin/cleanup/brands
// Returns distinct brands with pending product counts
export async function GET() {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
