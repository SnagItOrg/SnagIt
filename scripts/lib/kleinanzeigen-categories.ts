/**
 * scripts/lib/kleinanzeigen-categories.ts
 *
 * Which kleinanzeigen.de categories a monitored product is searched in (PAN-303).
 *
 * Every product is searched in Musikinstrumente (c74). A microphone is ALSO
 * searched in Audio & Hifi (c172): German sellers file studio microphones there
 * as often as under Musikinstrumente (PAN-302 measured the U 47 / U 67 / M 49
 * hunt), and a guitar or a synth is never there, so the widening is scoped to
 * the one kind that needs it.
 *
 * "Microphone" is read from the KG — the product's subcategory is
 * `pro-audio/microphones` — never from a hand list, so a microphone added to
 * the monitoring set later follows automatically. Exact match and fail-closed:
 * a product whose subcategory cannot be read is searched in c74 only, which is
 * what it was before this file existed.
 *
 * Which PRODUCTS are monitored is still the explicit set in
 * data/klup-source-monitoring.json; this decides only where each is looked for.
 */

export type KleinanzeigenCategory = {
  /** Kleinanzeigen's category code, the `c<n>` suffix of a search URL. */
  code: 'c74' | 'c172'
  /** The path segment the site uses for that category. */
  segment: string
}

export const MUSIKINSTRUMENTE: KleinanzeigenCategory = { code: 'c74', segment: 's-musikinstrumente' }
export const AUDIO_HIFI: KleinanzeigenCategory = { code: 'c172', segment: 's-audio-hifi' }

/** The KG leaf whose products are also searched in Audio & Hifi. */
export const MICROPHONE_SUBCATEGORY = 'pro-audio/microphones'

export function searchCategories(subcategorySlug: string | null): KleinanzeigenCategory[] {
  return subcategorySlug === MICROPHONE_SUBCATEGORY ? [MUSIKINSTRUMENTE, AUDIO_HIFI] : [MUSIKINSTRUMENTE]
}

export function buildKleinanzeigenUrl(normalizedQ: string, page: number, category: KleinanzeigenCategory): string {
  const q = normalizedQ.replace(/ /g, '+')
  const baseUrl = `https://www.kleinanzeigen.de/${category.segment}/${q}/k0${category.code}`
  return page > 1 ? `${baseUrl}?pageNum=${page}` : baseUrl
}
