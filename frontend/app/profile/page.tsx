'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { useLocale } from '@/components/LocaleProvider'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

export default function ProfilePage() {
  const router = useRouter()
  const { t } = useLocale()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      setAuthed(!!data.user)
      setEmail(data.user?.email ?? null)
    })
  }, [])

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/signup')
  }

  return (
    <div className="min-h-screen bg-bg text-white flex">
      <SideNav active="profil" onChange={() => {}} />

      <main className="flex-1 md:pl-60 flex flex-col items-center justify-center px-6 pb-24 md:pb-6">
        {authed === false ? (
          /* Teaser for unauthenticated visitors */
          <div className="w-full max-w-sm flex flex-col items-center gap-4 text-center">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '72px', color: 'var(--muted-foreground)' }}
            >
              person
            </span>
            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-black text-white">{t.profileTeaserHeading}</h2>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
                {t.profileTeaserSubtext}
              </p>
            </div>
            <button
              onClick={() => router.push('/signup')}
              className="w-full rounded-2xl py-4 px-8 font-black text-sm transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {t.savedTeaserCta}
            </button>
          </div>
        ) : authed ? (
          <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
            {/* Icon */}
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '72px', color: 'var(--muted-foreground)' }}
            >
              person
            </span>

            {/* Email */}
            {email && (
              <p className="text-base font-semibold" style={{ color: '#f1f5f9' }}>
                {email}
              </p>
            )}

            {/* Coming soon */}
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {t.profileComingSoon}
            </p>

            {/* Sign out */}
            <button
              onClick={handleSignOut}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-colors border border-white/10 hover:border-red-500/30 hover:text-red-400"
              style={{ color: 'rgba(255,255,255,0.6)' }}
            >
              {t.signOut}
            </button>
          </div>
        ) : null}
      </main>

      <BottomNav />
    </div>
  )
}
