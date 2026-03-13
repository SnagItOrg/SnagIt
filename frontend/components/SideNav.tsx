'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useLocale } from '@/components/LocaleProvider'
import type { NavTab } from '@/components/BottomNav'
import type { Locale } from '@/lib/i18n'

interface Props {
  active: NavTab
  onChange: (tab: NavTab) => void
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium w-full text-left transition-colors hover:bg-secondary"
      style={{ color: 'var(--muted-foreground)' }}
      aria-label="Toggle theme"
    >
      {resolvedTheme === 'dark'
        ? <Sun size={20} strokeWidth={1.8} />
        : <Moon size={20} strokeWidth={1.8} />
      }
      <span>{resolvedTheme === 'dark' ? 'Lystema' : 'Mørkt tema'}</span>
    </button>
  )
}

export function SideNav({ active, onChange }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const { locale, setLocale, t } = useLocale()

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  // Items with `href` are route-based (active via pathname); others are tab-based.
  const navItems: { tab?: NavTab; href?: string; label: string; icon: React.ReactNode }[] = [
    {
      tab: 'hjem',
      label: t.navHome,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
          <path d="M9 21V12h6v9" />
        </svg>
      ),
    },
    {
      href: '/watchlists',
      label: t.navWatchlists,
      icon: (
        <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>notifications</span>
      ),
    },
    {
      href: '/search',
      label: t.navSearch,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      ),
    },
    {
      href: '/saved',
      label: t.navSaved,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      tab: 'profil',
      label: t.navProfile,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      ),
    },
  ]

  return (
    <aside className="hidden md:flex flex-col w-60 fixed top-0 left-0 h-full border-r border-border bg-card z-40">
      {/* Logo */}
      <div className="px-6 py-6 border-b border-border">
        <div className="flex items-center gap-3 text-primary">
          <div className="size-8 rounded-lg flex items-center justify-center bg-primary/10 flex-shrink-0">
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>radar</span>
          </div>
          <span className="text-xl font-black tracking-tight">Klup.dk</span>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
        {navItems.map(({ tab, href, label, icon }) => {
          const isActive = href
            ? pathname === href
            : tab !== undefined && active === tab
          const itemStyle = {
            color: isActive ? 'var(--foreground)' : 'var(--muted-foreground)',
            backgroundColor: isActive ? 'var(--secondary)' : 'transparent',
          }
          const itemClass = "flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors w-full text-left"

          if (href) {
            return (
              <Link key={href} href={href} className={itemClass} style={itemStyle}>
                {icon}
                <span>{label}</span>
              </Link>
            )
          }
          return (
            <button
              key={tab}
              onClick={() => tab !== undefined && onChange(tab)}
              className={itemClass}
              style={itemStyle}
            >
              {icon}
              <span>{label}</span>
            </button>
          )
        })}
      </nav>

      {/* Bottom: theme toggle + locale toggle + logout */}
      <div className="px-3 pb-6 pt-2 border-t border-border flex flex-col gap-1">
        {/* Theme toggle */}
        <ThemeToggle />

        {/* Locale toggle */}
        <div className="flex gap-1 px-3 py-2">
          {(['da', 'en'] as Locale[]).map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className="text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors"
              style={{
                color: locale === l ? 'var(--foreground)' : 'var(--muted-foreground)',
                backgroundColor: locale === l ? 'var(--secondary)' : 'transparent',
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium w-full text-left transition-colors hover:bg-secondary"
          style={{ color: 'var(--muted-foreground)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>{t.logout}</span>
        </button>
      </div>
    </aside>
  )
}
