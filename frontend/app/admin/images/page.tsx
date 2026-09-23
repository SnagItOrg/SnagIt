import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isSupportedMusicProduct, CANONICAL_VISIBILITY } from '@/lib/catalogue'
import ImageCurationClient, { type ImageRow } from './ImageCurationClient'

/**
 * PAN-100 / PAN-110 — one surface for "billeder på alle produkter".
 *
 * The paste-a-URL flow already existed as `scripts/upload-product-images.ts`,
 * which needs a terminal, the Mac Mini and a service-role key. This is the
 * same pipeline behind a page, listed as a queue rather than per product, so
 * the remaining gaps can be closed in one sitting instead of one navigation
 * per instrument.
 *
 * THE COHORT IS THE SUPPORTED ONE, NOT THE PUBLIC ONE. `isSupportedMusicProduct`
 * rather than `isCanonical`: a `qa_only` product still needs a picture before
 * it can be published, and making the operator publish it first in order to
 * see it here would invert the order of the two decisions. Visibility is shown
 * per row instead, never inferred from anything else (CLAUDE.md §5).
 */
export const dynamic = 'force-dynamic'

type ProductRow = {
  slug: string | null
  canonical_name: string | null
  status: string | null
  support_state: string | null
  browse_visibility: string | null
  image_url: string | null
  hero_image_url: string | null
  attributes: Record<string, unknown> | null
}

function trimmed(v: string | null): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

export default async function AdminImagesPage() {
  const db = getSupabaseAdmin()

  const [{ data: products }, { data: projection }] = await Promise.all([
    db
      .from('kg_product')
      .select(
        'slug, canonical_name, status, support_state, browse_visibility, image_url, hero_image_url, attributes',
      )
      .eq('status', 'active')
      .eq('support_state', 'supported'),
    db.from('browse_product_projection').select('slug, browse_domain'),
  ])

  // `browse_domain` is not a column on kg_product, so the music axis comes from
  // the projection and is joined here rather than assumed.
  const domainBySlug = new Map<string, string | null>()
  for (const row of (projection ?? []) as Array<{ slug: string | null; browse_domain: string | null }>) {
    if (typeof row.slug === 'string') domainBySlug.set(row.slug, row.browse_domain)
  }

  const rows: ImageRow[] = []
  for (const p of (products ?? []) as ProductRow[]) {
    if (typeof p.slug !== 'string') continue
    const browse_domain = domainBySlug.get(p.slug) ?? null
    if (!isSupportedMusicProduct({ ...p, browse_domain })) continue

    const hero = trimmed(p.hero_image_url)
    const base = trimmed(p.image_url)
    const provenance = (p.attributes ?? {})['image_provenance'] as
      | { source_url?: unknown }
      | undefined

    rows.push({
      slug: p.slug,
      name: p.canonical_name ?? p.slug,
      currentImage: hero ?? base,
      isCurated: hero !== null,
      isPublic: p.browse_visibility === CANONICAL_VISIBILITY,
      provenanceSourceUrl:
        typeof provenance?.source_url === 'string' ? provenance.source_url : null,
    })
  }

  // Missing first — that is the work. Then by name, so the list is stable
  // across reloads and the operator can keep their place.
  rows.sort((a, b) => {
    const aMissing = a.currentImage === null
    const bMissing = b.currentImage === null
    if (aMissing !== bMissing) return aMissing ? -1 : 1
    return a.name.localeCompare(b.name, 'da')
  })

  return <ImageCurationClient rows={rows} />
}
