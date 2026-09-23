/**
 * Curated product images — fetch, convert, store.
 *
 * PAN-100. `scripts/upload-product-images.ts` already does download → webp →
 * Supabase Storage → `kg_product`, but only from a terminal on the Mac Mini
 * with a service-role key, which is exactly where the owner is not standing
 * when they are looking at a wrong picture. This module is that same pipeline,
 * callable from the admin API route.
 *
 * SERVER ONLY. It imports `sharp` and is handed a service-role Supabase
 * client. No client component may value-import it. The client is passed in
 * rather than constructed here so this module never imports
 * `lib/supabase-admin.ts` — one of the modules
 * `scripts/lib/wp4a-boundary.test.ts` forbids the browser bundle from
 * reaching.
 *
 * WHY THE STORAGE PATH DIVERGES FROM THE SCRIPT. The script writes
 * `products/{slug}.webp` and points `image_url` at it. PAN-100 requires the
 * curated image to land on `hero_image_url` and to leave `image_url` alone —
 * but writing the same object key would have overwritten the very bytes
 * `image_url` serves. The column would have been untouched and the picture
 * replaced anyway, and clearing the hero would no longer revert anything.
 * Curated heroes therefore get their own prefix, `products/hero/{slug}.webp`,
 * so "revert" is genuinely one nulled field.
 */

import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Same bucket as the CLI script — only the prefix differs. */
export const PRODUCT_IMAGE_BUCKET = 'onboarding-assets'

/** Curated heroes live beside, never on top of, the automated `image_url`. */
export const CURATED_HERO_PREFIX = 'products/hero'

/** Refuse a source larger than this before decoding it. */
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024

/** A decoded image smaller than this is a favicon or a tracking pixel. */
export const MIN_EDGE_PX = 200

/** Same quality as the CLI script, so a curated image matches the catalogue. */
const WEBP_QUALITY = 85

export type ImageFailureReason =
  | 'invalid_url'
  | 'unreachable'
  | 'not_an_image'
  | 'too_large'
  | 'too_small'
  | 'storage_failed'

export class ProductImageError extends Error {
  constructor(
    readonly reason: ImageFailureReason,
    message: string,
  ) {
    super(message)
    this.name = 'ProductImageError'
  }
}

/**
 * Provenance, as PAN-35 and PAN-76 §7 ask for it.
 *
 * PAN-76 proposed a dedicated `kg_product.image_provenance` column. That needs
 * a migration, and no migration is authorised here, so this rides in the
 * existing `attributes` jsonb under the same key. The shape is the one the
 * memo specified, so a later migration can lift it across unchanged.
 */
export type ImageProvenance = {
  source_url: string
  stored_url: string
  source: 'admin_paste'
  acquired_at: string
  acquired_by: string
  review_state: 'approved'
  bytes: number
  width: number
  height: number
}

/**
 * Reject anything that is not a plain public http(s) URL.
 *
 * This route performs a server-side fetch of an operator-supplied address, so
 * it is an SSRF sink even though only an admin can reach it. Hostnames that
 * resolve to the loopback or a private range are refused by name here; this is
 * a guard against the obvious mistake, not a substitute for network egress
 * rules.
 */
export function assertFetchableUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ProductImageError('invalid_url', 'Not a URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProductImageError('invalid_url', 'Only http and https are accepted.')
  }

  const host = url.hostname.toLowerCase()
  const isPrivate =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
    host === '::1' ||
    host === '[::1]'

  if (isPrivate) {
    throw new ProductImageError('invalid_url', 'That address is not publicly reachable.')
  }

  return url
}

/** The object key a curated hero is stored under. */
export function curatedHeroPath(slug: string): string {
  return `${CURATED_HERO_PREFIX}/${slug}.webp`
}

/**
 * Download, validate and re-encode. Throws `ProductImageError` with a reason
 * the route can turn into a sentence — never a bare 500.
 */
export async function fetchAndConvert(
  sourceUrl: string,
): Promise<{ webp: Buffer; width: number; height: number }> {
  const url = assertFetchableUrl(sourceUrl)

  let res: Response
  try {
    res = await fetch(url, {
      redirect: 'follow',
      // An honest identifier. This is a server fetching an address a human
      // pasted, and it must never pretend to be a browser.
      headers: { 'User-Agent': 'Klup/1.0 (+https://www.klup.dk; admin image curation)' },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new ProductImageError('unreachable', 'The address could not be reached.')
  }

  if (!res.ok) {
    throw new ProductImageError('unreachable', `The source answered ${res.status}.`)
  }

  const declaredLength = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
    throw new ProductImageError('too_large', 'The image is larger than 15 MB.')
  }

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
  // Checked but not trusted: some CDNs answer application/octet-stream for a
  // perfectly good JPEG, so an unexpected type is only fatal when it is
  // positively something else. sharp below is the real gate.
  if (contentType.startsWith('text/') || contentType.includes('html')) {
    throw new ProductImageError('not_an_image', 'That address returns a web page, not an image.')
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.byteLength === 0) {
    throw new ProductImageError('not_an_image', 'The source returned no data.')
  }
  if (buffer.byteLength > MAX_SOURCE_BYTES) {
    throw new ProductImageError('too_large', 'The image is larger than 15 MB.')
  }

  let width = 0
  let height = 0
  let webp: Buffer
  try {
    const pipeline = sharp(buffer)
    const meta = await pipeline.metadata()
    width = meta.width ?? 0
    height = meta.height ?? 0
    webp = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer()
  } catch {
    throw new ProductImageError('not_an_image', 'That file could not be read as an image.')
  }

  if (width < MIN_EDGE_PX || height < MIN_EDGE_PX) {
    throw new ProductImageError(
      'too_small',
      `The image is ${width}×${height}. At least ${MIN_EDGE_PX}×${MIN_EDGE_PX} is needed.`,
    )
  }

  return { webp, width, height }
}

/**
 * Upload the converted bytes and return the public URL.
 *
 * The URL carries a `?v=` stamp because the object key is stable: without it a
 * second curation of the same product would sit behind the CDN copy of the
 * first, and the operator would paste a new picture and watch nothing change.
 */
export async function storeCuratedHero(
  supabase: SupabaseClient,
  supabaseUrl: string,
  slug: string,
  webp: Buffer,
): Promise<string> {
  const path = curatedHeroPath(slug)

  const { error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(path, webp, { contentType: 'image/webp', upsert: true })

  if (error) {
    throw new ProductImageError('storage_failed', error.message)
  }

  const base = supabaseUrl.replace(/\/+$/, '')
  return `${base}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${path}?v=${Date.now()}`
}
