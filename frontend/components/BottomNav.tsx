'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { useLocale } from '@/components/LocaleProvider'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { Icon } from '@/components/Icon'
import { track } from '@/lib/analytics'

// Kept for SideNav compatibility
export type NavTab = 'hjem' | 'overvaagninger' | 'soeg' | 'gemt' | 'profil'

function ThemeToggle() {
  const { t } = useLocale()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <div className="min-w-[48px] min-h-[48px]" />

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="flex flex-col items-center justify-center gap-0.5 min-w-[48px] min-h-[48px] py-2 px-2 transition-colors"
      style={{ color: 'var(--muted-foreground)' }}
      aria-label={t.toggleTheme}
    >
      {resolvedTheme === 'dark'
        ? <Sun size={22} strokeWidth={1.8} />
        : <Moon size={22} strokeWidth={1.8} />
      }
      <span className="text-[11px] font-medium leading-none">
        {resolvedTheme === 'dark' ? t.themeToLightShort : t.themeToDarkShort}
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
    // PAN-300: a 6-digit code signs the visitor in on the page they are on
    // (a card, the product page), so the nav must follow without a reload.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(!!session?.user)
    })
    return () => subscription.subscription.unsubscribe()
  }, [])

  const isSaved         = pathname === '/saved'
  const isNotifications = pathname === '/watchlists' || pathname.startsWith('/watchlists/')
  const isProfil        = pathname === '/profile'
  // PAN-308: Søg and Katalog are one tab. Search results are the catalogue
  // searched, so the Katalog tab is the mark there too.
  const isBrowse        = pathname === '/browse' || pathname.startsWith('/browse/') || pathname === '/search'
  const isPriceCheck    = pathname === '/tjek-prisen'

  // Render nothing while auth state is resolving (avoids wrong-state flash)
  if (authed === null) return null

  // PAN-308 — the DBA price check takes the slot Søg left. Same on both navs.
  const browse = (
    <NavItem
      label={t.navBrowse}
      active={isBrowse}
      href="/browse"
      icon={<Icon name="grid_view" style={{ fontSize: '24px' }} />}
    />
  )
  const priceCheck = (
    <NavItem
      label={t.navPriceCheckShort}
      active={isPriceCheck}
      href="/tjek-prisen"
      onClick={() => track('price_check_entry_clicked', { surface: 'bottomnav' })}
      icon={<Icon name="sell" style={{ fontSize: '24px' }} />}
    />
  )

  // Simplified nav for unauthenticated users
  if (!authed) {
    return (
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border flex items-center justify-around px-4 pb-[env(safe-area-inset-bottom)]" style={{ minHeight: '64px' }}>
        {browse}
        {priceCheck}

        {/* Theme toggle */}
        <ThemeToggle />

        {/* Kom i gang */}
        <button
          onClick={() => router.push('/login')}
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
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border flex items-center justify-around px-2 pb-[env(safe-area-inset-bottom)] min-h-[56px]">
      {browse}
      {priceCheck}

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
          <Icon name="notifications" style={{ fontSize: '24px' }} />
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
  onClick,
}: {
  label: string
  active: boolean
  icon: React.ReactNode
  href?: string
  onClick?: () => void
}) {
  // PAN-121 — the active tab is where the visitor IS: `--here`, plus a weight
  // step so it survives grayscale. On a phone this is the only nav mark there is.
  const color     = active ? 'var(--here)' : 'var(--muted-foreground)'
  const className = "flex flex-col items-center justify-center gap-0.5 min-w-[48px] min-h-[48px] py-2 px-2 transition-colors"
  const labelClass = `text-[11px] leading-none ${active ? 'font-semibold' : 'font-medium'}`

  if (href) {
    return (
      <Link href={href} className={className} style={{ color }} aria-label={label} onClick={onClick}>
        {icon}
        <span className={labelClass}>{label}</span>
      </Link>
    )
  }

  return (
    <div className={className} style={{ color }} aria-label={label}>
      {icon}
      <span className={labelClass}>{label}</span>
    </div>
  )
}
