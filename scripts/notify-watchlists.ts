/**
 * scripts/notify-watchlists.ts
 *
 * PAN-12. One email per active watchlist with the listings that are new since
 * the last run and hit it (`scripts/lib/watchlist-hits.ts`), from every
 * supported marketplace. Runs on panter under PM2 after the nightly scrapes
 * have promoted and matched; it only reads `listings`, so it never competes
 * with ingestion on the listings unique index.
 *
 * New means `listings.ingested_at` (write-once database time, migration 055)
 * after the watchlist was created, after the go-live, and inside the last
 * 7 days. The go-live is the moment migration 066 was applied: it marked the
 * 324 historical rows as seen, so nothing older is ever sent (owner decision 2,
 * 2026-10-07). Every run re-reads the whole window and leaves the dedupe to
 * the (watchlist, listing) claim, so a night the job missed is caught up by
 * the next one and a listing promoted after the run goes out the night after.
 *
 * Honours `notification_preferences` (email_enabled, new_listings; no row
 * means the defaults, both on).
 *
 * PAN-273: a product watchlist (`product_id`, migration 069) hits what the
 * matcher tied to its model — `listing_product_match` rows for the watched
 * products, created inside the window and not rejected. A watch whose product
 * is no longer canonical is skipped, fail-closed. Until 069 is applied the
 * column does not exist, and the run falls back to query watchlists only.
 *
 * PAN-276/278: once migration 070 is applied every mail gets a
 * `watchlist_mail` row and links through `/w/<token>`; a watchlist's earlier
 * rows decide whether the mail asks "Skal vi stoppe?" or pauses it
 * (`mailPrompt()` in frontend/lib/watchlist-mail.ts). Until then the mail
 * keeps the PAN-273 links and carries no prompt.
 *
 * PAN-297: a product watchlist's hits carry the verdict word the model's own
 * product page shows for them — `loadChildVerdicts()`, the read the family
 * page uses, measured against that one model's bands with the Danish band
 * first and a Reverb band only when labelled as such. A query watchlist has
 * no model and gets no word. The word is additive: a verdict read that fails
 * is logged and the mail goes out as before.
 *
 * Dry run by default: prints the would-send list — watchlist id, query, the
 * hits — and writes nothing. It skips pairs the table already holds, so it
 * shows what tonight's --apply would do. Before 066 is applied it has no
 * go-live and previews the last 24 hours instead; --apply refuses then.
 *   npx tsx scripts/notify-watchlists.ts            # dry run
 *   npx tsx scripts/notify-watchlists.ts --apply
 */

import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { sendNewListingsEmail } from '../frontend/lib/email'
import { isCanonical } from '../frontend/lib/catalogue'
import { loadChildVerdicts, type CardVerdict } from '../frontend/lib/listing-verdicts'
import { mailPrompt, type MailEngagement, type MailPrompt } from '../frontend/lib/watchlist-mail'
import {
  isNonProduct, matchesProductWatchlist, matchesWatchlist, notifyHits, type HitListing, type HitWatchlist,
} from './lib/watchlist-hits'

const envPaths = [
  path.resolve(__dirname, '../frontend/.env.local'),
  path.resolve(__dirname, '../.env.local'),
]
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
    break
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const APPLY = process.argv.includes('--apply')
if (APPLY && (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL)) {
  console.error('Missing RESEND_API_KEY or RESEND_FROM_EMAIL; --apply refuses')
  process.exit(1)
}

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const PAGE = 1000
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.klup.dk'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

