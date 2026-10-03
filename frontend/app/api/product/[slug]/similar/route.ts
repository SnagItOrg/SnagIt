/**
 * GET /api/product/[slug]/similar — the "Lignende udstyr" cards (PAN-235).
 *
 * Its own route rather than a field on /api/product/[slug], so the heavy
 * product payload is not held back by it and the section fills in on its own.
 *
 * Nothing private crosses the wire: every candidate is a public product row
 * read from `browse_product_projection`, filtered through `isCanonical()`
 * (the one eligibility authority, which also refuses family labels), and the
 * response is built field by field.
 *
 * The ranking lives in `lib/similar-gear.ts`; this file only gathers the
 * three sources and the medians. Derived relations are never stored.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isCanonical } from '@/lib/catalogue'
import { familyForChild } from '@/lib/families'
import { median } from '@/lib/statistics'
import {
  rankSimilar,
  relationReason,
  SIMILAR_MAX,
  type SimilarCandidate,
  type SimilarPick,
  type SimilarReason,
} from '@/lib/similar-gear'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

/** How many same-type rows are priced before the cut. Keeps the price read bounded. */
const SAME_TYPE_POOL = 16

export type SimilarProduct = {
  slug: string
  name: string
  brand: string | null
  image_url: string | null
  tier: string | null
  active_listing_count: number
  reason: SimilarReason
}

type Row = SimilarCandidate & {
  id: string
  canonical_name: string
  brand_name: string | null
  image_url: string | null
  tier: string | null
  browse_domain: string | null
}

const PROJECTION_SELECT =
  'id, slug, canonical_name, brand_name, image_url, tier, tier_rank, active_listing_count, subcategory_id, browse_domain, status, browse_visibility'

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } }

