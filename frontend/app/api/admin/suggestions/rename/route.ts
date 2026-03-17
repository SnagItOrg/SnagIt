import { NextRequest, NextResponse } from 'next/server'
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

// GET — fetch all kg_product with brand name (for rename preview)
export async function GET() {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = getSupabaseAdmin()

  // Paginate to get all products
  const PAGE_SIZE = 1000
  const all: Array<{ id: string; canonical_name: string; brand_name: string }> = []
  let page = 0
  while (true) {
    const { data, error } = await admin
      .from('kg_product')
      .select('id, canonical_name, kg_brand!inner(name)')
      .eq('status', 'active')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break

    for (const row of data) {
      all.push({
        id: row.id,
        canonical_name: row.canonical_name,
        brand_name: (row.kg_brand as unknown as { name: string }).name,
      })
    }
    if (data.length < PAGE_SIZE) break
    page++
  }

  return NextResponse.json(all)
}

// POST — batch rename kg_product canonical_names
// Body: { renames: [{ id: string, canonical_name: string }] }
export async function POST(req: NextRequest) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { renames } = await req.json() as { renames: Array<{ id: string; canonical_name: string }> }
  if (!Array.isArray(renames) || renames.length === 0) {
    return NextResponse.json({ error: 'No renames provided' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  let updated = 0
  let failed = 0

  // Update one by one (each row has a different name)
  for (const r of renames) {
    const slug = r.canonical_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

    const { error } = await admin
      .from('kg_product')
      .update({ canonical_name: r.canonical_name, slug })
      .eq('id', r.id)

    if (error) failed++
    else updated++
  }

  return NextResponse.json({ updated, failed })
}
