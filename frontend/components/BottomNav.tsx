'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useLocale } from '@/components/LocaleProvider'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

// Kept for SideNav compatibility
export type NavTab = 'hjem' | 'overvaagninger' | 'soeg' | 'gemt' | 'profil'

export function BottomNav() {
  const pathname = usePathname()
  const router   = useRouter()
  const { t }    = useLocale()
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      setAuthed(!!data.user)
    })
  }, [])

  const isHome   = pathname === '/watchlists' || pathname.startsWith('/watchlists/')
  const isSearch = pathname === '/search'
  const isSaved  = pathname === '/saved'
  const isProfil = pathname === '/profile'

  // Render nothing while auth state is resolving (avoids wrong-state flash)
  if (authed === null) return null

  // Simplified nav for unauthenticated users
  if (!authed) {
    return (
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-white/10 flex items-center justify-around px-6 pb-[env(safe-area-inset-bottom)]" style={{ minHeight: '64px' }}>
        {/* Search FAB */}
        <div className="flex flex-col items-center pb-1">
          <Link
            href="/search"
            className="w-14 h-14 -mt-7 rounded-full bg-primary flex items-center justify-center shadow-lg glow-primary transition-transform active:scale-95"
            aria-label={t.navSearch}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--background)' }}>
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </Link>
          <span className="text-[11px] font-medium mt-0.5" style={{ color: 'var(--foreground)' }}>
            {t.navSearch}
          </span>
        </div>

        {/* Kom i gang */}
        <button
          onClick={() => router.push('/signup')}
          className="text-sm font-bold transition-opacity hover:opacity-80"
          style={{ color: 'var(--foreground)' }}
        >
          {t.getStarted}
        </button>
      </nav>
    )
  }

  // Full nav for authenticated users
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-white/10 flex items-end justify-around px-2 pb-[env(safe-area-inset-bottom)] min-h-[56px]">
      {/* Home */}
      <NavItem
        label={t.navHome}
        active={isHome}
        href="/watchlists"
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
            <path d="M9 21V12h6v9" />
          </svg>
        }
      />

      {/* Search FAB — elevated centre button */}
      <div className="relative flex flex-col items-center pb-3">
        <Link
          href="/search"
          className="w-14 h-14 -mt-7 rounded-full bg-primary flex items-center justify-center shadow-lg glow-primary transition-transform active:scale-95"
          aria-label={t.navSearch}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--background)' }}>
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </Link>
        <span
          className="text-[11px] font-medium mt-0.5"
          style={{ color: isSearch ? 'var(--foreground)' : 'var(--muted-foreground)' }}
        >
          {t.navSearch}
        </span>
      </div>

      {/* Saved */}
      <NavItem
        label={t.navSaved}
        active={isSaved}
        href="/saved"
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        }
      />

      {/* Profile */}
      <NavItem
        label={t.navProfile}
        active={isProfil}
        href="/profile"
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        }
      />
    </nav>
  )
}

function NavItem({
  label,
  active,
  icon,
  href,
}: {
  label: string
  active: boolean
  icon: React.ReactNode
  href?: string
}) {
  const color     = active ? 'var(--foreground)' : 'var(--muted-foreground)'
  const className = "flex flex-col items-center justify-center gap-0.5 min-w-[48px] min-h-[48px] py-2 px-2 transition-colors"

  if (href) {
    return (
      <Link href={href} className={className} style={{ color }} aria-label={label}>
        {icon}
        <span className="text-[11px] font-medium leading-none">{label}</span>
      </Link>
    )
  }

  return (
    <div className={className} style={{ color }} aria-label={label}>
      {icon}
      <span className="text-[11px] font-medium leading-none">{label}</span>
    </div>
  )
}
