'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import type { Listing } from '@/lib/supabase'
import { useLocale } from '@/components/LocaleProvider'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

function timeSince(dateStr: string, locale: string): string {
  const diff  = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)

  if (locale === 'da') {
    if (mins  <  1) return 'Lige nu'
    if (mins  < 60) return `${mins}m siden`
    if (hours < 24) return `${hours}t siden`
    return `${days}d siden`
  }
  if (mins  <  1) return 'Just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

type PriceStats = { count: number; p25: number | null; p75: number | null }

interface Props {
  listing:           Listing
  onCreateWatchlist: (listingTitle?: string) => void
  creating:          boolean
  onToast?:          (msg: string) => void
}

export function SearchResultCard({ listing, onCreateWatchlist, creating, onToast }: Props) {
  const { locale, t } = useLocale()

  const [stats,          setStats]         = useState<PriceStats | null>(null)
  const [editing,        setEditing]       = useState(false)
  const [fromPrice,      setFromPrice]     = useState('')
  const [toPrice,        setToPrice]       = useState('')
  const [saving,         setSaving]        = useState(false)
  const [showCapture,    setShowCapture]   = useState(false)
  const [captureEmail,   setCaptureEmail]  = useState('')
  const [captureLoading, setCaptureLoading] = useState(false)
  const [captureSent,    setCaptureSent]   = useState(false)

  useEffect(() => {
    fetch(`/api/price-observations?listing_id=${listing.id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: PriceStats | null) => {
        if (data && data.count > 0) setStats(data)
      })
      .catch(() => {})
  }, [listing.id])

  const priceFormatted = listing.price != null
    ? `${listing.price.toLocaleString('da-DK')} kr`
    : t.priceNotListed

  async function handleSave() {
    const fra = parseInt(fromPrice, 10)
    const til = parseInt(toPrice, 10)
    if (isNaN(fra) || fra <= 0) return

    const supabase = createSupabaseBrowserClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setShowCapture(true); return }

    setSaving(true)
    const res = await fetch('/api/price-observations', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        listing_id:    listing.id,
        price_dkk:     fra,
        price_min_dkk: fra,
        price_max_dkk: !isNaN(til) && til > fra ? til : undefined,
      }),
    })
    setSaving(false)

    if (res.ok) {
      setStats({ count: (stats?.count ?? 0) + 1, p25: fra, p75: !isNaN(til) && til > fra ? til : fra })
      setEditing(false)
      setFromPrice('')
      setToPrice('')
      onToast?.(t.priceSaved)
    }
  }

  async function handleWatchlistClick() {
    const supabase = createSupabaseBrowserClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      onCreateWatchlist(listing.title)
    } else {
      setShowCapture(true)
    }
  }

  async function handleCaptureSubmit(e: React.FormEvent) {
    e.preventDefault()
    const email = captureEmail.trim()
    if (!email) return
    setCaptureLoading(true)

    // Persist watchlist intent so it survives the auth redirect
    localStorage.setItem('pending_watchlist', JSON.stringify({
      query: listing.title,
      max_price: null,
    }))

    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: window.location.origin + '/auth/confirm',
      },
    })
    setCaptureLoading(false)
    setCaptureSent(true)
  }

  function handleClickPrice() {
    setEditing(true)
  }

  const hasStats  = stats !== null && stats.count > 0
  const showRange = hasStats && stats!.p25 != null && stats!.p75 != null

  return (
    <div className="flex gap-3 p-3 rounded-2xl bg-surface border border-white/10 hover:border-white/20 transition-colors">
      {/* Thumbnail */}
      <div className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-white/5 flex items-center justify-center">
        {listing.image_url ? (
          <Image
            src={listing.image_url}
            alt={listing.title}
            width={80}
            height={80}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="material-symbols-outlined" style={{ fontSize: '28px', color: 'var(--color-text-muted)' }}>
            image
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* Title */}
        <p className="text-sm font-semibold text-text truncate">{listing.title}</p>

        {/* Price */}
        <p className="text-base font-black" style={{ color: 'var(--color-primary)' }}>
          {priceFormatted}
        </p>

        {/* Typical price — interactive */}
        {editing ? (
          <div className="flex items-center gap-1 mt-0.5">
            <input
              type="number"
              min={0}
              value={fromPrice}
              onChange={(e) => setFromPrice(e.target.value)}
              placeholder="Fra"
              className="w-16 rounded px-1.5 py-0.5 text-[11px] outline-none"
              style={{
                backgroundColor: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: 'var(--color-text)',
              }}
              autoFocus
            />
            <input
              type="number"
              min={0}
              value={toPrice}
              onChange={(e) => setToPrice(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="Til"
              className="w-16 rounded px-1.5 py-0.5 text-[11px] outline-none"
              style={{
                backgroundColor: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: 'var(--color-text)',
              }}
            />
            <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>kr</span>
            <button
              onClick={handleSave}
              disabled={saving || !fromPrice}
              className="text-[11px] px-1.5 py-0.5 rounded transition-opacity disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-bg)' }}
              title="Gem"
            >
              ✓
            </button>
            <button
              onClick={() => { setEditing(false); setFromPrice(''); setToPrice('') }}
              className="text-[11px] px-1.5 py-0.5 rounded"
              style={{ color: 'rgba(255,255,255,0.4)' }}
              title="Annuller"
            >
              ✗
            </button>
          </div>
        ) : (
          <button
            onClick={handleClickPrice}
            className="text-left text-[11px] w-fit transition-opacity hover:opacity-80"
            style={{ color: showRange ? 'rgba(255,255,255,0.7)' : '#475569' }}
          >
            {showRange
              ? `Typisk ${stats!.p25!.toLocaleString('da-DK')}–${stats!.p75!.toLocaleString('da-DK')} kr`
              : <>Typisk pris · <span className="italic">{t.comingSoon.toLowerCase()}</span></>
            }
          </button>
        )}

        {/* Meta: platform + time */}
        <div className="flex items-center gap-1.5 text-[11px] mt-auto" style={{ color: '#64748b' }}>
          {listing.source === 'reverb'
            ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">Reverb</span>
            : <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-white/10 text-white/60">DBA</span>
          }
          <span>·</span>
          <span>{timeSince(listing.scraped_at, locale)}</span>
          {listing.location && (
            <>
              <span>·</span>
              <span className="truncate">{listing.location}</span>
            </>
          )}
        </div>

        {/* CTAs / inline login capture */}
        {showCapture ? (
          captureSent ? (
            /* Success state */
            <div className="flex flex-col gap-1 mt-2 py-1">
              <div className="flex items-center gap-1.5">
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: '16px', color: 'var(--color-primary)' }}
                >
                  mark_email_read
                </span>
                <span className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                  {t.checkInbox}
                </span>
              </div>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {t.checkEmailToSave}
              </p>
            </div>
          ) : (
            /* Email capture form */
            <form onSubmit={handleCaptureSubmit} className="flex flex-col gap-1.5 mt-2">
              <input
                type="email"
                value={captureEmail}
                onChange={(e) => setCaptureEmail(e.target.value)}
                placeholder={t.email}
                required
                autoFocus
                className="w-full rounded-xl px-3 py-2 text-sm outline-none transition-all"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: 'var(--color-text)',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(19,236,109,0.5)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)' }}
              />
              <button
                type="submit"
                disabled={captureLoading || !captureEmail.trim()}
                className="w-full rounded-xl py-2 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-bg)' }}
              >
                {captureLoading ? '...' : t.sendLoginLink}
              </button>
              <p className="text-[11px] text-center" style={{ color: 'rgba(255,255,255,0.35)' }}>
                {t.noPasswordNeeded}
              </p>
            </form>
          )
        ) : (
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleWatchlistClick}
              disabled={creating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-bg)' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>add_alert</span>
              {t.createWatchlist}
            </button>
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-white/10 hover:border-white/25 transition-colors"
              style={{ color: 'rgba(255,255,255,0.7)' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>open_in_new</span>
              {t.viewListing}
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
