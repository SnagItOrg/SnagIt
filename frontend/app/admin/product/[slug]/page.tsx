import { notFound } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import ProductCurationClient, {
  type CurationData,
  type MatchedListing,
  type SynonymRow,
  type ProductHeaderData,
  type NeighborProduct,
  type ThomannEntry,
} from './ProductCurationClient'

type ProductRow = {
  id: string
  slug: string
  canonical_name: string
  tier: string | null
  image_url: string | null
  hero_image_url: string | null
  year_released: number | null
  attributes: Record<string, unknown> | null
  reverb_csp_id: number | null
  kg_brand: { name: string } | { name: string }[] | null
}

type ListingMatchRow = {
  is_valid: boolean | null
  rejected_reason: string | null
  listings: {
    id: string
    title: string
    price: number | null
    price_dkk: number | string | null
    currency: string | null
    country: string | null
    source: string
    location: string | null
    url: string
    image_url: string | null
    is_active: boolean | null
    scraped_at: string
  } | null
}

function resolveBrandName(brand: ProductRow['kg_brand']): string | null {
  if (!brand) return null
  if (Array.isArray(brand)) return brand[0]?.name ?? null
  return brand.name ?? null
}

function toNumber(v: number | string | null): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

async function loadCurationData(slug: string): Promise<CurationData | null> {
  const admin = getSupabaseAdmin()

  const { data: productRow, error: productError } = await admin
    .from('kg_product')
    .select(
      'id, slug, canonical_name, tier, image_url, hero_image_url, year_released, attributes, reverb_csp_id, kg_brand!inner(name)',
    )
    .eq('slug', slug)
    .maybeSingle()

  if (productError) {
    throw new Error(`Failed to load product: ${productError.message}`)
  }
  if (!productRow) return null

  const product = productRow as unknown as ProductRow
  const brandName = resolveBrandName(product.kg_brand)

  // Thomann retail entry — best-effort canonical-name match. The table has no
  // currency column; price_dkk is always DKK by definition.
  const { data: thomannData } = await admin
    .from('thomann_product')
    .select('thomann_url, canonical_name, price_dkk, scraped_at')
    .ilike('canonical_name', `%${product.canonical_name}%`)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const thomann: ThomannEntry | null = thomannData
    ? {
        thomann_url: thomannData.thomann_url,
        canonical_name: thomannData.canonical_name,
        price_dkk: toNumber(thomannData.price_dkk as number | string | null),
        scraped_at: thomannData.scraped_at,
      }
    : null

  // Matched listings — only show unreviewed (NULL) and confirmed (true).
  const { data: matchData, error: matchError } = await admin
    .from('listing_product_match')
    .select(
      'is_valid, rejected_reason, listings!inner(id, title, price, price_dkk, currency, country, source, location, url, image_url, is_active, scraped_at)',
    )
    .eq('product_id', product.id)
    .or('is_valid.is.null,is_valid.eq.true')

  if (matchError) {
    throw new Error(`Failed to load matched listings: ${matchError.message}`)
  }

  const listings: MatchedListing[] = ((matchData ?? []) as unknown as ListingMatchRow[])
    .filter((m) => m.listings != null)
    .map((m) => {
      const l = m.listings!
      return {
        id: l.id,
        title: l.title,
        price: l.price,
        price_dkk: toNumber(l.price_dkk),
        currency: l.currency ?? 'DKK',
        country: l.country,
        source: l.source,
        location: l.location,
        url: l.url,
        image_url: l.image_url,
        is_active: l.is_active ?? true,
        scraped_at: l.scraped_at,
        is_valid: m.is_valid,
        rejected_reason: m.rejected_reason,
      }
    })
    .sort((a, b) => {
      const ap = a.price_dkk
      const bp = b.price_dkk
      if (ap == null && bp == null) return 0
      if (ap == null) return 1
      if (bp == null) return -1
      return ap - bp
    })

  // Synonyms.
  const { data: synonymData, error: synonymError } = await admin
    .from('synonym')
    .select('id, alias, lang, priority')
    .eq('product_id', product.id)
    .order('priority', { ascending: true })
    .order('alias', { ascending: true })

  if (synonymError) {
    throw new Error(`Failed to load synonyms: ${synonymError.message}`)
  }

  const synonyms: SynonymRow[] = (synonymData ?? []).map((s) => ({
    id: s.id as string,
    alias: s.alias as string,
    lang: s.lang as string,
    priority: s.priority as number,
  }))

  // Prev/next legendary product by canonical_name.
  const [{ data: prevData }, { data: nextData }] = await Promise.all([
    admin
      .from('kg_product')
      .select('slug, canonical_name')
      .eq('tier', 'legendary')
      .eq('status', 'active')
      .lt('canonical_name', product.canonical_name)
      .order('canonical_name', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('kg_product')
      .select('slug, canonical_name')
      .eq('tier', 'legendary')
      .eq('status', 'active')
      .gt('canonical_name', product.canonical_name)
      .order('canonical_name', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  const prev: NeighborProduct | null = prevData
    ? { slug: prevData.slug as string, canonical_name: prevData.canonical_name as string }
    : null
  const next: NeighborProduct | null = nextData
    ? { slug: nextData.slug as string, canonical_name: nextData.canonical_name as string }
    : null

  const header: ProductHeaderData = {
    id: product.id,
    slug: product.slug,
    canonical_name: product.canonical_name,
    brand_name: brandName,
    tier: product.tier,
    year_released: product.year_released,
    image_url: product.hero_image_url ?? product.image_url ?? null,
    reverb_csp_id: product.reverb_csp_id,
  }

  return { header, thomann, synonyms, listings, prev, next }
}

export default async function AdminProductCurationPage({
  params,
}: {
  params: { slug: string }
}) {
  const data = await loadCurationData(params.slug)
  if (!data) notFound()
  return <ProductCurationClient data={data} />
}
