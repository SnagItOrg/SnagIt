'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/admin/users', label: 'Brugere', icon: 'group' },
  { href: '/admin/products', label: 'Produkter', icon: 'workspace_premium' },
  { href: '/admin/suggestions', label: 'Forslag', icon: 'lightbulb' },
  { href: '/admin/suggestions/bulk', label: 'Bulk review', icon: 'auto_awesome' },
  { href: '/admin/match', label: 'Match', icon: 'link' },
  { href: '/admin/msrp', label: 'MSRP', icon: 'sell' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-bg text-foreground flex">
      {/* Sidebar */}
      <aside
        className="hidden md:flex flex-col w-56 fixed top-0 left-0 h-full z-40"
        style={{ backgroundColor: 'var(--card)', borderRight: '1px solid var(--border)' }}
      >
        <div className="px-5 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <Link href="/admin/users" className="flex items-center gap-2">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '20px', color: 'var(--primary)' }}
            >
              admin_panel_settings
            </span>
            <span className="text-lg font-black tracking-tight" style={{ color: 'var(--foreground)' }}>
              Admin
            </span>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
          {links.map(({ href, label, icon }) => {
            const active = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
                style={{
                  color: active ? 'var(--foreground)' : 'var(--muted-foreground)',
                  backgroundColor: active ? 'var(--secondary)' : 'transparent',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{icon}</span>
                {label}
              </Link>
            )
          })}
        </nav>

        <div className="px-3 pb-5 border-t" style={{ borderColor: 'var(--border)' }}>
          <Link
            href="/watchlists"
            className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors hover:bg-secondary mt-2"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>arrow_back</span>
            Tilbage til Klup
          </Link>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center gap-3 px-4 py-3"
        style={{ backgroundColor: 'var(--card)', borderBottom: '1px solid var(--border)' }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--primary)' }}>
          admin_panel_settings
        </span>
        <span className="text-base font-bold" style={{ color: 'var(--foreground)' }}>Admin</span>
        <div className="flex-1" />
        {links.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="text-sm font-medium px-2 py-1 rounded-lg"
            style={{
              color: pathname.startsWith(href) ? 'var(--foreground)' : 'var(--muted-foreground)',
              backgroundColor: pathname.startsWith(href) ? 'var(--secondary)' : 'transparent',
            }}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* Content */}
      <main className="flex-1 md:pl-56 pt-14 md:pt-0">
        <div className="px-4 py-6 md:px-8 md:py-8 max-w-5xl">
          {children}
        </div>
      </main>
    </div>
  )
}
