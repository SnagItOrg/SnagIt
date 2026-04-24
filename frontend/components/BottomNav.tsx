'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { useLocale } from '@/components/LocaleProvider'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

// Kept for SideNav compatibility
export type NavTab = 'hjem' | 'overvaagninger' | 'soeg' | 'gemt' | 'profil'

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <div className="min-w-[48px] min-h-[48px]" />

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="flex flex-col items-center justify-center gap-0.5 min-w-[48px] min-h-[48px] py-2 px-2 transition-colors"
      style={{ color: 'var(--muted-foreground)' }}
      aria-label="Toggle theme"
    >
      {resolvedTheme === 'dark'
        ? <Sun size={22} strokeWidth={1.8} />
        : <Moon size={22} strokeWidth={1.8} />
      }
      <span className="text-[11px] font-medium leading-none">
        {resolvedTheme === 'dark' ? 'Lys' : 'Mørk'}
      </span>
    </button>
  )
}

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

  const isSearch        = pathname === '/search'
  const isSaved         = pathname === '/saved'
  const isNotifications = pathname === '/watchlists' || pathname.startsWith('/watchlists/')
  const isProfil        = pathname === '/profile'
  const isBrowse        = pathname === '/browse' || pathname.startsWith('/browse/')

  // Render nothing while auth state is resolving (avoids wrong-state flash)
  if (authed === null) return null

  // Simplified nav for unauthenticated users
  if (!authed) {
    return (
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border flex items-center justify-around px-4 pb-[env(safe-area-inset-bottom)]" style={{ minHeight: '64px' }}>
        {/* Search FAB */}
        <div className="flex flex-col items-center pb-1">
          <Link
            href="/search"
            className="w-14 h-14 -mt-7 rounded-full bg-primary flex items-center justify-center shadow-lg glow-primary transition-transform active:scale-95"
            aria-label={t.navSearch}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--primary-foreground)' }}>
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </Link>
          <span className="text-[11px] font-medium mt-0.5" style={{ color: 'var(--foreground)' }}>
            {t.navSearch}
          </span>
        </div>

        {/* Browse */}
        <NavItem
          label={t.navBrowse}
          active={isBrowse}
          href="/browse"
          icon={<span className="material-symbols-outlined" style={{ fontSize: '24px' }}>grid_view</span>}
        />

        {/* Theme toggle */}
        <ThemeToggle />

        {/* Kom i gang */}
        <button
          onClick={() => router.push('/signup')}
          className="text-sm font-bold whitespace-nowrap min-h-[44px] flex items-center transition-opacity hover:opacity-80"
          style={{ color: 'var(--foreground)' }}
        >
          {t.getStarted}
        </button>
      </nav>
    )
  }

  // Full nav for authenticated users
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border flex items-end justify-around px-2 pb-[env(safe-area-inset-bottom)] min-h-[56px]">
      {/* Search FAB — elevated centre button */}
      <div className="relative flex flex-col items-center pb-3">
        <Link
          href="/search"
          className="w-14 h-14 -mt-7 rounded-full bg-primary flex items-center justify-center shadow-lg glow-primary transition-transform active:scale-95"
          aria-label={t.navSearch}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--primary-foreground)' }}>
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

      {/* Browse */}
      <NavItem
        label={t.navBrowse}
        active={isBrowse}
        href="/browse"
        icon={<span className="material-symbols-outlined" style={{ fontSize: '24px' }}>grid_view</span>}
      />

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

      {/* Notifications (watchlists) */}
      <NavItem
        label={t.navNotifications}
        active={isNotifications}
        href="/watchlists"
        icon={
          <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>notifications</span>
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
