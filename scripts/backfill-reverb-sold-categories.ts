/**
 * scripts/backfill-reverb-sold-categories.ts — PAN-170. DRY RUN unless --apply.
 *
 * Records the Reverb categories of the sold rows that feed product pages, so
 * `isPartOrAccessoryListing()` (frontend/lib/price-populations.ts) can keep
 * parts and accessories out of the published sold-price stats. Needs
 * migration 060 (`reverb_price_history.reverb_categories`).
 *
 * Scope: rows with `kg_product_id` set and `reverb_categories` NULL. Those are
 * the only rows a product page reads; ingestion records categories for new
 * rows itself. One read-only GET per distinct Reverb listing
 * (api.reverb.com/api/listings/<id>), 2 s + up to 1 s jitter apart.
 *
 * Writes nothing but `reverb_categories`, and only where it is still NULL, so
 * a re-run skips what is done and never overwrites. A listing Reverb cannot
 * return stays NULL, which the product route keeps (today's behaviour).
 *
 * --apply writes the rollback SQL BEFORE the first write. The column held NULL
 * on every row this script touches, so the rollback is one UPDATE back to NULL
 * over exactly those ids; run it in the Supabase Studio SQL editor.
 *
 * Usage (from the repository root):
 *   npx tsx scripts/backfill-reverb-sold-categories.ts [--out-dir=DIR] [--only=slug,slug]
 *   npx tsx scripts/backfill-reverb-sold-categories.ts --apply [--out-dir=DIR] [--only=…]
 *
 * Production write: needs product-owner authorisation before --apply.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import dotenv from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isPartOrAccessoryListing } from '../frontend/lib/price-populations'

const args = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const APPLY = args.includes('--apply')
const OUT_DIR = flag('out-dir') ?? path.join(os.tmpdir(), 'pan170')
const ONLY = flag('only')?.split(',').filter(Boolean)

type Category = { uuid: string | null; full_name: string | null }
type Row = { id: string; kg_product_id: string; listing_url: string | null; listing_title: string | null; price: number | null }
type Planned = Row & { slug: string; listingId: string | null; categories: Category[] | null }

function client(): SupabaseClient {
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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Reverb's listing id from a stored URL: https://reverb.com/item/43964148-cap-roland-… */
function listingIdOf(url: string | null): string | null {
  return url?.match(/\/item\/(\d+)/)?.[1] ?? null
}

/** Categories for one listing, or null when Reverb gave no usable answer. Never logs provider text. */
async function fetchCategories(listingId: string): Promise<Category[] | null> {
  await sleep(2000 + Math.random() * 1000)
  const headers: Record<string, string> = {
    'Accept-Version': '3.0',
    'Accept': 'application/hal+json',
    'User-Agent': 'Klup-Scraper/1.0',
  }
  if (process.env.REVERB_API_TOKEN) headers.Authorization = `Bearer ${process.env.REVERB_API_TOKEN}`
  try {
    const res = await fetch(`https://api.reverb.com/api/listings/${listingId}`, { headers })
    if (res.status === 429) { console.error('  provider_http_429'); await sleep(15000); return null }
    if (!res.ok) { console.error(`  provider_http_${res.status}`); return null }
    const body = (await res.json()) as { categories?: unknown }
    if (!Array.isArray(body.categories)) return null
    return body.categories.map((c) => ({
      uuid: typeof c?.uuid === 'string' ? c.uuid : null,
      full_name: typeof c?.full_name === 'string' ? c.full_name : null,
    }))
  } catch {
    console.error('  provider_request_failed')
    return null
  }
}

