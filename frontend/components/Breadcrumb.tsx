'use client'

import Link from 'next/link'
import { Children, Fragment, isValidElement, type ReactNode } from 'react'

import { useLocale } from '@/components/LocaleProvider'

/**
 * ONE CRUMB — a link when `href` is given, the current page when it is not.
 *
 * THERE IS NO `isCurrent` PROP, and that is the one deliberate departure from
 * the Astryx component this was read from (PAN-111 settled option B: read it,
 * do not import it). Astryx's `BreadcrumbItem` carries `href` AND `isCurrent`,
 * which lets a caller author `href` and `isCurrent` together — a current page
 * that is a link to itself, the single thing the accessibility rule forbids.
 * Deriving "current" from the absence of `href` makes that state
 * unrepresentable rather than merely discouraged, and neither call site has a
 * use for the other combination Astryx's two props allow: a non-link ancestor.
 *
 * `onClick` and `startIcon` are likewise absent because no crumb on this site
 * needs them. They are one prop away if one ever does.
 *
 * TRUNCATION IS ASYMMETRIC, on purpose. An ancestor truncates; the current
 * page never does. `Western- & akustiske guitarer` is the longest Danish root
 * label, and on /browse/[root] it IS the current page — so it wraps in full at
 * 320px instead of being cut. As an ancestor elsewhere it is allowed to clip,
 * because the page you are ON must always be readable in full.
 */
export function BreadcrumbItem({
  href,
  children,
}: {
  href?: string
  children: ReactNode
}) {
  if (href === undefined) {
    return (
      <li aria-current="page" className="wrap-anywhere font-medium" style={{ color: 'var(--here)' }}>
        {children}
      </li>
    )
  }

  return (
    <li className="min-w-0">
      <Link
        href={href}
        className="block max-w-[14rem] truncate underline underline-offset-2 transition-colors hover:text-foreground"
      >
        {children}
      </Link>
    </li>
  )
}

/**
 * The breadcrumb trail: a labelled landmark wrapping an ordered list.
 *
 * THE SEPARATOR IS INJECTED HERE, never authored by a call site. Both of the
 * hand-rolled breadcrumbs this replaces wrote their own "/" — one of them as a
 * bare `<span>` that a screen reader announced as content. Putting it between
 * items here means `aria-hidden` cannot be forgotten, because there is no
 * longer anywhere to forget it.
 *
 * Green is exhaustive and a breadcrumb is not one of the three permitted uses.
 * The current page takes `--here`, the one "you are here" colour (PAN-121),
 * plus a weight step so it survives grayscale; the ancestors stay muted and
 * underlined, which is what marks them as links.
 */
export function Breadcrumb({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const { t } = useLocale()
  const items = Children.toArray(children).filter(isValidElement)

  if (items.length === 0) return null

  return (
    <nav aria-label={t.breadcrumbLabel} className={className}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 type-meta text-muted-foreground">
        {items.map((item, index) => (
          <Fragment key={index}>
            {index > 0 && <li aria-hidden="true">/</li>}
            {item}
          </Fragment>
        ))}
      </ol>
    </nav>
  )
}
