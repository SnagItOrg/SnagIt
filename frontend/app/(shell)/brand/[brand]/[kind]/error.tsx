'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useLocale } from '@/components/LocaleProvider'
import { Button } from '@/components/Button'

/**
 * Brand-wall error boundary — PAN-271, the family route's for the same
 * reason: lib/brand-wall.ts throws CatalogueUnavailableError when the
 * database cannot answer, and that throw must never fall back to "no active
 * listings", a sentence indistinguishable from the truthful empty state.
 */
export default function BrandWallError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { t } = useLocale()

  useEffect(() => {
    // Operational channel only: no query text, no user id, no email.
    console.error(JSON.stringify({ route: '/brand/[brand]/[kind]', digest: error.digest ?? null }))
  }, [error])

  return (
    <main
      id="main-content"
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
    >
      <h1 className="type-title">{t.errorHeading}</h1>
      <p className="mt-4 max-w-md text-base" style={{ color: 'var(--muted-foreground)' }}>
        {t.errorBody}
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" onClick={reset} className="rounded-2xl px-6 py-3 text-base font-semibold">
          {t.errorRetry}
        </Button>
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