function toRow(r: Record<string, unknown>): Row | null {
  if (typeof r.slug !== 'string' || typeof r.canonical_name !== 'string' || typeof r.id !== 'string') return null
  return {
    id: r.id,
    slug: r.slug,
    canonical_name: r.canonical_name,
    brand_name: typeof r.brand_name === 'string' ? r.brand_name : null,
    image_url: typeof r.image_url === 'string' ? r.image_url : null,
    tier: typeof r.tier === 'string' ? r.tier : null,
    tier_rank: typeof r.tier_rank === 'number' ? r.tier_rank : 0,
    active_listing_count: typeof r.active_listing_count === 'number' ? r.active_listing_count : 0,
    browse_domain: typeof r.browse_domain === 'string' ? r.browse_domain : null,
    median_dkk: null,
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const admin = getSupabaseAdmin()

  const { data: selfRaw } = await admin
    .from('kg_product')
    .select('id, slug, status, support_state, browse_visibility, subcategory_id, attributes')
    .eq('slug', slug)
    .maybeSingle()
  const self = selfRaw as Record<string, unknown> | null
  if (!self) return NextResponse.json({ error: 'not_found' }, { status: 404, ...NO_STORE })
  const selfId = self.id as string
  const { data: selfProj } = await admin.from('browse_product_projection').select('browse_domain').eq('id', selfId).maybeSingle()
  if (!isCanonical({ ...self, browse_domain: (selfProj?.browse_domain as string | null) ?? null })) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, ...NO_STORE })
  }
  const subcategoryId = (self.subcategory_id as string | null) ?? null

  // 1. Explicit relations, both directions, plus the authored `related_products`.
  const { data: relRaw } = await admin
    .from('kg_relation')
    .select('type, from_product_id, to_product_id')
    .or(`from_product_id.eq.${selfId},to_product_id.eq.${selfId}`)
  const explicitById = new Map<string, SimilarReason>()
  for (const r of (relRaw ?? []) as Array<{ type: string; from_product_id: string; to_product_id: string }>) {
    const otherIsFrom = r.to_product_id === selfId
    const reason = relationReason(r.type, otherIsFrom ? 'from_is_other' : 'to_is_other')
    const otherId = otherIsFrom ? r.from_product_id : r.to_product_id
    if (reason && otherId !== selfId && !explicitById.has(otherId)) explicitById.set(otherId, reason)
  }
  const authored = ((self.attributes as { related_products?: Array<{ slug?: unknown; reason?: unknown }> } | null)?.related_products ?? [])
    .map((r) => (typeof r.slug === 'string' ? r.slug : null))
    .filter((s): s is string => s !== null && s !== slug)

  // 2. Family siblings, from reviewed code.
  const familySlugs = (familyForChild(slug)?.children ?? []).filter((s) => s !== slug)

  // Candidate rows: the named ones by slug or id, and the same-type pool by subcategory.
  const [named, pool] = await Promise.all([
    explicitById.size + authored.length + familySlugs.length > 0
      ? admin
          .from('browse_product_projection')
          .select(PROJECTION_SELECT)
          .or(`id.in.(${[...explicitById.keys()].join(',') || selfId}),slug.in.(${[...authored, ...familySlugs].map((s) => `"${s}"`).join(',') || '"-"'})`)
          .eq('is_public', true)
      : Promise.resolve({ data: [] }),
    subcategoryId
      ? admin
          .from('browse_product_projection')
          .select(PROJECTION_SELECT)
          .eq('subcategory_id', subcategoryId)
          .eq('is_public', true)
          .neq('id', selfId)
          .order('tier_rank', { ascending: false })
          .order('active_listing_count', { ascending: false })
          .limit(SAME_TYPE_POOL)
      : Promise.resolve({ data: [] }),
  ])
  const rows = new Map<string, Row>()
  for (const r of [...(named.data ?? []), ...(pool.data ?? [])] as Array<Record<string, unknown>>) {
    const row = toRow(r)
    if (row && row.id !== selfId) rows.set(row.id, row)
  }

  // The projection carries no support axis, so the gate is read from kg_product
  // and decided by `isCanonical()` — the same predicate the product page uses.
  const { data: axesRaw } = rows.size
    ? await admin.from('kg_product').select('id, slug, status, support_state, browse_visibility').in('id', [...rows.keys()])
    : { data: [] }
  const eligible = new Set<string>()
  for (const a of (axesRaw ?? []) as Array<Record<string, unknown>>) {
    const row = rows.get(a.id as string)
    if (row && isCanonical({ ...a, browse_domain: row.browse_domain })) eligible.add(row.id)
  }
  for (const id of rows.keys()) if (!eligible.has(id)) rows.delete(id)

  // 3. Medians over live asking prices, for this product and the eligible rows.
  const priceIds = [selfId, ...rows.keys()]
  const { data: priceRaw } = await admin
    .from('listing_product_match')
    .select('product_id, listings!inner(price_dkk, is_active)')
    .in('product_id', priceIds)
    .eq('listings.is_active', true)
    .not('is_valid', 'is', false)
  const prices = new Map<string, number[]>()
  type PriceRow = { product_id: string; listings: { price_dkk: unknown } | { price_dkk: unknown }[] | null }
  for (const m of (priceRaw ?? []) as unknown as PriceRow[]) {
    // A many-to-one embed arrives as one object; the client types it as an array.
    const l = Array.isArray(m.listings) ? m.listings[0] : m.listings
    const p = Number(l?.price_dkk)
    if (Number.isFinite(p) && p > 0) prices.set(m.product_id, [...(prices.get(m.product_id) ?? []), p])
  }
  for (const row of rows.values()) row.median_dkk = median(prices.get(row.id) ?? [])

  const explicit: SimilarPick<Row>[] = []
  const bySlug = new Map([...rows.values()].map((r) => [r.slug, r]))
  for (const [id, reason] of explicitById) { const r = rows.get(id); if (r) explicit.push({ candidate: r, reason }) }
  for (const s of authored) { const r = bySlug.get(s); if (r) explicit.push({ candidate: r, reason: 'alternative' }) }
  const family = familySlugs.map((s) => bySlug.get(s)).filter((r): r is Row => !!r)
  // A sibling or authored "alternative" adds nothing to a family sibling: "same family" is the truer chip.
  const explicitOutsideFamily = explicit.filter((p) => !(p.reason === 'alternative' && familySlugs.includes(p.candidate.slug)))
  const sameType = [...rows.values()].filter((r) => !familySlugs.includes(r.slug))

  const picks = rankSimilar({ slug, median_dkk: median(prices.get(selfId) ?? []) }, explicitOutsideFamily, family, sameType)
  const similar: SimilarProduct[] = picks.slice(0, SIMILAR_MAX).map(({ candidate: c, reason }) => ({
    slug: c.slug,
    name: c.canonical_name,
    brand: c.brand_name,
    image_url: c.image_url,
    tier: c.tier,
    active_listing_count: c.active_listing_count,
    reason,
  }))
  return NextResponse.json({ similar }, NO_STORE)
}
