import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'

// GET /api/admin/product/subcategories
// Returns leaf kg_category rows (parent_id IS NOT NULL) with their parent's
// name resolved client-side from a single second query — kg_category is small
// (~340 rows) so we load both lists and merge in TS.
export async function GET() {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const admin = getSupabaseAdmin()

  const { data, error } = await admin
    .from('kg_category')
    .select('id, name, parent_id')
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as { id: string; name: string; parent_id: string | null }[]
  const byId = new Map(rows.map((r) => [r.id, r]))

  const subcategories = rows
    .filter((r) => r.parent_id != null)
    .map((r) => ({
      id: r.id,
      name: r.name,
      parent_name: r.parent_id ? byId.get(r.parent_id)?.name ?? null : null,
    }))

  return NextResponse.json({ subcategories })
}
