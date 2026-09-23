/**
 * Which picture does a product show? — the single authority.
 *
 * PAN-133. `kg_product` carries two image columns and they mean different
 * things: `hero_image_url` is CURATED (an operator chose it through
 * `/admin/image`) and `image_url` is INGESTED (a Reverb CSP pull or a storage
 * upload put it there). Both stay. What stops existing is *each surface having
 * its own opinion about which one wins*.
 *
 * That opinion had already forked twice, in opposite directions:
 *   - PAN-110: a TR-909 re-pull wrote `image_url` while the product page
 *     rendered `hero_image_url`, so the re-pull changed a field nobody read.
 *   - PAN-133: `/admin/image` wrote `hero_image_url` while
 *     `browse_product_projection` selected `image_url` alone, so 16 public
 *     products showed nothing or a stale picture on every card.
 *
 * The rule below is therefore written exactly once in TypeScript, and exactly
 * once in SQL (migration 058's `image_resolved` LATERAL). Both say the same
 * sentence: **the curated image wins, the ingested one is the fallback, and a
 * blank string is not an image.**
 *
 * IMPORT-FREE ON PURPOSE, like `lib/catalogue.ts`, `lib/publication.ts` and
 * `lib/catalogue-tree.ts`. It is reached from `'use client'` pages, so it must
 * not be able to drag a service-role client or a native module into a browser
 * chunk — see `scripts/lib/wp4a-boundary.test.ts`.
 *
 * NOT `lib/product-image.ts`. That name was already taken by PAN-100's
 * server-only fetch/convert/store pipeline, which value-imports `sharp`. The
 * two modules are neighbours by subject and opposites by environment; keeping
 * the names distinct is what keeps `sharp` out of the product page's bundle.
 */

/** The two columns, as any caller happens to have selected them. */
export type ProductImageColumns = {
  hero_image_url?: string | null
  image_url?: string | null
}

export type ProductImageSource = 'curated' | 'ingested'

export type ResolvedProductImage = {
  /** The URL to render, already trimmed. `null` means "no image", honestly. */
  url: string | null
  /** Which column won. `null` when neither held anything. */
  source: ProductImageSource | null
}

/**
 * Blank is not a value. `''` and `'   '` are what a cleared admin field and a
 * whitespace-polluted import leave behind, and treating them as images is how
 * a surface ends up rendering `src=""` instead of falling through to the
 * picture it actually has. The view has always taken this view of `image_url`
 * (`NULLIF(btrim(...), '')`); now every surface does, for both columns.
 */
function present(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The precedence. Curated first, ingested second, `null` last.
 *
 * Callers that only need the URL read `.url`; callers that must distinguish an
 * operator's choice from an automated pull — `/admin/images` badges it — read
 * `.source`. Nobody re-derives either from the raw columns.
 */
export function resolveProductImage(row: ProductImageColumns): ResolvedProductImage {
  const curated = present(row.hero_image_url)
  if (curated !== null) return { url: curated, source: 'curated' }

  const ingested = present(row.image_url)
  if (ingested !== null) return { url: ingested, source: 'ingested' }

  return { url: null, source: null }
}
