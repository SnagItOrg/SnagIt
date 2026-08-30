import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

/**
 * Single-suggestion review actions.
 *
 * WHAT WAS BROKEN — the merge path reported success after doing nothing.
 *
 * Step 2 of a merge ran:
 *
 *   await admin.from('listing_product_match')
 *     .update({ product_id: merge_product_id })
 *     .ilike('match_reason', `%${normalizedSuggestion}%`)
 *
 * `listing_product_match` has no `match_reason` column — it holds id,
 * listing_id, product_id, method, score, explain, created_at, is_valid,
 * rejected_reason. PostgREST therefore failed the statement every time. The
 * result was never destructured, so the error was discarded, execution fell
 * through to step 3, the suggestion was marked approved and the operator was
 * told "Merget". Every merge ever performed through this route was a silent
 * no-op on the listing side.
 *
 * Had the column existed, the statement would have been worse than useless: an
 * unanchored `%...%` against no product and no listing identity, rewriting
 * `product_id` on arbitrary rows across the whole table.
 *
 * The step is removed rather than rewritten, because there is no real key to
 * rewrite it against: `kg_product_suggestions` stores no listing linkage
 * (id, canonical_name, brand_id, brand_name, category_id, source,
 * listing_count, status, reviewed_by, reviewed_at, created_at, notes), and a
 * suggestion has no product row of its own, so no listing_product_match row can
 * belong to it. The synonym alias — keyed on the real unique
 * (alias, product_id) — is the mechanism that actually merges the identity, and
 * re-matching existing listings is the matcher's job, not this route's.
 *
 * Every Supabase result is now checked before the next step runs. A failed step
 * returns a non-success response and performs no subsequent write.
 */

async function verifyAdmin(): Promise<{ ok: true; userId: string } | { ok: false }> {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const admin = getSupabaseAdmin()
  const { data: prefs, error } = await admin
    .from('user_preferences')
    .select('is_admin')
    .eq('user_id', user.id)
    .single()
  // Fail closed: an unreadable admin flag is not an admin flag.
  if (error || !prefs?.is_admin) return { ok: false }
  return { ok: true, userId: user.id }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// PATCH /api/admin/suggestions/[id]
// Body: { action: 'approve' | 'reject' | 'merge', canonical_name?, model_name?, merge_product_id? }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await verifyAdmin()
  if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Authorization above, parsing here, admin client after: a malformed body
  // must not reach the service-role client, and neither must an anonymous one.
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Malformed request body' }, { status: 400 })
  }
  const { action, canonical_name, model_name, merge_product_id } = body as {
    action?: string
    canonical_name?: string
    model_name?: string
    merge_product_id?: string
  }
  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()

  // Fetch the suggestion
  const { data: suggestion, error: fetchErr } = await admin
    .from('kg_product_suggestions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (fetchErr || !suggestion) {
    return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })
  }

  // If just editing the name (no action)
  if (!action && canonical_name) {
    const { error } = await admin
      .from('kg_product_suggestions')
      .update({ canonical_name })
      .eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'send-back') {
    const { error } = await admin
      .from('kg_product_suggestions')
      .update({
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        notes: null,
      })
      .eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'reject') {
    const { error } = await admin
      .from('kg_product_suggestions')
      .update({
        status: 'rejected',
        reviewed_by: auth.userId,
        reviewed_at: now,
      })
      .eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'approve') {
    const name = canonical_name || suggestion.canonical_name
    const slug = slugify(name)

    // Check slug doesn't already exist in kg_product.
    //
    // The error was previously discarded, so a failed probe read as "no such
    // product" and the insert went ahead. `kg_product_slug_key` is unique, so
    // the outcome was a raw constraint-violation 500 instead of the intended
    // 409 — a duplicate was never actually created, but the operator was told
    // the wrong thing about why. Fail closed on an unreadable probe.
    const { data: existing, error: existingErr } = await admin
      .from('kg_product')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()

    if (existingErr) {
      return NextResponse.json(
        { error: `Could not verify slug availability: ${existingErr.message}` },
        { status: 500 },
      )
    }

    if (existing) {
      return NextResponse.json(
        { error: `Product with slug "${slug}" already exists` },
        { status: 409 },
      )
    }

    // Insert into kg_product (with optional model_name)
    const insertData: Record<string, unknown> = {
      slug,
      canonical_name: name,
      brand_id: suggestion.brand_id,
      category_id: suggestion.category_id,
      status: 'active',
    }
    if (model_name && typeof model_name === 'string' && model_name.trim()) {
      insertData.model_name = model_name.trim()
    }

    const { error: insertErr } = await admin
      .from('kg_product')
      .insert(insertData)

    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

    // Mark suggestion as approved
    const { error: updateErr } = await admin
      .from('kg_product_suggestions')
      .update({
        status: 'approved',
        canonical_name: name,
        reviewed_by: auth.userId,
        reviewed_at: now,
      })
      .eq('id', params.id)

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, slug })
  }

  if (action === 'merge') {
    if (!merge_product_id || typeof merge_product_id !== 'string') {
      return NextResponse.json({ error: 'Missing merge_product_id' }, { status: 400 })
    }

    // 1. The merge target must be a real product, addressed by its primary key.
    const { data: targetProduct, error: targetErr } = await admin
      .from('kg_product')
      .select('id, slug')
      .eq('id', merge_product_id)
      .single()

    if (targetErr || !targetProduct) {
      return NextResponse.json({ error: 'Target product not found' }, { status: 404 })
    }

    const alias = String(suggestion.canonical_name ?? '').trim()
    if (!alias) {
      return NextResponse.json(
        { error: 'Suggestion has no canonical_name to merge as an alias' },
        { status: 422 },
      )
    }

    /**
     * 2. Record the alias against the target product.
     *
     * This is the whole merge. It is constrained by two real identities —
     * the alias text and `product_id` — and lands on the unique index
     * `synonym_alias_product_unique (alias, product_id)`, so repeating a merge
     * converges on one row instead of adding another.
     *
     * The error is checked. If this fails, the suggestion is NOT marked
     * approved: a merge that recorded nothing must not look reviewed.
     */
    const { error: synonymErr } = await admin
      .from('synonym')
      .upsert({
        alias,
        product_id: merge_product_id,
        match_type: 'alias',
        lang: 'en',
        priority: 50,
      }, { onConflict: 'alias,product_id', ignoreDuplicates: true })

    if (synonymErr) {
      return NextResponse.json(
        { error: `Merge failed while recording alias: ${synonymErr.message}` },
        { status: 500 },
      )
    }

    // 3. Only now is the suggestion reviewed.
    const { error: updateErr } = await admin
      .from('kg_product_suggestions')
      .update({
        status: 'approved',
        reviewed_by: auth.userId,
        reviewed_at: now,
        notes: `merged into ${targetProduct.slug}`,
      })
      .eq('id', params.id)

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    /**
     * `relinked_listings` is reported as 0 deliberately and truthfully. This
     * route does not move `listing_product_match` rows; existing listings are
     * re-associated by the matcher reading the new alias, which is a separate,
     * scheduled path. The previous code implied otherwise and moved nothing.
     */
    return NextResponse.json({
      ok: true,
      merged_into: targetProduct.slug,
      alias_recorded: alias,
      relinked_listings: 0,
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
