import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

/**
 * GET /api/admin/product/[slug]/match-review
 *
 * Admin-only match metadata for the public product page's review mode.
 *
 * SEPARATE FROM THE PUBLIC API ON PURPOSE. `/api/product/[slug]` is anonymous,
 * and adding `is_valid` to it would publish Klup's internal adjudication state
 * to everyone. This endpoint carries the review fields instead, behind
 * `requireAdminInRoute`, and the product page merges the two client-side.
 *
 * DELIBERATELY NARROW. It returns the review status and the matcher's own
 * method/score, and nothing else. `explain` is not exposed: it holds
 * `admin_decision.actor_user_id`, and no surface needs to know which colleague
 * rejected a listing in order to render a badge. `rejected_reason` is likewise
 * withheld — the status already says rejected.
 */
export async function GET(
  _req: Request,
  { params }: { params: { slug: string } },
) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const admin = getSupabaseAdmin()

  const productRes = await admin
    .from('kg_product')
    .select('id')
    .eq('slug', params.slug)
    .maybeSingle()

  if (productRes.error) {
    return NextResponse.json({ error: productRes.error.message }, { status: 500 })
  }
  if (!productRes.data) {
    return NextResponse.json({ error: 'product not found' }, { status: 404 })
  }

  const productId = (productRes.data as { id: string }).id

  // Every relation on this product, including rejections: review mode must be
  // able to show and undo a rejection, which the public route cannot serve
  // because it filters them out.
  const matchRes = await admin
    .from('listing_product_match')
    .select('listing_id, is_valid, method, score')
    .eq('product_id', productId)

  if (matchRes.error) {
    return NextResponse.json({ error: matchRes.error.message }, { status: 500 })
  }

  const rows = (matchRes.data ?? []) as Array<{
    listing_id: string
    is_valid: boolean | null
    method: string | null
    score: number | null
  }>

  return NextResponse.json({
    product_id: productId,
    matches: rows.map((r) => ({
      listing_id: r.listing_id,
      status: r.is_valid === true ? 'reviewed' : r.is_valid === false ? 'rejected' : 'unresolved',
      method: r.method,
      score: r.score,
    })),
  })
}
