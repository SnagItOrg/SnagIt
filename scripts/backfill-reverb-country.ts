/**
 * scripts/backfill-reverb-country.ts
 *
 * One-off: backfill country and price_dkk on existing Reverb listings.
 *
 * NOTE: scrape-reverb.ts buildRow always stored currency = 'DKK' (prices were
 * converted to DKK at scrape time). The DKK → 'DK' mapping below therefore
 * sets country = 'DK' for all existing rows, not 'US'. Task 2 (scrape-reverb.ts)
 * explicitly writes country = 'US' on new scrapes going forward. Run
 * scrape-reverb.ts after applying this backfill to overwrite with the correct
 * country = 'US' values, or adjust the mapping below before running.
 *
 * Usage:
 *   npx tsx scripts/backfill-reverb-country.ts
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
const COUNTRY_BY_CURRENCY: Record<string, string> = {
  USD: 'US',
  EUR: 'DE',
  GBP: 'GB',
  SEK: 'SE',
  NOK: 'NO',
  DKK: 'DK',
}

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

// ── Main ─────────────────────────────────────────────────────────────────────
const BATCH_SIZE = 500

type ListingRow = {
  id: string
  price: number | null
  currency: string
}

async function main() {
  console.log('⚙️  Backfill country + price_dkk for Reverb listings')
  console.log()

  // Count total rows to process
  const { count, error: countError } = await supabase
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'reverb')
    .or('country.is.null,price_dkk.is.null')

  if (countError) {
    console.error('❌ Count query failed:', countError.message)
    process.exit(1)
  }

  const total = count ?? 0
  console.log(`Found ${total} Reverb listings to backfill`)
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
      .select('id, price, currency')
      .eq('source', 'reverb')
      .or('country.is.null,price_dkk.is.null')
      .range(from, to)

    if (fetchError) {
      console.error(`❌ Fetch failed (page ${page}):`, fetchError.message)
      process.exit(1)
    }

    const rows = (data ?? []) as ListingRow[]
    if (rows.length === 0) break

    for (const row of rows) {
      const { error: updateError } = await supabase
        .from('listings')
        .update({
          country: 'US',
          price_dkk: row.price != null ? toDkkApprox(row.price, row.currency ?? 'DKK') : null,
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
