import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'

// GET /api/admin/product/brands
// Returns all kg_brand rows ordered by name. No pagination — kg_brand is small.
export async function GET() {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('kg_brand')
    .select('id, name')
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ brands: data ?? [] })
}
