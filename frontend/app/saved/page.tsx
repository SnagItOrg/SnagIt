'use client'

import { useRouter } from 'next/navigation'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { useLocale } from '@/components/LocaleProvider'

export default function SavedPage() {
  const router = useRouter()
  const { t } = useLocale()

  return (
    <div className="min-h-screen bg-bg text-white flex">
      <SideNav active="gemt" onChange={() => {}} />

      <main className="flex-1 md:pl-60 flex flex-col items-center justify-center px-6 pb-24 md:pb-6">
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
      </main>

      <BottomNav />
    </div>
  )
}
