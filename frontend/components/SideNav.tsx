'use client'

import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useLocale } from '@/components/LocaleProvider'
import type { NavTab } from '@/components/BottomNav'
import type { Locale } from '@/lib/i18n'

interface Props {
  active: NavTab
  onChange: (tab: NavTab) => void
}

export function SideNav({ active, onChange }: Props) {
  const router = useRouter()
  const { locale, setLocale, t } = useLocale()

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const navItems: { tab: NavTab; label: string; icon: React.ReactNode }[] = [
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
      tab: 'overvaagninger',
      label: t.navWatch,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ),
    },
    {
      tab: 'soeg',
      label: t.navSearch,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      ),
    },
    {
      tab: 'gemt',
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
    <aside className="hidden md:flex flex-col w-60 fixed top-0 left-0 h-full border-r border-white/10 bg-surface z-40">
      {/* Logo */}
      <div className="px-6 py-6 border-b border-white/10">
        <span className="text-xl font-bold tracking-tight text-primary">Klup</span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
        {navItems.map(({ tab, label, icon }) => {
          const isActive = active === tab
          return (
            <button
              key={tab}
              onClick={() => onChange(tab)}
              className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors w-full text-left"
              style={{
                color: isActive ? 'var(--color-primary)' : 'rgba(255,255,255,0.6)',
                backgroundColor: isActive ? 'rgba(19,236,109,0.08)' : 'transparent',
              }}
            >
              {icon}
              <span>{label}</span>
            </button>
          )
        })}
      </nav>

      {/* Bottom: locale toggle + logout */}
      <div className="px-3 pb-6 pt-2 border-t border-white/10 flex flex-col gap-1">
        {/* Locale toggle */}
        <div className="flex gap-1 px-3 py-2">
          {(['da', 'en'] as Locale[]).map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className="text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors"
              style={{
                color: locale === l ? 'var(--color-primary)' : 'rgba(255,255,255,0.4)',
                backgroundColor: locale === l ? 'rgba(19,236,109,0.1)' : 'transparent',
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium w-full text-left transition-colors hover:bg-white/5"
          style={{ color: 'rgba(255,255,255,0.4)' }}
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
