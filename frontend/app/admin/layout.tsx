'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SkipLink } from '@/components/SkipLink'
import { Icon } from '@/components/Icon'
import { useLocale } from '@/components/LocaleProvider'
import type { translations } from '@/lib/i18n'

type AdminNavKey = keyof (typeof translations)['da']['adminNav']

type AdminNavItem = {
  href: string
  label: AdminNavKey
  icon: string
  /** A further path prefix this tool owns, e.g. the per-product pages. */
  also?: string
}

/**
 * PAN-171 — EVERY ADMIN TOOL, IN ONE LIST. A new tool is one line here; the
 * desktop sidebar and the mobile menu both render from it.
 *
 * Grouped the way Astryx's `SideNavSection` groups: a titled `role="group"`
 * per section. `/admin/product/new` and `/admin/product/[slug]` are not items
 * of their own — they are reached from Produkter, and mark it as current.
 * Intel lives at `/intel`, outside this layout, and has its own header back.
 */
const ADMIN_NAV: { title: AdminNavKey; items: AdminNavItem[] }[] = [
  {
    title: 'sectionCatalogue',
    items: [
      { href: '/admin/products', label: 'products', icon: 'workspace_premium', also: '/admin/product' },
      { href: '/admin/families/propose', label: 'families', icon: 'account_tree' },
      { href: '/admin/images', label: 'images', icon: 'image' },
      { href: '/admin/msrp', label: 'msrp', icon: 'sell' },
      { href: '/admin/cleanup', label: 'cleanup', icon: 'mop' },
    ],
  },
  {
    title: 'sectionReview',
    items: [
      { href: '/admin/suggestions', label: 'suggestions', icon: 'lightbulb' },
      { href: '/admin/suggestions/bulk', label: 'suggestionsBulk', icon: 'auto_awesome' },
      { href: '/admin/match', label: 'match', icon: 'link' },
    ],
  },
  {
    title: 'sectionMarket',
    items: [
      { href: '/admin/demand', label: 'demand', icon: 'manage_search' },
      { href: '/intel', label: 'intel', icon: 'monitoring' },
    ],
  },
  {
    title: 'sectionAccess',
    items: [{ href: '/admin/users', label: 'users', icon: 'group' }],
  },
]

const within = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`)

/**
 * The ONE current item: the longest prefix that contains the path. The old
 * `startsWith` per item marked both Forslag and Bulk review on
 * `/admin/suggestions/bulk`.
 */
function currentItem(pathname: string): AdminNavItem | null {
  let best: AdminNavItem | null = null
  let bestLength = -1
  for (const section of ADMIN_NAV) {
    for (const item of section.items) {
      for (const prefix of [item.href, item.also]) {
        if (prefix && within(pathname, prefix) && prefix.length > bestLength) {
          best = item
          bestLength = prefix.length
        }
      }
    }
  }
  return best
}

/**
 * The sections and the pinned way back to the site. The current item is
 * `--here` plus a weight step and a filled icon, the same mark `SideNav` uses,
 * so it survives grayscale. Rows get no fill at rest.
 */
function AdminNavBody({
  current,
  idPrefix,
  onNavigate,
}: {
  current: AdminNavItem | null
  /** Two copies can be in the DOM (desktop and mobile), so ids are prefixed. */
  idPrefix: string
  onNavigate?: () => void
}) {
  const { t } = useLocale()
  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4 flex flex-col gap-4">
        {ADMIN_NAV.map((section) => (
          <div
            key={section.title}
            role="group"
            aria-labelledby={`${idPrefix}-${section.title}`}
            className="flex flex-col gap-1"
          >
            <p
              id={`${idPrefix}-${section.title}`}
              className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
            >
              {t.adminNav[section.title]}
            </p>
            {section.items.map((item) => {
              const isCurrent = item === current
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors ${
                    isCurrent ? 'font-semibold' : 'font-medium text-ink-secondary hover:underline underline-offset-2'
                  }`}
                  style={isCurrent ? { color: 'var(--here)', backgroundColor: 'var(--here-subtle)' } : undefined}
                >
                  <Icon
                    name={item.icon}
                    className="flex-shrink-0"
                    style={{ fontSize: '20px', fontVariationSettings: isCurrent ? "'FILL' 1" : "'FILL' 0" }}
                  />
                  {t.adminNav[item.label]}
                </Link>
              )
            })}
          </div>
        ))}
      </div>

      {/* Pinned bottom zone: the way back to the public site. */}
      <div className="shrink-0 px-3 py-3 border-t border-line">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-ink-secondary hover:underline underline-offset-2"
        >
          <Icon name="arrow_back" className="flex-shrink-0" style={{ fontSize: '20px' }} />
          {t.adminNav.backToSite}
        </Link>
      </div>
    </>
  )
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { t } = useLocale()
  const [menuOpen, setMenuOpen] = useState(false)
  const current = currentItem(pathname)

  const lockup = (
    <Link href="/admin" className="flex items-center gap-2 text-ink">
      <Icon name="admin_panel_settings" style={{ fontSize: '20px' }} />
      <span className="text-lg font-black tracking-tight">{t.navAdmin}</span>
    </Link>
  )

  return (
    <div className="min-h-screen bg-bg text-foreground flex">
      <SkipLink />

      {/* Sidebar */}
      <aside
        className="hidden md:flex flex-col w-56 fixed top-0 left-0 h-full z-40"
        style={{ backgroundColor: 'var(--card)', borderRight: '1px solid var(--border)' }}
      >
        <div className="px-5 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
          {lockup}
        </div>
        <nav aria-label={t.adminNav.navLabel} className="flex-1 min-h-0 flex flex-col">
          <AdminNavBody current={current} idPrefix="admin-nav" />
        </nav>
      </aside>

      {/* Mobile: a top bar that names where you are, and the same list behind a
          menu button (Astryx's drawer mode) instead of nine links in a row. */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40" style={{ backgroundColor: 'var(--card)' }}>
        <div className="flex items-center gap-3 px-4 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
          {lockup}
          {current && (
            <span className="min-w-0 truncate text-sm text-ink-secondary">{t.adminNav[current.label]}</span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="admin-mobile-nav"
            aria-label={menuOpen ? t.adminNav.menuClose : t.adminNav.menuOpen}
            className="flex items-center justify-center size-10 rounded-xl text-ink-secondary hover:bg-secondary"
          >
            <Icon name={menuOpen ? 'close' : 'menu'} style={{ fontSize: '24px' }} />
          </button>
        </div>
        {menuOpen && (
          <nav
            id="admin-mobile-nav"
            aria-label={t.adminNav.navLabel}
            className="flex flex-col max-h-[calc(100dvh-57px)] border-b shadow-overlay"
            style={{ borderColor: 'var(--border)' }}
          >
            <AdminNavBody current={current} idPrefix="admin-mobile-nav" onNavigate={() => setMenuOpen(false)} />
          </nav>
        )}
      </div>

      {/* Content */}
      <main id="main-content" className="flex-1 md:pl-56 pt-14 md:pt-0">
        <div className="px-4 py-6 md:px-8 md:py-8 max-w-5xl">
          {children}
        </div>
      </main>
    </div>
  )
}
