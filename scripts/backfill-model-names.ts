/**
 * scripts/backfill-model-names.ts
 *
 * One-off: derive kg_product.model_name from canonical_name when it is still
 * null. Dry-run by default; use --apply to write changes.
 *
 * Usage:
 *   npx tsx scripts/backfill-model-names.ts --dry-run
 *   npx tsx scripts/backfill-model-names.ts --apply
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

// ── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const DRY_RUN = args.includes('--dry-run') || !APPLY

// ── Main ─────────────────────────────────────────────────────────────────────
const BATCH_SIZE = 500

type ProductRow = {
  id: string
  canonical_name: string
  model_name: string | null
  kg_brand: { name: string } | { name: string }[] | null
}

function resolveBrandName(brand: ProductRow['kg_brand']): string | null {
  if (!brand) return null
  if (Array.isArray(brand)) return brand[0]?.name ?? null
  return brand.name ?? null
}

function deriveModelName(canonicalName: string, brandName: string): string | null {
  const escapedBrand = brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const stripped = canonicalName.replace(new RegExp(`^${escapedBrand}\\s+`, 'i'), '').trim()

  if (!stripped) return null
  if (stripped === canonicalName.trim()) return null
  if (stripped.length < 3) return null
  return stripped
}

async function main() {
  console.log(`⚙️  Backfill model_name from canonical_name${DRY_RUN ? ' (dry-run)' : ''}`)
  console.log()

  const { count, error: countError } = await supabase
    .from('kg_product')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .is('model_name', null)

  if (countError) {
    console.error('❌ Count query failed:', countError.message)
    process.exit(1)
  }

  const total = count ?? 0
  console.log(`Found ${total} active products with null model_name`)
  if (total === 0) {
    console.log('Nothing to do.')
    return
  }
  console.log()

  let processed = 0
  let page = 0
  let updated = 0
  let skipped = 0

  while (processed < total) {
    const from = page * BATCH_SIZE
    const to = from + BATCH_SIZE - 1

    const { data, error: fetchError } = await supabase
      .from('kg_product')
      .select('id, canonical_name, model_name, kg_brand!inner(name)')
      .eq('status', 'active')
      .is('model_name', null)
      .range(from, to)

    if (fetchError) {
      console.error(`❌ Fetch failed (page ${page}):`, fetchError.message)
      process.exit(1)
    }

    const rows = (data ?? []) as ProductRow[]
    if (rows.length === 0) break

    for (const row of rows) {
      const brandName = resolveBrandName(row.kg_brand)
      const derived = brandName ? deriveModelName(row.canonical_name, brandName) : null

      if (!derived) {
        skipped += 1
        continue
      }

      if (DRY_RUN) {
        updated += 1
        continue
      }

      const { error: updateError } = await supabase
        .from('kg_product')
        .update({ model_name: derived })
        .eq('id', row.id)

      if (updateError) {
        console.error(`❌ Update failed (id ${row.id}):`, updateError.message)
        process.exit(1)
      }

      updated += 1
    }

    processed += rows.length
    console.log(`Processed ${processed} of ${total} products`)
    page++
  }

  console.log()
  console.log(`Set model_name for ${updated} products, skipped ${skipped}`)
  console.log(DRY_RUN ? '✅ Dry run complete' : '✅ Done')
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${(err as Error).message ?? err}`)
  process.exit(1)
})
