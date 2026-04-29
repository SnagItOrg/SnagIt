import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function verifyAdmin(): Promise<boolean> {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const admin = getSupabaseAdmin()
  const { data: prefs } = await admin
    .from('user_preferences')
    .select('is_admin')
    .eq('user_id', user.id)
    .single()
  return !!prefs?.is_admin
}

export type Candidate = {
  id:        string
  title:     string
  price:     number | null
  url:       string
  source:    string
  scraped_at: string
  score:     'yes' | 'maybe' | 'no'
  reason:    string
}

// GET /api/admin/match/candidates?product_id=X&product_name=Y&limit=30
export async function GET(req: NextRequest) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const productId   = searchParams.get('product_id')
  const productName = searchParams.get('product_name')
  const limit       = Math.min(parseInt(searchParams.get('limit') ?? '30', 10), 50)

  if (!productId || !productName) {
    return NextResponse.json({ error: 'product_id and product_name required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  // Find IDs already matched to this product
  const { data: alreadyMatched } = await admin
    .from('listing_product_match')
    .select('listing_id')
    .eq('product_id', productId)

  const excludeIds = (alreadyMatched ?? []).map((r) => r.listing_id as string)

  // Normalize product name: replace hyphens with spaces so "Juno-106" matches "Juno 106"
  const normalizedName = productName.replace(/-/g, ' ').toLowerCase()
  const words = normalizedName.split(/\s+/).filter((w) => w.length > 2)

  // Optional source filter (comma-separated, e.g. "dba,finn,blocket,reverb")
  const sourcesParam = searchParams.get('sources')
  const sourcesFilter = sourcesParam ? sourcesParam.split(',').filter(Boolean) : null

  let q = admin
    .from('listings')
    .select('id, title, price, url, source, scraped_at')
    .eq('is_active', true)
    .not('title', 'is', null)

  if (sourcesFilter && sourcesFilter.length > 0) {
    q = (q as typeof q).in('source', sourcesFilter)
  }

  for (const w of words) {
    q = (q as typeof q).ilike('title', `%${w}%`)
  }

  if (excludeIds.length > 0) {
    q = (q as typeof q).not('id', 'in', `(${excludeIds.slice(0, 100).join(',')})`)
  }

  const { data: listings } = await q.limit(limit * 3) // fetch more than needed — Haiku will filter

  if (!listings || listings.length === 0) {
    return NextResponse.json({ candidates: [] })
  }

  // Haiku batch-scores relevance
  type RawListing = { id: string; title: string; price: number | null; url: string; source: string; scraped_at: string }
  const batch = (listings as RawListing[]).slice(0, 50)
  const lines = batch.map((l, i) => `${i + 1}. [${l.id}] ${l.title}`).join('\n')

  const scores: Record<string, { score: 'yes' | 'maybe' | 'no'; reason: string }> = {}

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system:
        'You are a music gear expert. For each listing title, decide if it is likely to be the specific product asked about. ' +
        'Hyphens and spaces are equivalent in model names (e.g. "Juno-106" = "Juno 106", "TR-08" = "TR 08"). ' +
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
      url:        l.url,
      source:     l.source,
      scraped_at: l.scraped_at,
      score:      scores[l.id]?.score ?? 'maybe',
      reason:     scores[l.id]?.reason ?? '',
    }))
    .filter((c) => c.score !== 'no')
    .sort((a, b) => {
      const order = { yes: 0, maybe: 1, no: 2 }
      return order[a.score] - order[b.score]
    })
    .slice(0, limit)

  return NextResponse.json({ candidates })
}
