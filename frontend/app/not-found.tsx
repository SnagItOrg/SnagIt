'use client'

import Link from 'next/link'
import { useLocale } from '@/components/LocaleProvider'

/**
 * Branded 404.
 *
 * Stage 3 WP-1. See docs/stage-3-v1-decision-and-build-plan.md §10 and §13.1.
 *
 * Before this existed, the middleware matcher ran ahead of routing and every
 * unmatched path fell through to a 307 redirect to /login — so a mistyped URL
 * looked like a permissions problem, /sitemap.xml was treated as a protected
 * page, and crawlers were told "redirect" where the truthful answer was "gone".
 *
 * This page is also the destination for every slug the eligibility gate in
 * lib/catalogue.ts refuses: unsupported products, private products seen by an
 * anonymous visitor, and the 3,976 KG rows that were never meant to have a
 * page. It therefore must not hint at what exists behind it.
 */
export default function NotFound() {
  const { t } = useLocale()

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
    >
      <h1
        className="text-3xl md:text-4xl"
        style={{ fontFamily: '"DM Serif Display", serif' }}
      >
        {t.notFoundHeading}
      </h1>

      <p className="mt-4 max-w-md text-base" style={{ color: 'var(--muted-foreground)' }}>
        {t.notFoundBody}
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/browse"
          className="rounded-2xl px-6 py-3 text-base font-semibold transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          {t.notFoundCta}
        </Link>
        <Link
          href="/"
          className="rounded-2xl px-6 py-3 text-base transition-opacity hover:opacity-90"
          style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
        >
          {t.navHome}
        </Link>
      </div>
    </main>
  )
}
