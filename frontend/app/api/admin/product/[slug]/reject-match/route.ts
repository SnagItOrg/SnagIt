import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getCurrentAdminState, requireAdminInRoute } from '@/lib/admin-auth'
import { applyProductPageDecision } from '@/lib/admin-match-decision'

/**
 * POST /api/admin/product/[slug]/reject-match
 * Body: { listing_id: string }
 *
 * Rejects ONE relation, scoped to (listing_id, product_id) where product_id is
 * resolved from the slug on the server.
 *
 * This used to write `is_valid = false` and a reason directly, which recorded
 * no operator, no timestamp and no source — a product-page rejection was
 * indistinguishable from a matcher verdict. It now delegates to the same
 * planner `/api/admin/match/approve` uses, so both surfaces write one
 * `explain.admin_decision` shape. `reason` is still accepted and is recorded as
 * `admin_decision.operator_note`, so provenance and a human explanation coexist
 * instead of competing for one column.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const { userId } = await getCurrentAdminState()
  // `reason` stays in the accepted contract: the route documented it before
  // this change, and dropping a field an external caller may still send would
  // be a silent break. It is recorded as `admin_decision.operator_note`.
  const { listing_id, reason } = (await req.json()) as { listing_id?: string; reason?: string }

  if (!listing_id) {
    return NextResponse.json({ error: 'listing_id is required' }, { status: 400 })
  }

  const result = await applyProductPageDecision(getSupabaseAdmin(), {
    slug: params.slug,
    listingId: listing_id,
    decision: 'reject',
    actorUserId: userId,
    operatorNote: reason ?? null,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ updated: true, is_valid: result.isValid })
}
