/**
 * scripts/pan262-rematch.ts — PAN-262: the existing rows the four matcher rules change. DRY RUN unless --apply.
 *
 * The rules (Danish "til", Martin codes without the hyphen, Shenandoah, "tangenter") decide new
 * listings from the next nightly run. This re-decides what is already written:
 *
 *   release   — live UNREVIEWED match rows (is_valid NULL, no admin_decision) whose title carries a
 *               rule's word: "til", "tangenter" or "shenandoah". A row is released (is_valid=false,
 *               rejected_reason 'pan262_not_this_product', guarded on is_valid NULL) only on positive
 *               evidence against its product: the title is a part, accessory or wanted ad, this
 *               product's line boundary refuses it, or it decides to another product. A row that
 *               merely decides to nothing is kept and listed: undecidable is not wrong (rematch-brand).
 *               An is_valid=true row or a person's decision is never read into the cohort.
 *   unmatched — active listings with no live match whose title writes a Martin code without its
 *               hyphen ("Martin D28").
 *
 * --apply: an owner-authorised production write, run on panter. Refused unless --expect-selection=
 * equals the md5 the dry run printed. Writes the rollback file before the first write, releases, then
 * hands every cohort listing to `matchListings`, the one writer, so a released title that names
 * another product lands there.
 *
 * --rollback=FILE [--apply]: deletes the is_valid NULL rows created for those listings since the
 * start and restores each released row to is_valid NULL with its prior rejected_reason.
 *
 * Usage (from the repository root):
 *   npx tsx scripts/pan262-rematch.ts
 *   npx tsx scripts/pan262-rematch.ts --apply --expect-selection=<md5> [--out-dir=DIR]
 *   npx tsx scripts/pan262-rematch.ts --rollback=DIR/pan262-rollback-<ts>.json [--apply]
 */

import { createHash } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import dotenv from 'dotenv'
import type { SupabaseClient } from '../frontend/node_modules/@supabase/supabase-js'
import { decideMatch, hyphenateMartinCodes, lineBoundaryRefusal, loadMatchIndex, matchListings, type MatchIndex } from '../frontend/lib/matching/match-listings'
import { readActiveTitles } from './lib/rematch-active-titles'
import { HUMAN_DECISION } from './lib/rematch-verdicts'

const REASON = 'pan262_not_this_product'
/** The rules' words; a title without one cannot decide differently because of PAN-262. */
export const RULE_WORDS = /(?<![\w-])(?:til|tangenter|shenandoah)(?![\w-])/i
const CHUNK = 100

/** What re-deciding a live row on `slug` says: release it (and why), or keep it. */
export function releaseVerdict(title: string, slug: string, index: MatchIndex): { release: boolean; why: string } {
  const d = decideMatch(title, index)
  const decided = d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug ?? null : null
  if (decided === slug) return { release: false, why: 'stays' }
  if (decided) return { release: true, why: `matched:${decided}` }
  if (d.kind === 'deferred' && d.reason === 'non_product_intent') return { release: true, why: `non_product_intent: ${d.detail}` }
  const refusal = lineBoundaryRefusal(hyphenateMartinCodes(title.toLowerCase().trim()), slug)
  if (refusal) return { release: true, why: `line boundary: ${refusal}` }
  return { release: false, why: `kept, for review: ${d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind}` }
}

/** A Martin code written without its hyphen, which the model tier could not read before PAN-262. */
export const gluedMartinCode = (title: string): boolean => {
  const t = title.toLowerCase().trim()
  return hyphenateMartinCodes(t) !== t
}

/* ── I/O ─────────────────────────────────────────────────────────────────── */

function client(): SupabaseClient {
  const { createClient } = require('../frontend/node_modules/@supabase/supabase-js') as typeof import('../frontend/node_modules/@supabase/supabase-js')
  for (const p of [path.resolve(__dirname, '../.env.local'), path.resolve(__dirname, '../frontend/.env.local')]) {
    if (fs.existsSync(p)) { dotenv.config({ path: p }); break }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

const chunks = <T>(xs: T[]): T[][] =>
  Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK))

type Live = { id: string; listing_id: string; product_id: string; rejected_reason: string | null; title: string }

/** Every unreviewed live row whose title carries a rule word, keyset-paged on the primary key. */
async function unreviewedWithRuleWord(db: SupabaseClient): Promise<Live[]> {
  type R = { id: string; listing_id: string; product_id: string; rejected_reason: string | null; explain: unknown; listings: { title: string | null } | null }
  const out: Live[] = []
  let last: string | null = null
  for (;;) {
    let q = db.from('listing_product_match').select('id, listing_id, product_id, rejected_reason, explain, listings!inner(title)')
      .is('is_valid', null).order('id').limit(1000)
    if (last !== null) q = q.gt('id', last)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const page = (data ?? []) as unknown as R[]
    for (const r of page) {
      const title = r.listings?.title
      if (title && RULE_WORDS.test(title) && !HUMAN_DECISION(r.explain)) {
        out.push({ id: r.id, listing_id: r.listing_id, product_id: r.product_id, rejected_reason: r.rejected_reason, title })
      }
    }
    if (page.length < 1000) return out
    last = page[page.length - 1].id
  }
}

