/**
 * Danish display labels for the music taxonomy roots.
 *
 * Stage 3 V1, WP-1. See docs/stage-3-v1-decision-and-build-plan.md §8.1 and D13.
 *
 * WHY A CODE MAP AND NOT A PRODUCTION WRITE. `kg_category.name_da` equals
 * `name_en` for every music root in production, so Danish users currently read
 * "Bass Guitars", "Keyboards and Synths" and "Pro Audio". Correcting the column
 * is a production write and therefore a product-owner decision (deferred as
 * Q-D6). Stage 3 V1 performs no production write, so the correction lives here
 * as reviewed code and is applied at render time only.
 *
 * This map NEVER changes taxonomy, routing, matching or slugs. `slug` remains
 * the identity in URLs, search and metadata.
 *
 * Roots not listed here fall back to `name_da` from the database, so an
 * unmapped root degrades to today's behaviour rather than to a blank label.
 */

export const CATEGORY_LABELS_DA: Readonly<Record<string, string>> = {
  'keyboards-and-synths': 'Synthesizere & keyboards',
  'electric-guitars': 'El-guitarer',
  'acoustic-guitars': 'Western- & akustiske guitarer',
  'bass-guitars': 'Basguitarer',
  'pro-audio': 'Studieudstyr',
  'effects-and-pedals': 'Effekter & pedaler',
  'drums-and-percussion': 'Trommer & percussion',
  amps: 'Forstærkere',
  'music-gear': 'Musikudstyr',
}

/**
 * English labels are already correct in the database; this map exists only so
 * both locales resolve through one code path.
 */
export const CATEGORY_LABELS_EN: Readonly<Record<string, string>> = {
  'keyboards-and-synths': 'Synthesizers & Keyboards',
  'electric-guitars': 'Electric Guitars',
  'acoustic-guitars': 'Acoustic Guitars',
  'bass-guitars': 'Bass Guitars',
  'pro-audio': 'Studio Equipment',
  'effects-and-pedals': 'Effects & Pedals',
  'drums-and-percussion': 'Drums & Percussion',
  amps: 'Amplifiers',
  'music-gear': 'Music Gear',
}

/**
 * Resolve a display label for a taxonomy root.
 * Falls back to the database value, then to the slug, so nothing renders blank.
 */
export function categoryLabel(
  slug: string,
  locale: 'da' | 'en',
  fallback?: string | null,
): string {
  const map = locale === 'da' ? CATEGORY_LABELS_DA : CATEGORY_LABELS_EN
  return map[slug] ?? fallback ?? slug
}
