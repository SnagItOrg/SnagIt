'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import type { Watchlist } from '@/lib/supabase'
import { useLocale } from '@/components/LocaleProvider'

function getDisplayName(query: string): string {
  if (!query.startsWith('http')) return query
  try {
    const url = new URL(query)
    const param = url.searchParams.get('q')
    if (param) return param
  } catch {
    // not a valid URL — fall through
  }
  return query
}

interface Props {
  watchlist: Watchlist
  onDelete: (id: string) => void
}

export function WatchlistBentoCard({ watchlist, onDelete }: Props) {
  const router = useRouter()
  const { t } = useLocale()
  const displayName = getDisplayName(watchlist.query)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('click', handleOutside)
    return () => document.removeEventListener('click', handleOutside)
  }, [menuOpen])

  function handleCardClick() {
    if (menuOpen) { setMenuOpen(false); return }
    router.push(`/search?q=${encodeURIComponent(watchlist.query)}`)
  }

  function handleDelete() {
    if (window.confirm('Slet overvågning?')) {
      onDelete(watchlist.id)
    }
  }

  return (
    <div
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleCardClick()}
      className="group relative rounded-2xl overflow-hidden border border-border/60 hover:border-primary/50 active:border-primary cursor-pointer transition-all duration-200 hover:shadow-[0_0_20px_rgba(19,236,109,0.15)] active:shadow-[0_0_25px_rgba(19,236,109,0.3)] bg-surface"
      style={{ aspectRatio: '4/3' }}
    >
      {/* Background: image or placeholder */}
      <div className="absolute inset-0 opacity-70 group-hover:opacity-90 group-active:opacity-100 transition-opacity duration-200">
        {watchlist.preview_image_url ? (
          <Image
            src={watchlist.preview_image_url}
            alt={displayName}
            fill
            className="object-cover"
            sizes="(min-width: 768px) 33vw, 100vw"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '48px', color: 'var(--color-text-muted)' }}
            >
              search
            </span>
          </div>
        )}
      </div>

      {/* Gradient overlay — bottom half */}
      <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/90 via-black/60 to-transparent pointer-events-none" />

      {/* More menu — top-right */}
      <div ref={menuRef} className="absolute top-2.5 right-2.5 z-50">
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o) }}
          className="bg-black/40 backdrop-blur-sm rounded-full p-1.5 text-white/70 hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>more_vert</span>
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 bg-surface border border-border rounded-xl shadow-lg overflow-hidden min-w-[140px]">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(false)
                router.push(`/watchlists/${watchlist.id}/edit`)
              }}
              className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
              Rediger
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(false)
                handleDelete()
              }}
              className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-red-400 hover:bg-white/10 transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
              Slet
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="absolute inset-x-0 bottom-0 p-3 flex flex-col gap-1.5">
        <p className="text-sm font-semibold text-white truncate pr-2">{displayName}</p>

        <div className="flex items-center gap-1.5 flex-wrap">
          {watchlist.new_count > 0 ? (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary text-bg">
              {watchlist.new_count} {t.newMatches}
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/60">
              {t.noMatches}
            </span>
          )}

          {watchlist.max_price != null && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/70">
              Max {watchlist.max_price.toLocaleString('da-DK')} kr
            </span>
          )}

          <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/50">
            dba.dk
          </span>
        </div>
      </div>
    </div>
  )
}
