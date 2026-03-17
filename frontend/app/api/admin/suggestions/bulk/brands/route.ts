import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

async function verifyAdmin(): Promise<boolean> {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const admin = getSupabaseAdmin()
  const { data: prefs } = await admin
    .from('user_preferences')
    .select('is_admin')
    .eq('user_id', user.id)
    .single()
  return !!prefs?.is_admin
}

// GET /api/admin/suggestions/bulk/brands
// Returns all brands that have at least one pending suggestion, with count
export async function GET() {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = getSupabaseAdmin()

  // Get pending suggestions with brand info
  const { data, error } = await admin
    .from('kg_product_suggestions')
    .select('brand_id, brand_name')
    .eq('status', 'pending')
    .not('brand_id', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aggregate by brand
  const brandMap = new Map<string, { id: string; name: string; count: number }>()
  for (const row of data ?? []) {
    if (!row.brand_id) continue
    const existing = brandMap.get(row.brand_id)
    if (existing) {
      existing.count++
    } else {
      brandMap.set(row.brand_id, {
        id: row.brand_id,
        name: row.brand_name ?? row.brand_id,
        count: 1,
      })
    }
  }

  const brands = Array.from(brandMap.values()).sort((a, b) => b.count - a.count)
  return NextResponse.json({ brands })
}
