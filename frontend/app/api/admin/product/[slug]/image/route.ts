import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getCurrentAdminState } from '@/lib/admin-auth'
import {
  ProductImageError,
  fetchAndConvert,
  storeCuratedHero,
  type ImageProvenance,
} from '@/lib/product-image'

/**
 * POST /api/admin/product/[slug]/image
 * Body: { source_url: string }
 *
 * PAN-100. Fetches the pasted address server-side, converts to webp, stores it
 * and points `hero_image_url` at the stored asset.
 *
 * WHAT THIS WRITES, AND WHAT IT DOES NOT.
 * Two fields on one row: `hero_image_url`, and an `image_provenance` key inside
 * the existing `attributes` jsonb. `image_url` is never touched — it is the
 * automated axis, and a later CSP re-pull must not be able to silently undo a
 * human decision. Nor are `status`, `support_state`, `browse_visibility` or
 * anything taxonomic: publishing is a separate action with its own authority
 * in `lib/publication.ts` (CLAUDE.md §5), and this route has no opinion on it.
 *
 * THE FETCH HAPPENS HERE, NOT IN THE BROWSER. The browser never hands bytes to
 * storage; it hands over a URL and this route decides whether it is usable.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params

  const admin = await getCurrentAdminState()
  if (!admin.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!admin.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { source_url?: unknown }
  try {
    body = (await req.json()) as { source_url?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid_body', message: 'Malformed request.' }, { status: 400 })
  }

  const sourceUrl = typeof body.source_url === 'string' ? body.source_url.trim() : ''
  if (!sourceUrl) {
    return NextResponse.json(
      { error: 'invalid_url', message: 'Paste an image address first.' },
      { status: 400 },
    )
  }

  const db = getSupabaseAdmin()

  // Refuse before fetching anything: an unknown slug should cost the operator a
  // message, not a download.
  const { data: product, error: readErr } = await db
    .from('kg_product')
    .select('id, slug, canonical_name, attributes')
    .eq('slug', slug)
    .maybeSingle()

  if (readErr) {
    return NextResponse.json({ error: 'lookup_failed', message: readErr.message }, { status: 500 })
  }
  if (!product) {
    return NextResponse.json(
      { error: 'not_found', message: 'No product with that slug.' },
      { status: 404 },
    )
  }

  let stored: string
  let width: number
  let height: number
  let bytes: number

  try {
    const converted = await fetchAndConvert(sourceUrl)
    width = converted.width
    height = converted.height
    bytes = converted.webp.byteLength
    stored = await storeCuratedHero(
      db,
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      slug,
      converted.webp,
    )
  } catch (e) {
    if (e instanceof ProductImageError) {
      // Fail closed: the product keeps whatever image it already had, and the
      // operator is told which of the four things went wrong.
      const status = e.reason === 'storage_failed' ? 502 : 400
      return NextResponse.json({ error: e.reason, message: e.message }, { status })
    }
    return NextResponse.json(
      { error: 'unexpected', message: 'The image could not be processed.' },
      { status: 500 },
    )
  }

  const provenance: ImageProvenance = {
    source_url: sourceUrl,
    stored_url: stored,
    source: 'admin_paste',
    acquired_at: new Date().toISOString(),
    acquired_by: admin.userId,
    review_state: 'approved',
    bytes,
    width,
    height,
  }

  const attributes = {
    ...((product.attributes as Record<string, unknown> | null) ?? {}),
    image_provenance: provenance,
  }

  const { error: writeErr } = await db
    .from('kg_product')
    .update({ hero_image_url: stored, attributes })
    .eq('slug', slug)

  if (writeErr) {
    return NextResponse.json({ error: 'write_failed', message: writeErr.message }, { status: 500 })
  }

  return NextResponse.json({
    slug,
    hero_image_url: stored,
    width,
    height,
    bytes,
    acquired_at: provenance.acquired_at,
  })
}
