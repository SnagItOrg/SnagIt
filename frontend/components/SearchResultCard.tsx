'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { Listing } from '@/lib/supabase'
import { useLocale } from '@/components/LocaleProvider'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

// Country name → ISO code for flag emoji lookup
const COUNTRY_CODES: Record<string, string> = {
  'Germany': 'DE', 'Netherlands': 'NL', 'Italy': 'IT', 'Spain': 'ES',
  'United States': 'US', 'United Kingdom': 'GB', 'France': 'FR',
  'Denmark': 'DK', 'Sweden': 'SE', 'Norway': 'NO', 'Japan': 'JP',
  'Australia': 'AU', 'Canada': 'CA', 'Belgium': 'BE', 'Austria': 'AT',
  'Poland': 'PL', 'Portugal': 'PT', 'Finland': 'FI', 'Switzerland': 'CH',
  'Czech Republic': 'CZ', 'Hungary': 'HU', 'Greece': 'GR',
}

function countryFlag(code: string): string {
  const upper = code.toUpperCase()
  return String.fromCodePoint(0x1F1E6 - 65 + upper.charCodeAt(0)) +
         String.fromCodePoint(0x1F1E6 - 65 + upper.charCodeAt(1))
}

// Parse "City, Country" → flag + country, or fall back to raw string
function formatLocation(location: string): string {
  const lastComma = location.lastIndexOf(', ')
  if (lastComma === -1) return location
  const country = location.slice(lastComma + 2)
  const code = COUNTRY_CODES[country]
  return code ? `${countryFlag(code)} ${country}` : location
}

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

interface Props {
  listing:           Listing
  onCreateWatchlist: (listingTitle?: string) => void
  creating:          boolean
  variant?:          'list' | 'grid'
  isSaved?:          boolean
  onToggleSave?:     (listing: Listing) => void
}

function PlatformBadge({ listing, absolute }: { listing: Listing; absolute?: boolean }) {
  const platform = listing.platform ?? listing.source

  if (absolute) {
    const base = 'absolute top-2 left-2 text-xs font-semibold px-2 py-0.5 rounded-full backdrop-blur-sm'
    if (platform === 'reverb')                         return <span className={`${base} bg-orange-500 text-white`}>Reverb</span>
    if (platform === 'facebook' || platform === 'fb') return <span className={`${base} bg-blue-500 text-white`}>FB</span>
    return <span className={`${base} bg-blue-600 text-white`}>DBA</span>
  }

  const cls = 'text-xs font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border'
  if (platform === 'reverb')                         return <span className={cls}>Reverb</span>
  if (platform === 'facebook' || platform === 'fb') return <span className={cls}>FB</span>
  return <span className={cls}>DBA</span>
}

export function SearchResultCard({ listing, onCreateWatchlist, creating, variant = 'list', isSaved = false, onToggleSave }: Props) {
  const { locale, t } = useLocale()

  const [imgError,       setImgError]      = useState(false)
  const [showCapture,    setShowCapture]   = useState(false)
  const [captureEmail,   setCaptureEmail]  = useState('')
  const [captureLoading, setCaptureLoading] = useState(false)
  const [captureSent,    setCaptureSent]   = useState(false)

  const priceFormatted = listing.price != null
    ? `${listing.price.toLocaleString('da-DK')} kr`
    : t.priceNotListed

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
    onToggleSave?.(listing)
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

  const priceOriginal = (listing as Listing & { price_original?: number | null }).price_original
  const hasDiscount   = priceOriginal != null && listing.price != null && priceOriginal > listing.price
  const discountPct   = hasDiscount
    ? Math.round((1 - listing.price! / priceOriginal!) * 100)
    : 0

  // ─── Grid variant ──────────────────────────────────────────────────────────
  if (variant === 'grid') {
    return (
      <a
        href={listing.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex flex-col rounded-2xl bg-card border border-card-border overflow-hidden hover:shadow-md transition-shadow duration-300"
      >
        {/* Image area */}
        <div className="relative w-full aspect-[4/3] bg-muted overflow-hidden">
          {listing.image_url && !imgError ? (
            <Image
              src={listing.image_url}
              alt={listing.title}
              fill
              sizes="(min-width: 768px) 25vw, 100vw"
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              onError={() => setImgError(true)}
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
            <span className="absolute bottom-2 left-2 text-xs font-bold px-2 py-0.5 rounded-full bg-green-500 text-white">
              -{discountPct}%
            </span>
          )}

          {/* Heart — save listing */}
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleHeartClick() }}
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm shadow-sm flex items-center justify-center transition-opacity hover:opacity-90"
            aria-label="Gem annonce"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isSaved ? 'text-red-500' : 'text-gray-800'}>
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        </div>

        {/* Card body */}
        <div className="p-3 flex flex-col gap-1">
          {/* KUP-RATING: Intentionally hidden until knowledge graph has sufficient
              per-variant price history. Do not ship without data validation. */}
          <div className="flex justify-between items-start gap-2">
            <p className="text-sm font-semibold text-foreground flex-1 line-clamp-2 min-h-[2.5rem]">{listing.title}</p>
            <p className="text-sm font-black text-foreground flex-shrink-0">{priceFormatted}</p>
          </div>

          {/* Location · time */}
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-auto pt-1">
            {listing.location && (
              <>
                <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: '12px' }}>location_on</span>
                <span className="truncate">
                  {listing.platform === 'reverb'
                    ? formatLocation(listing.location)
                    : listing.location}
                </span>
                <span>·</span>
              </>
            )}
            <span className="flex-shrink-0">{timeSince(listing.scraped_at, locale)}</span>
          </div>
        </div>
      </a>
    )
  }

  // ─── List variant (default) ─────────────────────────────────────────────────
  return (
    <div className="flex gap-3 p-3 rounded-2xl bg-card border border-border hover:border-border/80 transition-colors">
      {/* Thumbnail */}
      <div className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
        {listing.image_url && !imgError ? (
          <Image
            src={listing.image_url}
            alt={listing.title}
            width={80}
            height={80}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
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

        {/* Meta: platform + time + location */}
        <div className="flex items-center gap-1.5 text-[11px] mt-auto text-muted-foreground">
          <PlatformBadge listing={listing} />
          <span>·</span>
          <span>{timeSince(listing.scraped_at, locale)}</span>
          {listing.location && (
            <>
              <span>·</span>
              <span className="truncate">
                {listing.platform === 'reverb'
                  ? formatLocation(listing.location)
                  : listing.location}
              </span>
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
            <div className="flex gap-2">
              {/* Heart — save listing */}
              <button
                onClick={handleHeartClick}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--border)', color: isSaved ? 'var(--foreground)' : 'var(--muted-foreground)' }}
                aria-label="Gem annonce"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isSaved ? 'text-red-500' : ''}>
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                {isSaved ? 'Gemt' : 'Gem'}
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
