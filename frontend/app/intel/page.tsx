import { getSupabaseAdmin } from '@/lib/supabase-admin'

type ProductRow = {
  id: string
  canonical_name: string
}

type MatchWithListing = {
  product_id: string
  listings: {
    id: string
    country: string | null
    price_dkk: number | string | null
  } | null
}

type IntelRow = {
  id: string
  canonical_name: string
  dk_count: number
  de_count: number
  dk_median_dkk: number | null
  de_median_dkk: number | null
  delta_dkk: number | null
}

function toNumber(value: number | string | null): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function formatDkk(value: number | null) {
  if (value == null) return '—'
  return new Intl.NumberFormat('da-DK').format(value)
}

async function loadIntelRows(): Promise<IntelRow[]> {
  const admin = getSupabaseAdmin()

  const { data: products, error: productsError } = await admin
    .from('kg_product')
    .select('id, canonical_name')
    .eq('tier', 'legendary')
    .eq('status', 'active')
    .order('canonical_name', { ascending: true })

  if (productsError) {
    throw new Error(`Failed to load legendary products: ${productsError.message}`)
  }

  const productRows = (products ?? []) as ProductRow[]
  if (productRows.length === 0) return []

  const productIds = productRows.map((product) => product.id)

  const { data: matches, error: matchesError } = await admin
    .from('listing_product_match')
    .select('product_id, listings!inner(id, country, price_dkk)')
    .in('product_id', productIds)
    .eq('listings.is_active', true)
    .in('listings.country', ['DK', 'DE'])

  if (matchesError) {
    throw new Error(`Failed to load matched listings: ${matchesError.message}`)
  }

  const matchRows = (matches ?? []) as unknown as MatchWithListing[]

  const pricesByProduct = new Map<string, { DK: number[]; DE: number[] }>()
  for (const product of productRows) {
    pricesByProduct.set(product.id, { DK: [], DE: [] })
  }

  for (const match of matchRows) {
    const listing = match.listings
    if (!listing) continue
    if (listing.country !== 'DK' && listing.country !== 'DE') continue
    const price = toNumber(listing.price_dkk)
    if (price == null) continue
    pricesByProduct.get(match.product_id)?.[listing.country].push(price)
  }

  return productRows
    .map((product) => {
      const prices = pricesByProduct.get(product.id) ?? { DK: [], DE: [] }
      const dkMedian = median(prices.DK)
      const deMedian = median(prices.DE)
      return {
        id: product.id,
        canonical_name: product.canonical_name,
        dk_count: prices.DK.length,
        de_count: prices.DE.length,
        dk_median_dkk: dkMedian,
        de_median_dkk: deMedian,
        delta_dkk: dkMedian != null && deMedian != null ? dkMedian - deMedian : null,
      }
    })
    .sort((a, b) => {
      if (a.delta_dkk == null && b.delta_dkk == null) {
        return a.canonical_name.localeCompare(b.canonical_name, 'en')
      }
      if (a.delta_dkk == null) return 1
      if (b.delta_dkk == null) return -1
      if (b.delta_dkk !== a.delta_dkk) return b.delta_dkk - a.delta_dkk
      return a.canonical_name.localeCompare(b.canonical_name, 'en')
    })
}

export default async function IntelPage() {
  const rows = await loadIntelRows()

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#0a0a0a',
        color: '#f5f5f5',
        padding: '32px 24px 64px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 1440, margin: '0 auto' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 600, margin: 0 }}>Intel</h1>

        <div style={{ marginTop: 24, borderTop: '1px solid #222' }}>
          {rows.map((row) => (
            <div
              key={row.id}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(260px, 1.4fr) 1fr 1fr 0.8fr',
                gap: '16px',
                padding: '14px 0',
                borderBottom: '1px solid #171717',
                alignItems: 'center',
              }}
            >
              <div style={{ fontSize: '14px', lineHeight: 1.4 }}>{row.canonical_name}</div>
              <div
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '13px',
                  color: '#d4d4d4',
                }}
              >
                <span style={{ color: '#8a8a8a', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>DK:</span>{' '}
                {row.dk_count} listings / {formatDkk(row.dk_median_dkk)} DKK
              </div>
              <div
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '13px',
                  color: '#d4d4d4',
                }}
              >
                <span style={{ color: '#8a8a8a', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>DE:</span>{' '}
                {row.de_count} listings / {formatDkk(row.de_median_dkk)} DKK
              </div>
              <div
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '13px',
                  color: row.delta_dkk != null ? '#f5f5f5' : '#707070',
                  textAlign: 'right',
                }}
              >
                <span style={{ color: '#8a8a8a', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>Delta:</span>{' '}
                {row.delta_dkk != null ? `${formatDkk(row.delta_dkk)} DKK` : '—'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
