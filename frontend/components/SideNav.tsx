'use client'

import { Fragment, useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useLocale } from '@/components/LocaleProvider'
import { categoryLabel } from '@/lib/category-labels'
import type { NavTab } from '@/components/BottomNav'
import type { Locale } from '@/lib/i18n'
import type { CatalogueTreeCategory } from '@/lib/catalogue-tree'

interface Props {
  active: NavTab
  onChange: (tab: NavTab) => void
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium w-full text-left transition-colors hover:bg-secondary"
      style={{ color: 'var(--muted-foreground)' }}
      aria-label="Toggle theme"
    >
      {resolvedTheme === 'dark'
        ? <Sun size={20} strokeWidth={1.8} />
        : <Moon size={20} strokeWidth={1.8} />
      }
      <span>{resolvedTheme === 'dark' ? 'Lystema' : 'Mørkt tema'}</span>
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
function CatalogueTree() {
  const { t, locale } = useLocale()
  const pathname = usePathname()
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

  if (categories.length === 0) return null

  return (
    <div className="mt-0.5 mb-1 flex flex-col gap-0.5">
      {categories.map((category) => {
        const label = categoryLabel(
          category.slug,
          locale,
          locale === 'da' ? category.name_da : category.name_en,
        )

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
                 px-3/gap-3/20px: at w-60 the longest Danish root label
                 ("Western- & akustiske guitarer") needs every pixel before the
                 truncation, and a branch label that cannot be read is worse
                 navigation than one sitting 10px left of the item above it. */
              className="flex items-center gap-1.5 pl-3 pr-2 py-2 rounded-xl text-[13px] font-medium cursor-pointer list-none [&::-webkit-details-marker]:hidden transition-colors hover:bg-secondary"
              style={{ color: 'var(--muted-foreground)' }}
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
                return (
                  <li key={sub.slug}>
                    {/* A subcategory is a grouping label, not a destination:
                        `/browse/<root>` filters by subcategory in client state
                        rather than in the URL, so there is no honest href to
                        give this row today. */}
                    <p
                      className="pl-10 pr-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide truncate"
                      style={{ color: 'var(--muted-foreground)' }}
                      title={subLabel}
                    >
                      {subLabel}
                    </p>
                    <ul className="flex flex-col">
                      {sub.products.map((product) => {
                        const href = `/product/${product.slug}`
                        const isHere = pathname === href
                        return (
                          <li key={product.slug}>
                            <Link
                              href={href}
                              className="block pl-10 pr-3 py-1.5 rounded-lg text-xs truncate transition-colors hover:bg-secondary"
                              style={{
                                color: isHere ? 'var(--foreground)' : 'var(--muted-foreground)',
                                backgroundColor: isHere ? 'var(--secondary)' : 'transparent',
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
                            {t.catalogueTreeSeeAll.replace('{count}', String(sub.product_count))}
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

export function SideNav({ active, onChange }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const { locale, setLocale, t } = useLocale()

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  // Items with `href` are route-based (active via pathname); others are tab-based.
  const navItems: { tab?: NavTab; href?: string; label: string; icon: React.ReactNode }[] = [
    {
      href: '/search',
      label: t.navSearch,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      ),
    },
    {
      href: '/browse',
      label: t.navBrowse,
      icon: (
        <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>grid_view</span>
      ),
    },
    {
      href: '/saved',
      label: t.navSaved,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      href: '/watchlists',
      label: t.navNotifications,
      icon: (
        <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>notifications</span>
      ),
    },
    {
      href: '/profile',
      label: t.navProfile,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      ),
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

      <aside className="hidden md:flex flex-col w-60 fixed top-0 left-0 h-full border-r border-border bg-card z-40">
        {/* Logo — also the way home (PAN-67) */}
        <Link href="/" className="block px-6 py-6 border-b border-border">
          <div className="flex items-center gap-3 text-primary">
            <div className="size-8 rounded-lg flex items-center justify-center bg-primary/10 flex-shrink-0">
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>radar</span>
            </div>
            <span className="text-lg font-semibold tracking-tight">Klup.dk</span>
          </div>
        </Link>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
          {navItems.map(({ tab, href, label, icon }) => {
            const isActive = href
              ? pathname === href
              : tab !== undefined && active === tab
            const itemStyle = {
              color: isActive ? 'var(--foreground)' : 'var(--muted-foreground)',
              backgroundColor: isActive ? 'var(--secondary)' : 'transparent',
            }
            const itemClass = "flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors w-full text-left"

            if (href) {
              return (
                <Fragment key={href}>
                  <Link href={href} className={itemClass} style={itemStyle}>
                    {icon}
                    <span>{label}</span>
                  </Link>
                  {/* The catalogue hangs off the Katalog item rather than
                      under a heading of its own: the item already says
                      "Katalog" and already goes to /browse, so a second label
                      would name the same thing twice. */}
                  {href === '/browse' && <CatalogueTree />}
                </Fragment>
              )
            }
            return (
              <button
                key={tab}
                onClick={() => tab !== undefined && onChange(tab)}
                className={itemClass}
                style={itemStyle}
              >
                {icon}
                <span>{label}</span>
              </button>
            )
          })}
        </nav>

        {/* Bottom: theme toggle + locale toggle + logout */}
        <div className="px-3 pb-6 pt-2 border-t border-border flex flex-col gap-1">
          {/* Theme toggle */}
          <ThemeToggle />

          {/* Locale toggle */}
          <div className="flex gap-1 px-3 py-2">
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

          {/* Logout */}
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
            <span>{t.logout}</span>
          </button>
        </div>
      </aside>
    </>
  )
}
