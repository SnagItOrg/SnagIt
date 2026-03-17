import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

type SuggestionRow = {
  id: string
  canonical_name: string
  brand_id: string
  category_id: string | null
  listing_count: number
}

type AiGroup = {
  canonical_name: string
  model_name: string
  suggestions: string[]
}

// POST /api/admin/suggestions/bulk/group
// Body: { brand_id: string }
export async function POST(req: NextRequest) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { brand_id } = await req.json()
  if (!brand_id) return NextResponse.json({ error: 'Missing brand_id' }, { status: 400 })

  const admin = getSupabaseAdmin()

  // Fetch top 50 pending suggestions for this brand
  const { data: suggestions, error } = await admin
    .from('kg_product_suggestions')
    .select('id, canonical_name, brand_id, category_id, listing_count')
    .eq('status', 'pending')
    .eq('brand_id', brand_id)
    .order('listing_count', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!suggestions || suggestions.length === 0) {
    return NextResponse.json({ groups: [], total: 0 })
  }

  // Build a name → suggestion lookup
  const byName = new Map<string, SuggestionRow>()
  for (const s of suggestions as SuggestionRow[]) {
    byName.set(s.canonical_name, s)
  }

  // Check which canonical names already exist in kg_product for this brand
  const { data: existingProducts } = await admin
    .from('kg_product')
    .select('id, canonical_name, slug')
    .eq('brand_id', brand_id)

  const existingByName = new Map<string, { id: string; slug: string }>()
  for (const p of existingProducts ?? []) {
    existingByName.set(p.canonical_name.toLowerCase(), { id: p.id, slug: p.slug })
  }

  const nameList = (suggestions as SuggestionRow[]).map(s => s.canonical_name).join('\n')

  let aiGroups: AiGroup[] = []
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system:
        'You are a music gear expert helping clean up a product knowledge graph. ' +
        'Group these product listing titles by their canonical model. ' +
        'For each group suggest a clean canonical name (brand + model only, no years, colors or descriptions). ' +
        'Return JSON only — no markdown, no explanation.',
      messages: [
        {
          role: 'user',
          content:
            'Group these listing titles and return JSON matching this schema exactly:\n' +
            '{"groups":[{"canonical_name":"Roland TR-909","model_name":"TR-909","suggestions":["..."]}]}\n\n' +
            nameList,
        },
      ],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    // Strip any accidental markdown code fences
    const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(jsonStr) as { groups: AiGroup[] }
    aiGroups = parsed.groups ?? []
  } catch (e) {
    return NextResponse.json({ error: `AI grouping failed: ${String(e)}` }, { status: 500 })
  }

  // Map AI groups back to suggestion rows; annotate with KG existence
  type EnrichedGroup = {
    canonical_name: string
    model_name: string
    suggestions: Array<{ id: string; canonical_name: string; listing_count: number }>
    brand_id: string
    category_id: string | null
    exists_in_kg: boolean
    kg_product_id: string | null
    kg_product_slug: string | null
  }

  const enriched: EnrichedGroup[] = []
  const usedIds = new Set<string>()

  for (const group of aiGroups) {
    const members: Array<{ id: string; canonical_name: string; listing_count: number }> = []
    let brandId = brand_id
    let categoryId: string | null = null

    for (const name of group.suggestions) {
      const row = byName.get(name)
      if (!row) continue
      members.push({ id: row.id, canonical_name: row.canonical_name, listing_count: row.listing_count })
      usedIds.add(row.id)
      brandId = row.brand_id
      if (!categoryId && row.category_id) categoryId = row.category_id
    }

    if (members.length === 0) continue

    const nameLower = group.canonical_name.toLowerCase()
    const kgMatch = existingByName.get(nameLower)

    enriched.push({
      canonical_name: group.canonical_name,
      model_name: group.model_name,
      suggestions: members,
      brand_id: brandId,
      category_id: categoryId,
      exists_in_kg: !!kgMatch,
      kg_product_id: kgMatch?.id ?? null,
      kg_product_slug: kgMatch?.slug ?? null,
    })
  }

  // Any suggestions Claude missed — add as ungrouped singletons
  for (const s of suggestions as SuggestionRow[]) {
    if (usedIds.has(s.id)) continue
    enriched.push({
      canonical_name: s.canonical_name,
      model_name: '',
      suggestions: [{ id: s.id, canonical_name: s.canonical_name, listing_count: s.listing_count }],
      brand_id: s.brand_id,
      category_id: s.category_id,
      exists_in_kg: false,
      kg_product_id: null,
      kg_product_slug: null,
    })
  }

  return NextResponse.json({ groups: enriched, total: suggestions.length })
}
