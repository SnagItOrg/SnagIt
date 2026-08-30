import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'
import { sanitizeListingPrice } from '@/lib/listing-price-integrity'
import {
  ALL_SOURCE_KEYS,
  MATCH_SOURCES,
  perSourceQuota,
  storedSourcesFor,
} from '@/lib/admin-match-sources'
import {
  buildOrFilter,
  planRetrieval,
  variantMatches,
  type ProductFacts,
} from '@/lib/admin-match-query'
import {
  classifierStatus,
  interpretClassifierMessage,
  providerFailure,
  verdictFor,
  type ClassifierOutcome,
} from '@/lib/admin-match-classifier'
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
  /**
   * Did the classifier actually return a verdict for this listing?
   *
   * Additive and non-breaking: a client that ignores it behaves exactly as
   * before. It exists because `score: 'maybe'` has two unrelated meanings —
   * "the model is undecided" and "no verdict arrived" — and the deployed card
   * renders both as `Måske`. `score` deliberately stays inside the existing
   * three-value union, because widening it would break the client's lookup
   * table; the honest label is a client contract change, documented separately.
   */
  scored:     boolean
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

  /**
   * Retrieval facts come from the STORED product, not from the display name the
   * client happened to send.
   *
   * `model_name` is the curated model token ('RE-201', 'SH-101'). It is the
   * difference between a query that can find a listing and one that cannot, and
   * it is not derivable from the canonical name — 'Roland RE-201 (Space Echo)'
   * tokenises to `(space` and `echo)` under the old rule and matches nothing.
   */
  const { data: productRow } = await admin
    .from('kg_product')
    .select('canonical_name, model_name, kg_brand(name)')
    .eq('id', productId)
    .maybeSingle()

  const brandRel = (productRow as { kg_brand?: { name?: string } | Array<{ name?: string }> } | null)
    ?.kg_brand
  const brandName = Array.isArray(brandRel) ? brandRel[0]?.name ?? null : brandRel?.name ?? null

  const facts: ProductFacts = {
    canonicalName: (productRow?.canonical_name as string | undefined) ?? productName,
    modelName: (productRow?.model_name as string | null | undefined) ?? null,
    brandName,
  }

  const plan = planRetrieval(facts)
  const orFilter = buildOrFilter(plan.variants)

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
  const perSourceResults = await Promise.all(
    requestedKeys.map(async (key) => {
      let q = admin
        .from('listings')
        .select(LISTING_COLUMNS)
        .eq('is_active', true)
        .not('title', 'is', null)
        .in('source', storedSourcesFor([key]))

      /**
       * The variants are ALTERNATIVES, joined by OR.
       *
       * This is the whole repair. The previous loop AND-ed every token of the
       * canonical name onto one query, so a single unmatchable token — a word
       * carrying a stray parenthesis — reduced the result to zero with no
       * signal that it had. Widening now happens by adding an alternative,
       * never by dropping a required term from one, so each variant stays as
       * strict as it was.
       *
       * Still one query per source, so source balancing and the sweep's cost
       * are unchanged.
       */
      if (orFilter.length > 0) {
        q = (q as typeof q).or(orFilter)
      }

      // A volume reducer only. `not.in` is bounded by URL length, so it cannot
      // carry the full exclusion set — correctness comes from `decided` below.
      if (excludeIds.length > 0) {
        q = (q as typeof q).not('id', 'in', `(${excludeIds.slice(0, 100).join(',')})`)
      }

      /**
       * The error is NOT discarded.
       *
       * This used to be `const { data } = await q.limit(...)`, so a rejected
       * query — a malformed filter, a transport failure — produced `null`,
       * became `[]`, and reached the operator as "no candidates". That is
       * indistinguishable from a genuinely empty queue, and it is exactly how
       * a broken filter grammar would hide. A failed retrieval must read as a
       * failure.
       */
      const { data, error: queryError } = await q.limit(quota * 3)
      return { key, rows: (data ?? []) as RawListing[], queryError }
    }),
  )

  const failedSources = perSourceResults.filter((r) => r.queryError)
  if (failedSources.length > 0) {
    console.error(
      JSON.stringify({
        channel: 'operational',
        component: 'admin-match',
        event: 'candidate_retrieval_query_failed',
        product_id: productId,
        sources: failedSources.map((r) => r.key),
        variants: plan.variants.map((v) => v.id),
        // Message only — the provider payload and every listing stay out.
        detail: failedSources[0].queryError?.message ?? null,
      }),
    )
    return NextResponse.json(
      { error: 'Kandidatsøgningen fejlede. Ingen kandidater blev hentet — dette er ikke et tomt resultat.' },
      { status: 502 },
    )
  }

  const perSource = perSourceResults.map((r) => r.rows)

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
  let droppedAsDecided = 0
  let droppedAsDuplicate = 0
  for (const rows of perSource) {
    for (const row of rows) {
      if (decided.has(row.id)) { droppedAsDecided++; continue }
      // Deduplicated on listings.id — the stable marketplace identity the rest
      // of this route already keys on. Several variants matching one listing is
      // the expected case, not an anomaly, and it must cost one Haiku slot.
      if (seen.has(row.id)) { droppedAsDuplicate++; continue }
      seen.add(row.id)
      pool.push(row)
    }
  }

  /**
   * Server-side retrieval diagnostics.
   *
   * Counts and variant ids only — no titles, no urls, no prices. The four
   * outcomes an operator has to be able to tell apart are all derivable here:
   * a source that contributed nothing to this batch (`per_source_fetched`), a
   * plan that could not be built (`variants`), candidates removed as duplicates
   * (`dropped_duplicate`), and candidates removed by the classifier
   * (`scored_out`, logged below). Every count is bounded by the per-source cap.
   */
  const perSourceFetched: Record<string, number> = {}
  requestedKeys.forEach((key, i) => { perSourceFetched[key] = perSource[i].length })

  /**
   * Which variant could have found each row, WITHIN THE FETCHED BATCH.
   *
   * These are not raw source counts and must not be read as any. Each source
   * query is capped at `quota * 3`, so a count here is bounded by that cap and
   * by whatever order the planner returned; a zero means the variant matched
   * nothing IN THE ROWS WE FETCHED, which is not the same as the variant having
   * no hits in the database. Proving that requires an uncapped count this route
   * deliberately does not issue.
   *
   * Computed from titles already in memory, so it costs no extra round trip and
   * one query per source stays one query per source.
   */
  const perVariantInFetchedBatch: Record<string, Record<string, number>> = {}
  for (const variant of plan.variants) {
    const bySource: Record<string, number> = {}
    requestedKeys.forEach((key, i) => {
      bySource[key] = perSource[i].filter((row) => variantMatches(variant, row.title ?? '')).length
    })
    perVariantInFetchedBatch[variant.id] = bySource
  }
  const retrievalLog = {
    channel: 'operational',
    component: 'admin-match',
    event: 'candidate_retrieval',
    product_id: productId,
    variants: plan.variants.map((v) => v.id),
    variant_count: plan.variants.length,
    model_distinctive: plan.diagnostics.modelDistinctive,
    aliases_considered: plan.diagnostics.aliasesConsidered,
    aliases_admitted: plan.diagnostics.aliasesAdmitted,
    variants_capped: plan.diagnostics.variantsCapped,
    // Capped fetched rows, NOT complete source counts. A zero does not prove
    // the source or variant has no database hits.
    per_source_fetched: perSourceFetched,
    per_variant_in_fetched_batch: perVariantInFetchedBatch,
    unique_after_dedup: pool.length,
    dropped_decided: droppedAsDecided,
    dropped_duplicate: droppedAsDuplicate,
  }

  if (pool.length === 0) {
    console.info(JSON.stringify({ ...retrievalLog, scored_out: 0, returned: 0 }))
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

  /**
   * The classifier round-trip, with the failure kept as a fact.
   *
   * This used to be a bare `catch {}` that assigned every listing in the batch
   * `{ score: 'maybe', reason: 'Kunne ikke vurdere' }`. The card layer renders
   * `maybe` as `Måske`, so an operator looking at an exact
   * `Roland RE-201 Space Echo` was shown the badge that means "the model is
   * undecided" when what had actually happened was that the model never
   * answered. The exception was not even bound, so which failure it was could
   * not be recovered from the deployed system.
   *
   * Nothing about the request changes here — same model, same prompt, same
   * `max_tokens`, no retry. Only the reading of the reply changes.
   */
  let outcome: ClassifierOutcome
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
    outcome = interpretClassifierMessage(msg, batch.map((l) => l.id))
  } catch (error) {
    outcome = providerFailure(error)
  }

  const classifier = classifierStatus(outcome, batch.length)

  /**
   * A degraded classifier is an operational event and is logged as one.
   *
   * `detail` carries the provider's message only — never the prompt, never a
   * listing title, never a url. `failure` is the closed enum, so this line is
   * greppable and countable without parsing free text.
   */
  if (outcome.status === 'degraded') {
    console.error(
      JSON.stringify({
        channel: 'operational',
        component: 'admin-match',
        event: 'classifier_degraded',
        product_id: productId,
        failure: outcome.failure,
        batch_size: batch.length,
        detail: outcome.detail,
      }),
    )
  }

  const candidates: Candidate[] = batch
    .map((l) => {
      /**
       * Sanitise at the read boundary; keep the ad.
       *
       * The matching queue is where an operator disposes of a bad row, so
       * dropping it would remove the only place it can be dealt with. But the
       * NUMBER must not be rendered: a concatenated 235240 shown as
       * "235.240 EUR" is a false claim, and the write-side guard does nothing
       * for the rows already stored. Both fields are nulled together — a
       * converted DKK figure with no source price behind it is the same lie in
       * another currency.
       */
      const safe = sanitizeListingPrice(l)
      return {
        id:         l.id,
        title:      l.title,
        price:      safe.price,
        currency:   l.currency,
        price_dkk:  safe.price_dkk,
        url:        l.url,
        image_url:  l.image_url,
        location:   l.location,
        source:     l.source,
        scraped_at: l.scraped_at,
        // 'none' for every row here by construction — decided listings are
        // filtered out above. Read from the same map so the field cannot drift.
        match_state: matchState(decided.get(l.id), decided.has(l.id)),
        ...verdictFor(outcome, l.id),
      }
    })
    .filter((c) => c.score !== 'no')
    .sort((a, b) => {
      const order = { yes: 0, maybe: 1, no: 2 }
      return order[a.score] - order[b.score]
    })
    .slice(0, limit)

  console.info(
    JSON.stringify({
      ...retrievalLog,
      sent_to_classifier: batch.length,
      // Status first: every count below is meaningless when the classifier
      // never answered, and reading them as verdicts is the mistake this
      // route used to invite.
      classifier_status: classifier.status,
      classifier_failure: classifier.failure,
      classifier_unscored: classifier.unscored,
      scored_yes: batch.filter((l) => verdictFor(outcome, l.id).score === 'yes').length,
      scored_maybe: batch.filter((l) => {
        const v = verdictFor(outcome, l.id)
        return v.scored && v.score === 'maybe'
      }).length,
      scored_no: batch.filter((l) => verdictFor(outcome, l.id).score === 'no').length,
      scored_out: batch.length - candidates.length,
      returned: candidates.length,
    }),
  )

  return NextResponse.json({
    candidates,
    sources: MATCH_SOURCES.map((s) => s.key),
    // Additive. An existing client ignores it; see the client contract note in
    // docs for what a future card is expected to do with `degraded`.
    classifier,
  })
}
