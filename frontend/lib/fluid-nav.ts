/**
 * PAN-296 (spike) — the two client-side handoffs a shared-element transition
 * needs between a card and the page it opens.
 *
 * WHY THESE EXIST. React's `<ViewTransition>` pairs an element on the old page
 * with one on the new page by `name`, and it pairs them in the navigation's
 * COMMIT. Both public surfaces involved are client shells that fetch after
 * mount: `/browse/[root]` renders a skeleton until `/api/browse/[root]`
 * answers and `/product/[slug]` renders a skeleton until `/api/product/[slug]`
 * does. At commit neither holds the element the other needs, so no pair forms
 * and the morph never plays — forwards (no hero yet) or back (no grid yet).
 *
 * The real fix is the server shell WP-3 describes (the product hero rendered
 * by the server, the browse grid rendered by the server). This module is the
 * spike-sized stand-in: in-memory only, lost on reload, nothing persisted.
 *
 *   - `rememberHero` / `takeHero`: the card hands the page what it already
 *     shows (name, brand, image), so the page can render the hero in the
 *     commit and let the morph land on it. A direct load has no handoff and
 *     renders exactly as before.
 *   - `browseRootCache`: the last grid per root, so a return to the browse
 *     page renders synchronously, the reverse morph finds its card and the
 *     router's scroll restoration lands on a page that has its height.
 *
 * Import-free on purpose, like `catalogue.ts`, so it can be read from a test.
 */

export type HeroHandoff = {
  slug: string
  canonicalName: string
  brandName: string
  imageUrl: string | null
  /** The card's placeholder glyph name, for a product with no image. */
  placeholder: string
}

/** The `view-transition-name` shared by a product's card image and its hero. */
export function productImageTransitionName(slug: string): string {
  return `product-image-${slug}`
}

const pendingHero = new Map<string, HeroHandoff>()

/** The card records what it shows, just before the navigation starts. */
export function rememberHero(hero: HeroHandoff): void {
  pendingHero.set(hero.slug, hero)
}

/** The page takes it once; a reload or a direct visit finds nothing. */
export function takeHero(slug: string): HeroHandoff | null {
  const hero = pendingHero.get(slug) ?? null
  pendingHero.delete(slug)
  return hero
}

/**
 * The last `/api/browse/[root]` payload per root, keyed by the page's own key.
 *
 * WHAT THIS DOES AND DOES NOT BUY ON THE WAY BACK. With the grid rendered in
 * the commit, the browser's own scroll restoration lands where the visitor
 * left (measured 1552 → 1552; on main the skeleton has no height and it
 * lands at 459). The reverse MORPH still does not play, and not because of
 * this module: measured on Next 16.3.6, a back/forward restore commits with
 * zero `document.startViewTransition` calls — with or without a named pair,
 * with the card in or out of the viewport, with a `default` crossfade on
 * every card — while the forward navigation runs one every time. Next keeps
 * its restore path apart from navigations on purpose (app-router-instance.js:
 * "restore is handled quickly since it's fired on the popstate event"); the
 * exact mechanism is a framework question to take upstream, not something to
 * route around in product code. Scrolling the old page to the saved position
 * in the `popstate` itself was tried and changed nothing.
 */
export const browseRootCache = new Map<string, unknown>()
