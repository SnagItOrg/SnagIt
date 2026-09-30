import { NextRequest, NextResponse } from 'next/server'
import { requireAdminInRoute } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { NAVIGATION_FAMILIES } from '@/lib/families'
import {
  validateFamilyProposal,
  type FamilyProposalInput,
  type ProposalProductRow,
} from '@/lib/family-proposal'

/**
 * POST /api/admin/families/validate — PAN-159, option M.
 *
 * Checks a proposed family against live rows and returns the code to paste.
 * READ-ONLY: three SELECTs, no write of any kind. Families stay reviewed code,
 * so the patch is landed as a PR, never applied from here.
 *
 * Admin-gated in-route: middleware gates /admin pages, not /api/admin.
 */

const MAX_MEMBERS = 40

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readInput(body: unknown): FamilyProposalInput | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (!Array.isArray(b.members) || b.members.length > MAX_MEMBERS) return null
  return {
    slug: asString(b.slug),
    label: asString(b.label),
    brand: asString(b.brand),
    categoryRoot: asString(b.categoryRoot),
    members: b.members.filter((m): m is string => typeof m === 'string'),
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const input = readInput(await req.json().catch(() => null))
  if (!input) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  // Existing families' children too: a member may duplicate one of them (PAN-194).
  const familyChildren = NAVIGATION_FAMILIES.flatMap((f) => f.children)
  const slugs = Array.from(
    new Set([...input.members, input.slug, ...familyChildren].map((s) => s.trim()).filter(Boolean)),
  )
  const admin = getSupabaseAdmin()

  const unavailable = () => NextResponse.json({ error: 'catalogue_unavailable' }, { status: 503 })
  const reads = await Promise.all([
    admin
      .from('kg_product')
      .select('slug, canonical_name, status, support_state, browse_visibility, reverb_csp_id, kg_brand(name)')
      .in('slug', slugs),
    admin
      .from('browse_product_projection')
      .select('slug, browse_domain, root_category_slug, active_listing_count')
      .in('slug', slugs),
    admin.from('kg_category').select('slug').eq('domain', 'music').is('parent_id', null),
  ]).catch(() => null)
  if (!reads) return unavailable()

  const [productsRes, projectionRes, rootsRes] = reads
  if (productsRes.error || projectionRes.error || rootsRes.error) return unavailable()

  const projection = new Map(
    ((projectionRes.data ?? []) as Array<Record<string, unknown>>).map((p) => [p.slug as string, p]),
  )
  const rows: ProposalProductRow[] = ((productsRes.data ?? []) as Array<Record<string, unknown>>).map((raw) => {
    const p = projection.get(raw.slug as string)
    const brand = raw.kg_brand as { name: string | null } | { name: string | null }[] | null
    return {
      slug: raw.slug as string,
      canonical_name: (raw.canonical_name as string | null) ?? null,
      status: (raw.status as string | null) ?? null,
      support_state: (raw.support_state as string | null) ?? null,
      browse_visibility: (raw.browse_visibility as string | null) ?? null,
      reverb_csp_id: (raw.reverb_csp_id as number | null) ?? null,
      brand: (Array.isArray(brand) ? brand[0]?.name : brand?.name) ?? null,
      browse_domain: (p?.browse_domain as string | null) ?? null,
      root_category_slug: (p?.root_category_slug as string | null) ?? null,
      active_listing_count: (p?.active_listing_count as number | null) ?? null,
    }
  })

  const result = validateFamilyProposal(input, {
    rows,
    musicRoots: ((rootsRes.data ?? []) as Array<{ slug: string }>).map((r) => r.slug),
    families: NAVIGATION_FAMILIES,
  })

  return NextResponse.json(result)
}
