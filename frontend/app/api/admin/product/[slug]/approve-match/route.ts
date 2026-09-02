import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getCurrentAdminState, requireAdminInRoute } from '@/lib/admin-auth'
import { applyProductPageDecision } from '@/lib/admin-match-decision'

/**
 * POST /api/admin/product/[slug]/approve-match
 * Body: { listing_id: string }
 *
 * Confirms an unreviewed (`is_valid IS NULL`) relation, or re-confirms one that
 * was rejected. Same scope and same provenance shape as the rejection: the two
 * decisions are one contract with opposite dispositions, so they cannot drift.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const { userId } = await getCurrentAdminState()
  const { listing_id } = (await req.json()) as { listing_id?: string }

  if (!listing_id) {
    return NextResponse.json({ error: 'listing_id is required' }, { status: 400 })
  }

  const result = await applyProductPageDecision(getSupabaseAdmin(), {
    slug: params.slug,
    listingId: listing_id,
    decision: 'approve',
    actorUserId: userId,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ updated: true, is_valid: result.isValid })
}
