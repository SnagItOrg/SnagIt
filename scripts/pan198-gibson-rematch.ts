/**
 * scripts/pan198-gibson-rematch.ts — PAN-198. DRY RUN unless --apply.
 *
 * Re-decides three cohorts against the Gibson series models PAN-198 creates
 * and promotes (the PAN-195 method):
 *
 *   held      — listings whose live match (is_valid NULL or true) sits on a
 *               Gibson family LABEL row (`gibson-les-paul`, `gibson-es-335`,
 *               `gibson-sg`). A label is never a match target (PAN-84), so
 *               these are stranded there.
 *   stale     — listings whose live match sits on one of the PROMOTED rows but
 *               was not written by `decideMatch` against today's models: the
 *               Phase A/B folds re-pointed listing-title rows' matches onto
 *               their survivors ("Gibson 1952 J-185" on `gibson-j-185`, the old
 *               `gibson-jumbo` collisions).
 *   unmatched — active listings whose title names a Gibson line and that hold
 *               no live match anywhere.
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
 *      'pan198_moved_to_model', guarded on the prior is_valid it read. A stale
 *      listing that lands nowhere keeps its row and is listed for review:
 *      undecidable is not wrong.
 *
 * --rollback=FILE: deletes the match rows created for those listings at or
 * after the recorded start, except any a person has approved since
 * (is_valid=true), and restores each released row's prior is_valid and
 * rejected_reason. Also a dry run without --apply.
 *
 * Usage (from the repository root):
 *   npx tsx scripts/pan198-gibson-rematch.ts [--show=N]
 *   npx tsx scripts/pan198-gibson-rematch.ts --apply [--out-dir=DIR]
 *   npx tsx scripts/pan198-gibson-rematch.ts --rollback=DIR/pan198-rollback-<ts>.json [--apply]
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
import { filterByIlike, readActiveTitles } from './lib/rematch-active-titles'

/** The Gibson family label rows. Never match targets; their held matches move. */
export const LABELS: readonly string[] = ['gibson-les-paul', 'gibson-es-335', 'gibson-sg']

/**
 * The rows the PAN-198 promote SQL moves from `known` to `supported`: the same
 * reviewed list, verbatim. `gibson-es-355` is not here (its CSP is the Custom
 * Shop '59 reissue while its name is the bare model; owner decision), nor are
 * the three owner-held "clean" rows.
 */