async function run(db: SupabaseClient, apply: boolean, expect: string | undefined, outDir: string): Promise<void> {
  const [index, live, active] = await Promise.all([loadMatchIndex(db), unreviewedWithRuleWord(db), readActiveTitles(db)])
  // A row may sit on a product the index does not hold (not matchable today), so slugs are read by id.
  const slugs = new Map<string, string>()
  for (const group of chunks(Array.from(new Set(live.map((r) => r.product_id))))) {
    const { data, error } = await db.from('kg_product').select('id, slug').in('id', group)
    if (error) throw new Error(error.message)
    for (const p of data ?? []) slugs.set(p.id as string, p.slug as string)
  }
  const slugOf = (id: string) => slugs.get(id) ?? index.productById.get(id)?.slug ?? id

  const release: Array<Live & { why: string }> = []
  const kept: string[] = []
  for (const r of live) {
    const v = releaseVerdict(r.title, slugOf(r.product_id), index)
    if (v.release) release.push({ ...r, why: v.why })
    else if (v.why !== 'stays') kept.push(`  ${slugOf(r.product_id)} | ${v.why} | ${r.title}`)
  }

  const glued = active.filter((l): l is { id: string; title: string } => !!l.title && gluedMartinCode(l.title))
  const withLive = new Set<string>()
  for (const group of chunks(glued.map((l) => l.id))) {
    const { data, error } = await db.from('listing_product_match').select('listing_id').in('listing_id', group).or('is_valid.is.null,is_valid.eq.true')
    if (error) throw new Error(error.message)
    for (const r of data ?? []) withLive.add(r.listing_id as string)
  }
  const unmatched = glued.filter((l) => !withLive.has(l.id))

  const selection = [...release.map((r) => `release|${r.id}`), ...unmatched.map((l) => `unmatched|${l.id}`)].sort()
  const md5 = createHash('md5').update(selection.join('\n')).digest('hex')

  console.log(`PAN-262 re-match — ${apply ? 'APPLY' : 'DRY RUN'}`)
  console.log(`release: ${live.length} unreviewed rows carry a rule word; ${release.length} to release, ${kept.length} kept for review`)
  for (const r of release.sort((a, b) => a.title.localeCompare(b.title))) console.log(`  ${r.listing_id} | ${slugOf(r.product_id)} | ${r.why} | ${r.title}`)
  if (kept.length) console.log(`kept, for review:\n${kept.sort().join('\n')}`)
  console.log(`unmatched: ${glued.length} active titles write a Martin code without the hyphen; ${unmatched.length} hold no live match`)
  for (const l of unmatched) {
    const d = decideMatch(l.title, index)
    const to = d.kind === 'matched' || d.kind === 'rejected' ? `${d.kind}:${slugOf(d.best.product_id)}` : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
    console.log(`  ${l.id} | ${to} | ${l.title}`)
  }
  console.log(`selection md5=${md5}`)
  if (!apply) return

  if (expect !== md5) throw new Error(`refused: --expect-selection=${expect ?? '(missing)'} is not this selection's md5 ${md5}; re-run the dry run`)
  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `pan262-rollback-${Date.now()}.json`)
  const listingIds = Array.from(new Set([...release.map((r) => r.listing_id), ...unmatched.map((l) => l.id)]))
  const fd = fs.openSync(file, 'wx')
  fs.writeSync(fd, JSON.stringify({
    started_at: new Date().toISOString(),
    listing_ids: listingIds,
    released: release.map((r) => ({ id: r.id, listing_id: r.listing_id, product_id: r.product_id, rejected_reason: r.rejected_reason })),
  }))
  fs.fsyncSync(fd)
  fs.closeSync(fd)
  console.log(`rollback written first: ${file}`)

  let released = 0
  for (const r of release) {
    const { data, error } = await db.from('listing_product_match').update({ is_valid: false, rejected_reason: REASON })
      .eq('id', r.id).is('is_valid', null).select('id')
    if (error) throw new Error(error.message)
    released += (data ?? []).length
  }
  console.log(`released: ${released} (raced: ${release.length - released}, reviewed since the dry run, left as they are)`)
  for (const group of chunks(listingIds)) console.log(await matchListings(db, group))
}

async function rollback(db: SupabaseClient, file: string, apply: boolean): Promise<void> {
  const { started_at, listing_ids, released } = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    started_at: string
    listing_ids: string[]
    released: Array<{ id: string; rejected_reason: string | null }>
  }
  const created: string[] = []
  for (const group of chunks(listing_ids)) {
    const { data, error } = await db.from('listing_product_match').select('id')
      .in('listing_id', group).gte('created_at', started_at).is('is_valid', null)
    if (error) throw new Error(error.message)
    created.push(...(data ?? []).map((r) => r.id as string))
  }
  console.log(`PAN-262 rollback — ${apply ? 'APPLY' : 'DRY RUN'} — ${created.length} unreviewed rows created since ${started_at}; ${released.length} released rows to restore`)
  if (!apply) return
  for (const group of chunks(created)) {
    const { error } = await db.from('listing_product_match').delete().in('id', group).is('is_valid', null)
    if (error) throw new Error(error.message)
  }
  for (const r of released) {
    const { error } = await db.from('listing_product_match').update({ is_valid: null, rejected_reason: r.rejected_reason })
      .eq('id', r.id).eq('is_valid', false).eq('rejected_reason', REASON)
    if (error) throw new Error(error.message)
  }
  console.log('restored')
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
  const APPLY = args.includes('--apply')
  const ROLLBACK = flag('rollback')
  const db = client()
  ;(ROLLBACK
    ? rollback(db, ROLLBACK, APPLY)
    : run(db, APPLY, flag('expect-selection'), flag('out-dir') ?? path.join(os.tmpdir(), 'pan262'))
  ).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
