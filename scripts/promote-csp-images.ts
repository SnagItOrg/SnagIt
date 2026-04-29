/**
 * scripts/promote-csp-images.ts
 *
 * Promotes attributes.reverb_csp.image_url → kg_product.image_url for
 * products that have a typed reverb_csp_id (high/medium confidence) but
 * no image_url yet.
 *
 * hero_image_url is the editorial override and is never touched here.
 * Only fills the gap for products with NO image at all.
 *
 * Run: npx tsx scripts/promote-csp-images.ts
 *      npx tsx scripts/promote-csp-images.ts --dry-run
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

const DRY_RUN = process.argv.includes('--dry-run')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

async function main() {
  console.log(`promote-csp-images — mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}\n`)

  // Fetch products with a CSP anchor but no image_url yet
  const all: Array<{ id: string; slug: string; attributes: Record<string, unknown> | null }> = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('kg_product')
      .select('id, slug, attributes')
      .not('reverb_csp_id', 'is', null)
      .is('image_url', null)
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  console.log(`Candidates (reverb_csp_id set, image_url null): ${all.length}`)

  const toUpdate = all.filter(p => {
    const csp = (p.attributes as Record<string, unknown> | null)?.['reverb_csp'] as Record<string, unknown> | null
    return typeof csp?.image_url === 'string' && csp.image_url.length > 0
  })

  console.log(`With attributes.reverb_csp.image_url available: ${toUpdate.length}\n`)

  if (toUpdate.length === 0) {
    console.log('Nothing to update.')
    return
  }

  let updated = 0
  let errors = 0

  for (const p of toUpdate) {
    const csp = (p.attributes as Record<string, unknown>)['reverb_csp'] as Record<string, unknown>
    const imageUrl = csp.image_url as string

    if (DRY_RUN) {
      console.log(`  ${p.slug.padEnd(40)} → ${imageUrl.slice(0, 70)}`)
      updated++
      continue
    }

    const { error } = await supabase
      .from('kg_product')
      .update({ image_url: imageUrl })
      .eq('id', p.id)

    if (error) {
      console.error(`  ✗ ${p.slug}: ${error.message}`)
      errors++
    } else {
      updated++
    }
  }

  console.log(`\nDone. Updated: ${updated}  Errors: ${errors}`)
}

main().catch(err => { console.error(err); process.exit(1) })
