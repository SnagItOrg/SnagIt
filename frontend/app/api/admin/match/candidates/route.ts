import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'
import {
  ALL_SOURCE_KEYS,
  MATCH_SOURCES,
  perSourceQuota,
  storedSourcesFor,
} from '@/lib/admin-match-sources'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/** How many listings one sweep sends to Haiku. Unchanged. */
const SCORING_BATCH = 50

/**
 * A candidate as the admin page consumes it — one shape for every marketplace.
 *
 * `price`, `currency`, `image_url` and `location` are all nullable, and a null
 * in any of them is a rendering concern, never a filter: a Kleinanzeigen ad with
 * no asking price is still a real ad that may belong to this product, and 265 of
 * the ~2,141 active Kleinanzeigen rows are in exactly that state. Dropping them
 * would hide the listings most in need of a human decision.
 */
export type Candidate = {
  id:         string
  title:      string
  price:      number | null
  currency:   string | null
  price_dkk:  number | null
  url:        string
  image_url:  string | null
  location:   string | null
  source:     string
  scraped_at: string
  /** Decision already stored for (listing, product). 'none' until one is made. */
  match_state: 'none' | 'confirmed' | 'rejected' | 'unreviewed'
  score:      'yes' | 'maybe' | 'no'
  reason:     string
}

type RawListing = {
  id: string
  title: string
  price: number | null
  currency: string | null
  price_dkk: number | null
  url: string
  image_url: string | null
  location: string | null
  source: string
  scraped_at: string
}

const LISTING_COLUMNS =
  'id, title, price, currency, price_dkk, url, image_url, location, source, scraped_at'

function matchState(isValid: boolean | null | undefined, hasRow: boolean): Candidate['match_state'] {
  if (!hasRow) return 'none'
  if (isValid === true) return 'confirmed'
  if (isValid === false) return 'rejected'
  return 'unreviewed'
}

