import type { IconName } from '@/components/Icon'

/**
 * The glyph a product shows where it has no image (PAN-281).
 *
 * Keyed by the bare leaf slug (`trumpets`), the one shape every surface can
 * hand over: the browse projection carries it and the product page's
 * placement names it as the kind. A full `root/leaf` slug works too — each
 * segment is tried. `piano` is the default every other category kept.
 *
 * Only a leaf Heroicons already draws is listed (`brass` is the one glyph of
 * Klup's own, drawn for this), and nothing here is a scraper or matcher
 * selector — a placeholder says what kind of thing is missing a photo,
 * nothing more.
 */
const BY_LEAF: Readonly<Record<string, IconName>> = {
  microphones: 'microphone',
  trumpets: 'brass',
}

export function placeholderIcon(slug: string | null | undefined): IconName {
  for (const part of (slug ?? '').split('/')) {
    const hit = BY_LEAF[part]
    if (hit) return hit
  }
  return 'piano'
}
