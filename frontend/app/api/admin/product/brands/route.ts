import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'
import { findBrandNearMatches, brandKey, type BrandRow } from '@/lib/brand-identity'

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

// GET /api/admin/product/brands
// Returns all kg_brand rows ordered by name. No pagination — kg_brand is small.
export async function GET() {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('kg_brand')
    .select('id, name, slug')
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ brands: data ?? [] })
}

function bad(field: string, error: string) {
  return NextResponse.json({ error, field }, { status: 400 })
}

type Admin = ReturnType<typeof getSupabaseAdmin>

// Every brand, or an error. The near-match check is only as good as the list
// it runs against, so a truncated list (PostgREST caps a response at 1000
// rows) fails closed instead of letting a duplicate through.
async function loadAllBrands(admin: Admin): Promise<BrandRow[] | string> {
  const { data, count, error } = await admin
    .from('kg_brand')
    .select('id, name, slug', { count: 'exact' })
  if (error) return error.message
  if (!data || count !== data.length) return 'brand list incomplete; duplicate check cannot run'
  return data
}

// POST /api/admin/product/brands
// Body { name, slug }. Creates one kg_brand row and nothing else: no product,
// no monitoring, no visibility — a brand appears nowhere public until a product
// under it is separately published.
//   201 { brand }                            created
//   409 { error: 'brand_exists', matches }   same name/slug up to case,
//                                            whitespace, separators; not inserted
//   400 { error, field }                     invalid input
export async function POST(req: NextRequest) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const body = (await req.json().catch(() => ({}))) as { name?: unknown; slug?: unknown }
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''

  if (!brandKey(name)) return bad('name', 'name is required')
  if (name.length > 100) return bad('name', 'name must be at most 100 characters')
  if (!SLUG_RE.test(slug)) return bad('slug', 'slug must be lowercase letters, digits, and hyphens')
  if (slug.length > 100) return bad('slug', 'slug must be at most 100 characters')

  const admin = getSupabaseAdmin()

  const existing = await loadAllBrands(admin)
  if (typeof existing === 'string') return NextResponse.json({ error: existing }, { status: 500 })
  const matches = findBrandNearMatches({ name, slug }, existing)
  if (matches.length > 0) {
    return NextResponse.json({ error: 'brand_exists', matches }, { status: 409 })
  }

  // kg_brand.category_id is a legacy NOT NULL column (008). Music gear is the
  // only vertical, and the music root is what migration 056 gave the brands it
  // created; kg_product.category_id is derived from it at product creation.
  const { data: root, error: rootErr } = await admin
    .from('kg_category')
    .select('id')
    .eq('slug', 'music-gear')
    .is('parent_id', null)
    .maybeSingle()
  if (rootErr || !root) {
    return NextResponse.json({ error: rootErr?.message ?? 'music-gear root not found' }, { status: 500 })
  }

  const { data: brand, error: insertErr } = await admin
    .from('kg_brand')
    .insert({ name, slug, category_id: root.id })
    .select('id, name, slug')
    .single()

  if (insertErr?.code === '23505') {
    // Another request took this slug between our check and our insert.
    const now = await loadAllBrands(admin)
    const raced = typeof now === 'string' ? [] : findBrandNearMatches({ name, slug }, now)
    return NextResponse.json({ error: 'brand_exists', matches: raced }, { status: 409 })
  }
  if (insertErr || !brand) {
    return NextResponse.json({ error: insertErr?.message ?? 'insert failed' }, { status: 500 })
  }

  return NextResponse.json({ brand }, { status: 201 })
}
