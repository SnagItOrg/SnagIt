/**
 * scripts/backfill-category-uuids.ts
 *
 * Populates kg_category.reverb_uuid from data/reverb-categories.json.
 * Run AFTER migration 033 has added the column.
 *
 * Mapping rule:
 *   kg_category.slug = "<root>/<leaf>"  → match Reverb where root_slug=<root> and slug=<leaf>
 *   kg_category.slug = "<root>"          → match the root entry (Reverb root: full_name === name)
 *
 * Idempotent: skips rows that already have reverb_uuid set unless --force.
 *
 * Usage:
 *   npm run backfill-category-uuids
 *   npm run backfill-category-uuids -- --dry-run
 *   npm run backfill-category-uuids -- --force
 */

import 'dotenv/config'
import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'

for (const p of [
  path.resolve(__dirname, '../frontend/.env.local'),
  path.resolve(__dirname, '../.env.local'),
]) {
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, 'utf8').split('\n')
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
    break
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing Supabase env')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const args    = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const FORCE   = args.includes('--force')

interface ReverbCategory {
  uuid:       string
  full_name:  string
  name:       string
  root_slug:  string
  slug:       string
}

interface KgCategoryRow {
  id:           string
  slug:         string
  parent_id:    string | null
  reverb_uuid:  string | null
}

async function main() {
  console.log('🔗  Backfill kg_category.reverb_uuid')
  console.log(`   Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}, force: ${FORCE}`)
  console.log()

  const reverb: { categories: ReverbCategory[] } = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../data/reverb-categories.json'), 'utf8'),
  )

  // Build two lookups: root slug → uuid (for parent_id IS NULL rows),
  // and "<root_slug>/<leaf_slug>" → uuid (for child rows).
  const rootLookup = new Map<string, string>()
  const leafLookup = new Map<string, string>()
  for (const c of reverb.categories) {
    if (c.full_name === c.name) {
      rootLookup.set(c.root_slug, c.uuid)
    } else {
      leafLookup.set(`${c.root_slug}/${c.slug}`, c.uuid)
    }
  }
  console.log(`Source: ${rootLookup.size} root + ${leafLookup.size} leaf entries`)

  // Try selecting the new column; fall back to base columns if migration 033
  // hasn't been applied yet (lets dry-run preview the mapping).
  let rows: KgCategoryRow[]
  const probe = await supabase.from('kg_category').select('id, slug, parent_id, reverb_uuid')
  if (probe.error?.message.includes('reverb_uuid')) {
    console.warn('⚠️   reverb_uuid column not present yet — apply migration 033 first.')
    if (!DRY_RUN) {
      console.error('❌  Cannot backfill in LIVE mode without the column. Run --dry-run to preview, then apply 033.')
      process.exit(1)
    }
    const { data, error } = await supabase.from('kg_category').select('id, slug, parent_id')
    if (error) throw new Error(error.message)
    rows = (data ?? []).map(r => ({ ...r, reverb_uuid: null })) as KgCategoryRow[]
  } else if (probe.error) {
    throw new Error(probe.error.message)
  } else {
    rows = (probe.data ?? []) as KgCategoryRow[]
  }
  console.log(`Target: ${rows.length} kg_category rows`)

  let resolved = 0
  let unmatched = 0
  let skipped = 0
  let errors = 0

  for (const row of rows) {
    if (row.reverb_uuid && !FORCE) { skipped++; continue }

    let uuid: string | null = null
    if (row.parent_id === null) {
      uuid = rootLookup.get(row.slug) ?? null
    } else {
      uuid = leafLookup.get(row.slug) ?? null
    }

    if (!uuid) {
      console.log(`  · ${row.slug.padEnd(45)} no Reverb match`)
      unmatched++
      continue
    }

    if (DRY_RUN) {
      console.log(`  ✓ ${row.slug.padEnd(45)} → ${uuid}`)
      resolved++
      continue
    }

    const { error: updErr } = await supabase
      .from('kg_category')
      .update({ reverb_uuid: uuid })
      .eq('id', row.id)
    if (updErr) {
      console.error(`  ✗ ${row.slug}: ${updErr.message}`)
      errors++
    } else {
      console.log(`  ✓ ${row.slug.padEnd(45)} → ${uuid}`)
      resolved++
    }
  }

  console.log()
  console.log('─'.repeat(60))
  console.log(`Resolved: ${resolved}  Skipped: ${skipped}  Unmatched: ${unmatched}  Errors: ${errors}`)
}

main().catch(err => { console.error(err); process.exit(1) })
