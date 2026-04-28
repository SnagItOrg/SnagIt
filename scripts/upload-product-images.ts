/**
 * upload-product-images.ts
 *
 * Downloads images from URLs (Unsplash or any public source),
 * converts to webp, uploads to Supabase Storage, and updates kg_product.
 *
 * Usage (one-off):
 *   tsx scripts/upload-product-images.ts <slug> <image-url>
 *
 * Usage (batch) — edit the BATCH array below and run with --batch:
 *   tsx scripts/upload-product-images.ts --batch
 *
 * Storage path: onboarding-assets/products/{slug}.webp
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import dotenv from 'dotenv'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'

for (const p of [
  path.resolve(__dirname, '../.env.local'),
  path.resolve(__dirname, '../frontend/.env.local'),
]) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); break }
}

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!
const BUCKET        = 'onboarding-assets'
const STORAGE_PREFIX = 'products'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ── Batch list — paste slug + Unsplash page URL here ────────────────────────
// Resolve the actual image URL from the Unsplash page URL first (see below),
// or paste the images.unsplash.com URL directly.
const BATCH: { slug: string; url: string }[] = [
  { slug: 'fender-jazz-bass',              url: 'https://images.unsplash.com/photo-1544722712-2ac7c0b365ef' },
  { slug: 'moog-minitaur',                 url: 'https://images.unsplash.com/photo-1695407773587-c1e378e3b4cf' },
  { slug: 'elektron-digitakt',             url: 'https://images.unsplash.com/photo-1689951993157-5f2aea0983e2' },
  { slug: 'elektron-digitone',             url: 'https://images.unsplash.com/photo-1654048210688-ca790c0fe5e1' },
  { slug: 'te-op-1',                       url: 'https://images.unsplash.com/photo-1646551387209-18632aa0bad3' },
  { slug: 'elektron-analog-four',          url: 'https://images.unsplash.com/photo-1695407773492-dffd52d73b8c' },
  { slug: 'moog-moog-music-subsequent-25', url: 'https://images.unsplash.com/photo-1649365810362-a5bf4414f1dc' },
  { slug: 'korg-minilogue',               url: 'https://images.unsplash.com/photo-1771272258869-22d80b851870' },
  { slug: 'waldorf-blofeld',              url: 'https://images.unsplash.com/photo-1591909862480-b6a599ea362b' },
  { slug: 'korg-volca-beats',             url: 'https://images.unsplash.com/photo-1732199327984-7baedc962fa7' },
  { slug: 'korg-microkorg',               url: 'https://images.unsplash.com/photo-1765448999810-528c435f2ed6' },
  { slug: 'moog-dfam',                    url: 'https://images.unsplash.com/photo-1732282343119-163df43f9677' },
  { slug: 'roland-tr-909',               url: 'https://images.unsplash.com/photo-1617833140106-f85990a942bf' },
  { slug: 'linn-electronics-linndrum',    url: 'https://images.unsplash.com/photo-1571512379797-4613cb587cc0' },
  // Batch 3
  { slug: 'fender-telecaster',            url: 'https://images.unsplash.com/photo-1635891360509-8705d6d128bb' },
  { slug: 'roland-tr-808',               url: 'https://images.unsplash.com/photo-1571512379940-716326f35dbd' },
  { slug: 'roland-tr-09',               url: 'https://images.unsplash.com/photo-1685017207768-1681e4ed71a7' },
  { slug: 'roland-jx-8p',               url: 'https://images.unsplash.com/photo-1641994245125-06dd360cadf7' },
  { slug: 'roland-sp-404-mkii',          url: 'https://images.unsplash.com/photo-1758626445322-d5dda0431094' },
  { slug: 'roland-sp-404a',             url: 'https://images.unsplash.com/photo-1587916849729-61978d3f0601' },
  { slug: 'roland-jx-08',               url: 'https://images.unsplash.com/photo-1641994245114-38cb2df59881' },
  { slug: 'roland-jd-08',               url: 'https://images.unsplash.com/photo-1641994245608-91a52d3f95ac' },
  { slug: 'ampex-atr-700',              url: 'https://images.unsplash.com/photo-1709283937750-96694edc213a' },
  { slug: 'behringer-poly-d',           url: 'https://images.unsplash.com/photo-1710284032550-e6de0ff9c072' },
  { slug: 'arturia-polybrute',          url: 'https://images.unsplash.com/photo-1634041551278-a843c116ff28' },
  { slug: 'native-instruments-maschine',url: 'https://images.unsplash.com/photo-1646071996900-b3989dac101b' },
  { slug: 'akai-mpc-5000',             url: 'https://images.unsplash.com/photo-1628452803026-e15039313d0e' },
  { slug: 'ableton-push',              url: 'https://images.unsplash.com/photo-1535979014625-490762ceb2ff' },
]

// ── Core ─────────────────────────────────────────────────────────────────────

async function resolveUrl(rawUrl: string): Promise<string> {
  // If already a direct image URL, return as-is
  if (rawUrl.includes('images.unsplash.com')) return rawUrl

  // For Unsplash page URLs, extract the photo ID and build the direct URL
  const match = rawUrl.match(/unsplash\.com\/photos\/[^/]+-([A-Za-z0-9_-]+)$/)
    ?? rawUrl.match(/unsplash\.com\/photos\/([A-Za-z0-9_-]+)$/)
  if (match) {
    // Use the source redirect — it resolves to the actual image
    const res = await fetch(`https://unsplash.com/photos/${match[1]}/download?force=true`, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    return res.url
  }

  return rawUrl
}

async function processOne(slug: string, rawUrl: string) {
  console.log(`\n[${slug}] Resolving URL...`)
  const imageUrl = await resolveUrl(rawUrl)
  console.log(`[${slug}] Downloading: ${imageUrl.slice(0, 80)}...`)

  const res = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching image`)
  const buffer = Buffer.from(await res.arrayBuffer())

  console.log(`[${slug}] Converting to webp...`)
  const webp = await sharp(buffer)
    .webp({ quality: 85 })
    .toBuffer()

  const storagePath = `${STORAGE_PREFIX}/${slug}.webp`
  console.log(`[${slug}] Uploading to ${BUCKET}/${storagePath}...`)

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, webp, {
      contentType: 'image/webp',
      upsert: true,
    })

  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`)

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`

  const { error: dbErr } = await supabase
    .from('kg_product')
    .update({ image_url: publicUrl })
    .eq('slug', slug)

  if (dbErr) throw new Error(`DB update failed: ${dbErr.message}`)

  console.log(`[${slug}] ✓ Done — ${publicUrl}`)
  return publicUrl
}

// ── Entry ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)

  if (args[0] === '--batch') {
    if (BATCH.length === 0) {
      console.error('BATCH array is empty. Edit the script and add entries.')
      process.exit(1)
    }
    for (const { slug, url } of BATCH) {
      try { await processOne(slug, url) }
      catch (e) { console.error(`[${slug}] ERROR:`, e) }
    }
    return
  }

  const [slug, url] = args
  if (!slug || !url) {
    console.error('Usage: tsx scripts/upload-product-images.ts <slug> <image-url>')
    console.error('       tsx scripts/upload-product-images.ts --batch')
    process.exit(1)
  }

  await processOne(slug, url)
}

main().catch((e) => { console.error(e); process.exit(1) })
