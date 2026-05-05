/**
 * scripts/backfill-schibsted-price-dkk.ts
 *
 * One-off: backfill price_dkk and country on existing Schibsted/Kleinanzeigen
 * listings that were scraped before currency conversion was wired in.
 *
 * Usage:
 *   npx tsx scripts/backfill-schibsted-price-dkk.ts
 */

import * as path from 'path'
import * as fs from 'fs'
import type { SupabaseClient } from '../frontend/node_modules/@supabase/supabase-js'

// Resolve Supabase from the frontend workspace because that is where the
// installed dependency lives on this machine.
const { createClient } = require('../frontend/node_modules/@supabase/supabase-js') as typeof import('../frontend/node_modules/@supabase/supabase-js')

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
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Currency helpers ──────────────────────────────────────────────────────────
const DKK_RATES: Record<string, number> = {
  DKK: 1.0,
  SEK: 0.65,
  NOK: 0.60,
  EUR: 7.45,
  USD: 7.00,
  GBP: 8.80,
}

function toDkkApprox(price: number, currency: string): number | null {
  const rate = DKK_RATES[currency.toUpperCase()]
  if (!rate) return null
  return Math.round(price * rate)
}

function countryFromSource(source: string): string | null {
  switch (source) {
    case 'blocket':
      return 'SE'
    case 'finn':
      return 'NO'
    case 'dba.dk':
      return 'DK'
    case 'kleinanzeigen':
      return 'DE'
    default:
      return null
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
const BATCH_SIZE = 500

type ListingRow = {
  id: string
  price: number | null
  currency: string
  source: string
  country: string | null
}

async function main() {
  console.log('⚙️  Backfill price_dkk + country for Schibsted/Kleinanzeigen listings')
  console.log()

  const { count, error: countError } = await supabase
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .in('source', ['blocket', 'finn', 'dba.dk', 'kleinanzeigen'])
    .is('price_dkk', null)
    .not('price', 'is', null)

  if (countError) {
    console.error('❌ Count query failed:', countError.message)
    process.exit(1)
  }

  const total = count ?? 0
  console.log(`Found ${total} listings to backfill`)
  if (total === 0) {
    console.log('Nothing to do.')
    return
  }
  console.log()

  let processed = 0
  let page = 0

  while (processed < total) {
    const from = page * BATCH_SIZE
    const to = from + BATCH_SIZE - 1

    const { data, error: fetchError } = await supabase
      .from('listings')
      .select('id, price, currency, source, country')
      .in('source', ['blocket', 'finn', 'dba.dk', 'kleinanzeigen'])
      .is('price_dkk', null)
      .not('price', 'is', null)
      .range(from, to)

    if (fetchError) {
      console.error(`❌ Fetch failed (page ${page}):`, fetchError.message)
      process.exit(1)
    }

    const rows = (data ?? []) as ListingRow[]
    if (rows.length === 0) break

    for (const row of rows) {
      const nextCountry = row.country ?? countryFromSource(row.source)
      const nextPriceDkk = row.price != null ? toDkkApprox(row.price, row.currency ?? 'DKK') : null

      const { error: updateError } = await supabase
        .from('listings')
        .update({
          price_dkk: nextPriceDkk,
          country: nextCountry,
        })
        .eq('id', row.id)

      if (updateError) {
        console.error(`❌ Update failed (id ${row.id}):`, updateError.message)
        process.exit(1)
      }
    }

    processed += rows.length
    console.log(`Backfilled ${processed} of ${total} listings`)

    page++
  }

  console.log()
  console.log('✅ Done')
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${(err as Error).message ?? err}`)
  process.exit(1)
})
