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

  const [menuOpen,   setMenuOpen]   = useState(false)
  const [confirming, setConfirming] = useState(false)

  const cardRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
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

  // Cancel confirm on outside click
  useEffect(() => {
    if (!confirming) return
    function handleOutside(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setConfirming(false)
      }
    }
    document.addEventListener('click', handleOutside)
    return () => document.removeEventListener('click', handleOutside)
  }, [confirming])

  // Auto-cancel confirm after 5 seconds
  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), 5000)
    return () => clearTimeout(timer)
  }, [confirming])

  function handleCardClick() {
    if (confirming) { setConfirming(false); return }
    if (menuOpen)   { setMenuOpen(false);   return }
    router.push(`/search?q=${encodeURIComponent(watchlist.query)}`)
  }

  return (
    <div
      ref={cardRef}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleCardClick()}
      className={`relative flex flex-col rounded-2xl border bg-card cursor-pointer transition-all duration-200 ${
        confirming
          ? 'border-red-500/40'
          : 'border-border/60 hover:border-border active:border-border'
      }`}
      style={{ aspectRatio: '4/3' }}
    >
      {/* Image — top 65% */}
      <div className="relative flex-1 overflow-hidden rounded-t-2xl bg-card/50">
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
              style={{ fontSize: '48px', color: 'var(--muted-foreground)' }}
            >
              search
            </span>
          </div>
        )}

        {/* Red overlay in confirm state */}
        {confirming && (
          <div className="absolute inset-0 bg-red-500/10 pointer-events-none" />
        )}
      </div>

      {/* Footer bar */}
      <div className="flex-shrink-0 px-3 pb-3 pt-2 border-t border-border/40">
        {confirming ? (
          <div onClick={(e) => e.stopPropagation()}>
            <p className="text-xs text-muted-foreground mb-2">Slet overvågning?</p>
            <div className="flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(watchlist.id)
                }}
                className="flex-1 py-1.5 rounded-lg bg-red-500/80 hover:bg-red-500 text-white text-sm font-bold transition-colors"
              >
                Ja, slet
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirming(false) }}
                className="flex-1 py-1.5 rounded-lg text-muted-foreground text-sm hover:text-foreground hover:bg-secondary transition-colors"
              >
                Annuller
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm font-bold text-foreground truncate mb-1.5">{displayName}</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {watchlist.new_count > 0 && (
                <span className="text-xs font-black px-2 py-0.5 rounded-full bg-accent text-accent-foreground">
                  {watchlist.new_count} {t.newMatches}
                </span>
              )}
              {watchlist.max_price != null && (
                <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  Max {watchlist.max_price.toLocaleString('da-DK')} kr
                </span>
              )}
              <span className="text-xs text-muted-foreground">dba.dk</span>
            </div>
          </>
        )}
      </div>

      {/* More menu — hidden while confirming */}
      {!confirming && (
        <div ref={menuRef} className="absolute top-2 right-2 z-50">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o) }}
            className="bg-card/70 backdrop-blur-sm rounded-full p-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>more_vert</span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden min-w-[140px]">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen(false)
                  router.push(`/watchlists/${watchlist.id}/edit`)
                }}
                className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-foreground hover:bg-secondary transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
                Rediger
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen(false)
                  setConfirming(true)
                }}
                className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-red-400 hover:bg-secondary transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                Slet
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