export const PROMOTED: readonly string[] = [
  'gibson-50s-j-45-original', 'gibson-50s-lg-2-original', 'gibson-60s-j-45-original',
  'gibson-70s-explorer', 'gibson-70s-flying-v', 'gibson-80s-explorer', 'gibson-advanced-jumbo',
  'gibson-b-25-12', 'gibson-billie-joe-armstrong-les-paul-junior',
  'gibson-custom-shop-1936-advanced-jumbo', 'gibson-custom-shop-1936-j-35',
  'gibson-custom-shop-1939-j-55', 'gibson-custom-shop-1939-sj-100',
  'gibson-custom-shop-1942-banner-j-45', 'gibson-custom-shop-1952-j-185',
  'gibson-custom-shop-1955-j-45-reissue', 'gibson-custom-shop-1957-les-paul-custom-reissue',
  'gibson-custom-shop-1957-les-paul-junior-reissue',
  'gibson-custom-shop-1957-les-paul-special-single-cut-reissue', 'gibson-custom-shop-1957-sj-200',
  'gibson-custom-shop-1958-korina-explorer-reissue',
  'gibson-custom-shop-1958-korina-flying-v-reissue', 'gibson-custom-shop-1959-es-335-reissue',
  'gibson-custom-shop-1960-hummingbird',
  'gibson-custom-shop-1960-les-paul-special-double-cut-reissue',
  'gibson-custom-shop-1961-es-335-reissue', 'gibson-custom-shop-1961-les-paul-sg-standard-reissue',
  'gibson-custom-shop-1963-es-335-block-reissue', 'gibson-custom-shop-1963-firebird-v-reissue',
  'gibson-custom-shop-1963-sg-special-reissue', 'gibson-custom-shop-1964-es-335-reissue',
  'gibson-custom-shop-1968-les-paul-custom-reissue', 'gibson-custom-shop-les-paul-r0',
  'gibson-custom-shop-les-paul-r4', 'gibson-custom-shop-les-paul-r6',
  'gibson-custom-shop-les-paul-r7', 'gibson-custom-shop-les-paul-r8',
  'gibson-custom-shop-les-paul-r9', 'gibson-custom-shop-les-paul-special-double-cut-figured',
  'gibson-dave-mustaine-flying-v-exp', 'gibson-dove', 'gibson-dove-original',
  'gibson-elvis-presley-sj-200', 'gibson-es-330', 'gibson-es-335-50s', 'gibson-es-335-60s-block',
  'gibson-es-335-block', 'gibson-es-335-satin', 'gibson-es-335-studio', 'gibson-es-345',
  'gibson-es-346-paul-jackson-jr', 'gibson-es-les-paul', 'gibson-explorer', 'gibson-explorer-b-2',
  'gibson-explorer-custom', 'gibson-explorer-e2', 'gibson-explorer-iii', 'gibson-firebird',
  'gibson-firebird-platypus', 'gibson-firebird-studio', 'gibson-firebird-vii', 'gibson-flying-v',
  'gibson-flying-v-67', 'gibson-flying-v-custom', 'gibson-flying-v2', 'gibson-g-200-ec',
  'gibson-g-45', 'gibson-g-45-studio', 'gibson-gary-clark-jr-es-355',
  'gibson-gibson-j-45-standard-12-string', 'gibson-gibson-l-00-original', 'gibson-hp-665',
  'gibson-hummingbird-original', 'gibson-hummingbird-special',
  'gibson-hummingbird-standard-rosewood', 'gibson-hummingbird-studio-ec',
  'gibson-hummingbird-studio-rosewood', 'gibson-j-185', 'gibson-j-185-century-12-fret',
  'gibson-j-185-original', 'gibson-j-35', 'gibson-j-35-30s-faded', 'gibson-j-45-century-12-fret',
  'gibson-j-45-special', 'gibson-j-45-standard-rosewood', 'gibson-j-45-studio-rosewood',
  'gibson-j-45-studio-walnut', 'gibson-j-55', 'gibson-jumbo', 'gibson-l-00-century-12-fret',
  'gibson-l-00-standard', 'gibson-l-4c', 'gibson-l-7c', 'gibson-les-paul-50s-tribute',
  'gibson-les-paul-52-tribute', 'gibson-les-paul-60s-tribute', 'gibson-les-paul-70s-deluxe',
  'gibson-les-paul-70s-tribute', 'gibson-les-paul-classic', 'gibson-les-paul-custom-70s',
  'gibson-les-paul-deluxe', 'gibson-les-paul-double-cut-special', 'gibson-les-paul-future-tribute',
  'gibson-les-paul-junior', 'gibson-les-paul-junior-double-cut', 'gibson-les-paul-modern',
  'gibson-les-paul-paul-kossoff', 'gibson-les-paul-paul-landers-signature',
  'gibson-les-paul-special-tribute', 'gibson-les-paul-standard-50s-double-trouble',
  'gibson-les-paul-standard-50s-faded', 'gibson-les-paul-standard-50s-p-90',
  'gibson-les-paul-standard-60s-double-trouble', 'gibson-les-paul-standard-60s-faded',
  'gibson-les-paul-studio-deluxe-ii', 'gibson-les-paul-studio-double-trouble',
  'gibson-les-paul-studio-session', 'gibson-les-paul-supreme', 'gibson-les-paul-the-paul-ii',
  'gibson-les-paul-traditional', 'gibson-les-paul-traditional-pro-ii', 'gibson-les-paul-tribute',
  'gibson-lg-2', 'gibson-lg-2-3-4', 'gibson-lg-2-all-mahogany-faded', 'gibson-lg-2-american-eagle',
  'gibson-marcus-king-es-345', 'gibson-margo-price-j-45', 'gibson-non-reverse-thunderbird',
  'gibson-pre-war-sj-200', 'gibson-rosanne-cash-j-185', 'gibson-sg-61-reissue', 'gibson-sg-modern',
  'gibson-sg-special', 'gibson-sg-special-faded', 'gibson-sg-standard', 'gibson-sg-standard-61',
  'gibson-sg-standard-61-faded', 'gibson-sg-supreme', 'gibson-sj-200-60s-original',
  'gibson-sj-200-orianthi-signature', 'gibson-sj-200-standard', 'gibson-sj-200-standard-rosewood',
  'gibson-sj-200-studio-rosewood', 'gibson-sj-200-studio-walnut', 'gibson-sj-200-western-classic',
  'gibson-slash-j-45', 'gibson-slash-les-paul-standard', 'gibson-southern-jumbo-original',
  'gibson-the-paul', 'gibson-thunderbird', 'gibson-thunderbird-bicentennial',
]

