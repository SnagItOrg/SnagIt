'use client'

import { useState, useRef } from 'react'
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
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

const SWIPE_REVEAL = 80 // px — width of delete zone

export function WatchlistBentoCard({ watchlist, onEdit, onDelete }: Props) {
  const router = useRouter()
  const { t } = useLocale()
  const displayName = getDisplayName(watchlist.query)

  const [swipeOffset, setSwipeOffset] = useState(0)
  const [isDragging,  setIsDragging]  = useState(false)

  const touchStartX  = useRef(0)
  const swipeRef     = useRef(0)   // mirrors swipeOffset, always current
  const swipeStartRef = useRef(0)  // swipeRef value at start of this gesture
  const hasSwiped    = useRef(false)

  function setSwipe(val: number) {
    swipeRef.current = val
    setSwipeOffset(val)
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current  = e.touches[0].clientX
    swipeStartRef.current = swipeRef.current
    hasSwiped.current    = false
    setIsDragging(true)
  }

  function handleTouchMove(e: React.TouchEvent) {
    const delta = touchStartX.current - e.touches[0].clientX
    if (swipeStartRef.current === 0) {
      // Closed → left swipe opens
      if (delta > 0) {
        hasSwiped.current = true
        setSwipe(Math.min(delta, SWIPE_REVEAL))
      }
    } else {
      // Open → right swipe closes
      if (delta < 0) {
        hasSwiped.current = true
        setSwipe(Math.max(0, swipeStartRef.current + delta))
      }
    }
  }

  function handleTouchEnd() {
    setIsDragging(false)
    if (swipeRef.current >= SWIPE_REVEAL / 2) {
      setSwipe(SWIPE_REVEAL)
    } else {
      setSwipe(0)
    }
  }

  function handleCardClick() {
    // Any swipe gesture (even partial) cancels navigation on this tap
    if (hasSwiped.current || swipeRef.current > 0) {
      hasSwiped.current = false
      setSwipe(0)
      return
    }
    router.push(`/search?q=${encodeURIComponent(watchlist.query)}`)
  }

  return (
    <div
      className="group relative rounded-2xl overflow-hidden border border-border/60 hover:border-primary/50 active:border-primary cursor-pointer transition-all duration-200 hover:shadow-[0_0_20px_rgba(19,236,109,0.15)] active:shadow-[0_0_25px_rgba(19,236,109,0.3)] bg-surface"
      style={{ aspectRatio: '4/3' }}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleCardClick()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Delete zone — revealed on left swipe (mobile) */}
      <div
        className="absolute right-0 top-0 bottom-0 flex items-center justify-center bg-red-500/80"
        style={{ width: `${SWIPE_REVEAL}px` }}
        onClick={(e) => { e.stopPropagation(); onDelete(watchlist.id) }}
      >
        <span className="material-symbols-outlined text-white" style={{ fontSize: '28px' }}>delete</span>
      </div>

      {/* Sliding content wrapper */}
      <div
        className="absolute inset-0"
        style={{
          transform: `translateX(-${swipeOffset}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out',
        }}
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

        {/* Desktop delete button — top-right, visible on card hover */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(watchlist.id) }}
          className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-all p-1 rounded-lg text-white/30 hover:text-red-400"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete</span>
        </button>

        {/* Content */}
        <div className="absolute inset-x-0 bottom-0 p-3 flex flex-col gap-1.5">
          <p className="text-sm font-semibold text-white truncate pr-14">{displayName}</p>

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

          {/* Edit button — stops card click propagation */}
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(watchlist.id) }}
            className="absolute bottom-2.5 right-2.5 text-xs font-medium px-2.5 py-1 rounded-lg text-white/55 hover:text-white hover:bg-white/10 transition-colors"
          >
            Rediger
          </button>
        </div>
      </div>
    </div>
  )
}
