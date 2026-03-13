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
  variant?:          'list' | 'grid'
}

function PlatformBadge({ listing, absolute }: { listing: Listing; absolute?: boolean }) {
  const platform = listing.platform ?? listing.source

  if (absolute) {
    // On-image badges — need guaranteed contrast over any photo
    const base = 'absolute top-2 left-2 text-xs font-semibold px-2 py-0.5 rounded-full backdrop-blur-sm'
    if (platform === 'reverb') return <span className={`${base} bg-orange-500 text-white`}>Reverb</span>
    if (platform === 'facebook' || platform === 'fb') return <span className={`${base} bg-blue-500 text-white`}>FB</span>
    return <span className={`${base} bg-white/90 text-gray-900`}>DBA</span>
  }

  // Inline badges (list variant) — standard neutral style
  const cls = 'text-xs font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border'
  if (platform === 'reverb') return <span className={cls}>Reverb</span>
  if (platform === 'facebook' || platform === 'fb') return <span className={cls}>FB</span>
  return <span className={cls}>DBA</span>
}

export function SearchResultCard({ listing, onCreateWatchlist, creating, onToast, variant = 'list' }: Props) {
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
  const [heartToast,     setHeartToast]    = useState(false)

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

  async function handleHeartClick() {
    const supabase = createSupabaseBrowserClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setShowCapture(true); return }
    setHeartToast(true)
    setTimeout(() => setHeartToast(false), 2000)
  }

  async function handleCaptureSubmit(e: React.FormEvent) {
    e.preventDefault()
    const email = captureEmail.trim()
    if (!email) return
    setCaptureLoading(true)

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

  const priceOriginal = (listing as Listing & { price_original?: number | null }).price_original
  const hasDiscount   = priceOriginal != null && listing.price != null && priceOriginal > listing.price
  const discountPct   = hasDiscount
    ? Math.round((1 - listing.price! / priceOriginal!) * 100)
    : 0

  // ─── Grid variant ──────────────────────────────────────────────────────────
  if (variant === 'grid') {
    return (
      <div className="flex flex-col rounded-2xl bg-card border border-card-border overflow-hidden">
        {/* Image area */}
        <div className="relative w-full aspect-[4/3] bg-muted">
          {listing.image_url ? (
            <Image
              src={listing.image_url}
              alt={listing.title}
              fill
              sizes="(min-width: 768px) 25vw, 100vw"
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="material-symbols-outlined" style={{ fontSize: '32px', color: 'var(--muted-foreground)' }}>
                image
              </span>
            </div>
          )}

          {/* Platform badge */}
          <PlatformBadge listing={listing} absolute />

          {/* Discount badge */}
          {hasDiscount && (
            <span className="absolute bottom-2 left-2 text-xs font-bold px-2 py-0.5 rounded-full bg-secondary text-foreground border border-border">
              ↓ -{discountPct}%
            </span>
          )}

          {/* Heart — save listing */}
          <button
            onClick={handleHeartClick}
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm shadow-sm flex items-center justify-center transition-opacity hover:opacity-90"
            aria-label="Gem annonce"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-800">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        </div>

        {/* Card body */}
        <div className="p-3 flex flex-col gap-1">
          {/* KUP-RATING: Intentionally hidden until knowledge graph has sufficient
              per-variant price history. Do not ship without data validation. */}
          <div className="flex justify-between items-start gap-2">
            <p className="text-sm font-semibold text-foreground flex-1 truncate">{listing.title}</p>
            <p className="text-sm font-black text-foreground flex-shrink-0">{priceFormatted}</p>
          </div>

          {/* Typical price */}
          <button
            onClick={handleClickPrice}
            className="text-left text-[11px] w-fit transition-opacity hover:opacity-80 text-muted-foreground"
          >
            {showRange
              ? `Typisk ${stats!.p25!.toLocaleString('da-DK')}–${stats!.p75!.toLocaleString('da-DK')} kr`
              : <>Typisk pris · <span className="italic">{t.comingSoon.toLowerCase()}</span></>
            }
          </button>

          {/* Location · time */}
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-auto pt-1">
            {listing.location && (
              <>
                <span className="truncate">{listing.location}</span>
                <span>·</span>
              </>
            )}
            <span className="flex-shrink-0">{timeSince(listing.scraped_at, locale)}</span>
          </div>
        </div>
      </div>
    )
  }

  // ─── List variant (default) ─────────────────────────────────────────────────
  return (
    <div className="flex gap-3 p-3 rounded-2xl bg-card border border-border hover:border-border/80 transition-colors">
      {/* Thumbnail */}
      <div className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
        {listing.image_url ? (
          <Image
            src={listing.image_url}
            alt={listing.title}
            width={80}
            height={80}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="material-symbols-outlined" style={{ fontSize: '28px', color: 'var(--muted-foreground)' }}>
            image
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* Title */}
        <p className="text-sm font-semibold text-foreground truncate">{listing.title}</p>

        {/* Price */}
        <p className="text-base font-black" style={{ color: 'var(--foreground)' }}>
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
                backgroundColor: 'var(--input-background)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
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
                backgroundColor: 'var(--input-background)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
              }}
            />
            <span className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>kr</span>
            <button
              onClick={handleSave}
              disabled={saving || !fromPrice}
              className="text-[11px] px-1.5 py-0.5 rounded transition-opacity disabled:opacity-40"
              style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--border)', color: 'var(--secondary-foreground)' }}
              title="Gem"
            >
              ✓
            </button>
            <button
              onClick={() => { setEditing(false); setFromPrice(''); setToPrice('') }}
              className="text-[11px] px-1.5 py-0.5 rounded"
              style={{ color: 'var(--muted-foreground)' }}
              title="Annuller"
            >
              ✗
            </button>
          </div>
        ) : (
          <button
            onClick={handleClickPrice}
            className="text-left text-[11px] w-fit transition-opacity hover:opacity-80"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {showRange
              ? `Typisk ${stats!.p25!.toLocaleString('da-DK')}–${stats!.p75!.toLocaleString('da-DK')} kr`
              : <>Typisk pris · <span className="italic">{t.comingSoon.toLowerCase()}</span></>
            }
          </button>
        )}

        {/* Meta: platform + time */}
        <div className="flex items-center gap-1.5 text-[11px] mt-auto text-muted-foreground">
          <PlatformBadge listing={listing} />
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
            <div className="flex flex-col gap-1 mt-2 py-1">
              <div className="flex items-center gap-1.5">
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: '16px', color: 'var(--foreground)' }}
                >
                  mark_email_read
                </span>
                <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                  {t.checkInbox}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t.checkEmailToSave}
              </p>
            </div>
          ) : (
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
                  backgroundColor: 'var(--input-background)',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
              />
              <button
                type="submit"
                disabled={captureLoading || !captureEmail.trim()}
                className="w-full rounded-xl py-2 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                {captureLoading ? '...' : t.sendLoginLink}
              </button>
              <p className="text-[11px] text-center text-muted-foreground">
                {t.noPasswordNeeded}
              </p>
            </form>
          )
        ) : (
          <div className="flex flex-col gap-1.5 mt-2">
            {heartToast && (
              <p className="text-xs text-muted-foreground italic">Kommer snart 🤍</p>
            )}
            <div className="flex gap-2">
              {/* Heart — save listing (coming soon) */}
              <button
                onClick={handleHeartClick}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
                aria-label="Gem annonce"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                Gem
              </button>
              {/* Bell — create watchlist alert */}
              <button
                onClick={handleWatchlistClick}
                disabled={creating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--border)', color: 'var(--secondary-foreground)' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>notifications</span>
                {t.createWatchlist}
              </button>
              <a
                href={listing.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-border hover:border-border/80 transition-colors"
                style={{ color: 'var(--foreground)' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>open_in_new</span>
                {t.viewListing}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
