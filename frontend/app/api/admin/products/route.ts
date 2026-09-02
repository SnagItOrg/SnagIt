import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getCurrentAdminState } from '@/lib/admin-auth'
import { effectiveExposure } from '@/lib/catalogue'

export async function GET(req: NextRequest) {
  const { userId, isAdmin } = await getCurrentAdminState()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = getSupabaseAdmin()
  const q = req.nextUrl.searchParams.get('q')?.trim()
  const tier = req.nextUrl.searchParams.get('tier')

  /**
   * All four exposure axes, not just visibility.
   *
   * The list badged `browse_visibility` alone and called `public` "Public",
   * which is true of 35 rows while only 14 have a product page. Deciding the
   * effective state needs `status` and `support_state` too, and — for browse —
   * `taxonomy_state`, which is derived by `browse_product_projection` rather
   * than stored on `kg_product`.
   */
  let query = admin
    .from('kg_product')
    .select('id, slug, canonical_name, tier, status, support_state, browse_visibility, subcategory_id, year_released, image_url, kg_brand(name)')
    .eq('status', 'active')
    .order('canonical_name')
    .limit(60)

  if (q) {
    query = query.ilike('canonical_name', `%${q}%`)
  } else if (tier) {
    query = query.eq('tier', tier)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const products = (data ?? []) as Array<Record<string, unknown>>
  if (products.length === 0) return NextResponse.json({ products: [] })

  // The derived axes, read from the view rather than recomputed here so there
  // stays exactly one definition of "classified".
  const ids = products.map((p) => p.id as string)
  const { data: proj, error: projErr } = await admin
    .from('browse_product_projection')
    .select('id, taxonomy_state, browse_domain')
    .in('id', ids)

  // Fail closed and say so. Guessing `classified` here would badge a product as
  // live in browse when nothing is known about its taxonomy.
  if (projErr) return NextResponse.json({ error: projErr.message }, { status: 500 })

  const derived = new Map(
    ((proj ?? []) as Array<{ id: string; taxonomy_state: string | null; browse_domain: string | null }>)
      .map((r) => [r.id, r]),
  )

  /**
   * The effective state is computed HERE, not in the browser.
   * `lib/catalogue.ts` is server-only — a client module must not reach
   * catalogue eligibility by value import (WP-4a boundary) — so the admin page
   * receives a plain string and renders a label for it.
   */
  return NextResponse.json({
    products: products.map((p) => {
      const d = derived.get(p.id as string)
      const row = {
        status: p.status as string | null,
        support_state: p.support_state as string | null,
        browse_visibility: p.browse_visibility as string | null,
        browse_domain: d?.browse_domain ?? null,
        taxonomy_state: d?.taxonomy_state ?? null,
      }
      return { ...p, ...row, exposure: effectiveExposure(row) }
    }),
  })
}
