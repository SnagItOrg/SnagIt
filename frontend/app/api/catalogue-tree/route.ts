import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isCatalogueUnavailable } from '@/lib/catalogue'
import { buildCatalogueTreeResponse } from '@/lib/browse'

/**
 * PAN-17 — the catalogue tree behind `SideNav`.
 *
 * WHY A ROUTE AND NOT A SERVER PROP. `SideNav` is mounted by eight pages, all
 * of which are client components; there is no server boundary to hand it props
 * through without converting all eight. A route keeps the change to one new
 * file plus the component, and matches how `/browse` already feeds itself.
 *
 * Never prerendered, for the reason `/api/browse` and `/api/discover` are not:
 * the tree IS catalogue eligibility, and a baked payload would keep offering a
 * withdrawn product a link in the sidebar of every page until the next deploy.
 * No `Cache-Control` beyond `no-store` for the same reason — PAN-68.
 *
 * No debug variant, deliberately: `/api/browse?debug=1` already owns the audit
 * payload and gates it on an admin session. A second one would be a second
 * thing to keep gated.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const response = await buildCatalogueTreeResponse(getSupabaseAdmin())
    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    // Absence is not unavailability, and a public body never carries the
    // internal message.
    if (isCatalogueUnavailable(error)) {
      console.error('[operational] catalogue tree eligibility unavailable', {
        route: '/api/catalogue-tree',
        stage: error.stage,
      })
      return NextResponse.json({ error: 'catalogue_unavailable' }, {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' },
      })
    }
    console.error('[operational] catalogue tree request failed', error)
    return NextResponse.json({ error: 'internal_error' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
