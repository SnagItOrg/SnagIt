import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'

// POST /api/admin/product/[slug]/synonym
// Body: { alias: string, lang: string, priority: number }
export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const body = (await req.json()) as {
    alias?: string
    lang?: string
    priority?: number
  }

  const alias = (body.alias ?? '').trim()
  const lang = (body.lang ?? 'da').trim()
  const priority = Number.isFinite(body.priority) ? Number(body.priority) : 5

  if (!alias) {
    return NextResponse.json({ error: 'alias is required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  const { data: product, error: prodErr } = await admin
    .from('kg_product')
    .select('id')
    .eq('slug', params.slug)
    .maybeSingle()

  if (prodErr) {
    return NextResponse.json({ error: prodErr.message }, { status: 500 })
  }
  if (!product) {
    return NextResponse.json({ error: 'product not found' }, { status: 404 })
  }

  // match_type defaults to 'alias' — the synonym table requires it (NOT NULL
  // CHECK constraint). Spec didn't expose it; 'alias' is the catch-all bucket.
  const { data: inserted, error: insertErr } = await admin
    .from('synonym')
    .insert({
      alias,
      lang,
      priority,
      product_id: product.id,
      match_type: 'alias',
    })
    .select('id, alias, lang, priority, product_id')
    .single()

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json(inserted)
}
