/**
 * scripts/pan203-warm-audio-rematch.ts — PAN-203. DRY RUN unless --apply.
 * A copy of scripts/pan202-neumann-rematch.ts for the Warm Audio pass.
 *
 * Re-decides two cohorts against the Warm Audio models PAN-203 creates and promotes
 * (Warm Audio has no navigation family, so the Gibson `held` cohort is empty here):
 *
 *   stale     — listings whose live match (is_valid NULL or true) sits on one of
 *               the PROMOTED rows. None of them is a match target today, so their
 *               live matches are historical: jr units on the WA-87 and WA-47, D2
 *               units on the WA76, stereo pairs, packs and modified units on the
 *               singles. Re-decided, a jr lands on its jr row and the old match is
 *               released; a pair, pack or modified unit lands nowhere and is kept
 *               for review (the automatic ones are released by the promote SQL).
 *   unmatched — active listings whose title names Warm Audio and that hold no
 *               live match anywhere.
 *
 * The originals Warm Audio copies (Neumann, Universal Audio 1176 / LA-2A, Neve
 * 1073, Tube-Tech CL 1B) are not re-decided: the PAN-203 boundaries change none
 * of their 655 live matches (the regression table on the boundary PR). The one
 * Warm Audio listing live on `neve-1073` is released by the promote SQL and
 * comes back here as unmatched.
 *
 * Every decision is `decideMatch`'s. Nothing here scores a title.
 *
 * TWO COLUMNS, BECAUSE SUPPORT IS NOT OURS TO WIDEN. Only `supported` rows
 * receive automatic matches, so the dry run prints, for every listing:
 *
 *   now        — the decision against the real index (`loadMatchIndex`). This
 *                is exactly what --apply writes. After the promote SQL has run,
 *                it IS the promoted state.
 *   supported  — the decision if every PROMOTED row were `supported`. A
 *                forecast for the promotion. Never written.
 *
 * --apply: an owner-authorised production write, run only after the promote
 * SQL. It writes the rollback file BEFORE the first write (start time, the
 * listing ids, and every held row's prior is_valid / rejected_reason), then:
 *   1. hands every listing to `matchListings`, the one writer, which writes
 *      what `decideMatch` decides against the real index;
 *   2. for a held or stale listing that step 1 gave a live row on ANOTHER
 *      product, marks the old row is_valid=false, rejected_reason
 *      'pan203_moved_to_model', guarded on the prior is_valid it read. A stale
 *      listing that lands nowhere keeps its row and is listed for review:
 *      undecidable is not wrong.
 *
 * --rollback=FILE: deletes the match rows created for those listings at or
 * after the recorded start, except any a person has approved since
 * (is_valid=true), and restores each released row's prior is_valid and
 * rejected_reason. Also a dry run without --apply.
 *
 * Usage (from the repository root):
 *   npx tsx scripts/pan203-warm-audio-rematch.ts [--show=N]
 *   npx tsx scripts/pan203-warm-audio-rematch.ts --apply [--out-dir=DIR]
 *   npx tsx scripts/pan203-warm-audio-rematch.ts --rollback=DIR/pan203-rollback-<ts>.json [--apply]
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import dotenv from 'dotenv'
import type { SupabaseClient } from '../frontend/node_modules/@supabase/supabase-js'
import {
  PRODUCT_SELECT,
  buildMatchIndex,
  decideMatch,
  isMatchableProduct,
  loadMatchIndex,
  matchListings,
  normalizeProductRow,
  type MatchIndex,
  type Product,
} from '../frontend/lib/matching/match-listings'

/** Warm Audio has no family label rows, so no held cohort. */
export const LABELS: readonly string[] = []

/**
 * The rows the PAN-203 promote SQL moves from `known` to `supported`: the same
 * reviewed list, verbatim. Not here: the owner-held "clean" WA12 MKII, the pair
 * rows (WA-2A Stereo Pair, WA-84 Stereo Pair, WA-87 R2 TS), and the held rows
 * (WA-47T, WA-47F, WA76-D2, WA-WL, the "LDC 87 Type" and French small-diaphragm titles).
 */
