/**
 * upload-csp-images.ts
 *
 * Downloads Reverb CSP images for products that have attributes.reverb_csp.image_url
 * but do NOT yet have a Supabase Storage image (or have a junk sbpics/thumb72x72 URL).
 *
 * Converts to webp via sharp, uploads to onboarding-assets/products/{slug}.webp,
 * then updates kg_product.image_url to the storage URL.
 *
 * Delta-safe by default: skips products whose image_url already points to storage.
 *
 * Usage:
 *   npx tsx scripts/upload-csp-images.ts              # all eligible products
 *   npx tsx scripts/upload-csp-images.ts --dry-run    # preview only, no uploads
 *   npx tsx scripts/upload-csp-images.ts --limit=50   # cap number processed
 *   npx tsx scripts/upload-csp-images.ts --tier=legendary  # filter by tier
 *   npx tsx scripts/upload-csp-images.ts --slug=roland-re-201  # single product
 *   npx tsx scripts/upload-csp-images.ts --force      # re-upload even if already in storage
 *
 * Run on Mac Mini (panter) — same machine as other bulk jobs.
 */

import * as fs from 'fs'
import * as path from 'path'
import sharp from 'sharp'
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const BUCKET       = 'onboarding-assets'
const STORAGE_PREFIX = 'products'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const args = process.argv.slice(2)
const DRY_RUN  = args.includes('--dry-run')
const FORCE    = args.includes('--force')
const limitArg = args.find(a => a.startsWith('--limit='))
const LIMIT    = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity
const tierArg  = args.find(a => a.startsWith('--tier='))
const TIER     = tierArg ? tierArg.split('=')[1] : null
const slugArg  = args.find(a => a.startsWith('--slug='))
const SLUG     = slugArg ? slugArg.split('=')[1] : null

const STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${STORAGE_PREFIX}/`

function isJunkUrl(url: string | null): boolean {
  if (!url) return true
  if (url.includes('sbpics')) return true
  if (url.includes('thumb72x72')) return true
  return false
}

function isStorageUrl(url: string | null): boolean {
  return !!url && url.startsWith(STORAGE_BASE)
}

async function processOne(slug: string, rawUrl: string): Promise<boolean> {
  const imageUrl = rawUrl
  console.log(`[${slug}] Downloading ${imageUrl.slice(0, 80)}...`)

  const res = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) {
    console.error(`[${slug}] HTTP ${res.status} — skipping`)
    return false
  }
  const buffer = Buffer.from(await res.arrayBuffer())

  const webp = await sharp(buffer)
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer()

  const storagePath = `${STORAGE_PREFIX}/${slug}.webp`

  if (DRY_RUN) {
    console.log(`[${slug}] DRY-RUN — would upload ${storagePath} (${webp.length} bytes)`)
    return true
  }

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, webp, { contentType: 'image/webp', upsert: true })
  if (uploadErr) {
    console.error(`[${slug}] Storage upload failed: ${uploadErr.message}`)
    return false
  }

  const publicUrl = `${STORAGE_BASE}${slug}.webp`
  const { error: dbErr } = await supabase
    .from('kg_product')
    .update({ image_url: publicUrl })
    .eq('slug', slug)
  if (dbErr) {
    console.error(`[${slug}] DB update failed: ${dbErr.message}`)
    return false
  }

  console.log(`[${slug}] ✓ → ${publicUrl}`)
  return true
}

async function main() {
  console.log(`upload-csp-images — mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}${FORCE ? ' +FORCE' : ''}${TIER ? ` tier=${TIER}` : ''}${SLUG ? ` slug=${SLUG}` : ''}\n`)

  // Build query — products with a CSP image URL available
  let query = supabase
    .from('kg_product')
    .select('slug, image_url, attributes')
    .eq('status', 'active')
    .not('attributes->reverb_csp->image_url', 'is', null)

  if (SLUG) {
    query = query.eq('slug', SLUG)
  } else {
    if (TIER) query = query.eq('tier', TIER)
    query = query.order('tier', { ascending: true }) // legendary first (alphabetically: classic < legendary < standard)
  }

  const rows: Array<{ slug: string; image_url: string | null; attributes: Record<string, unknown> }> = []
  let from = 0
  while (true) {
    const { data, error } = await query.range(from, from + 499)
    if (error) throw error
    if (!data?.length) break
    rows.push(...data)
    if (data.length < 500) break
    from += 500
  }

  // Filter to eligible rows
  const eligible = rows.filter(r => {
    if (FORCE) return true
    if (isStorageUrl(r.image_url)) return false  // already in storage — skip
    return true  // null, sbpics, or any other non-storage URL
  })

  const toProcess = SLUG ? eligible : eligible.slice(0, LIMIT === Infinity ? eligible.length : LIMIT)

  console.log(`Found ${rows.length} products with CSP image. Eligible (not in storage): ${eligible.length}. Processing: ${toProcess.length}\n`)

  let ok = 0, fail = 0
  for (const row of toProcess) {
    const cspImageUrl = (row.attributes as { reverb_csp?: { image_url?: string } })?.reverb_csp?.image_url
    if (!cspImageUrl) continue
    try {
      const success = await processOne(row.slug, cspImageUrl)
      if (success) ok++; else fail++
    } catch (e) {
      console.error(`[${row.slug}] ERROR:`, e)
      fail++
    }
    // Rate limit — be kind to Reverb CDN
    await new Promise(r => setTimeout(r, 500))
  }

  console.log(`\nDone. ✓ ${ok}  ✗ ${fail}`)
}

main().catch(e => { console.error(e); process.exit(1) })
