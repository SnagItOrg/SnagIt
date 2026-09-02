import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getCurrentAdminState, requireAdminInRoute } from '@/lib/admin-auth'
import { applyReassign } from '@/lib/admin-match-decision'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/admin/product/[slug]/reassign-match
 * Body: { listing_id: string, target_slug: string }
 *
 * Moves a listing to the product it really is. Delegates to `applyReassign`,
 * which expresses the move as two decisions written in one statement, so a
 * listing that ALREADY has a relation to the target no longer collides with
 * `lpm_listing_product_unique`.
 *
 * NO DATABASE TEXT REACHES THE OPERATOR. The old route returned
 * `updateErr.message` verbatim, which is how "duplicate key value violates
 * unique constraint" ended up in the UI. Nielsen #9: an error must say what
 * happened and what to do, in the reader's language — a constraint name says
 * neither. The detail is logged server-side instead, with no row data and no
 * credentials.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const { userId } = await getCurrentAdminState()
  const { listing_id, target_slug } = (await req.json()) as {
    listing_id?: string
    target_slug?: string
  }

  if (!listing_id || !UUID_RE.test(listing_id)) {
    return NextResponse.json({ error: 'listing_id must be a valid UUID' }, { status: 400 })
  }
  const targetSlug = (target_slug ?? '').trim()
  if (!targetSlug) {
    return NextResponse.json({ error: 'target_slug is required' }, { status: 400 })
  }

  const result = await applyReassign(getSupabaseAdmin(), {
    slug: params.slug,
    listingId: listing_id,
    targetSlug,
    actorUserId: userId,
  })

  if (!result.ok) {
    // Human-readable outward, technical inward.
    const message =
      result.status === 404
        ? 'Kunne ikke finde annoncen eller produktet. Genindlæs siden og prøv igen.'
        : 'Kunne ikke flytte annoncen lige nu. Prøv igen.'
    console.error(JSON.stringify({
      channel: 'operational',
      component: 'admin-reassign',
      event: 'reassign_failed',
      status: result.status,
      detail: result.error ?? 'unknown',
    }))
    return NextResponse.json({ error: message }, { status: result.status })
  }

  return NextResponse.json({
    moved: true,
    target_slug: targetSlug,
    outcome: result.outcome,
  })
}
