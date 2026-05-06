import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'

const TIERS = new Set(['legendary', 'classic', 'standard'])
const STATUSES = new Set(['active', 'inactive'])
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Body = {
  canonical_name?: string
  slug?: string
  brand_id?: string
  model_name?: string
  tier?: string
  status?: string
  year_released?: number | string | null
  subcategory_id?: string | null
}

function bad(field: string, error: string) {
  return NextResponse.json({ error, field }, { status: 400 })
}

// POST /api/admin/product/new
// Creates a new kg_product row. See SUBMISSION SPEC in the curation feature
// docs for the full validation contract. category_id (legacy NOT NULL) is
// derived from kg_brand.category_id at insert time — clients only ever
// provide brand_id + optional subcategory_id.
export async function POST(req: NextRequest) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const body = (await req.json()) as Body

  // 1. canonical_name
  const canonicalName = (body.canonical_name ?? '').trim()
  if (!canonicalName) return bad('canonical_name', 'canonical_name is required')
  if (canonicalName.length < 3) return bad('canonical_name', 'canonical_name must be at least 3 characters')
  if (canonicalName.length > 200) return bad('canonical_name', 'canonical_name must be at most 200 characters')

  // 2. slug
  const slug = (body.slug ?? '').trim()
  if (!slug) return bad('slug', 'slug is required')
  if (slug.length > 200) return bad('slug', 'slug must be at most 200 characters')
  if (!SLUG_RE.test(slug)) return bad('slug', 'slug must be lowercase letters, digits, and hyphens')

  // 3. brand_id
  const brandId = (body.brand_id ?? '').trim()
  if (!brandId) return bad('brand_id', 'brand_id is required')
  if (!UUID_RE.test(brandId)) return bad('brand_id', 'brand_id must be a valid UUID')

  // 4. model_name
  const modelName = (body.model_name ?? '').trim()
  if (!modelName) return bad('model_name', 'model_name is required')
  if (modelName.length < 2) return bad('model_name', 'model_name must be at least 2 characters')
  if (modelName.length > 100) return bad('model_name', 'model_name must be at most 100 characters')

  // 5. tier
  const tier = (body.tier ?? '').trim()
  if (!tier) return bad('tier', 'tier is required')
  if (!TIERS.has(tier)) return bad('tier', 'tier must be legendary, classic, or standard')

  // 6. status
  const status = (body.status ?? 'active').trim() || 'active'
  if (!STATUSES.has(status)) return bad('status', 'status must be active or inactive')

  // 7. year_released
  let yearReleased: number | null = null
  if (body.year_released != null && body.year_released !== '') {
    const n = typeof body.year_released === 'number'
      ? body.year_released
      : parseInt(String(body.year_released), 10)
    if (!Number.isInteger(n) || n < 1900 || n > 2030) {
      return bad('year_released', 'year_released must be an integer between 1900 and 2030')
    }
    yearReleased = n
  }

  // 8. subcategory_id
  let subcategoryId: string | null = null
  if (body.subcategory_id) {
    if (!UUID_RE.test(body.subcategory_id)) {
      return bad('subcategory_id', 'subcategory_id must be a valid UUID')
    }
    subcategoryId = body.subcategory_id
  }

  const admin = getSupabaseAdmin()

  // Slug uniqueness — return 409 (no auto-suffix per spec).
  const { data: existing, error: existsErr } = await admin
    .from('kg_product')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (existsErr) {
    return NextResponse.json({ error: existsErr.message }, { status: 500 })
  }
  if (existing) {
    return NextResponse.json({ error: 'slug_exists', slug }, { status: 409 })
  }

  // Resolve legacy NOT NULL category_id from the brand row.
  const { data: brand, error: brandErr } = await admin
    .from('kg_brand')
    .select('id, category_id')
    .eq('id', brandId)
    .maybeSingle()

  if (brandErr) {
    return NextResponse.json({ error: brandErr.message }, { status: 500 })
  }
  if (!brand) {
    return bad('brand_id', 'brand not found')
  }

  const insertRow: Record<string, unknown> = {
    canonical_name: canonicalName,
    slug,
    model_name: modelName,
    brand_id: brandId,
    category_id: brand.category_id,
    tier,
    status,
    year_released: yearReleased,
    subcategory_id: subcategoryId,
    browse_visibility: 'qa_only',
  }

  const { data: inserted, error: insertErr } = await admin
    .from('kg_product')
    .insert(insertRow)
    .select('id, slug')
    .single()

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'insert failed' },
      { status: 500 },
    )
  }

  return NextResponse.json(
    { id: inserted.id, slug: inserted.slug },
    { status: 201 },
  )
}
