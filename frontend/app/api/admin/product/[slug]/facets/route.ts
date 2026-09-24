import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getCurrentAdminState, requireAdminInRoute } from '@/lib/admin-auth'
import { applyFacetWrite, readFacetEntries, validateFacetWrite } from '@/lib/product-facets'

/**
 * PUT /api/admin/product/[slug]/facets
 * Body: { key: 'capsule' | 'circuit' | 'polar_pattern', values: string[] }
 *
 * PAN-140. THE ONLY WRITER of `attributes.facets`. A facet value is a product
 * claim, so it is set one axis at a time by a signed-in admin, validated
 * against the closed vocabulary AND against the product's own leaf (read here
 * from the database, never from the body), and stamped with who and when.
 * An empty `values` unsets the axis.
 *
 * Nothing else on the row is written: every other `attributes` key is carried
 * over by `applyFacetWrite`. Known weakness, accepted with one admin: this is
 * read-modify-write on `attributes`, which the image route also writes.
 */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params
  const denied = await requireAdminInRoute()
  if (denied) return denied
  const { userId } = await getCurrentAdminState()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const db = getSupabaseAdmin()

  const { data: product, error: readErr } = await db
    .from('kg_product')
    .select('id, attributes, subcategory_id')
    .eq('slug', slug)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  if (!product) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  let leafSlug: string | null = null
  if (product.subcategory_id) {
    const { data: leaf, error: leafErr } = await db
      .from('kg_category')
      .select('slug')
      .eq('id', product.subcategory_id)
      .maybeSingle()
    if (leafErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
    leafSlug = (leaf?.slug as string | undefined) ?? null
  }

  const write = validateFacetWrite(body, leafSlug)
  if (!write.ok) return NextResponse.json({ error: write.error }, { status: 400 })

  const provenance = { set_by: userId, set_at: new Date().toISOString() }
  const attributes = applyFacetWrite(product.attributes, write, provenance)

  const { error: writeErr } = await db
    .from('kg_product')
    .update({ attributes })
    .eq('id', product.id)
  if (writeErr) return NextResponse.json({ error: 'write_failed' }, { status: 500 })

  return NextResponse.json({
    key: write.key,
    entry: readFacetEntries(attributes, leafSlug)[write.key] ?? null,
  })
}