async function plan(db: SupabaseClient): Promise<Planned[]> {
  const rows = await readAll<Row>(() => db.from('reverb_price_history')
    .select('id, kg_product_id, listing_url, listing_title, price')
    .not('kg_product_id', 'is', null).is('reverb_categories', null).order('id'))
  const productIds = Array.from(new Set(rows.map((r) => r.kg_product_id)))
  const products = productIds.length === 0 ? [] : await readAll<{ id: string; slug: string }>(
    () => db.from('kg_product').select('id, slug').in('id', productIds).order('id'))
  const slugOf = new Map(products.map((p) => [p.id, p.slug]))

  const scoped = rows
    .map((r) => ({ ...r, slug: slugOf.get(r.kg_product_id) ?? r.kg_product_id, listingId: listingIdOf(r.listing_url) }))
    .filter((r) => !ONLY || ONLY.includes(r.slug))

  const ids = Array.from(new Set(scoped.map((r) => r.listingId).filter((id): id is string => id !== null)))
  console.log(`${scoped.length} rows, ${ids.length} distinct Reverb listings — about ${Math.ceil(ids.length * 2.5 / 60)} min at the rate limit`)
  const byListing = new Map<string, Category[] | null>()
  for (const [i, id] of ids.entries()) {
    byListing.set(id, await fetchCategories(id))
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${ids.length}`)
  }
  return scoped.map((r) => ({ ...r, categories: r.listingId ? byListing.get(r.listingId) ?? null : null }))
}

function report(planned: Planned[]): string {
  const lines: string[] = ['product | rows | categorised | part/accessory | left NULL']
  const slugs = Array.from(new Set(planned.map((p) => p.slug))).sort()
  for (const slug of slugs) {
    const rows = planned.filter((p) => p.slug === slug)
    const known = rows.filter((p) => p.categories !== null)
    lines.push(`${slug} | ${rows.length} | ${known.length} | ${known.filter((p) => isPartOrAccessoryListing(p.categories)).length} | ${rows.length - known.length}`)
  }
  lines.push('', 'Rows the product route will exclude once written (product | DKK | categories | title):')
  for (const p of planned.filter((x) => isPartOrAccessoryListing(x.categories)).sort((a, b) => a.slug.localeCompare(b.slug) || (a.price ?? 0) - (b.price ?? 0))) {
    lines.push(`${p.slug} | ${Math.round(p.price ?? 0)} | ${(p.categories ?? []).map((c) => c.full_name).join('; ')} | ${p.listing_title ?? ''}`)
  }
  return lines.join('\n') + '\n'
}

async function write(db: SupabaseClient, planned: Planned[]): Promise<void> {
  const toWrite = planned.filter((p) => p.categories !== null)
  if (toWrite.length === 0) { console.log('nothing to write'); return }

  const rollbackPath = path.join(OUT_DIR, `pan170-rollback-${Date.now()}.sql`)
  const fd = fs.openSync(rollbackPath, 'wx')
  fs.writeSync(fd,
    '-- PAN-170 rollback: every row this run gave reverb_categories held NULL before it.\n' +
    'UPDATE public.reverb_price_history SET reverb_categories = NULL\n' +
    ` WHERE id IN (\n${toWrite.map((p) => `  '${p.id}'`).join(',\n')}\n );\n`)
  fs.fsyncSync(fd)
  fs.closeSync(fd)
  console.log(`rollback written first: ${rollbackPath}`)

  let written = 0
  for (const p of toWrite) {
    const res = await db.from('reverb_price_history')
      .update({ reverb_categories: p.categories }).eq('id', p.id).is('reverb_categories', null).select('id')
    if (res.error) throw new Error(`reverb_price_history ${p.id}: ${res.error.message} (stopped; ${written} written, rollback at ${rollbackPath})`)
    if ((res.data ?? []).length === 1) written += 1
    else console.warn(`skipped ${p.id}: reverb_categories set since the plan was read`)
  }
  console.log(`written: ${written} of ${toWrite.length}`)
}

async function main() {
  const db = client()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const planned = await plan(db)
  const text = report(planned)
  fs.writeFileSync(path.join(OUT_DIR, 'pan170-report.txt'), text)
  fs.writeFileSync(path.join(OUT_DIR, 'pan170-plan.json'), JSON.stringify(planned, null, 1))
  console.log(text)
  if (!APPLY) { console.log(`DRY RUN — nothing written. Report and plan in ${OUT_DIR}. Pass --apply to write.`); return }
  await write(db, planned)
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
