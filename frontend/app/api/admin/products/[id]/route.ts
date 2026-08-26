import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getCurrentAdminState } from '@/lib/admin-auth'

/**
 * Product lifecycle mutations for /admin/products.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FOUR INDEPENDENT AXES. This route is the existing promotion seam and is
 * reused rather than replaced, but it previously let one PATCH change support,
 * public exposure and marketplace monitoring together with no signal that it
 * had done so:
 *
 *   identity    kg_product.status            active | inactive
 *   support     kg_product.support_state     known | reserve | supported   (056)
 *   visibility  kg_product.browse_visibility public | qa_only | hidden
 *   editorial   kg_product.tier              legendary | classic | standard
 *
 * `tier` is an EDITORIAL classification (migration 031) — carousel, badges,
 * browse ranking, /intel filter. It is ALSO, today, the implicit selector four
 * scrapers use to decide what to query, so an editorial change silently changes
 * marketplace monitoring. Those two consequences are reported separately here;
 * the query sets themselves are documented in data/klup-source-monitoring.json.
 *
 * The contract now enforced here:
 *   - every request must name the axes it intends to change (`intent`);
 *   - changing monitoring (`tier`) or visibility (`browse_visibility`) requires
 *     that axis to be named explicitly, so neither can ride along with a
 *     support promotion;
 *   - `?dryRun=1` returns the same decision and the same before/after manifest
 *     WITHOUT writing, so a change can be previewed;
 *   - every applied change returns a before/after manifest naming the affected
 *     axes and their downstream consequences.
 *
 * Promoting support does NOT publish. Publishing does NOT change support or
 * monitoring. Nothing here starts a scrape or a match run.
 */

const SUPPORT_STATES = ['known', 'reserve', 'supported'] as const
const VISIBILITIES   = ['public', 'qa_only', 'hidden'] as const
const TIERS          = ['legendary', 'classic', 'standard'] as const

/**
 * `tier` is an EDITORIAL classification (migration 031): it drives the homepage
 * "Legendarisk gear" carousel, the product-page and admin badges, browse
 * ranking and the /intel filter. That is its established meaning.
 *
 * SEPARATELY, four scrapers currently use it as an implicit query selector, so
 * an editorial change today also changes marketplace monitoring. Those sets are
 * documented explicitly in `data/klup-source-monitoring.json`. Until a
 * separately authorised task migrates the scrapers to read that manifest, this
 * route reports the two consequences as DISTINCT axes so an editorial promotion
 * can never look monitoring-neutral when it is not.
 */
const MONITORING_SELECTOR_TIERS = new Set(['legendary', 'classic'])
const SOURCES_SELECTING_ON_TIER = 'dba.dk, finn, blocket, kleinanzeigen'

type Axis = 'support' | 'visibility' | 'monitoring' | 'metadata'

const FIELD_AXIS: Record<string, Axis> = {
  support_state:     'support',
  browse_visibility: 'visibility',
  tier:              'monitoring',
  year_released:     'metadata',
  tags:              'metadata',
}

