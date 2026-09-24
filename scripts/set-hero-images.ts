/**
 * scripts/set-hero-images.ts
 *
 * Writes hero_image_url to specific kg_product rows from
 * editorially-chosen Unsplash photos. CDN URLs are clean (no watermark
 * overlay params) at 1200px wide.
 *
 * PAN-135: a row that already has a hero image is never overwritten unless
 * --force is passed, and nothing is written unless --apply is passed. The
 * decision lives in scripts/lib/hero-image-guard.ts.
 *
 * Run: npx tsx scripts/set-hero-images.ts                   (dry run, the default)
 *      npx tsx scripts/set-hero-images.ts --apply           (fill empty rows only)
 *      npx tsx scripts/set-hero-images.ts --apply --force   (also overwrite)
 */

import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { parseHeroFlags, setHeroImages } from './lib/hero-image-guard'

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
  const flags = parseHeroFlags(process.argv.slice(2))

  const { data: rows, error } = await supabase
    .from('kg_product')
    .select('slug, hero_image_url')
    .in('slug', Object.keys(UPDATES))
  if (error) throw new Error(error.message)

  const lines = await setHeroImages(
    (rows ?? []).map(r => ({ slug: r.slug, current: r.hero_image_url })),
    UPDATES,
    flags,
    async (slug, before, after) => {
      // Compare-and-set: only overwrite the value that was read and reported.
      const q = supabase.from('kg_product').update({ hero_image_url: after }).eq('slug', slug)
      const { data, error } = await (before === null ? q.is('hero_image_url', null) : q.eq('hero_image_url', before)).select('slug')
      if (error) throw new Error(`${slug}: ${error.message}`)
      return (data ?? []).length > 0
    },
  )
  for (const line of lines) console.log(line)
}

main().catch(err => { console.error(err); process.exit(1) })