export const PROMOTED: readonly string[] = [
  'warm-audio-wa-19', 'warm-audio-wa-251', 'warm-audio-wa-2mpx',
  'warm-audio-wa-412', 'warm-audio-wa-47jr', 'warm-audio-wa-47jr-se',
  'warm-audio-wa-67', 'warm-audio-wa-84', 'warm-audio-wa-87-r2',
  'warm-audio-wa-87jr', 'warm-audio-wa-87jr-se', 'warm-audio-wa-cx24',
  'warm-audio-wa273', 'warm-audio-wa2a', 'warm-audio-wa47',
  'warm-audio-wa73', 'warm-audio-wa73-eq', 'warm-audio-wa76',
  'warm-audio-wa87', 'warm-audio-warm-audio-wa-1b', 'warm-audio-warm-audio-wa-44',
  'warm-audio-warm-audio-wa-8000', 'warm-audio-warm-audio-wa-cx12', 'warm-audio-warm-audio-wa-mpx',
  'warm-audio-warm-audio-wa273-eq', 'warm-audio-warm-bender',
]

/**
 * Rows supported TODAY whose live matches the PAN-203 boundaries change: none.
 * The clone guard on the Neumann, 1176, LA-2A, Neve 1073 and CL 1B rows changes
 * no live match on them (measured on all 655).
 */
export const SUPPORTED_TODAY: readonly string[] = []

/** Every row whose live matches are re-decided. */
export const RE_DECIDED: readonly string[] = [...PROMOTED, ...SUPPORTED_TODAY]

/**
 * The unmatched cohort: active titles that name Warm Audio. Other makers' listings
 * that mention Warm Audio ("Revive Audio Modified: Warm Audio WA73") stay in scope
 * on purpose: `decideMatch` defers or rejects them, which is the auditable outcome.
 */
export const LINES: ReadonlyArray<{ line: string; names: RegExp; ilike: string[] }> = [
  { line: 'warm-audio', names: /warm\s*audio/i, ilike: ['%warm%audio%'] },
]

export const REJECTED_REASON = 'pan203_moved_to_model'

export interface PoolListing {
  id: string
  title: string
  cohort: 'held' | 'stale' | 'unmatched'
  /** The label or promoted row the listing is held on, or its line when unmatched. */
  group: string
  /** held/stale only: the held row's product and prior state, restored exactly by --rollback. */
  product_id?: string
  prior_is_valid?: boolean | null
  prior_rejected_reason?: string | null
}

export type Outcome = { key: string; slug: string | null }

/** One listing's decision, keyed the way the report counts it. */
export function outcome(title: string, index: MatchIndex): Outcome {
  const d = decideMatch(title, index)
  const slug = d.kind === 'matched' || d.kind === 'rejected' ? index.productById.get(d.best.product_id)?.slug ?? null : null
  if (d.kind === 'deferred') return { key: `deferred:${d.reason}`, slug: null }
  return { key: slug ? `${d.kind}:${slug}` : d.kind, slug }
}

/**
 * The forecast index: the real candidates plus every PROMOTED row, with
 * support forced to `supported` IN MEMORY ONLY. It answers "what would move if
 * the promotion ran", and nothing built from it is ever written.
 */
export function forecastIndex(real: Product[], promoted: Product[], idents: MatchIndex['idents'], synonyms: MatchIndex['synonyms'], brands: Iterable<string>): MatchIndex {
  const byId = new Map(real.map((p) => [p.id, p]))
  for (const c of promoted) if (c.status === 'active') byId.set(c.id, { ...c, support_state: 'supported' })
  return buildMatchIndex(Array.from(byId.values()), idents, synonyms, brands)
}

/* ── I/O ─────────────────────────────────────────────────────────────────── */

// The frontend copy of supabase-js, because the client is handed to
// frontend/lib/matching (the pattern scripts/pan195-fender-rematch.ts uses).
const CHUNK = 100

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readAll<T>(build: () => any): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data as T[]))
    if (data.length < 1000) return rows
  }
}

const chunks = <T>(xs: T[]): T[][] =>
  Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK))

/** slug -> id for the re-decided rows; every one must exist. */
async function heldRowIds(db: SupabaseClient): Promise<Map<string, string>> {
  const slugs = [...LABELS, ...RE_DECIDED]
  const out = new Map<string, string>()
  for (const group of chunks(slugs)) {
    const { data, error } = await db.from('kg_product').select('id, slug').in('slug', group)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) out.set(r.slug as string, r.id as string)
  }
  if (out.size !== slugs.length) throw new Error(`held rows missing: expected ${slugs.length}, found ${out.size}`)
  return out
}

/**
 * Held and stale rows are one entry per (listing, row) — a listing can sit on
 * two rows, and each is released and restored on its own. Unmatched listings
 * are one entry per listing.
 */
