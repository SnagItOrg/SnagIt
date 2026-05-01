import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { buildDiscoverResponse } from '@/lib/browse'

export type DiscoverProduct = {
  slug: string
  canonical_name: string
  image_url: string | null
  brand_name: string
  active_listing_count: number
}

export async function GET() {
  const admin = getSupabaseAdmin()

  try {
    const response = await buildDiscoverResponse(admin)
    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
    })
  } catch {
    return NextResponse.json({ legendary: [], popular: [] }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' },
      status: 500,
    })
  }
}
