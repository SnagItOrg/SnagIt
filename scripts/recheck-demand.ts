/**
 * scripts/recheck-demand.ts
 *
 * PAN-247. Re-reads every saved DBA ad that is still active
 * (`price_check_demand`, one polite request each), re-runs the identification
 * — `decideMatch`, then the PAN-244 guess — queues a price fetch for a matched
 * product, and marks sold or removed ads. It never writes a match or a KG row.
 *
 * Dry-run by default: it reads the ads and prints what it would write.
 * `--apply` writes. Meant to run nightly on the Mac Mini under PM2, once the
 * dry run has been seen there.
 *
 * Usage:
 *   npx tsx scripts/recheck-demand.ts            # dry run
 *   npx tsx scripts/recheck-demand.ts --apply
 */

import * as path from 'path'
import * as fs from 'fs'
// The frontend copy of supabase-js, the documented pattern for scripts/, so the
// shared matcher and demand code type-check against one SupabaseClient identity.
const { createClient } = require('../frontend/node_modules/@supabase/supabase-js') as typeof import('../frontend/node_modules/@supabase/supabase-js')
import { decideMatch, loadMatchIndex } from '../frontend/lib/matching/match-listings'
import { scrapeDbaListing } from '../frontend/lib/scrapers/dba-listing'
import { adStateFrom, canonicalSlugs, guessesFor } from '../frontend/lib/price-check-demand'

// ── Load env ─────────────────────────────────────────────────────────────────
const envPaths = [
  path.resolve(__dirname, '../frontend/.env.local'),
  path.resolve(__dirname, '../.env.local'),
]
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, 'utf8').split('\n')
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
    break
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const APPLY = process.argv.includes('--apply')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Rate limiting: one polite request per ad, ≥2 s apart plus jitter ─────────
const FETCH_DELAY_MS = 2500
let lastFetchTime = 0

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

async function rateLimit() {
  const elapsed = Date.now() - lastFetchTime
  const delay = Math.max(0, FETCH_DELAY_MS + (Math.random() * 500 - 250) - elapsed)
  if (delay > 0) await sleep(delay)
  lastFetchTime = Date.now()
}

/** The ad id, for the log: the URL itself and the title stay out of it. */
const adId = (url: string) => /\/item\/(\d+)/.exec(url)?.[1] ?? '?'

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Demand re-check (${APPLY ? 'APPLY' : 'DRY RUN'})`)

  const { data: rows, error } = await supabase
    .from('price_check_demand')
    .select('url')
    .eq('source', 'dba')
    .eq('ad_state', 'active')
    .order('last_seen_at', { ascending: false })

  if (error) {
    console.error('demand_read_failed')
    process.exit(1)
  }
  if (!rows || rows.length === 0) {
    console.log('No active ad to re-check. Exiting.')
    return
  }

  console.log(`Re-checking ${rows.length} ads\n`)
  const [index, canonical] = await Promise.all([loadMatchIndex(supabase), canonicalSlugs(supabase)])

  const counts = { active: 0, sold: 0, removed: 0, matched: 0, queued: 0, failed: 0 }

  for (const row of rows as Array<{ url: string }>) {
    await rateLimit()
    const fetched = await scrapeDbaListing(row.url).then((l) => l, (e: unknown) => String(e))
    const listing = typeof fetched === 'string' ? null : fetched
    const ad_state = adStateFrom(fetched)
    counts[ad_state]++

    const decision = listing ? decideMatch(listing.title, index) : null
    const product = decision?.kind === 'matched' ? index.productById.get(decision.best.product_id) : undefined
    const guesses = listing && !product ? await guessesFor(canonical, index, listing, listing.price, async () => null) : []
    if (product) counts.matched++

    const what = product ? `matched ${product.slug}` : listing ? `${guesses.length} guesses` : 'not read'
    console.log(`  [${adId(row.url)}] ${ad_state}, ${what}`)
    if (!APPLY) continue

    const { error: writeError } = await supabase
      .from('price_check_demand')
      .update({
        ad_state,
        rechecked_at: new Date().toISOString(),
        // A page that was read refreshes the ad's own facts and the identification.
        ...(listing
          ? { title: listing.title, price: listing.price, currency: listing.currency, matched_slug: product?.slug ?? null, guesses }
          : {}),
      })
      .eq('url', row.url)
    if (writeError) {
      console.error('    demand_write_failed')
      counts.failed++
      continue
    }

    if (product && ad_state === 'active') {
      // The same insert the route makes: the unique index on pending slugs
      // makes a repeat a no-op (23505).
      const { error: queueError } = await supabase
        .from('price_fetch_queue')
        .insert({ product_slug: product.slug, status: 'pending' })
      if (!queueError) counts.queued++
      else if (queueError.code !== '23505') console.error('    queue_write_failed')
    }
  }

  console.log(`\nDone: ${counts.active} active, ${counts.sold} sold, ${counts.removed} removed; ` +
    `${counts.matched} matched, ${counts.queued} price fetches queued, ${counts.failed} write failures` +
    (APPLY ? '' : ' (dry run: nothing written)'))
}

main().catch((err: unknown) => {
  console.error(`${(err as Error).message ?? err}`)
  process.exit(1)
})
