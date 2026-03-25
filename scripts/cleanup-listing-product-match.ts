/**
 * scripts/cleanup-listing-product-match.ts
 *
 * Deduplicates listing_product_match by removing rows where a
 * (listing_id, product_id) pair appears more than once, keeping
 * only the row with the highest score (ties broken by latest created_at).
 *
 * Processes in batches of 500 duplicate pairs to avoid timeouts.
 *
 * After cleanup, print the SQL to create a unique index — run that
 * manually in the Supabase SQL editor once the script finishes.
 *
 * Usage:
 *   npx tsx scripts/cleanup-listing-product-match.ts
 *   npx tsx scripts/cleanup-listing-product-match.ts --dry-run
 */

import 'dotenv/config'
import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'

// ── Load env ──────────────────────────────────────────────────────────────────
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

const BATCH_SIZE = 500
const DRY_RUN = process.argv.includes('--dry-run')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Types ─────────────────────────────────────────────────────────────────────
type DuplicateGroup = {
  listing_id: string
  product_id: string
  keep_id: string      // the id of the row to keep
}

// ── Step 1: find all duplicate (listing_id, product_id) pairs ─────────────────
// For each duplicate pair we fetch all row ids, then delete all but the keeper.
// We use a cursor-based page through the full table rather than a GROUP BY
// because Supabase JS doesn't expose raw SQL. Instead we:
//   a) select all rows ordered by listing_id, product_id, score DESC, created_at DESC
//   b) detect consecutive duplicates in JS
//   c) collect the ids to delete in batches
async function findDuplicatesToDelete(): Promise<string[]> {
  console.log('Scanning listing_product_match for duplicates...')

  const toDelete: string[] = []
  // Track (listing_id, product_id) → id of the row we are keeping
  const keeper = new Map<string, string>()

  let offset = 0
  const PAGE = 10_000
  let totalScanned = 0

  while (true) {
    const { data, error } = await supabase
      .from('listing_product_match')
      .select('id, listing_id, product_id, score, created_at')
      .order('listing_id', { ascending: true })
      .order('product_id', { ascending: true })
      .order('score',      { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1)

    if (error) {
      console.error('Error scanning table:', error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      const key = `${row.listing_id}:${row.product_id}`
      if (!keeper.has(key)) {
        // First (highest-score) row for this pair — keep it
        keeper.set(key, row.id as string)
      } else {
        // Duplicate — mark for deletion
        toDelete.push(row.id as string)
      }
    }

    totalScanned += data.length
    process.stdout.write(`\r  Scanned ${totalScanned.toLocaleString()} rows, found ${toDelete.length.toLocaleString()} duplicates so far...`)

    if (data.length < PAGE) break
    offset += PAGE
  }

  console.log(`\nScan complete. Total scanned: ${totalScanned.toLocaleString()}, duplicates to delete: ${toDelete.length.toLocaleString()}`)
  return toDelete
}

// ── Step 2: delete in batches ─────────────────────────────────────────────────
async function deleteBatches(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    console.log('No duplicates found — table is already clean.')
    return
  }

  const totalBatches = Math.ceil(ids.length / BATCH_SIZE)
  let totalDeleted = 0

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1

    if (DRY_RUN) {
      console.log(`[dry-run] Batch ${batchNum}/${totalBatches}: would delete ${batch.length} rows`)
      totalDeleted += batch.length
      continue
    }

    const { error } = await supabase
      .from('listing_product_match')
      .delete()
      .in('id', batch)

    if (error) {
      console.error(`Error in batch ${batchNum}: ${error.message}`)
      console.error('Stopping. Re-run the script to resume — already-deleted rows are gone.')
      process.exit(1)
    }

    totalDeleted += batch.length
    console.log(`Deleted ${batch.length} duplicates in batch ${batchNum}/${totalBatches} (${totalDeleted.toLocaleString()} total)`)
  }

  console.log(`\n✅ Done. Deleted ${totalDeleted.toLocaleString()} duplicate rows${DRY_RUN ? ' (dry-run, nothing actually deleted)' : ''}.`)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (DRY_RUN) console.log('🔍 DRY RUN — no rows will be deleted\n')

  const toDelete = await findDuplicatesToDelete()
  await deleteBatches(toDelete)

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Step 2 — run this SQL manually in the Supabase SQL editor
once the script has completed successfully:

  CREATE UNIQUE INDEX IF NOT EXISTS lpm_listing_product_unique
  ON listing_product_match(listing_id, product_id);

This will fail if any duplicates remain. If it does, re-run
this script and try again.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
