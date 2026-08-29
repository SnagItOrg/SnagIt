'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useLocale } from '@/components/LocaleProvider'

/**
 * Family-route error boundary.
 *
 * Stage 3 V1, WP-2.
 *
 * WHY THE ROUTE NEEDS ONE. page.tsx throws CatalogueUnavailableError when the
 * database cannot answer which children are canonical. Without a boundary that
 * throw would render the site-wide error page — but the harm it exists to
 * prevent is more specific: an unavailable lookup must never be allowed to fall
 * back to "this family has no public variants". That sentence is indistinguishable
 * from the truthful empty state, and it is exactly the empty-catalogue-as-truth
 * failure the no-store work in WP-1 was written to stop.
 *
 * So: a real error surface, a retry, and no catalogue claim of any kind.
 */
export default function FamilyError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { t } = useLocale()

  useEffect(() => {
    // Operational channel only (build plan §12.4.8): no query text, no slug
    // bound to a person, no user id, no email.
    console.error(JSON.stringify({ route: '/family/[slug]', digest: error.digest ?? null }))
  }, [error])

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
    >
      <h1 className="type-title">
        {t.errorHeading}
      </h1>

      <p className="mt-4 max-w-md text-base" style={{ color: 'var(--muted-foreground)' }}>
        {t.errorBody}
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-2xl px-6 py-3 text-base font-semibold transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          {t.errorRetry}
        </button>
        <Link
          href="/browse"
          className="rounded-2xl px-6 py-3 text-base transition-opacity hover:opacity-90"
          style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
        >
          {t.familyBackToCatalogue}
        </Link>
      </div>
    </main>
  )
}
