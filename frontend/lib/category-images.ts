/**
 * Stock category photography for the music taxonomy roots (PAN-86).
 *
 * WHY A CODE MAP AND NOT A PRODUCTION WRITE — the same reason, and the same
 * shape, as `category-labels.ts`. `kg_category.image_url` is the authority for
 * a category image and it is read first by `/browse`; correcting the column is
 * a production write and therefore a product-owner decision. This map is the
 * reviewed candidate set, applied at render time only. Promote it into the
 * column whenever you like and delete the entry — the fallback argument means
 * the column shows through the moment the map stops answering.
 *
 * WHY HOTLINKS AND NOT SUPABASE STORAGE — measured on production, not assumed.
 * The stock CDN resizes and content-negotiates, so `?auto=format&fit=crop&
 * w=1200&q=80` is served as avif/webp at ~25-215 KB. The Supabase objects the
 * column pointed at are full-size originals with no transform in front of
 * them: `products/fender-jazz-bass.webp` is 1.9 MB, `products/ampex-atr-700
 * .webp` is 4.0 MB and `categories/music-gear.webp` is 3.9 MB. Roughly 30x,
 * for the same card. `images.unsplash.com` was already declared in
 * `next.config.mjs` remotePatterns; this adds no CDN.
 *
 * THIRTEEN ENTRIES, NOT FIFTEEN, and that is deliberate. `acoustic-guitars`
 * and `electric-guitars` already hold correct Unsplash hotlinks in the column
 * (137 KB and 106 KB delivered), so they are absent here and resolve through
 * the fallback. The map supersedes the column in exactly two situations: the
 * ten roots where it is null, and the three where it points at a borrowed
 * multi-megabyte product photograph.
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
  // Guitar strap and pick on a guitar body.
  accessories: photo('photo-1643386156518-9efc679d9e57'),

  // unsplash.com/photos/black-fender-amplifier-FR9Hm-xNRa8
  // Black Fender combo amp beside a sunburst Stratocaster.
  amps: photo('photo-1557855684-8aa6f40997df'),

  // unsplash.com/photos/brass-trumpet-on-brown-wooden-table-r5jL69trU-s
  // Silver cornet on a stand on a concert stage.
  'band-and-orchestra': photo('photo-1613142659446-bf37da865799'),

  // unsplash.com/photos/brown-and-black-bass-guitars-G_3NA_UoVyo
  // Sunburst Precision-style bass. Supersedes the borrowed 1.9 MB
  // products/fender-jazz-bass.webp the column points at.
  'bass-guitars': photo('photo-1543060749-aa3f115aad09'),

  // unsplash.com/photos/lighted-dj-mixer-ttv1pX6tk7o
  // CDJ deck and mixer under blue club lighting.
  'dj-and-lighting-gear': photo('photo-1544785349-c4a5301826fd'),

  // unsplash.com/photos/gray-drum-set-6NpYOFB3VCI
  // Full white drum kit on a riser.
  'drums-and-percussion': photo('photo-1543443258-92b04ad5ec6b'),

  // unsplash.com/photos/assorted-colored-electric-guitar-effects-oiYgrDjSJhM
  // Pedalboard of assorted effects pedals.
  'effects-and-pedals': photo('photo-1550602003-c89e9c05f972'),

  // unsplash.com/photos/shallow-focus-photo-banjo-on-brown-wicker-chair-yQQoQlGDX7k
  // Resonator banjo on a wicker chair.
  'folk-instruments': photo('photo-1568903457385-c38d34ffd37e'),

  // unsplash.com/photos/black-turntable-on-brown-wooden-table-TcSckNRL9J8
  // Turntable playing a record on a sideboard.
  'home-audio': photo('photo-1526394931762-90052e97b376'),

  // unsplash.com/photos/a-bunch-of-electronic-keyboards-sitting-next-to-each-other-11KDGL-cN5s
  // Stacked rack of vintage analogue synthesizers. The column is null here and
  // lib/browse.ts lends /browse the 3.9 MB music-gear.webp instead.
  'keyboards-and-synths': photo('photo-1634041551278-a843c116ff28'),

  // unsplash.com/photos/recording-studio-with-guitars-and-console-ptVBlniJi50
  // Studio control room: console, outboard, guitars on the wall. Supersedes
  // the 3.9 MB categories/music-gear.webp.
  'music-gear': photo('photo-1598488035139-bdbb2231ce04'),

  // unsplash.com/photos/close-up-of-a-guitar-headstock-with-tuners-WKBQrLwfi6Y
  // Guitar headstock and machine heads.
  parts: photo('photo-1744654296952-cf5b6b47556f'),

  // unsplash.com/photos/close-up-photography-of-turned-on-audio-mixer-VRdZBLqnoMU
  // Lit mixing desk — faders and meters. Supersedes the borrowed 4.0 MB
  // products/ampex-atr-700.webp.
  'pro-audio': photo('photo-1518972559570-7cc1309f3229'),
}

/**
 * Resolve a category image.
 *
 * Reviewed map first, `kg_category.image_url` second, `null` last — a root
 * with neither renders the empty image well rather than a broken `<img>`.
 * Mirrors `categoryLabel(slug, locale, fallback)` exactly, on purpose: two
 * render-time corrections for two columns nobody is authorised to write, with
 * one shape between them.
 */
export function categoryImage(slug: string, fallback?: string | null): string | null {
  return CATEGORY_IMAGES[slug] ?? fallback ?? null
}
