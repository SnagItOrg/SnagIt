'use client'

import Link from 'next/link'
import { useLocale } from '@/components/LocaleProvider'

/**
 * /konto-slettet — PAN-277, the receipt after "Slet konto".
 *
 * Public: by the time the visitor lands here the account and its session are
 * gone. It says only that the deletion happened, so it reveals nothing to
 * anyone who opens the URL directly.
 */
export default function AccountDeletedPage() {
  const { t } = useLocale()

  return (
    <main
      id="main-content"
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
    >
      <h1
        className="text-3xl md:text-4xl"
        style={{ fontFamily: 'var(--font-dm-serif), "DM Serif Display", serif' }}
      >
        {t.accountDeletedHeading}
      </h1>

      <p className="mt-4 max-w-md text-base" style={{ color: 'var(--muted-foreground)' }}>
        {t.accountDeletedBody}
      </p>

      <Link href="/" className="button-primary mt-8 rounded-2xl px-6 py-3 text-base font-semibold">
        {t.accountDeletedHome}
      </Link>
    </main>
  )
}
