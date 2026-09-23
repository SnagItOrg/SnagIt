/**
 * Stock category photography for the music taxonomy roots (PAN-86).
 *
 * WHY A CODE MAP AND NOT A PRODUCTION WRITE. `kg_category.image_url` is the
 * authority for a category image and it is read first by `/browse`; correcting
 * the column is a production write and therefore a product-owner decision.
 * This map is the reviewed candidate set, applied at render time only. Promote
 * it into the column whenever you like and delete the entry — the fallback
 * argument means the column shows through the moment the map stops answering.
 *
 * WHY HOTLINKS AND NOT SUPABASE STORAGE — measured on production, not assumed.
 * The stock CDN resizes and content-negotiates, so `?auto=format&fit=crop&
 * w=1200&q=80` is served as avif/webp at ~25-215 KB. The Supabase objects the
 * column pointed at are full-size originals with no transform in front of
 * them: `products/fender-jazz-bass.webp` is 1.9 MB and `products/ampex-atr-700
 * .webp` is 4.0 MB. Roughly 30x, for the same card.
 * `images.unsplash.com` was already declared in `next.config.mjs`
 * remotePatterns; this adds no CDN.
 *
 * TWELVE ENTRIES FOR FOURTEEN ROOTS, and that is deliberate.
 * `acoustic-guitars` and `electric-guitars` already hold correct Unsplash
 * hotlinks in the column (72.5 KB and 39.1 KB delivered at w=1200), so they
 * are absent here and resolve through the fallback. The map supersedes the
 * column in exactly two situations: the ten roots where it is null, and the
 * two where it points at a borrowed multi-megabyte product photograph.
 *
 * `music-gear` has no entry because it is not a card — `isRenderableRoot()`
 * excludes the legacy coarse root. Its 3.9 MB `categories/music-gear.webp` is
 * still what `/browse` lends `keyboards-and-synths`, which this shelf does not
 * do and which is not this ticket's to fix.
 *
 * PROVENANCE. Every URL below was fetched and visually checked on 2026-09-21.
 * The `unsplash.com/photos/...` page for each is recorded beside it — PAN-76
 * and PAN-100 both turned on not being able to say where an asset came from.
 * Unsplash licenses these for commercial use without attribution; the source
 * line is ours, for traceability, not a licence requirement.
 */

/** The resize contract. `auto=format` is what makes the delivered bytes avif. */
const TRANSFORM = 'auto=format&fit=crop&w=1200&q=80'

const photo = (id: string) => `https://images.unsplash.com/${id}?${TRANSFORM}`

export const CATEGORY_IMAGES: Readonly<Record<string, string>> = {
  // unsplash.com/photos/a-close-up-of-a-guitar-pick-and-a-guitar-case--XFV7J2uao0
  // Guitar strap and pick on a guitar body. Not owner-selected — this root has
  // no supported products, so the card is empty either way.
  accessories: photo('photo-1643386156518-9efc679d9e57'),

  // Owner-selected 2026-09-22, supplied as a CDN URL.
  // Both hands on a dreadnought, warm amber, shallow focus. Supersedes the
  // column's own Unsplash hotlink, which is a wider studio shot with no hands.
  'acoustic-guitars': photo('photo-1510915361894-db8b60106cb1'),

  // Owner-selected 2026-09-22, supplied as a CDN URL.
  // Vintage Fender blackface combo — logo, grille cloth and control panel.
  amps: photo('photo-1778607237788-802e0ccc129c'),

  // unsplash.com/photos/person-playing-trumpet-during-night-time-A10y2Eq7OHY
  // A hand on a trumpet in warm stage light. Owner-selected 2026-09-22 — the
  // message carried a different photo id as the link TEXT and this one as the
  // href; they are not the same image and this is the one that matches the
  // stated direction.
  'band-and-orchestra': photo('photo-1511192336575-5a79af67a629'),

  // unsplash.com/photos/person-playing-guitar-in-grayscale-photography-nUd7uq3i0qs
  // A hand on a bass neck, warm sepia. Unsplash titles it "grayscale"; it is
  // not. Supersedes the borrowed 1.9 MB products/fender-jazz-bass.webp.
  'bass-guitars': photo('photo-1622316375172-11207007fba9'),

  // Owner-selected 2026-09-22, supplied as a CDN URL.
  // DJ hands over a mixer, amber bokeh behind.
  'dj-and-lighting-gear': photo('photo-1660211934853-e33d8a02201d'),

  // Owner-selected 2026-09-22, supplied as a CDN URL.
  // Kit in warm stage light, shallow focus across cymbals.
  'drums-and-percussion': photo('photo-1602939444907-6e688c594a66'),

  // unsplash.com/photos/a-screenshot-of-a-video-game-ci6TQb-4cRA
  // A shop wall of guitar pedals. Unsplash's auto-title is wrong — it is not a
  // video game, and the title would have been wrong to act on.
  'effects-and-pedals': photo('photo-1662434243640-42988ab42db8'),

  // Owner-selected 2026-09-22, supplied as a CDN URL.
  // Weathered hands on a zither.
  'folk-instruments': photo('photo-1601712112487-5a284906b10f'),

  // Owner-selected 2026-09-22, supplied as a CDN URL.
  // Turntable with orange vinyl by a window, record sleeves beside it.
  'home-audio': photo('photo-1496293455970-f8581aae0e3b'),

  // Owner-selected 2026-09-22, supplied as a CDN URL.
  // Moog modular wall with red and yellow patch cables over two keyboards.
  // The column is null here and lib/browse.ts lends /browse the 3.9 MB
  // music-gear.webp instead.
  'keyboards-and-synths': photo('photo-1600148272607-7bbf03a40d3b'),

  // unsplash.com/photos/close-up-of-a-guitar-headstock-with-tuners-WKBQrLwfi6Y
  // Guitar headstock and machine heads. Not owner-selected — this root has no
  // supported products, so the card is empty either way.
  parts: photo('photo-1744654296952-cf5b6b47556f'),

  // Owner-selected 2026-09-22, supplied as a CDN URL.
  // Mixing console, shallow focus across the faders. Supersedes the borrowed
  // 4.0 MB products/ampex-atr-700.webp.
  'pro-audio': photo('photo-1521450741901-ea1ad3399027'),
}

/**
 * Resolve a category image.
 *
 * Reviewed map first, `kg_category.image_url` second, `null` last — a root
 * with neither renders the empty image well rather than a broken `<img>`.
 */
export function categoryImage(slug: string, fallback?: string | null): string | null {
  return CATEGORY_IMAGES[slug] ?? fallback ?? null
}