async function main() {
  const { data: seen, error: seenError } = await supabase
    .from('watchlist_notification')
    .select('attempted_at')
    .eq('outcome', 'seen')
    .order('attempted_at', { ascending: true })
    .limit(1)
  const goLive = !seenError && seen?.[0] ? Date.parse(seen[0].attempted_at) : null
  if (goLive == null && APPLY) {
    console.error('watchlist_notification has no go-live (migration 066 not applied); refusing')
    process.exit(1)
  }
  const since = new Date(goLive == null ? Date.now() - DAY_MS : Math.max(goLive, Date.now() - WINDOW_MS)).toISOString()

  const watchlistQuery = (withProduct: boolean) => supabase
    .from('watchlists')
    .select(`id, user_id, query, min_price, max_price, created_at${withProduct ? ', product_id' : ''}`)
    .eq('active', true)
    .in('type', withProduct ? ['query', 'product'] : ['query'])
    .not('user_id', 'is', null) // an ownerless watchlist has nobody to mail (production holds some)
  let { data: watchlists, error: wlError } = await watchlistQuery(true)
  if (wlError?.code === '42703') {
    // 069 not applied: no product column, no product watchlists.
    console.log('watchlists.product_id absent (migration 069 not applied); query watchlists only')
    ;({ data: watchlists, error: wlError } = await watchlistQuery(false))
  }
  if (wlError) throw new Error(`watchlists: ${wlError.message}`)

  // Keyset on (ingested_at, id). A promoted batch shares one ingested_at, so
  // the id breaks the tie; ordering by id alone walks the whole primary key
  // (7.8 s a page on 115k rows, measured 2026-10-19), this reads the window.
  const listings: HitListing[] = []
  let cursor: { at: string; id: string } | null = null
  for (;;) {
    let q = supabase
      .from('listings')
      .select('id, title, price, currency, price_dkk, url, source, ingested_at, is_active, image_url')
      .is('watchlist_id', null)
      .gt('ingested_at', since)
      .order('ingested_at')
      .order('id')
      .limit(PAGE)
    if (cursor) q = q.or(`ingested_at.gt."${cursor.at}",and(ingested_at.eq."${cursor.at}",id.gt.${cursor.id})`)
    const { data, error } = await q
    if (error) throw new Error(`listings: ${error.message}`)
    listings.push(...(data as HitListing[]))
    if (!data || data.length < PAGE) break
    const last = data[data.length - 1]
    cursor = { at: last.ingested_at, id: last.id }
  }

  // PAN-273. The watched products that are still canonical, and what the
  // matcher tied to them inside the window. `isCanonical()` is the one
  // authority (frontend/lib/catalogue.ts); a model taken off public stops
  // mailing on the next run. Match rows are read by product, not by listing:
  // the watched set is small, the window's listing ids are not.
  const watchedIds = [...new Set(
    ((watchlists ?? []) as Array<{ product_id?: string | null }>).map((w) => w.product_id).filter((id): id is string => !!id),
  )]
  const productSlug = new Map<string, string>()
  const matchedByListing = new Map<string, Set<string>>()
  let verdictsByProduct = new Map<string, Map<string, CardVerdict>>()
  if (watchedIds.length > 0) {
    const [{ data: products, error: productError }, { data: projection, error: projectionError }] = await Promise.all([
      supabase.from('kg_product').select('id, slug, status, support_state, browse_visibility').in('id', watchedIds),
      supabase.from('browse_product_projection').select('id, browse_domain').in('id', watchedIds),
    ])
    if (productError) throw new Error(`kg_product: ${productError.message}`)
    if (projectionError) throw new Error(`browse_product_projection: ${projectionError.message}`)
    const domain = new Map((projection ?? []).map((p) => [p.id as string, p.browse_domain as string | null]))
    for (const p of products ?? []) {
      if (isCanonical({ ...p, browse_domain: domain.get(p.id as string) ?? null })) productSlug.set(p.id as string, p.slug as string)
    }

    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('listing_product_match')
        .select('listing_id, product_id')
        .in('product_id', [...productSlug.keys()])
        .not('is_valid', 'is', false)
        .gte('created_at', since)
        .order('id')
        .range(from, from + PAGE - 1)
      if (error) throw new Error(`listing_product_match: ${error.message}`)
      for (const m of data ?? []) {
        let set = matchedByListing.get(m.listing_id as string)
        if (!set) matchedByListing.set(m.listing_id as string, (set = new Set()))
        set.add(m.product_id as string)
      }
      if (!data || data.length < PAGE) break
    }

    // PAN-297. One read for every watched model together, as the family page
    // does for its children; a transport failure costs the word, not the mail.
    if (productSlug.size > 0) {
      try {
        // The root and frontend copies of @supabase/supabase-js are two type
        // identities of one client (scripts/scrape-reverb.ts has the other fix).
        verdictsByProduct = await loadChildVerdicts(
          supabase as unknown as Parameters<typeof loadChildVerdicts>[0], [...productSlug.keys()],
        )
      } catch {
        console.error(JSON.stringify({ channel: 'operational', component: 'notify-watchlists', event: 'verdicts_unavailable' }))
      }
    }
  }
  const notCanonical = watchedIds.length - productSlug.size

  const userIds = [...new Set((watchlists ?? []).map((w) => w.user_id as string))]
  const { data: prefs, error: prefError } = await supabase
    .from('notification_preferences')
    .select('user_id, email_enabled, new_listings')
    .in('user_id', userIds)
  if (prefError) throw new Error(`notification_preferences: ${prefError.message}`)
  const optedOut = new Set(
    (prefs ?? []).filter((p) => p.email_enabled === false || p.new_listings === false).map((p) => p.user_id as string),
  )

  // PAN-276. 070 applied or not: the probe's error is the answer, as 069's is.
  const { error: mailProbeError } = await supabase.from('watchlist_mail').select('token').limit(1)
  const mailRows = !mailProbeError
  /** PAN-278: what this watchlist's next mail carries, from its earlier mails. */
  const promptFor = async (watchlistId: string): Promise<MailPrompt | null> => {
    if (!mailRows) return null
    const { data, error } = await supabase
      .from('watchlist_mail')
      .select('sent_at, clicked_at, prompt')
      .eq('watchlist_id', watchlistId)
      .order('sent_at', { ascending: false })
      .limit(200)
    if (error) throw new Error(`watchlist_mail: ${error.message}`)
    return mailPrompt((data ?? []) as MailEngagement[])
  }

  // The dry run honours the claim table too: every pair claimed for a listing
  // in the window was claimed after `since`, so this read is bounded.
  const handled = new Set<string>()
  if (!APPLY && goLive != null) {
    const { data: rows, error } = await supabase
      .from('watchlist_notification')
      .select('watchlist_id, listing_id')
      .gte('attempted_at', since)
    if (error) throw new Error(`watchlist_notification: ${error.message}`)
    for (const r of rows ?? []) handled.add(`${r.watchlist_id}:${r.listing_id}`)
  }

  console.log(
    `${APPLY ? 'apply' : 'dry run'}: since ${since}${goLive == null ? ' (no go-live: 066 not applied, last 24 h shown)' : ''}, `
    + `${listings.length} new listings, ${watchlists?.length ?? 0} active watchlists`
    + ` (${watchedIds.length} model(s) watched${notCanonical ? `, ${notCanonical} no longer canonical and skipped` : ''}), `
    + `${optedOut.size} user(s) opted out`
    + `${mailRows ? '' : '; watchlist_mail absent (migration 070 not applied): no /w links, no prompts'}`,
  )

  const tally: Record<string, number> = {}
  let wouldSend = 0
  let wouldSendListings = 0
  const wouldSendUsers = new Set<string>()
  for (const w of (watchlists ?? []) as Array<HitWatchlist & { user_id: string }>) {
    const slug = w.product_id ? productSlug.get(w.product_id) : undefined
    if (w.product_id && !slug) continue // no longer canonical
    // The product rule has no part/wanted guard: the matcher already decided.
    const matched = w.product_id
      ? listings.filter((l) => matchesProductWatchlist(w, l, matchedByListing.get(l.id)))
      : listings.filter((l) => matchesWatchlist(w, l))
    const verdicts = w.product_id ? verdictsByProduct.get(w.product_id) : undefined
    const hits = (w.product_id
      ? matched.map((l) => ({ ...l, verdict: verdicts?.get(l.id) ?? null }))
      : matched.filter((l) => !isNonProduct(l)))
      .sort((a, b) => (a.price_dkk ?? Infinity) - (b.price_dkk ?? Infinity))
    if (hits.length === 0) continue

    if (!APPLY) {
      const fresh = hits.filter((l) => !handled.has(`${w.id}:${l.id}`))
      if (fresh.length === 0) continue
      const skipped = matched.length - hits.length
      const prompt = await promptFor(w.id)
      const note = [
        skipped ? `${skipped} part/wanted skipped` : '',
        optedOut.has(w.user_id) ? 'opted out' : '',
        prompt ? `prompt ${prompt}` : '',
      ].filter(Boolean).join(', ')
      console.log(`  ${w.id}  ${slug ? `[model ${slug}]` : `"${w.query}"`}  ${fresh.length} hit(s)${note ? ` (${note})` : ''}`)
      for (const l of fresh.slice(0, 5)) {
        console.log(
          `    • ${l.title} — ${l.price_dkk != null ? `${l.price_dkk.toLocaleString('da-DK')} kr` : 'no price'} (${l.source})`
          + (l.verdict ? ` · ${l.verdict.verdict}${l.verdict.basisLabelKey ? ` [${l.verdict.basisLabelKey}]` : ''}` : ''),
        )
      }
      if (fresh.length > 5) console.log(`    …and ${fresh.length - 5} more`)
      if (!optedOut.has(w.user_id)) {
        wouldSend += 1
        wouldSendListings += fresh.length
        wouldSendUsers.add(w.user_id)
      }
      continue
    }

    const { data: user } = await supabase.auth.admin.getUserById(w.user_id)
    const result = await notifyHits(
      supabase,
      {
        watchlist: w,
        hits,
        email: user?.user?.email ?? null,
        optedOut: optedOut.has(w.user_id),
        seeAllUrl: slug ? `${APP_URL}/product/${slug}` : undefined,
        mailRows,
        prompt: await promptFor(w.id),
      },
      sendNewListingsEmail,
    )
    if (result.outcome) tally[result.outcome] = (tally[result.outcome] ?? 0) + 1
    if (result.prompt) tally[`prompt_${result.prompt}`] = (tally[`prompt_${result.prompt}`] ?? 0) + 1
  }

  if (APPLY) console.log(`done: ${JSON.stringify(tally)} (watchlists by outcome)`)
  else console.log(`would send ${wouldSend} email(s) to ${wouldSendUsers.size} user(s), ${wouldSendListings} listing(s); nothing sent, nothing written`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
