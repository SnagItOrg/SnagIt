'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { useLocale } from '@/components/LocaleProvider'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

export default function SavedPage() {
  const router = useRouter()
  const { t } = useLocale()
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      setAuthed(!!data.user)
    })
  }, [])

  return (
    <div className="min-h-screen bg-bg text-white flex">
      <SideNav active="gemt" onChange={() => {}} />

      <main className="flex-1 md:pl-60 flex flex-col items-center justify-center px-6 pb-24 md:pb-6">
        {authed === false ? (
          /* Teaser for unauthenticated visitors */
          <div className="w-full max-w-sm flex flex-col gap-4">
            {/* Blurred card — visible above CTA */}
            <div className="pointer-events-none select-none opacity-60" style={{ filter: 'blur(3px)' }}>
              <FakeSavedCard />
            </div>

            {/* CTA section below — not an overlay */}
            <div
              className="rounded-2xl p-6 flex flex-col gap-3 text-center"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <h2 className="text-xl font-black text-white">{t.savedTeaserHeading}</h2>
              <button
                onClick={() => router.push('/login')}
                className="w-full rounded-2xl py-4 px-8 font-black text-sm transition-opacity hover:opacity-90"
                style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-bg)' }}
              >
                {t.savedTeaserCta}
              </button>
            </div>
          </div>
        ) : (
          /* Empty state for authenticated users with no saved listings */
          <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '72px', color: 'rgba(19,236,109,0.4)' }}
            >
              bookmark
            </span>

            <h1 className="text-xl font-bold" style={{ color: '#f1f5f9' }}>
              {t.noSavedListings}
            </h1>

            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {t.noSavedListingsSubtext}
            </p>

            <button
              onClick={() => router.push('/search')}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-colors bg-primary text-bg hover:bg-primary/90"
            >
              {t.goToSearch}
            </button>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  )
}

function FakeSavedCard() {
  return (
    <div className="flex gap-3 p-3 rounded-2xl bg-surface border border-white/10">
      {/* Thumbnail */}
      <div className="flex-shrink-0 w-20 h-20 rounded-lg bg-white/5 flex items-center justify-center">
        <span
          className="material-symbols-outlined"
          style={{ fontSize: '28px', color: 'var(--color-text-muted)' }}
        >
          piano
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col gap-1">
        <p className="text-sm font-semibold text-text">Roland Juno-106</p>
        <p className="text-base font-black" style={{ color: 'var(--color-primary)' }}>4.500 kr</p>
        <p className="text-[11px]" style={{ color: '#475569' }}>
          Typisk 4.200–5.800 kr
        </p>
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: '#64748b' }}>
          <span className="px-1.5 py-0.5 rounded bg-white/5">dba.dk</span>
          <span>·</span>
          <span>3t siden</span>
          <span>·</span>
          <span>København</span>
        </div>
        {/* Fake CTA row */}
        <div className="flex gap-2 mt-1">
          <div
            className="px-3 py-1.5 rounded-xl text-xs font-semibold"
            style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-bg)' }}
          >
            Gem annonce
          </div>
        </div>
      </div>
    </div>
  )
}