async function pool(db: SupabaseClient, ids: Map<string, string>): Promise<PoolListing[]> {
  const held: PoolListing[] = []
  for (const slug of [...LABELS, ...RE_DECIDED]) {
    type H = {
      listing_id: string
      is_valid: boolean | null
      rejected_reason: string | null
      listings: { title: string | null } | { title: string | null }[] | null
    }
    const productId = ids.get(slug)!
    const rows = await readAll<H>(() => db.from('listing_product_match')
      .select('listing_id, is_valid, rejected_reason, listings!inner(title)')
      .eq('product_id', productId).or('is_valid.is.null,is_valid.eq.true').order('listing_id'))
    for (const r of rows) {
      const l = Array.isArray(r.listings) ? r.listings[0] : r.listings
      if (!l?.title) continue
      held.push({
        id: r.listing_id, title: l.title, cohort: LABELS.includes(slug) ? 'held' : 'stale', group: slug,
        product_id: productId, prior_is_valid: r.is_valid, prior_rejected_reason: r.rejected_reason,
      })
    }
  }

  const out = new Map<string, PoolListing>()
  const heldIds = new Set(held.map((l) => l.id))
  type L = { id: string; title: string | null }
  for (const line of LINES) {
    const rows = (await readAll<L>(() => db.from('listings').select('id, title').eq('is_active', true)
      .or(line.ilike.map((p) => `title.ilike.${p}`).join(',')).order('id')))
      .filter((l): l is { id: string; title: string } =>
        !!l.title && line.names.test(l.title) && !heldIds.has(l.id) && !out.has(l.id))
    const live = new Set<string>()
    for (const group of chunks(rows.map((l) => l.id))) {
      const { data, error } = await db.from('listing_product_match').select('listing_id')
        .in('listing_id', group).or('is_valid.is.null,is_valid.eq.true')
      if (error) throw new Error(error.message)
      for (const r of data ?? []) live.add(r.listing_id as string)
    }
    for (const l of rows) if (!live.has(l.id)) out.set(l.id, { id: l.id, title: l.title, cohort: 'unmatched', group: line.line })
  }
  return [...held, ...Array.from(out.values())]
}

async function loadPromoted(db: SupabaseClient): Promise<Product[]> {
  const rows = await readAll<Parameters<typeof normalizeProductRow>[0]>(() =>
    db.from('kg_product').select(PRODUCT_SELECT).in('slug', [...PROMOTED]).order('id'))
  return rows.map(normalizeProductRow)
}

