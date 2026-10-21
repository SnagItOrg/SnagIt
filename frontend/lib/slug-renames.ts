/**
 * Product slugs that were renamed — PAN-289 (owner, 2026-10-21).
 *
 * Eleven public slugs repeated their brand (`warm-audio-warm-audio-wa-1b`),
 * a residue of the April import, and the qa_only SP-404 row carried an
 * uppercase slug. The rename itself is a production write, run from guarded
 * SQL on the owner's word AFTER this file is deployed; this map is what keeps
 * every old URL and every slug-keyed rule working on both sides of that write:
 *
 *   - the product layout redirects an old slug permanently, but only once the
 *     row no longer answers to it — before the SQL runs the old page still
 *     renders, so no URL 404s in between;
 *   - the matcher's `LINE_BOUNDARIES` are keyed by the NEW slug and looked up
 *     through `currentSlug`, so the nightly matcher reads the same rule for the
 *     row whichever slug production holds that night.
 *
 * `moog-moog-subsequent-37` cannot become `moog-subsequent-37`: that slug is
 * the inactive row migration 053 retired (RETIRED_053_SLUGS in
 * scripts/lib/seed-identifier-manifest.ts), which must never be reused.
 *
 * Import-free, like `family-slugs.ts`, so the Edge middleware, the matcher and
 * the plain-Node tests can all load it. An entry is never removed: an old URL
 * stays linked from somewhere forever.
 */
export const SLUG_RENAMES: Readonly<Record<string, string>> = {
  'gibson-gibson-j-45-standard-12-string': 'gibson-j-45-standard-12-string',
  'gibson-gibson-l-00-original': 'gibson-l-00-original',
  'moog-moog-messenger': 'moog-messenger',
  'moog-moog-subsequent-37': 'moog-subsequent-37-synth',
  'neumann-neumann-u47-fet-collectors-edition': 'neumann-u47-fet-collectors-edition',
  'warm-audio-warm-audio-wa-1b': 'warm-audio-wa-1b',
  'warm-audio-warm-audio-wa-44': 'warm-audio-wa-44',
  'warm-audio-warm-audio-wa-8000': 'warm-audio-wa-8000',
  'warm-audio-warm-audio-wa-cx12': 'warm-audio-wa-cx12',
  'warm-audio-warm-audio-wa-mpx': 'warm-audio-wa-mpx',
  'warm-audio-warm-audio-wa273-eq': 'warm-audio-wa273-eq',
  'roland-SP-404': 'roland-sp-404',
}

/** The slug a renamed row answers to now, or null when `slug` was never renamed. */
export function renamedSlug(slug: string): string | null {
  return Object.prototype.hasOwnProperty.call(SLUG_RENAMES, slug) ? SLUG_RENAMES[slug] : null
}

/** The row's current slug: the new one for an old slug, otherwise `slug` itself. */
export function currentSlug(slug: string): string {
  return renamedSlug(slug) ?? slug
}