// GET /api/admin/match/candidates?product_id=X&product_name=Y&limit=30&sources=dba,kleinanzeigen
export async function GET(req: NextRequest) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const { searchParams } = new URL(req.url)
  const productId   = searchParams.get('product_id')
  const productName = searchParams.get('product_name')
  const limit       = Math.min(parseInt(searchParams.get('limit') ?? '30', 10), 50)

  if (!productId || !productName) {
    return NextResponse.json({ error: 'product_id and product_name required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  // Every decision already recorded for this product, with its verdict.
  const { data: alreadyMatched } = await admin
    .from('listing_product_match')
    .select('listing_id, is_valid')
    .eq('product_id', productId)

  const decided = new Map<string, boolean | null>()
  for (const row of alreadyMatched ?? []) {
    decided.set(row.listing_id as string, (row.is_valid ?? null) as boolean | null)
  }
  const excludeIds = Array.from(decided.keys())

  // Normalize product name: replace hyphens with spaces so "Juno-106" matches "Juno 106"
  const normalizedName = productName.replace(/-/g, ' ').toLowerCase()
  const words = normalizedName.split(/\s+/).filter((w) => w.length > 2)

  // Requested sources, restricted to keys this route actually knows.
  const sourcesParam = searchParams.get('sources')
  const requestedKeys = sourcesParam
    ? sourcesParam.split(',').filter(Boolean).filter((k) => ALL_SOURCE_KEYS.includes(k))
    : [...ALL_SOURCE_KEYS]

  if (requestedKeys.length === 0) {
    return NextResponse.json({ candidates: [] })
  }

  const quota = perSourceQuota(limit, requestedKeys.length)

  /**
   * One query per source, each with its own ceiling.
   *
   * A single pooled query let the largest marketplace consume the whole sweep:
   * Reverb holds ~40,850 active rows to Kleinanzeigen's ~2,141, so a broad
   * product name could return 50 Reverb rows and nothing else, and the operator
   * would never learn that anything had been crowded out.
   */
  const perSource = await Promise.all(
    requestedKeys.map(async (key) => {
      let q = admin
        .from('listings')
        .select(LISTING_COLUMNS)
        .eq('is_active', true)
        .not('title', 'is', null)
        .in('source', storedSourcesFor([key]))

      for (const w of words) {
        q = (q as typeof q).ilike('title', `%${w}%`)
      }

      // A volume reducer only. `not.in` is bounded by URL length, so it cannot
      // carry the full exclusion set — correctness comes from `decided` below.
      if (excludeIds.length > 0) {
        q = (q as typeof q).not('id', 'in', `(${excludeIds.slice(0, 100).join(',')})`)
      }

      const { data } = await q.limit(quota * 3)
      return (data ?? []) as RawListing[]
    }),
  )

  /**
   * Drop every listing that already carries a decision.
   *
   * This is the authoritative exclusion. The database filter above truncates at
   * 100 ids, and real products are far past that — roland-juno-106 alone holds
   * 193 match rows, 62 of them rejections. Relying on the truncated filter meant
   * an already-rejected listing could reappear in the queue as if undecided,
   * which is precisely the outcome a durable negative label exists to prevent.
   */
  const seen = new Set<string>()
  const pool: RawListing[] = []
  for (const rows of perSource) {
    for (const row of rows) {
      if (decided.has(row.id) || seen.has(row.id)) continue
      seen.add(row.id)
      pool.push(row)
    }
  }

  if (pool.length === 0) {
    return NextResponse.json({ candidates: [] })
  }

  // Interleave the sources so a truncated scoring batch stays representative.
  const byKey = requestedKeys.map((key) => {
    const stored = storedSourcesFor([key])
    return pool.filter((l) => stored.includes(l.source)).slice(0, quota)
  })
  const interleaved: RawListing[] = []
  for (let i = 0; interleaved.length < SCORING_BATCH; i++) {
    let added = false
    for (const bucket of byKey) {
      if (i < bucket.length) {
        interleaved.push(bucket[i])
        added = true
        if (interleaved.length >= SCORING_BATCH) break
      }
    }
    if (!added) break
  }

  const batch = interleaved
  const lines = batch.map((l, i) => `${i + 1}. [${l.id}] ${l.title}`).join('\n')

  const scores: Record<string, { score: 'yes' | 'maybe' | 'no'; reason: string }> = {}

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system:
        'You are a music gear expert. For each listing title, decide if it is likely to be the specific product asked about. ' +
        'Hyphens and spaces are equivalent in model names (e.g. "Juno-106" = "Juno 106", "TR-08" = "TR 08"). ' +
        'Listings may be in Danish, Norwegian, Swedish or German. ' +
        'Return JSON only — no markdown.',
      messages: [
        {
          role: 'user',
          content:
            `Product: "${productName}"\n\n` +
            `For each listing below, return a JSON object:\n` +
            `{"results":[{"id":"...","score":"yes"|"maybe"|"no","reason":"one sentence"}]}\n\n` +
            lines,
        },
      ],
    })

    const raw = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
    const json = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()) as {
      results: Array<{ id: string; score: 'yes' | 'maybe' | 'no'; reason: string }>
    }
    for (const r of json.results ?? []) {
      scores[r.id] = { score: r.score, reason: r.reason }
    }
  } catch {
    // Haiku failed — show all as 'maybe'
    for (const l of batch) scores[l.id] = { score: 'maybe', reason: 'Kunne ikke vurdere' }
  }

  const candidates: Candidate[] = batch
    .map((l) => ({
      id:         l.id,
      title:      l.title,
      price:      l.price,
      currency:   l.currency,
      price_dkk:  l.price_dkk,
      url:        l.url,
      image_url:  l.image_url,
      location:   l.location,
      source:     l.source,
      scraped_at: l.scraped_at,
      // 'none' for every row here by construction — decided listings are filtered
      // out above. Read from the same map so the field cannot drift from truth.
      match_state: matchState(decided.get(l.id), decided.has(l.id)),
      score:      scores[l.id]?.score ?? 'maybe',
      reason:     scores[l.id]?.reason ?? '',
    }))
    .filter((c) => c.score !== 'no')
    .sort((a, b) => {
      const order = { yes: 0, maybe: 1, no: 2 }
      return order[a.score] - order[b.score]
    })
    .slice(0, limit)

  return NextResponse.json({ candidates, sources: MATCH_SOURCES.map((s) => s.key) })
}