async function rematch(db: SupabaseClient, apply: boolean, outDir: string, show: number): Promise<void> {
  const ids = await heldRowIds(db)
  const [listings, index, promoted] = await Promise.all([pool(db, ids), loadMatchIndex(db), loadPromoted(db)])
  const brands = index.catalogueBrands
  const forecast = forecastIndex(index.products, promoted, index.idents, index.synonyms, brands)
  const notMatchable = promoted.filter((c) => !isMatchableProduct(c)).length

  // A stale listing that decides to the row it already sits on "stays": re-deciding
  // it writes nothing, so it is counted apart from the ones that move.
  const slugOf = new Map(Array.from(ids.entries()).map(([s, id]) => [id, s]))
  const counts = new Map<string, { now: number; supported: number }>()
  const bump = (k: string, col: 'now' | 'supported') => {
    const c = counts.get(k) ?? { now: 0, supported: 0 }
    c[col] += 1
    counts.set(k, c)
  }
  const lines: string[] = []
  const strandedStale: string[] = []
  for (const l of listings) {
    const now = outcome(l.title, index)
    const fc = outcome(l.title, forecast)
    const own = l.product_id ? slugOf.get(l.product_id) : undefined
    const tag = (o: Outcome) => (l.cohort === 'stale' && o.slug === own && o.key.startsWith('matched:') ? 'stays' : o.key)
    bump(`${l.group} ${l.cohort} ${tag(now)}`, 'now')
    bump(`${l.group} ${l.cohort} ${tag(fc)}`, 'supported')
    if (l.cohort === 'stale' && tag(fc) !== 'stays' && !fc.key.startsWith('matched:')) {
      strandedStale.push(`  ${own} | supported=${fc.key} | ${l.title}`)
    }
    if (tag(now) !== tag(fc) || (now.slug && tag(now) !== 'stays')) {
      lines.push(`  ${l.cohort} ${l.group} | now=${tag(now)} | supported=${tag(fc)} | ${l.title}`)
    }
  }

  console.log(`PAN-203 Warm Audio re-match — ${apply ? 'APPLY' : 'DRY RUN'}`)
  console.log(`  ${listings.filter((l) => l.cohort === 'held').length} held on label rows, ` +
    `${listings.filter((l) => l.cohort === 'stale').length} held on promoted or re-decided supported rows, ` +
    `${listings.filter((l) => l.cohort === 'unmatched').length} unmatched`)
  console.log(`  ${promoted.length} promoted rows loaded; ${notMatchable} are not match targets today, so "now" cannot reach them`)
  console.log('group cohort outcome: now | if the promoted rows were supported')
  for (const [k, c] of Array.from(counts.entries()).sort()) console.log(`  ${k}: ${c.now} | ${c.supported}`)
  if (show > 0) console.log(lines.sort().slice(0, show).join('\n'))
  console.log(`stale rows no model would take (kept, for review): ${strandedStale.length}`)
  if (show > 0) console.log(strandedStale.sort().slice(0, show).join('\n'))
  if (!apply) return

  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `pan203-rollback-${Date.now()}.json`)
  const held = listings.filter((l) => l.cohort !== 'unmatched')
  const listingIds = Array.from(new Set(listings.map((l) => l.id)))
  const fd = fs.openSync(file, 'wx')
  fs.writeSync(fd, JSON.stringify({
    started_at: new Date().toISOString(),
    listing_ids: listingIds,
    held_rows: held.map((l) => ({
      listing_id: l.id,
      product_id: l.product_id,
      is_valid: l.prior_is_valid ?? null,
      rejected_reason: l.prior_rejected_reason ?? null,
    })),
  }))
  fs.fsyncSync(fd)
  fs.closeSync(fd)
  console.log(`rollback written first: ${file}`)

  for (const group of chunks(listingIds)) console.log(await matchListings(db, group))

  // A held or stale listing moves only if step 1 gave it a live row on a real
  // product other than the one it is held on.
  const labelIds = new Set(LABELS.map((s) => ids.get(s)!))
  let moved = 0
  for (const group of chunks(held)) {
    const { data, error } = await db.from('listing_product_match').select('listing_id, product_id')
      .in('listing_id', group.map((l) => l.id)).or('is_valid.is.null,is_valid.eq.true')
    if (error) throw new Error(error.message)
    const live = (data ?? []) as Array<{ listing_id: string; product_id: string }>
    for (const l of group) {
      const landed = live.some((r) => r.listing_id === l.id && r.product_id !== l.product_id && !labelIds.has(r.product_id))
      if (!landed) continue
      let q = db.from('listing_product_match').update({ is_valid: false, rejected_reason: REJECTED_REASON })
        .eq('listing_id', l.id).eq('product_id', l.product_id!)
      q = l.prior_is_valid === null || l.prior_is_valid === undefined ? q.is('is_valid', null) : q.eq('is_valid', l.prior_is_valid)
      const { error: uErr } = await q
      if (uErr) throw new Error(uErr.message)
      moved += 1
    }
  }
  console.log(`held rows released: ${moved}`)
}

async function rollback(db: SupabaseClient, file: string, apply: boolean): Promise<void> {
  const { started_at, listing_ids, held_rows } = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    started_at: string
    listing_ids: string[]
    held_rows: Array<{ listing_id: string; product_id: string; is_valid: boolean | null; rejected_reason: string | null }>
  }
  // A held row existed before the run, so it is restored below, never deleted.
  const heldPairs = new Set(held_rows.map((r) => `${r.listing_id}|${r.product_id}`))
  const created: Array<{ id: string }> = []
  for (const group of chunks(listing_ids)) {
    const { data, error } = await db.from('listing_product_match').select('id, listing_id, product_id')
      .in('listing_id', group).gte('created_at', started_at).or('is_valid.is.null,is_valid.eq.false')
    if (error) throw new Error(error.message)
    created.push(...((data ?? []) as Array<{ id: string; listing_id: string; product_id: string }>)
      .filter((r) => !heldPairs.has(`${r.listing_id}|${r.product_id}`)))
  }
  console.log(`PAN-203 rollback — ${apply ? 'APPLY' : 'DRY RUN'} — ${created.length} rows created since ${started_at}; ${held_rows.length} held rows to restore`)
  if (!apply) return
  for (const group of chunks(created.map((r) => r.id))) {
    const { error } = await db.from('listing_product_match').delete().in('id', group).or('is_valid.is.null,is_valid.eq.false')
    if (error) throw new Error(error.message)
  }
  for (const r of held_rows) {
    const { error } = await db.from('listing_product_match').update({ is_valid: r.is_valid, rejected_reason: r.rejected_reason })
      .eq('listing_id', r.listing_id).eq('product_id', r.product_id).eq('rejected_reason', REJECTED_REASON)
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
    : rematch(db, APPLY, flag('out-dir') ?? path.join(os.tmpdir(), 'pan203'), Number(flag('show') ?? 200))
  ).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
