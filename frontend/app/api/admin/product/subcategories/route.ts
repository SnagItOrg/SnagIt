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
    .select('id, name, parent_id, domain')
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as { id: string; name: string; parent_id: string | null; domain: string | null }[]
  const byId = new Map(rows.map((r) => [r.id, r]))

  /**
   * `classifies` mirrors the rule in `browse_product_projection`: a music leaf
   * whose parent is a music ROOT. All 320 leaves are music but only 15 of 20
   * roots are, so a leaf can hang off a non-music root and produce
   * `missing_root_mapping` — a save that looks successful and changes nothing
   * visible. Marking the choice lets the operator see that before saving; the
   * PATCH route refuses it regardless.
   */
  const subcategories = rows
    .filter((r) => r.parent_id != null)
    .map((r) => {
      const root = r.parent_id ? byId.get(r.parent_id) ?? null : null
      return {
        id: r.id,
        name: r.name,
        parent_name: root?.name ?? null,
        classifies: r.domain === 'music' && root != null && root.parent_id === null && root.domain === 'music',
      }
    })

  return NextResponse.json({ subcategories })
}
