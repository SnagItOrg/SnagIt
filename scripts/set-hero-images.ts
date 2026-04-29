/**
 * scripts/set-hero-images.ts
 *
 * One-shot: writes hero_image_url to specific kg_product rows from
 * editorially-chosen Unsplash photos. CDN URLs are clean (no watermark
 * overlay params) at 1200px wide.
 *
 * Run: npx tsx scripts/set-hero-images.ts
 */

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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const unsplash = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80`
const pexels = (id: number) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1200`

// slug → direct CDN image URL (editorial hero overrides)
const UPDATES: Record<string, string> = {
  // Unsplash
  'gibson-hummingbird':  unsplash('photo-1588729827829-cbf5023cd78e'),
  'gibson-es-335':       unsplash('photo-1706871111087-9f8f32b28702'),
  'fender-telecaster':   unsplash('photo-1583679670276-90aa14338851'),
  'fender-jazzmaster':   unsplash('photo-1642450530377-74f3a7327406'),
  'fender-jaguar':       unsplash('photo-1686421402964-24b6d8247dff'),
  // Pexels
  'roland-tr-909':       pexels(15786284),
}

async function main() {
  // First: check which slugs actually exist
  const { data: rows } = await supabase
    .from('kg_product')
    .select('slug, canonical_name, hero_image_url')
    .in('slug', Object.keys(UPDATES))

  const found = new Set((rows ?? []).map(r => r.slug))
  const missing = Object.keys(UPDATES).filter(s => !found.has(s))
  if (missing.length) {
    console.warn(`⚠  Slugs not found in kg_product: ${missing.join(', ')}`)
  }

  for (const row of rows ?? []) {
    const newUrl = UPDATES[row.slug]
    const { error } = await supabase
      .from('kg_product')
      .update({ hero_image_url: newUrl })
      .eq('slug', row.slug)

    if (error) {
      console.error(`✗ ${row.slug}: ${error.message}`)
    } else {
      const prev = row.hero_image_url ? '(was set)' : '(was null)'
      console.log(`✓ ${row.slug.padEnd(22)} ${prev}`)
      console.log(`  → ${newUrl}`)
    }
  }
}

main().catch(err => { console.error(err); process.exit(1) })
