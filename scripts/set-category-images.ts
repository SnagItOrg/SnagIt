/**
 * scripts/set-category-images.ts
 *
 * Populates kg_category.image_url for root music categories by picking the
 * best product image in each category. Priority order per category:
 *   1. legendary tier with hero_image_url
 *   2. classic tier with hero_image_url
 *   3. legendary tier with image_url
 *   4. classic tier with image_url
 *
 * Editorial overrides (slug → URL) in EDITORIAL_OVERRIDES take precedence
 * over auto-derived images. Add entries there for the music-gear root and
 * any category where the auto pick is wrong.
 *
 * Run: npx tsx scripts/set-category-images.ts
 *      npx tsx scripts/set-category-images.ts --dry-run
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

// Editorial overrides — set these to lock in a specific image for a category
// or the music-gear root (which keyboards-and-synths inherits in the API).
const EDITORIAL_OVERRIDES: Record<string, string> = {
  // 'music-gear': 'https://images.unsplash.com/...',  ← set this; keyboards-and-synths inherits it
  // 'electric-guitars': 'https://...',
}

// These categories are skipped by auto-derive entirely.
// keyboards-and-synths is driven by the API via music-gear.image_url inheritance.
const SKIP_AUTO: Set<string> = new Set(['keyboards-and-synths'])

async function main() {
  console.log(`set-category-images — mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}\n`)

  // Fetch all root music categories (including music-gear — it needs an image
  // even though it's hidden from browse, because keyboards-and-synths inherits it)
  const { data: roots, error: rootsErr } = await supabase
    .from('kg_category')
    .select('id, slug, name_en, image_url')
    .eq('domain', 'music')
    .is('parent_id', null)
  if (rootsErr) throw rootsErr

  // Fetch all leaf subcategories with their parent (root) id
  const { data: subs, error: subsErr } = await supabase
    .from('kg_category')
    .select('id, parent_id')
    .eq('domain', 'music')
    .not('parent_id', 'is', null)
  if (subsErr) throw subsErr

  const subToRoot = new Map<string, string>()
  for (const s of subs ?? []) {
    if (s.parent_id) subToRoot.set(s.id, s.parent_id)
  }

  // Fetch active products with tier + images
  const products: Array<{
    id: string; subcategory_id: string; tier: string | null
    hero_image_url: string | null; image_url: string | null
  }> = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('kg_product')
      .select('id, subcategory_id, tier, hero_image_url, image_url')
      .eq('status', 'active')
      .not('subcategory_id', 'is', null)
      .range(from, from + 999)
    if (error) throw error
    if (!data?.length) break
    products.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  console.log(`Loaded ${products.length} active products with subcategory\n`)

  // Score each product for image quality (higher = prefer):
  //   6 legendary+hero, 5 classic+hero, 4 legendary+image
  //   3 classic+image, 2 any tier+hero, 1 any tier+image
  function score(p: typeof products[0]): number {
    const isLegendary = p.tier === 'legendary'
    const isClassic   = p.tier === 'classic'
    const hasHero     = !!p.hero_image_url
    const hasImage    = !!p.image_url
    if (isLegendary && hasHero)   return 6
    if (isClassic   && hasHero)   return 5
    if (isLegendary && hasImage)  return 4
    if (isClassic   && hasImage)  return 3
    if (hasHero)                  return 2
    if (hasImage)                 return 1
    return 0
  }
  function bestImage(p: typeof products[0]): string | null {
    return p.hero_image_url ?? p.image_url ?? null
  }

  // Reject known-bad image URLs: sbpics (Thomann staff photos), 72x72 thumbnails
  function isUsableImage(url: string): boolean {
    if (url.includes('sbpics')) return false
    if (url.includes('thumb72x72')) return false
    return true
  }

  // Build root_id → best product per root
  const bestByRoot = new Map<string, { img: string; score: number }>()
  for (const p of products) {
    const rootId = subToRoot.get(p.subcategory_id!)
    if (!rootId) continue
    const s = score(p)
    if (s === 0) continue
    const img = bestImage(p)
    if (!img || !isUsableImage(img)) continue
    const current = bestByRoot.get(rootId)
    if (!current || s > current.score) {
      bestByRoot.set(rootId, { img, score: s })
    }
  }

  // Apply to each root category
  for (const cat of roots ?? []) {
    const override = EDITORIAL_OVERRIDES[cat.slug]
    const skipAuto = SKIP_AUTO.has(cat.slug)
    const auto = skipAuto ? null : bestByRoot.get(cat.id)
    const newUrl = override ?? auto?.img ?? null

    // Only auto-populate classic/legendary tier images (score ≥ 2).
    // Score 1 = random CSP thumbnail — not good enough for a category hero card.
    const MIN_AUTO_SCORE = 2
    if (!override && auto && auto.score < MIN_AUTO_SCORE) {
      console.log(`  ⚠  ${cat.slug.padEnd(30)} needs editorial (best auto score=${auto.score})`)
      continue
    }

    if (!newUrl) {
      const reason = skipAuto ? 'skipped (inherits from music-gear in API)' : 'no image found — needs editorial'
      console.log(`  ⚠  ${cat.slug.padEnd(30)} ${reason}`)
      continue
    }

    const source = override ? 'editorial' : `auto (score=${auto?.score})`
    console.log(`  ${cat.slug.padEnd(30)} [${source}]`)
    console.log(`    → ${newUrl.slice(0, 80)}`)

    if (!DRY_RUN) {
      const { error } = await supabase
        .from('kg_category')
        .update({ image_url: newUrl })
        .eq('id', cat.id)
      if (error) console.error(`    ✗ ${error.message}`)
    }
  }
  console.log('\nDone.')
}

main().catch(err => { console.error(err); process.exit(1) })
