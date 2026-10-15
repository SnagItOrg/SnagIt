/**
 * scripts/recall-canary.ts — the nightly recall canary (PAN-266). READ-ONLY.
 *
 * For every product in data/klup-recall-canary.json: run DBA's own search the way a user types
 * it, take the hits that name the product, and check each one against Klup — the product page a
 * user sees (the public API's `listings`), then `listings` and `listing_product_match` for the
 * class of any miss (not scraped, inactive, no match row, matched elsewhere, hidden). The pure
 * decisions are in scripts/lib/recall-canary.ts.
 *
 * Exit 1, and a `[recall-canary] FAIL …` line, when recall is below the threshold or a product
 * with real supply shows nothing. `[recall-canary] OK …` otherwise. One line per miss.
 *
 * No write of any kind: SELECTs on two tables, GETs on dba.dk (3–5 s apart, scripts/CLAUDE.md)
 * and on www.klup.dk.
 *
 * Usage:
 *   npx tsx scripts/recall-canary.ts [--limit=N] [--json=<path>] [--site=https://www.klup.dk]
 */

import * as fs from 'fs'
import * as path from 'path'
import dotenv from 'dotenv'
import type { SupabaseClient } from '../frontend/node_modules/@supabase/supabase-js'
import { DBA_CONFIG, fetchSchibstedPage } from '../frontend/lib/scrapers/schibsted'
import { normalizeQuery } from '../frontend/lib/query-normalizer'
import { loadMatchIndex } from '../frontend/lib/matching/match-listings'
import {
  decideHit, namesProduct, productsFor, summarise, summaryLine,
  type CanaryConfig, type ProductResult, type ProductionState,
} from './lib/recall-canary'

const args = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const LIMIT = Number(flag('limit') ?? Infinity)
const SITE = flag('site') ?? 'https://www.klup.dk'
const JSON_OUT = flag('json')

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const dbaId = (url: string) => url.match(/\/item\/(\d+)/)?.[1] ?? url.match(/\/id-(\d+)/)?.[1] ?? url

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

function loadConfig(): CanaryConfig {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/klup-recall-canary.json'), 'utf8')) as {
    threshold: number; zero_shown_min: number; products: CanaryConfig['products']
  }
  return { threshold: raw.threshold, zeroShownMin: raw.zero_shown_min, products: raw.products }
}

/** The DBA ids on the product page a user sees. */
async function onPage(slug: string, cache: Map<string, Set<string>>): Promise<Set<string>> {
  const hit = cache.get(slug)
  if (hit) return hit
  const ids = new Set<string>()
  const res = await fetch(`${SITE}/api/product/${slug}`, { headers: { 'User-Agent': UA } })
  if (res.ok) {
    const body = await res.json() as { listings?: Array<{ source: string; url: string }> }
    for (const l of body.listings ?? []) if (l.source === DBA_CONFIG.source) ids.add(dbaId(l.url))
  } else {
    console.error(`[recall-canary] ${SITE}/api/product/${slug}: ${res.status}`)
  }
  cache.set(slug, ids)
  return ids
}

/** `listings` and `listing_product_match` for a set of DBA ads, by URL. */
async function productionState(db: SupabaseClient, urls: string[], slugById: Map<string, string>): Promise<Map<string, Omit<ProductionState, 'onPage'>>> {
  const out = new Map<string, Omit<ProductionState, 'onPage'>>()
  if (urls.length === 0) return out
  const { data: rows, error } = await db
    .from('listings').select('id, external_id, is_active').eq('source', DBA_CONFIG.source).in('external_id', urls)
  if (error) throw new Error(`listings: ${error.message}`)
  const byListingId = new Map<string, string>()
  for (const r of rows ?? []) {
    out.set(String(r.external_id), { inListings: true, active: r.is_active as boolean | null, rows: [] })
    byListingId.set(String(r.id), String(r.external_id))
  }
  if (byListingId.size > 0) {
    const { data: matches, error: mErr } = await db
      .from('listing_product_match').select('listing_id, product_id, is_valid, rejected_reason, explain')
      .in('listing_id', Array.from(byListingId.keys()))
    if (mErr) throw new Error(`listing_product_match: ${mErr.message}`)
    for (const m of matches ?? []) {
      const ext = byListingId.get(String(m.listing_id))
      const state = ext ? out.get(ext) : undefined
      if (!state) continue
      const explain = (m.explain ?? {}) as Record<string, unknown>
      state.rows.push({
        slug: slugById.get(String(m.product_id)) ?? String(m.product_id),
        is_valid: m.is_valid as boolean | null,
        rejected_reason: (m.rejected_reason as string | null) ?? null,
        admin: 'admin_decision' in explain,
      })
    }
  }
  return out
}

async function main(): Promise<void> {
  const config = loadConfig()
  const db = client()
  const index = await loadMatchIndex(db)
  // Every supported product, for the slug of a match row that points elsewhere.
  const { data: allProducts } = await db.from('kg_product').select('id, slug')
  const slugById = new Map<string, string>((allProducts ?? []).map((p) => [String(p.id), String(p.slug)]))
  const pageCache = new Map<string, Set<string>>()
  const results: ProductResult[] = []

  for (const entry of config.products.slice(0, LIMIT)) {
    const products = productsFor(entry, index)
    if (products.length === 0) {
      console.error(`[recall-canary] ${entry.q}: none of ${entry.slugs.join(',')} is in the matcher index; skipped`)
      continue
    }
    await sleep(3000 + Math.random() * 2000)
    const page = await fetchSchibstedPage(DBA_CONFIG, normalizeQuery(entry.q), 1)
    if (!page.schemaValid) {
      console.error(`[recall-canary] ${entry.q}: dba.dk page unreadable; skipped`)
      continue
    }
    const named = page.listings.filter((l) => products.some((p) => namesProduct(l.title, p.model_name)))
    const states = await productionState(db, named.map((l) => l.url), slugById)
    const shownIds = new Set<string>()
    for (const slug of entry.slugs) for (const id of await onPage(slug, pageCache)) shownIds.add(id)

    const result: ProductResult = { q: entry.q, slugs: entry.slugs, hits: page.listings.length, expected: named.length, shown: 0, refused: 0, misses: [] }
    for (const l of named) {
      const base = states.get(l.url) ?? { inListings: false, active: null, rows: [] }
      const outcome = decideHit(l.title, entry, index, { ...base, onPage: shownIds.has(dbaId(l.url)) })
      if (outcome.kind === 'shown') result.shown++
      else if (outcome.kind === 'refused') result.refused++
      else {
        result.misses.push({ id: dbaId(l.url), title: l.title, class: outcome.class, detail: outcome.detail })
        console.log(`[recall-canary] miss ${entry.slugs[0]} ${dbaId(l.url)} ${outcome.class} (${outcome.detail}) "${l.title}"`)
      }
    }
    console.log(`[recall-canary] ${entry.q}: hits=${result.hits} expected=${result.expected} shown=${result.shown} refused=${result.refused} misses=${result.misses.length}`)
    results.push(result)
  }

  const summary = summarise(results, config)
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ ran_at: new Date().toISOString(), summary, results }, null, 2))
  console.log(summaryLine(summary, results.length))
  process.exit(summary.ok ? 0 : 1)
}

main().catch((e) => {
  console.error(`[recall-canary] FAIL error: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
