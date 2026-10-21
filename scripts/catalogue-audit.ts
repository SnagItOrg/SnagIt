/**
 * scripts/catalogue-audit.ts — the nightly catalogue audit (PAN-284). READ-ONLY.
 *
 * Runs every check in scripts/lib/catalogue-audit.ts over the supported + active cohort — SELECTs
 * on kg_product, browse_product_projection, kg_category and listing_product_match — diffs the
 * findings against the previous run's state file, prints the short report (new or changed first,
 * then what was fixed) and writes the new state. Silence means clean: "[catalogue-audit] OK".
 *
 * No write of any kind to the database. The only file written is the state file. Mail is behind
 * --email and off by default.
 *
 * Usage:
 *   npx tsx scripts/catalogue-audit.ts                       # report, state in ~/klup-rollbacks/catalogue-audit/state.json
 *   npx tsx scripts/catalogue-audit.ts --json                # the run and the diff as JSON on stdout
 *   npx tsx scripts/catalogue-audit.ts --state=<path>        # another state file (a dry look: --state=/dev/null)
 *   npx tsx scripts/catalogue-audit.ts --email=<to>          # also mail the report when something moved (Resend)
 *   npx tsx scripts/catalogue-audit.ts --email               # the same, to CATALOGUE_AUDIT_TO_EMAIL, else FEEDBACK_TO_EMAIL,
 *                                                            # else RESEND_FROM_EMAIL (.env.local), so no address is committed
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sendCatalogueAuditEmail } from '../frontend/lib/email'
import {
  CHECKS, diffRuns, formatReport, runAudit, toState,
  type AuditCategory, type AuditMatch, type AuditProduct, type AuditSnapshot, type AuditState,
} from './lib/catalogue-audit'

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

const args = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const JSON_OUT = args.includes('--json')
const STATE = flag('state') ?? path.join(os.homedir(), 'klup-rollbacks', 'catalogue-audit', 'state.json')
// A bare --email takes the owner's inbox from .env.local, like the feedback route, so PM2 config names no address.
const EMAIL = flag('email') ?? (args.includes('--email')
  ? process.env.CATALOGUE_AUDIT_TO_EMAIL ?? process.env.FEEDBACK_TO_EMAIL ?? process.env.RESEND_FROM_EMAIL
  : undefined)

const PAGE = 1000
type Row = Record<string, unknown>
type Result = { data: Row[] | null; error: { message: string } | null }

/** All rows `build` selects, paged by range: PostgREST answers at most 1,000 per request. */
async function pageAll(table: string, build: (from: number, to: number) => PromiseLike<Result>): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}

const chunk = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n))
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

async function loadSnapshot(db: SupabaseClient): Promise<AuditSnapshot> {
  // The cohort: supported + active, every visibility. Re-checked in memory by the authorities.
  const kg = await pageAll('kg_product', (from, to) => db.from('kg_product')
    .select('id, slug, canonical_name, model_name, brand_id, status, support_state, browse_visibility, hero_image_url, image_url, kg_brand(slug, name)')
    .eq('status', 'active').eq('support_state', 'supported').order('id').range(from, to) as unknown as PromiseLike<Result>)

  const ids = kg.map((r) => String(r.id))
  const projection = new Map<string, Row>()
  for (const part of chunk(ids, 100)) {
    const { data, error } = await db.from('browse_product_projection')
      .select('id, browse_domain, taxonomy_state, root_category_slug, subcategory_slug, active_listing_count')
      .in('id', part)
    if (error) throw new Error(`browse_product_projection: ${error.message}`)
    for (const r of data ?? []) projection.set(String(r.id), r as Row)
  }

  const products: AuditProduct[] = kg.map((r) => {
    const brand = one(r.kg_brand as Row | Row[] | null)
    const pr = projection.get(String(r.id)) ?? {}
    return {
      id: String(r.id), slug: String(r.slug), canonical_name: str(r.canonical_name), model_name: str(r.model_name),
      brand_id: str(r.brand_id), brand_slug: str(brand?.slug), brand_name: str(brand?.name),
      status: str(r.status), support_state: str(r.support_state), browse_visibility: str(r.browse_visibility),
      browse_domain: str(pr.browse_domain), taxonomy_state: str(pr.taxonomy_state),
      root_category_slug: str(pr.root_category_slug), subcategory_slug: str(pr.subcategory_slug),
      hero_image_url: str(r.hero_image_url), image_url: str(r.image_url),
      active_listing_count: typeof pr.active_listing_count === 'number' ? pr.active_listing_count : null,
    }
  })

  const categories: AuditCategory[] = (await pageAll('kg_category', (from, to) => db.from('kg_category')
    .select('slug, name_da, name_en, domain').order('slug').range(from, to) as unknown as PromiseLike<Result>))
    .map((r) => ({ slug: String(r.slug), name_da: str(r.name_da), name_en: str(r.name_en), domain: str(r.domain) }))

  // Not-rejected matches on ACTIVE listings of the cohort, with the listing's brand and country.
  const matches: AuditMatch[] = []
  for (const part of chunk(ids, 100)) {
    const rows = await pageAll('listing_product_match', (from, to) => db.from('listing_product_match')
      .select('id, listing_id, product_id, listings!inner(brand_id, country, is_active)')
      .in('product_id', part).eq('listings.is_active', true).or('is_valid.is.null,is_valid.eq.true')
      .order('id').range(from, to) as unknown as PromiseLike<Result>)
    for (const r of rows) {
      const l = one(r.listings as Row | Row[] | null)
      matches.push({ listing_id: String(r.listing_id), product_id: String(r.product_id), listing_brand_id: str(l?.brand_id), listing_country: str(l?.country) })
    }
  }

  return { products, categories, matches }
}

function readState(file: string): AuditState | null {
  if (!fs.existsSync(file)) return null
  const text = fs.readFileSync(file, 'utf8').trim()
  if (text.length === 0) return null
  const raw = JSON.parse(text) as Partial<AuditState>
  return typeof raw.ran_at === 'string' && raw.findings && typeof raw.findings === 'object' ? (raw as AuditState) : null
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  const db = createClient(url, key, { auth: { persistSession: false } })

  const snapshot = await loadSnapshot(db)
  const run = runAudit(snapshot, CHECKS)
  const previous = readState(STATE)
  const diff = diffRuns(previous, run)
  const report = formatReport(run, diff)

  if (STATE !== '/dev/null') {
    fs.mkdirSync(path.dirname(STATE), { recursive: true })
    fs.writeFileSync(STATE, JSON.stringify(toState(run), null, 2))
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ run, diff, cohort: { products: snapshot.products.length, categories: snapshot.categories.length, matches: snapshot.matches.length } }, null, 2))
  } else {
    console.log(report)
    console.log(`\n(${snapshot.products.length} supported rows, ${snapshot.matches.length} active matches read; state ${STATE})`)
  }

  if (EMAIL && diff.added.length + diff.changed.length + diff.fixed.length > 0) {
    await sendCatalogueAuditEmail(EMAIL, report, run.ran_at)
    console.error(`[catalogue-audit] report mailed`)
  }
}

main().catch((err: unknown) => {
  console.error(`[catalogue-audit] ${(err as Error).message ?? err}`)
  process.exit(1)
})
