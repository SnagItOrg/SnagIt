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
 * browse ranking, /intel filter. That is ALL it is. It is NOT a scraper
 * selector: the tier/monitoring coupling was removed in Prompt 04B, and all
 * four scrapers now resolve their query sets through monitoredSlugs() /
 * assertResolved() against data/klup-source-monitoring.json — reviewed code
 * that no runtime surface, including this route, may widen.
 *
 * CHANGING TIER HERE CHANGES NO MARKETPLACE MONITORING. This comment and the
 * consequence text below said the opposite until Stage 3 WP-2. Wrong operator
 * guidance on a write path is worse than none.
 *
 * The contract now enforced here:
 *   - every request must name the axes it intends to change (`intent`);
 *   - changing tier or visibility (`browse_visibility`) requires that axis to be
 *     named explicitly, so neither can ride along with a support promotion. The
 *     axis token for `tier` is still `monitoring` — a historical name, kept
 *     because renaming it is an axis-mapping change this package may not make.
 *     It gates declaration only; it asserts no monitoring effect;
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
 * ranking and the /intel filter. That is its whole meaning.
 *
 * The two constants that used to live here — a set of "selector tiers" and a
 * list of sources said to select on tier — encoded a coupling that no longer
 * exists and are deleted rather than kept as commentary. Marketplace monitoring
 * is controlled by THIS file only:
 */
const MONITORING_BOUNDARY = 'data/klup-source-monitoring.json'

type Axis = 'support' | 'visibility' | 'monitoring' | 'taxonomy' | 'metadata'

const FIELD_AXIS: Record<string, Axis> = {
  support_state:     'support',
  browse_visibility: 'visibility',
  tier:              'monitoring',
  // Taxonomy is its own axis. `browse_product_projection` DERIVES
  // `taxonomy_state` from `subcategory_id`, so writing the subcategory is the
  // only way to make a product classified — and doing so can put it into
  // public browse. That is a change of exposure, which is why it must be
  // declared like `visibility` rather than riding along as metadata.
  subcategory_id:    'taxonomy',
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
    case 'taxonomy':
      return to == null
        ? 'Product loses its subcategory and leaves public browse. The product page is unaffected.'
        : 'Category is derived from the subcategory\u2019s root mapping; no separate category value is written. '
          + 'If the mapping resolves, the product becomes listable in public browse. Matcher eligibility and monitoring are unchanged.'
    case 'monitoring': {
      // One consequence, because tier now has exactly one. No scraper reads
      // tier: the coupling was removed in 04B and every source resolves its
      // query set from the monitoring boundary instead.
      return (
        `EDITORIAL: tier '${String(from)}' -> '${String(to)}' changes carousel, badge and browse ranking. ` +
        `MONITORING UNCHANGED: tier is not a scraper selector. Marketplace monitoring is controlled ` +
        `by ${MONITORING_BOUNDARY} and is not changed by this request.`
      )
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
  const mustDeclare: Axis[] = ['visibility', 'monitoring', 'taxonomy']
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

  /**
   * A subcategory that does not classify is refused rather than written.
   *
   * The view calls a product `classified` only when the chosen category is a
   * music leaf whose parent is a music ROOT. 320 of 320 leaves are music but
   * only 15 of 20 roots are, so a leaf can hang off a non-music root and
   * silently produce `missing_root_mapping` — a save that reports success and
   * changes nothing the operator can see. Fail closed instead.
   */
  if (update.subcategory_id !== undefined && update.subcategory_id !== null) {
    const { data: sub, error: subErr } = await admin
      .from('kg_category')
      .select('id, parent_id, domain')
      .eq('id', update.subcategory_id as string)
      .maybeSingle()
    if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 })
    if (!sub) return NextResponse.json({ error: 'unknown_subcategory' }, { status: 400 })
    if (!sub.parent_id) {
      return NextResponse.json({ error: 'not_a_subcategory', message: 'Choose a leaf category, not a root.' }, { status: 400 })
    }
    const { data: root, error: rootErr } = await admin
      .from('kg_category')
      .select('id, parent_id, domain')
      .eq('id', sub.parent_id)
      .maybeSingle()
    if (rootErr) return NextResponse.json({ error: rootErr.message }, { status: 500 })
    if (!root || root.parent_id !== null || root.domain !== 'music' || sub.domain !== 'music') {
      return NextResponse.json({
        error: 'subcategory_would_not_classify',
        message: 'That category does not map to a music root, so the product would stay out of browse.',
      }, { status: 409 })
    }
  }

  // ── before state, for the manifest and for the dry run ───────────────────
  const { data: before, error: readErr } = await admin
    .from('kg_product')
    .select('id, slug, canonical_name, status, support_state, browse_visibility, tier, subcategory_id, year_released, tags')
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
    // Editorial classification and source monitoring are separate concerns and
    // separate mechanisms. Shape unchanged; only the description was false.
    axis_semantics: {
      tier: 'editorial classification (migration 031) only; NOT a scraper selector since 04B',
      monitoring_boundary: MONITORING_BOUNDARY,
    },
    unchanged_axes: {
      identity:   before.status,
      support:    update.support_state     === undefined ? before.support_state     : undefined,
      visibility: update.browse_visibility === undefined ? before.browse_visibility : undefined,
      monitoring: update.tier              === undefined ? before.tier              : undefined,
      taxonomy:   update.subcategory_id     === undefined ? before.subcategory_id     : undefined,
    },
  }

  if (dryRun) return NextResponse.json({ ok: true, applied: false, manifest })
  if (changes.length === 0) return NextResponse.json({ ok: true, applied: false, manifest })

  const { error } = await admin.from('kg_product').update(update).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, applied: true, manifest })
}