/** Human-readable consequence of touching an axis, returned with every manifest. */
function consequence(axis: Axis, from: unknown, to: unknown): string {
  switch (axis) {
    case 'support':
      return to === 'supported'
        ? 'Product BECOMES an automatic matcher target. It does NOT become public and no marketplace query is added.'
        : 'Product STOPS being an automatic matcher target. Existing matches, pages, articles and images are untouched.'
    case 'visibility':
      return to === 'public'
        ? 'Product page becomes publicly visible in browse. Matcher eligibility and marketplace monitoring are unchanged.'
        : 'Product page leaves public browse. Matcher eligibility and marketplace monitoring are unchanged.'
    case 'monitoring': {
      // Two independent consequences, always reported separately.
      const editorial = `EDITORIAL: tier '${String(from)}' -> '${String(to)}' changes carousel, badge and browse ranking.`
      const was = MONITORING_SELECTOR_TIERS.has(String(from)), now = MONITORING_SELECTOR_TIERS.has(String(to))
      if (!was && now) return `${editorial} MONITORING EXPANDS: because ${SOURCES_SELECTING_ON_TIER} currently select on tier, this product joins those query sets on their next run.`
      if (was && !now) return `${editorial} MONITORING SHRINKS: this product leaves the ${SOURCES_SELECTING_ON_TIER} query sets.`
      return `${editorial} MONITORING UNCHANGED: both tiers fall on the same side of the scraper selectors.`
    }
    default:
      return 'Metadata only. No matcher, visibility or monitoring effect.'
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { userId, isAdmin } = await getCurrentAdminState()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
  const update: Record<string, unknown> = {}
  const touched = new Set<Axis>()

  for (const [field, axis] of Object.entries(FIELD_AXIS)) {
    if (body[field] === undefined) continue
    update[field] = body[field]
    touched.add(axis)
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // ── value validation, fail closed ────────────────────────────────────────
  if (update.support_state !== undefined && !SUPPORT_STATES.includes(update.support_state as never)) {
    return NextResponse.json({ error: 'invalid_support_state', allowed: SUPPORT_STATES }, { status: 400 })
  }
  if (update.browse_visibility !== undefined && !VISIBILITIES.includes(update.browse_visibility as never)) {
    return NextResponse.json({ error: 'invalid_browse_visibility', allowed: VISIBILITIES }, { status: 400 })
  }
  if (update.tier !== undefined && !TIERS.includes(update.tier as never)) {
    return NextResponse.json({ error: 'invalid_tier', allowed: TIERS }, { status: 400 })
  }

  // ── explicit intent, so no axis moves as a side effect ───────────────────
  // `intent` lists the axes the caller means to change. Support and metadata
  // may be implied (they carry no cross-axis consequence); visibility and
  // monitoring must be named, because those are the two that silently changed
  // public exposure and scraper configuration before.
  const intent: string[] = Array.isArray(body.intent) ? body.intent.map(String) : []
  const mustDeclare: Axis[] = ['visibility', 'monitoring']
  const undeclared = mustDeclare.filter((a) => touched.has(a) && !intent.includes(a))
  if (undeclared.length > 0) {
    return NextResponse.json({
      error: 'undeclared_axis',
      message: 'Changing these axes has effects beyond support and must be requested explicitly.',
      undeclared,
      hint: `Resend with "intent": ${JSON.stringify(undeclared)}`,
    }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  // ── before state, for the manifest and for the dry run ───────────────────
  const { data: before, error: readErr } = await admin
    .from('kg_product')
    .select('id, slug, canonical_name, status, support_state, browse_visibility, tier, year_released, tags')
    .eq('id', params.id)
    .maybeSingle()

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // A deprecated identity can never be promoted into the supported cohort.
  if (update.support_state === 'supported' && before.status !== 'active') {
    return NextResponse.json({
      error: 'inactive_product_cannot_be_supported',
      message: `status='${before.status}' — reactivate the identity before promoting support.`,
    }, { status: 409 })
  }

  const changes = Object.entries(update)
    .filter(([f, v]) => (before as Record<string, unknown>)[f] !== v)
    .map(([field, to]) => ({
      field,
      axis: FIELD_AXIS[field],
      from: (before as Record<string, unknown>)[field] ?? null,
      to,
      consequence: consequence(FIELD_AXIS[field], (before as Record<string, unknown>)[field], to),
    }))

  const manifest = {
    product: { id: before.id, slug: before.slug, canonical_name: before.canonical_name },
    dry_run: dryRun,
    axes_touched: Array.from(touched),
    changes,
    // Editorial classification and source monitoring are reported separately
    // even though one field currently drives both.
    axis_semantics: {
      tier: 'editorial classification (migration 031); ALSO an implicit scraper selector today',
      monitoring_boundary: 'data/klup-source-monitoring.json',
    },
    unchanged_axes: {
      identity:   before.status,
      support:    update.support_state     === undefined ? before.support_state     : undefined,
      visibility: update.browse_visibility === undefined ? before.browse_visibility : undefined,
      monitoring: update.tier              === undefined ? before.tier              : undefined,
    },
  }

  if (dryRun) return NextResponse.json({ ok: true, applied: false, manifest })
  if (changes.length === 0) return NextResponse.json({ ok: true, applied: false, manifest })

  const { error } = await admin.from('kg_product').update(update).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, applied: true, manifest })
}