/**
 * The Gibson lines a title can name, for the unmatched cohort. Epiphone and
 * other makers' listings stay in scope on purpose: `decideMatch` rejects or
 * defers them, which is the auditable outcome, and filtering them here would
 * hide that.
 */
export const LINES: ReadonlyArray<{ line: string; names: RegExp; ilike: string[] }> = [
  { line: 'les-paul', names: /les ?paul|\bthe paul\b/i, ilike: ['%les paul%', '%lespaul%', '%the paul%'] },
  { line: 'sg', names: /\bsg\b/i, ilike: ['%sg%'] },
  { line: 'es', names: /\bes[- ]?3[3-5]\d|\bes[- ]les ?paul/i, ilike: ['%es-3%', '%es 3%', '%es3%', '%es-les%', '%es les%'] },
  { line: 'explorer', names: /explorer/i, ilike: ['%explorer%'] },
  { line: 'flying-v', names: /flying ?v/i, ilike: ['%flying v%', '%flyingv%'] },
  { line: 'firebird', names: /firebird/i, ilike: ['%firebird%'] },
  { line: 'thunderbird', names: /thunderbird/i, ilike: ['%thunderbird%'] },
  {
    line: 'acoustic',
    names: /\bj-?(?:35|45|55|185)\b|hummingbird|\bs?j-?200\b|\bsj-?100\b|\bl-?00\b|\blg-?2\b|advanced jumbo|\bdove\b|\bg-?45\b|\bg-?200\b|\bjumbo\b|\bb-?25\b|\bhp ?665\b|\bl-?[47]c\b/i,
    ilike: [
      '%j-35%', '%j-45%', '%j45%', '%j-55%', '%j-185%', '%hummingbird%', '%j-200%', '%j200%', '%sj-100%',
      '%l-00%', '%lg-2%', '%dove%', '%g-45%', '%g-200%', '%jumbo%', '%b-25%', '%hp 665%', '%l-4c%', '%l-7c%',
    ],
  },
]

export const REJECTED_REASON = 'pan198_moved_to_model'

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

/** slug -> id for the labels and the promoted rows; every one must exist. */
async function heldRowIds(db: SupabaseClient): Promise<Map<string, string>> {
  const slugs = [...LABELS, ...PROMOTED]
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
  for (const slug of [...LABELS, ...PROMOTED]) {
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
  // One plan-proof keyset read of every active title; the ILIKE patterns are applied in memory.
  const active = await readActiveTitles(db)
  for (const line of LINES) {
    const rows = filterByIlike(active, line.ilike)
      .filter((l) => line.names.test(l.title) && !heldIds.has(l.id) && !out.has(l.id))
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

  console.log(`PAN-198 Gibson re-match — ${apply ? 'APPLY' : 'DRY RUN'}`)
  console.log(`  ${listings.filter((l) => l.cohort === 'held').length} held on label rows, ` +
    `${listings.filter((l) => l.cohort === 'stale').length} held on promoted rows, ` +
    `${listings.filter((l) => l.cohort === 'unmatched').length} unmatched`)
  console.log(`  ${promoted.length} promoted rows loaded; ${notMatchable} are not match targets today, so "now" cannot reach them`)
  console.log('group cohort outcome: now | if the promoted rows were supported')
  for (const [k, c] of Array.from(counts.entries()).sort()) console.log(`  ${k}: ${c.now} | ${c.supported}`)
  if (show > 0) console.log(lines.sort().slice(0, show).join('\n'))
  console.log(`stale rows no model would take (kept, for review): ${strandedStale.length}`)
  if (show > 0) console.log(strandedStale.sort().slice(0, show).join('\n'))
  if (!apply) return

  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `pan198-rollback-${Date.now()}.json`)
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
  console.log(`PAN-198 rollback — ${apply ? 'APPLY' : 'DRY RUN'} — ${created.length} rows created since ${started_at}; ${held_rows.length} held rows to restore`)
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
    : rematch(db, APPLY, flag('out-dir') ?? path.join(os.tmpdir(), 'pan198'), Number(flag('show') ?? 200))
  ).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
