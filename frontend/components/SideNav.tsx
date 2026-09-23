'use client'

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useLocale } from '@/components/LocaleProvider'
import type { NavTab } from '@/components/BottomNav'
import { fill, type Locale } from '@/lib/i18n'
import { currentCatalogueNode, type CatalogueTreeCategory } from '@/lib/catalogue-tree'

interface Props {
  active: NavTab
  /**
   * Optional, so a SERVER component can mount the sidebar.
   *
   * Every nav item carries an `href` today and is active by pathname, so the
   * tab-based branch below — the only caller — never runs, and all eight
   * client pages pass `() => {}`. A server page may not hand a function across
   * the RSC boundary at all, so /family/[slug] mounts `<SideNav active=… />`
   * and this stays undefined. Making it optional is what lets that route reuse
   * this chrome instead of growing a second shell.
   */
  onChange?: (tab: NavTab) => void
}

function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium w-full text-left transition-colors hover:bg-secondary ${
        collapsed ? 'justify-center' : ''
      }`}
      style={{ color: 'var(--muted-foreground)' }}
      aria-label="Toggle theme"
    >
      {resolvedTheme === 'dark'
        ? <Sun size={20} strokeWidth={1.8} />
        : <Moon size={20} strokeWidth={1.8} />
      }
      {!collapsed && <span>{resolvedTheme === 'dark' ? 'Lystema' : 'Mørkt tema'}</span>}
    </button>
  )
}

/**
 * PAN-17 — the supported catalogue, under the Katalog nav item.
 *
 * WHAT IS EXPOSED, AND WHY IT IS SO LITTLE. PAN-30 found the taxonomy missing
 * no branches: 320 leaves exist and the public catalogue occupies 14 of them
 * under 6 roots. The structure is ~23x larger than the catalogue navigating
 * it, so the job was deciding how little to show, not designing a hierarchy.
 * The tree is built from the product rows themselves (`buildCatalogueTree`),
 * which makes "populated branches only" structural rather than a filter — an
 * empty music root contributes no row and so cannot render (D-IA-1). Two
 * levels, then products. Form factor and technology are filters and never
 * levels (D-IA-2); `Accessories` and `Parts` hold nothing and are therefore
 * absent by construction (D-IA-3).
 *
 * The homepage shelf (PAN-86) shows all fourteen roots INCLUDING the empty
 * ones. That is not a contradiction: it answers "what does Klup cover", and
 * this answers "where can I go". An empty branch is honest on the first
 * surface and a dead end on this one. Eight roots are empty today; none of
 * them is named anywhere in this file, because the tree is built from the
 * rows rather than filtered down to them.
 *
 * NO PRICE, BAND, MEDIAN OR VERDICT. Guaranteed by the payload rather than by
 * this component's restraint: a product node is `{ label, slug }` and has no
 * field a price could travel in. Asserted structurally in
 * scripts/lib/pan17-catalogue-tree.test.ts, the way PAN-56 asserts it.
 *
 * ON A PHONE THIS RENDERS NOTHING, AND NOTHING IS LOST. The whole `<aside>` is
 * `hidden md:flex` (PAN-73), so below 768px the tree is absent along with the
 * rest of the sidebar. The catalogue is not unreachable there: `BottomNav`
 * carries the same Katalog destination for anonymous and signed-in visitors
 * alike, and `/browse` -> `/browse/<root>` is the same two levels as full
 * pages, with the subcategory chips that page already has. This tree is a
 * desktop shortcut into a journey that exists on every width, not the only
 * route to it — so it is deliberately NOT duplicated into `BottomNav`, where
 * a 69-row tree would be a worse control than the page it shortcuts.
 *
 * Fetched rather than passed: all eight pages that mount `SideNav` are client
 * components, so there is no server boundary to hand props through. An
 * unreadable catalogue renders no tree at all — the primary nav above is
 * untouched, which is the same degradation `/browse` already performs.
 */
function CatalogueTree({ onMarkedChange }: { onMarkedChange: (marked: boolean) => void }) {
  const { t, locale } = useLocale()
  const pathname = usePathname()
  /**
   * PAN-121 — the sidebar reads the same facet the chips write.
   *
   * `/browse/[root]` now keeps its subcategory in `?sub=<slug>`, so "where you
   * are" is a fact both surfaces can read rather than one component's private
   * state. Reading it here is what makes the sidebar indicator and the filter
   * chips agree instead of telling two half-stories.
   */
  const searchParams = useSearchParams()
  const activeSub = searchParams.get('sub')
  const [categories, setCategories] = useState<CatalogueTreeCategory[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/catalogue-tree')
      .then(async (r) => (r.ok ? await r.json() : null))
      .then((d: { categories?: CatalogueTreeCategory[] } | null) => {
        if (!cancelled && d?.categories) setCategories(d.categories)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  /**
   * The one current node, decided once by `lib/catalogue-tree.ts`.
   *
   * Every level below compares itself against this single answer instead of
   * re-deriving its own predicate, so "exactly one `aria-current` in the tree"
   * is structural rather than three booleans that happen not to overlap.
   */
  const current = useMemo(
    () => currentCatalogueNode(categories, pathname, activeSub),
    [categories, pathname, activeSub],
  )

  /**
   * Tell the sidebar whether the tree is carrying the mark.
   *
   * When it is not — collapsed, still loading, or standing somewhere the tree
   * has no node for, such as a family page — the Katalog item marks the section
   * instead, so a visitor inside the catalogue is never told nothing at all.
   * The cleanup matters as much as the effect: collapsing unmounts this
   * component, and without it the sidebar would keep believing a node it can no
   * longer see is still marked.
   */
  useEffect(() => {
    onMarkedChange(current !== null)
    return () => onMarkedChange(false)
  }, [current, onMarkedChange])

  if (categories.length === 0) return null

  return (
    <div className="mt-0.5 mb-1 flex flex-col gap-0.5">
      {categories.map((category) => {
        const label = locale === 'da' ? category.name_da : category.name_en

        /**
         * PAN-121 — is this the branch the visitor is standing in?
         *
         * `isCurrentRoot` is the whole `/browse/<root>` page; `isCurrentBranch`
         * additionally requires that no facet is narrowing it, so a visitor
         * filtered down to one subcategory sees the *subcategory* marked as the
         * current node rather than two nodes both claiming to be it. Exactly one
         * `aria-current="page"` in the tree at a time is the point — a screen
         * reader announcing two current pages is no better than announcing none.
         */
        const isCurrentBranch =
          current?.kind === 'branch' && current.categorySlug === category.slug

        return (
          // Native disclosure. `<details>` needs no state, keeps keyboard and
          // screen-reader semantics, and survives a client-side route change
          // without a store.
          //
          // OPEN BY DEFAULT IS A PRODUCT DECISION, AND A REVERSIBLE ONE.
          // "Jeg vil ogsaa gerne have produkter i sub kategorier naar det er
          // muligt" is an instruction to show them, not to hide them one click
          // away, so every category starts open: 6 categories, 14 leaves and
          // 49 products — 69 rows, roughly 1,800px, in a container that
          // already scrolls. The collapse is the control if that becomes too
          // much, and `open` -> a route-derived condition is a one-line change
          // if the default should instead be "only the branch I am in".
          <details key={category.slug} open className="group">
            <summary
              /* pl-3/gap-1.5 and a 16px chevron rather than the nav items'
                 px-3/gap-3/20px: the longest Danish root label ("Western- &
                 akustiske guitarer") needs every pixel it can get, and a branch
                 label that cannot be read is worse navigation than one sitting
                 10px left of the item above it.

                 PAN-120 corrected the claim that used to stand here. This said
                 `w-60` was the width at which that label fits; measured, it is
                 not — the text needs 184px and gets 173px at 240, so it has
                 been ellipsing all along. `SIDEBAR_MIN_WIDTH` is now the
                 measured floor, and these paddings are why it is not larger. */
              /* PAN-121 — the current branch, marked without colour.
                 A rail, a fill and a weight step. The sparse-accent rule is
                 exhaustive, so green is not available to a nav item; and
                 PAN-113 measured an opacity-based state treatment at 2.61:1,
                 so transparency is not available either. All three signals
                 here are full-strength semantic tokens. */
              aria-current={isCurrentBranch ? 'page' : undefined}
              className={`flex items-center gap-1.5 pr-2 py-2 rounded-xl text-[13px] cursor-pointer list-none [&::-webkit-details-marker]:hidden transition-colors hover:bg-secondary ${
                isCurrentBranch
                  ? 'pl-2 border-l-2 font-semibold'
                  : 'pl-3 font-medium'
              }`}
              style={{
                color: isCurrentBranch ? 'var(--foreground)' : 'var(--muted-foreground)',
                backgroundColor: isCurrentBranch ? 'var(--secondary)' : 'transparent',
                borderLeftColor: isCurrentBranch ? 'var(--foreground)' : 'transparent',
              }}
            >
              <span
                className="material-symbols-outlined flex-shrink-0 transition-transform group-open:rotate-90"
                style={{ fontSize: '16px' }}
                aria-hidden="true"
              >
                chevron_right
              </span>
              <span className="truncate" title={label}>{label}</span>
            </summary>

            <ul className="flex flex-col">
              {category.subcategories.map((sub) => {
                const subLabel = locale === 'da' ? sub.name_da : sub.name_en
                /* `sub.slug` is documented in `catalogue-tree.ts` as the bare
                   leaf slug "as `/browse/<root>` reports it", which is exactly
                   the value the filter chips write into `?sub=`. The sidebar and
                   the chips therefore compare the same string — no second
                   normalisation here that could drift from the route's. */
                const isCurrentSub =
                  current?.kind === 'subcategory' &&
                  current.categorySlug === category.slug &&
                  current.subcategorySlug === sub.slug
                return (
                  <li key={sub.slug}>
                    {/* PAN-121 — a subcategory IS a destination now.

                        It used to be an inert `<p>`, and the comment here said
                        why: "`/browse/<root>` filters by subcategory in client
                        state rather than in the URL, so there is no honest href
                        to give this row today." That premise is gone — the facet
                        is `?sub=<slug>` — so the row becomes the link it always
                        wanted to be, and the same click the chip performs is now
                        available from the sidebar. This is also the only reason
                        the sidebar can mark the current subcategory at all. */}
                    <Link
                      href={`/browse/${category.slug}?sub=${encodeURIComponent(sub.slug)}`}
                      aria-current={isCurrentSub ? 'page' : undefined}
                      className={`block pr-3 pt-2 pb-1 text-[11px] uppercase tracking-wide truncate rounded-lg transition-colors hover:bg-secondary ${
                        isCurrentSub ? 'pl-9 border-l-2 font-bold' : 'pl-10 font-semibold'
                      }`}
                      style={{
                        color: isCurrentSub ? 'var(--foreground)' : 'var(--muted-foreground)',
                        backgroundColor: isCurrentSub ? 'var(--secondary)' : 'transparent',
                        borderLeftColor: isCurrentSub ? 'var(--foreground)' : 'transparent',
                      }}
                      title={subLabel}
                    >
                      {subLabel}
                    </Link>
                    <ul className="flex flex-col">
                      {sub.products.map((product) => {
                        const href = `/product/${product.slug}`
                        const isHere =
                          current?.kind === 'product' && current.productSlug === product.slug
                        return (
                          <li key={product.slug}>
                            <Link
                              href={href}
                              /* PAN-121 — `isHere` already painted this row;
                                 nothing told a screen reader about it. The
                                 visual state and the announced state now come
                                 from the same boolean. */
                              aria-current={isHere ? 'page' : undefined}
                              className={`block pr-3 py-1.5 rounded-lg text-xs truncate transition-colors hover:bg-secondary ${
                                isHere ? 'pl-9 border-l-2 font-semibold' : 'pl-10'
                              }`}
                              style={{
                                color: isHere ? 'var(--foreground)' : 'var(--muted-foreground)',
                                backgroundColor: isHere ? 'var(--secondary)' : 'transparent',
                                borderLeftColor: isHere ? 'var(--foreground)' : 'transparent',
                              }}
                              title={product.label}
                            >
                              {product.label}
                            </Link>
                          </li>
                        )
                      })}

                      {/* The threshold, made visible. `products` is empty
                          exactly when the leaf holds more than
                          LEAF_PRODUCT_LIMIT, so the reader is told the leaf is
                          bigger than the sidebar rather than shown an
                          unannounced slice of it. No leaf reaches this today —
                          the largest is 9 — and that is the point: it is here
                          before it is needed. */}
                      {sub.products.length === 0 && (
                        <li>
                          <Link
                            href={`/browse/${category.slug}`}
                            className="block pl-10 pr-3 py-1.5 rounded-lg text-xs truncate transition-colors hover:bg-secondary"
                            style={{ color: 'var(--muted-foreground)' }}
                          >
                            {fill(t.catalogueTreeSeeAll, { count: sub.product_count })}
                          </Link>
                        </li>
                      )}
                    </ul>
                  </li>
                )
              })}
            </ul>
          </details>
        )
      })}
    </div>
  )
}

/**
 * PAN-120 — the sidebar's width bounds, in resolved pixels.
 *
 * `SIDEBAR_MIN_WIDTH` IS A MEASURED FLOOR, AND THE MEASUREMENT CONTRADICTS THE
 * COMMENT IT REPLACES.
 *
 * The tree's `<summary>` has said since PAN-17 that `w-60` — 240px — "is where
 * the longest Danish root label fits". Measured in a real browser for this
 * ticket, it is not. "Western- & akustiske guitarer" needs **184px** of text
 * width; inside a 240px sidebar, after the chevron, the gap and the padding, it
 * gets **173px**, and it has been quietly ellipsing for as long as the sidebar
 * has existed. The first width at which it renders in full is **250px**.
 *
 * So the floor is 16rem: six pixels of slack over the measured 250, and on the
 * 16px arrow-key grid so `Home` lands exactly on it. A sidebar whose minimum
 * truncates Klup's own category names is not a minimum, it is a default nobody
 * checked.
 *
 * It never *wraps* at any width, which is the property the ticket asked about —
 * but that is true by construction rather than by fit: the label is `truncate`,
 * so `white-space: nowrap` makes wrapping impossible and ellipsis the only
 * failure mode available. Wrapping was never the risk; silent truncation was.
 *
 * The resize may go up from here and never down, which is the clamp order
 * Astryx's "maximum wins when resolved bounds conflict" describes.
 *
 * `SIDEBAR_COLLAPSED_WIDTH` IS ON THIS SCALE, and the first cut had it wrong.
 * It was treated as a separate mode sitting outside the range, which is why the
 * separator was removed while collapsed — `aria-valuenow="72"` under
 * `aria-valuemin="256"` would have been invalid. But collapsed being outside
 * the range was the choice, not a constraint: Astryx's spec lists "persistence,
 * snapping and collapse" as one concern owned by the hook, and snapping is the
 * part that was left out. With it, collapsed is simply the bottom of the range.
 *
 * The range is deliberately DISCONTINUOUS: {72} union [256, 480]. Nothing
 * resolves between those, so every expanded width still clears the measured
 * Danish-label floor, and `aria-valuenow` is always inside min and max. The gap
 * is a snap zone — released inside it, the width falls to whichever end is
 * nearer.
 */
/**
 * Which top-level section a path belongs to.
 *
 * Only the catalogue needs one, because it is the only section with pages
 * beneath its own href: `/browse/<root>` and `/product/<slug>` are inside
 * Katalog and neither equals `/browse`. Everything else in the nav is a single
 * page, where an exact match is the truth.
 *
 * This is coarse ON PURPOSE. It is the fallback the sidebar uses when the tree
 * cannot mark a precise node, and the honest coarse answer is the section.
 *
 * A FAMILY ROUTE IS DELIBERATELY NOT IN HERE. It was, briefly, and WP-2's
 * navigation guard caught it: `/family/<slug>` is `noindex` and reachable only
 * by the legacy redirects and a gated breadcrumb, so nothing may treat it as an
 * ordinary catalogue destination. Production agrees it is consistent rather
 * than broken — the family route marks nothing in either sidebar state, which
 * is the same answer before and after this change. The orientation gap there is
 * real, it is the one PAN-121's Trunk Test flagged, and it belongs to PAN-124's
 * breadcrumb rather than to a nav highlight invented here.
 */
const isCataloguePath = (pathname: string) =>
  pathname === '/browse' ||
  pathname.startsWith('/browse/') ||
  pathname.startsWith('/product/')

const SIDEBAR_MIN_WIDTH = 256
const SIDEBAR_MAX_WIDTH = 480
const SIDEBAR_COLLAPSED_WIDTH = 72
/** One arrow press. Coarse enough to be useful, fine enough to aim. */
const SIDEBAR_RESIZE_STEP = 16

const SIDEBAR_WIDTH_KEY = 'klup.sidebar.width'
const SIDEBAR_COLLAPSED_KEY = 'klup.sidebar.collapsed'

/** An expanded width, clamped into the readable band. */
const clampWidth = (px: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(px)))

/**
 * Resolve any candidate width to a state the sidebar can actually be in.
 *
 * The snap threshold is the midpoint of the gap between collapsed and the
 * minimum readable width, so a drag that ends inside the gap falls to whichever
 * end it was closer to. Below it the sidebar collapses; above it, it expands to
 * at least the Danish-label floor. There is no third outcome, which is what
 * keeps `aria-valuenow` honest.
 */
const SIDEBAR_SNAP_THRESHOLD = Math.round((SIDEBAR_COLLAPSED_WIDTH + SIDEBAR_MIN_WIDTH) / 2)

const snapWidth = (px: number): { collapsed: boolean; width: number } =>
  px < SIDEBAR_SNAP_THRESHOLD
    ? { collapsed: true, width: SIDEBAR_MIN_WIDTH }
    : { collapsed: false, width: clampWidth(px) }

/**
 * The resize handle — a real `separator`, not a div with a drag listener.
 *
 * Astryx's `Resizable.spec.md` is the reference and none of it is imported. The
 * parts worth copying are the semantics: `role="separator"` carrying
 * `aria-valuemin` / `aria-valuemax` / `aria-valuenow` in **resolved pixels**, an
 * orientation, a name, and — the part most implementations skip — a tab stop
 * with keyboard interaction. A resize control a keyboard cannot reach is
 * decoration.
 *
 * THE HIT TARGET AND THE PAINTED AFFORDANCE ARE DIFFERENT SIZES ON PURPOSE.
 * The grab zone is 16px wide and invisible, straddling the border; the grip
 * inside it is a 2px bar that only appears on hover or focus. A 2px pointer
 * target is a dexterity test, and a permanently visible grip is furniture on a
 * surface that is mostly text.
 *
 * IT IS PRESENT WHILE COLLAPSED, which the first cut got wrong. Collapsed is
 * now the default, so removing the handle there meant the state every visitor
 * starts in had no resize control at all and a keyboard visitor tabbing through
 * met no separator until they had already expanded. `aria-valuenow` reports the
 * resolved width in both states — 72 collapsed — and dragging or arrowing right
 * out of the collapsed state expands it.
 */
function SidebarResizeHandle({
  width,
  collapsed,
  label,
  onResolve,
}: {
  /** The resolved width, which is the collapsed width while collapsed. */
  width: number
  collapsed: boolean
  label: string
  /** Commit a snapped state. Persistence belongs to the caller. */
  onResolve: (next: { collapsed: boolean; width: number }, commit: boolean) => void
}) {
  const dragging = useRef(false)

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    let next: number | null = null
    // THE GAP IS CROSSED IN ONE STEP, IN BOTH DIRECTIONS. Neither 72 + 16 nor
    // 256 - 16 is a width the sidebar can be, so an arrow that would land
    // inside the gap goes all the way over instead. Without the second case a
    // keyboard visitor could expand from the separator but never collapse from
    // it — the pointer can, by dragging across, and the two must match.
    if (e.key === 'ArrowLeft') {
      next = collapsed || width <= SIDEBAR_MIN_WIDTH
        ? SIDEBAR_COLLAPSED_WIDTH
        : width - SIDEBAR_RESIZE_STEP
    } else if (e.key === 'ArrowRight') {
      next = collapsed ? SIDEBAR_MIN_WIDTH : width + SIDEBAR_RESIZE_STEP
    }
    else if (e.key === 'Home') next = SIDEBAR_COLLAPSED_WIDTH
    else if (e.key === 'End') next = SIDEBAR_MAX_WIDTH
    if (next === null) return
    // The arrows would otherwise scroll the sidebar's own overflow container.
    e.preventDefault()
    onResolve(snapWidth(next), true)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    // The sidebar is pinned to the left edge, so the pointer's viewport x IS
    // the candidate width. No offset bookkeeping to drift.
    onResolve(snapWidth(e.clientX), false)
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    dragging.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    onResolve(snapWidth(e.clientX), true)
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={SIDEBAR_COLLAPSED_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="group absolute inset-y-0 -right-2 z-50 w-4 cursor-col-resize"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{
          background: 'var(--border-strong, var(--border))',
          transitionDuration: 'var(--duration-fast)',
          transitionTimingFunction: 'var(--ease-standard)',
        }}
      />
    </div>
  )
}

export function SideNav({ active, onChange }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const { locale, setLocale, t } = useLocale()

  /**
   * PAN-120 — collapsed by default, and the hydration question that creates.
   *
   * `localStorage` appeared nowhere in this file before this ticket, and the
   * file already had one reason to diverge between server and client: the theme
   * toggle's `mounted` guard, which returns `null` server-side because
   * `resolvedTheme` is unknowable there. Adding a persisted width is a second
   * reason, and the two must be handled the same way or the sidebar renders one
   * width on the server and another on the client's first paint — which is a
   * hydration mismatch, not a flash.
   *
   * So the FIRST CLIENT RENDER IS IDENTICAL TO THE SERVER RENDER by
   * construction: both use the declared defaults — collapsed, at the minimum
   * width. Only after mount does the effect below read what was stored and
   * apply it. React therefore never compares two different trees.
   *
   * The cost is honest and small: a visitor who expanded the sidebar sees it
   * collapsed for one frame. The alternative — a blocking inline script in
   * `<head>` — buys that frame with a render-blocking script on every page, and
   * `app/layout.tsx` belongs to another worker tonight.
   */
  const [mounted, setMounted] = useState(false)
  const [collapsed, setCollapsed] = useState(true)
  const [width, setWidth] = useState(SIDEBAR_MIN_WIDTH)

  useEffect(() => {
    setMounted(true)
    try {
      const storedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY))
      if (Number.isFinite(storedWidth) && storedWidth > 0) setWidth(clampWidth(storedWidth))
      // Only an explicit "false" expands: an absent key means a first-time
      // visitor, and the default is collapsed.
      if (window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'false') setCollapsed(false)
    } catch {
      // Private mode, or storage disabled. The declared defaults still apply.
    }
  }, [])

  const resolvedWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : width

  /**
   * Publish the resolved width so the content area can follow it.
   *
   * Every page offsets its main column by the sidebar. That offset was
   * `md:ml-60` — 240px hardcoded in nine places — which a resizable sidebar
   * makes wrong by definition. `--sidebar-width` on the root element is the one
   * number both sides read, and `.shell-offset` in `globals.css` is how the
   * content consumes it.
   */
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${resolvedWidth}px`)
  }, [resolvedWidth])

  /**
   * Apply a snapped state, and persist it when the interaction settles.
   *
   * Both axes move together because a snap can change both at once — dragging
   * from 300px down past the threshold collapses the sidebar AND leaves a width
   * to come back to. Writing them through one function is what stops a reload
   * restoring half of a gesture.
   *
   * `commit` is false during a drag and true on release or on a key press, so
   * storage is written once per interaction rather than once per pointer event.
   */
  const applySidebarState = useCallback(
    (next: { collapsed: boolean; width: number }, commit: boolean) => {
      setCollapsed(next.collapsed)
      setWidth(next.width)
      if (!commit) return
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next.collapsed))
        window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next.width))
      } catch { /* storage unavailable; the session still resizes */ }
    },
    [],
  )

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      } catch { /* storage unavailable; the session still toggles */ }
      return next
    })
  }, [])

  /**
   * Does the catalogue tree currently carry the `aria-current` mark?
   *
   * Reported by the tree itself, so there is no second copy of the rule here
   * that could drift from the one in `lib/catalogue-tree.ts`. False whenever
   * the tree is not mounted, which is the collapsed default.
   */
  const [treeMarked, setTreeMarked] = useState(false)
  const handleTreeMarked = useCallback((marked: boolean) => setTreeMarked(marked), [])

  // Same mechanism BottomNav already uses to decide what an anonymous visitor
  // sees. `null` means "still resolving", so the control stays absent until a
  // session is confirmed rather than flashing and withdrawing.
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      setAuthed(!!data.user)
    })
  }, [])

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  /**
   * PAN-120 — the flat list becomes headed groups.
   *
   * Astryx's `SideNavSection` is "section grouping with an optional title,
   * subtitle and end content", and the grouping is the cheap, useful half of
   * "navigation headers": five equal-weight rows become two named groups, so a
   * visitor scanning for "where do I manage my own stuff" has somewhere to look.
   *
   * `SideNavHeading`'s menu popover is DELIBERATELY NOT BUILT. It is a
   * product/account lockup with a menu of actions, and Klup has no actions to
   * put in it — the wordmark goes home and that is the whole interaction. The
   * ticket's own instruction is that a popover with two items is worse than two
   * links, so the wordmark stays a link and there is no menu.
   *
   * `icon` is a function of the selected state, which is Astryx's
   * `icon`/`selectedIcon` pair. The current item is marked by WEIGHT, never by
   * colour — green is exhaustive and navigation is not on the list.
   */
  const navSections: {
    title: string
    subtitle?: string
    items: { tab?: NavTab; href?: string; label: string; icon: (selected: boolean) => React.ReactNode }[]
  }[] = [
    {
      title: t.sidebarSectionDiscover,
      subtitle: t.sidebarSectionDiscoverSubtitle,
      items: [
        {
          href: '/search',
          label: t.navSearch,
          // A FILLED MAGNIFIER IS A BLOB, so this one takes weight rather than
          // fill. Same principle, legible result: the selected state is a
          // heavier stroke, not a different hue.
          icon: (selected) => (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={selected ? 2.6 : 1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          ),
        },
        {
          href: '/browse',
          label: t.navBrowse,
          icon: (selected) => (
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '20px', fontVariationSettings: selected ? "'FILL' 1" : "'FILL' 0" }}
            >
              grid_view
            </span>
          ),
        },
      ],
    },
    {
      title: t.sidebarSectionYours,
      items: [
        {
          href: '/saved',
          label: t.navSaved,
          icon: (selected) => (
            <svg width="20" height="20" viewBox="0 0 24 24" fill={selected ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          ),
        },
        {
          href: '/watchlists',
          label: t.navNotifications,
          icon: (selected) => (
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '20px', fontVariationSettings: selected ? "'FILL' 1" : "'FILL' 0" }}
            >
              notifications
            </span>
          ),
        },
        {
          href: '/profile',
          label: t.navProfile,
          icon: (selected) => (
            <svg width="20" height="20" viewBox="0 0 24 24" fill={selected ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          ),
        },
      ],
    },
  ]

  return (
    <>
      {/* Below md the sidebar does not render at all, so the same logo carries
          the way home from here instead — BottomNav has no home destination
          (PAN-73). In normal flow, so it never covers page content. */}
      <header className="md:hidden border-b border-border bg-card">
        <Link href="/" className="flex items-center gap-3 px-4 min-h-[44px] text-primary">
          <div className="size-8 rounded-lg flex items-center justify-center bg-primary/10 flex-shrink-0">
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>radar</span>
          </div>
          <span className="text-lg font-semibold tracking-tight">Klup.dk</span>
        </Link>
      </header>

      {/* `hidden md:flex` STAYS VIEWPORT-KEYED, deliberately. "Is this a phone"
          is a viewport question, and converting this to a container query would
          be a bug — see the responsive note in the PR. Only the *width* becomes
          dynamic; the show/hide does not. */}
      <aside
        className="hidden md:flex flex-col fixed top-0 left-0 h-full border-r border-border bg-card z-40"
        style={{
          width: `${resolvedWidth}px`,
          // Not animated while dragging: a transition on width turns a drag
          // into a rubber band that lags the pointer.
          transition: mounted ? 'none' : undefined,
        }}
      >
        {/* Logo — also the way home (PAN-67) */}
        <Link
          href="/"
          className={`block border-b border-border ${collapsed ? 'px-4 py-6' : 'px-6 py-6'}`}
          aria-label={collapsed ? 'Klup.dk' : undefined}
        >
          <div className="flex items-center gap-3 text-primary">
            <div className="size-8 rounded-lg flex items-center justify-center bg-primary/10 flex-shrink-0">
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>radar</span>
            </div>
            {!collapsed && <span className="text-lg font-semibold tracking-tight">Klup.dk</span>}
          </div>
        </Link>

        {/* The collapse control. A button, above the nav, so it is the first
            thing Tab reaches inside the sidebar rather than the last. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t.sidebarExpand : t.sidebarCollapse}
          title={collapsed ? t.sidebarExpand : t.sidebarCollapse}
          className={`flex items-center gap-3 mx-3 mt-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors hover:bg-secondary ${
            collapsed ? 'justify-center' : ''
          }`}
          style={{
            color: 'var(--muted-foreground)',
            transitionDuration: 'var(--duration-fast)',
            transitionTimingFunction: 'var(--ease-standard)',
          }}
        >
          <span
            className="material-symbols-outlined flex-shrink-0"
            style={{ fontSize: '20px' }}
            aria-hidden="true"
          >
            {collapsed ? 'left_panel_open' : 'left_panel_close'}
          </span>
          {!collapsed && <span>{t.sidebarCollapse}</span>}
        </button>

        {/* Nav items, in headed sections (PAN-120). */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
          {navSections.map((section) => (
            <Fragment key={section.title}>
              {/* SideNavSection's title and optional subtitle. Hidden when
                  collapsed — a 72px rail has no room for a heading, and the
                  items keep their own accessible names there, so nothing is
                  lost but the grouping label. */}
              {!collapsed && (
                <div className="px-3 pt-3 pb-1 first:pt-0">
                  <p
                    className="text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    {section.title}
                  </p>
                  {section.subtitle && (
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                      {section.subtitle}
                    </p>
                  )}
                </div>
              )}

              {section.items.map(({ tab, href, label, icon }) => {
                /**
                 * PAN-125 — the section carries the mark when the tree cannot.
                 *
                 * Measured on production: in the collapsed default, nothing in
                 * the sidebar was marked on `/browse/<root>`, on `?sub=` or on
                 * `/product/<slug>`. The tree holds the precise mark for those
                 * routes and the tree does not render at 72px, so the state
                 * every first-time visitor starts in said nothing at all —
                 * which is the owner's "you are here" quietly not firing.
                 *
                 * Katalog now marks the section whenever the visitor is inside
                 * the catalogue and the tree is not marking something more
                 * specific. Exactly one node still claims to be current: this
                 * defers to the tree, and the tree defers to nobody.
                 */
                const isActive = href
                  ? pathname === href ||
                    (href === '/browse' && isCataloguePath(pathname) && !treeMarked)
                  : tab !== undefined && active === tab
                const itemStyle = {
                  color: isActive ? 'var(--foreground)' : 'var(--muted-foreground)',
                  backgroundColor: isActive ? 'var(--secondary)' : 'transparent',
                }
                /* `font-semibold` when selected: the icon swaps outline for
                   fill and the label gains weight, so the current item stays
                   legible with colour ignored entirely. */
                const itemClass = `flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-colors w-full text-left ${
                  isActive ? 'font-semibold' : 'font-medium'
                } ${collapsed ? 'justify-center' : ''}`

                if (href) {
                  return (
                    <Fragment key={href}>
                      {/* PAN-121 — the top-level section, announced as well as
                          painted. `isActive` has styled this item since PAN-73;
                          `aria-current` is what makes the same fact reach a
                          screen reader, and `SideNav` carried none before it.

                          PAN-120 — COLLAPSED MUST NOT MEAN NAMELESS. The visible
                          label goes away at 72px, so `aria-label` carries the
                          same string and `title` gives a pointer visitor the
                          tooltip. Every nav target keeps an accessible name in
                          both states. */}
                      <Link
                        href={href}
                        aria-current={isActive ? 'page' : undefined}
                        aria-label={collapsed ? label : undefined}
                        title={collapsed ? label : undefined}
                        className={itemClass}
                        style={itemStyle}
                      >
                        {icon(isActive)}
                        {!collapsed && <span>{label}</span>}
                      </Link>
                      {/* The catalogue hangs off the Katalog item rather than
                          under a heading of its own: the item already says
                          "Katalog" and already goes to /browse, so a second
                          label would name the same thing twice.

                          Absent when collapsed: it is a tree of Danish product
                          names and there is nowhere to put them at 72px. */}
                      {/* `CatalogueTree` reads `?sub=` to mark the current leaf,
                          and `useSearchParams` opts a statically-rendered page
                          into client rendering unless it sits behind a boundary.
                          The sidebar mounts on eight pages, several of them
                          static, so the boundary lives here rather than being
                          pushed onto every one of them. `null` is the honest
                          fallback: the tree already renders nothing until its
                          fetch resolves. */}
                      {href === '/browse' && !collapsed && (
                        <Suspense fallback={null}>
                          <CatalogueTree onMarkedChange={handleTreeMarked} />
                        </Suspense>
                      )}
                    </Fragment>
                  )
                }
                return (
                  <button
                    key={tab}
                    onClick={() => tab !== undefined && onChange?.(tab)}
                    aria-label={collapsed ? label : undefined}
                    title={collapsed ? label : undefined}
                    className={itemClass}
                    style={itemStyle}
                  >
                    {icon(isActive)}
                    {!collapsed && <span>{label}</span>}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </nav>

        {/* Bottom: theme toggle + locale toggle + logout */}
        <div className="px-3 pb-6 pt-2 border-t border-border flex flex-col gap-1">
          {/* Theme toggle */}
          <ThemeToggle collapsed={collapsed} />

          {/* Locale toggle. Two-letter codes, so they fit the collapsed rail
              without abbreviation; only the row centres. */}
          <div className={`flex gap-1 px-3 py-2 ${collapsed ? 'justify-center' : ''}`}>
            {(['da', 'en'] as Locale[]).map((l) => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className="text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors"
                style={{
                  color: locale === l ? 'var(--foreground)' : 'var(--muted-foreground)',
                  backgroundColor: locale === l ? 'var(--secondary)' : 'transparent',
                }}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Logout — only for a visitor who actually has a session to end. */}
          {authed && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium w-full text-left transition-colors hover:bg-secondary"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              {!collapsed && <span>{t.logout}</span>}
            </button>
          )}
        </div>

        {/* THE RESIZE HANDLE, IN BOTH STATES.

            It used to be rendered only while expanded, on the reasoning that
            collapsed is a mode rather than a width and a separator reporting 72
            under a minimum of 256 would be invalid. The premise was right and
            the conclusion was wrong: collapsed is only outside the range if you
            leave snapping out, and Astryx's spec lists snapping and collapse as
            one concern. With the collapsed width as `aria-valuemin`, the value
            is valid in both states — and since collapsed is the default, this is
            the difference between a visitor meeting a resizable sidebar and
            meeting one that cannot be resized until they find the expand
            button. A keyboard visitor met no separator at all. */}
        <SidebarResizeHandle
          width={resolvedWidth}
          collapsed={collapsed}
          label={t.sidebarResize}
          onResolve={applySidebarState}
        />
      </aside>
    </>
  )
}
