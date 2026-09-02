'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { Listing } from '@/lib/supabase'
import { useLocale } from '@/components/LocaleProvider'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { usePostHog } from 'posthog-js/react'
import { formatOriginalPrice } from '@/lib/currency'
import { classifyListing, firstSeenTimestamp, isApproximateDkk } from '@/lib/price-populations'

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

function getLocationDisplay(listing: Listing): string | null {
  if (listing.source === 'thomann') return null
  const schibstedWithoutLocation = ['dba.dk', 'finn', 'blocket']
  if (!listing.location && !schibstedWithoutLocation.includes(listing.source)) return null

  switch (listing.source) {
    case 'dba.dk':
      return '🇩🇰 Danmark'
    case 'reverb': {
      const loc = listing.location
      if (!loc || loc === 'International' || loc === 'Local') return null
      return formatLocation(loc)
    }
    case 'kleinanzeigen':
      return '🇩🇪 Tyskland'
    case 'blocket':
      return '🇸🇪 Sverige'
    case 'finn':
      return '🇳🇴 Norge'
    default:
      return listing.location ?? null
  }
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
  listing:            Listing
  onCreateWatchlist:  (listingTitle?: string) => void
  creating:           boolean
  variant?:           'list' | 'grid'
  isSaved?:           boolean
  onToggleSave?:      (listing: Listing) => void
  thomannPriceDkk?:   number | null
  thomannUrl?:        string | null
  productSlug?:       string | null
  thomannImageUrl?:   string | null
  /** Position of this listing inside its OWN asking population. Server-computed. */
  marketVerdict?:            'under' | 'typical' | 'over' | null
  marketVerdictPopulation?:  string | null
  /** i18n key naming the population the verdict was measured against. */
  marketVerdictBasisLabel?:  string | null
}

/**
 * The deal signal. Replaces the hidden KUP-RATING placeholder.
 *
 * Renders NOTHING when there is no verdict — no empty badge, no reserved gap —
 * because a listing without a comparable population has nothing to say, and a
 * placeholder would imply otherwise.
 *
 * The label is always a word, never colour alone, and it describes position in
 * one asking population. It is deliberately not "Kup", "God handel", "Billig"
 * or any judgement of the deal: Klup is stating where the price sits, not
 * whether to buy.
 */
function MarketVerdictBadge({
  verdict,
  basisLabelKey,
  t,
}: {
  verdict?: 'under' | 'typical' | 'over' | null
  basisLabelKey?: string | null
  t: Record<string, string>
}) {
  if (!verdict) return null
  const label =
    verdict === 'under' ? t.verdictUnder : verdict === 'over' ? t.verdictOver : t.verdictTypical
  const basis = basisLabelKey ? t[basisLabelKey] : null
  return (
    <span
      className="inline-flex w-fit items-center rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-secondary"
      title={basis ?? undefined}
      aria-label={basis ? `${label}. ${basis}` : label}
    >
      {label}
    </span>
  )
}

function PlatformBadge({ listing, absolute }: { listing: Listing; absolute?: boolean }) {
  const platform = listing.platform ?? listing.source

  if (absolute) {
    const base = 'absolute top-2 left-2 text-xs font-semibold px-2 py-0.5 rounded-full'
    if (platform === 'reverb')                         return <span className={`${base} text-white`} style={{ backgroundColor: '#EC5A2C' }}>Reverb</span>
    if (platform === 'facebook' || platform === 'fb') return <span className={`${base} bg-blue-500 text-white`}>FB</span>
    if (platform === 'thomann')                       return <span className={`${base} text-white`} style={{ backgroundColor: '#002D4C' }}>Thomann</span>
    if (platform === 'finn')                           return <span className={`${base} text-white`} style={{ backgroundColor: '#06bffc' }}>Finn</span>
    if (platform === 'blocket')                        return <span className={`${base} text-white`} style={{ backgroundColor: '#F71414' }}>Blocket</span>
    if (platform === 'kleinanzeigen')                  return <span className={`${base} text-white`} style={{ backgroundColor: '#1D4B00' }}>KA</span>
    return <span className={`${base} text-white`} style={{ backgroundColor: '#00098A' }}>DBA</span>
  }

  const cls = 'text-xs font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border'
  if (platform === 'reverb')                         return <span className={cls}>Reverb</span>
  if (platform === 'facebook' || platform === 'fb') return <span className={cls}>FB</span>
  if (platform === 'thomann')                       return <span className={cls}>Thomann</span>
  if (platform === 'finn')                           return <span className={cls}>Finn</span>
  if (platform === 'blocket')                        return <span className={cls}>Blocket</span>
  if (platform === 'kleinanzeigen')                  return <span className={cls}>Kleinanzeigen</span>
  return <span className={cls}>DBA</span>
}

export function SearchResultCard({ listing, onCreateWatchlist, creating, variant = 'list', isSaved = false, onToggleSave, thomannPriceDkk, thomannUrl, productSlug, thomannImageUrl, marketVerdict, marketVerdictBasisLabel }: Props) {
  const { locale, t } = useLocale()
  const posthog = usePostHog()

  const [imgError,       setImgError]      = useState(false)
  const [showCapture,    setShowCapture]   = useState(false)
  const [captureEmail,   setCaptureEmail]  = useState('')
  const [captureLoading, setCaptureLoading] = useState(false)
  const [captureSent,    setCaptureSent]   = useState(false)

  const priceFormatted = listing.price != null
    ? formatOriginalPrice(listing.price, listing.currency)
    : t.priceNotListed
  /**
   * The comparable DKK figure is READ, not recomputed.
   *
   * This used to call `formatDkkApprox(price, currency)`, converting again at
   * render through the static April table — a third conversion path that could
   * disagree with the `price_dkk` already stored on the same row. `price_dkk`
   * is written at ingestion and is what every P2 statistic is built from, so
   * the card and the band now quote the same number.
   *
   * `currency` is never consulted for market: all 39,926 active Reverb rows
   * are converted USD stored as currency='DKK'. Population decides.
   */
  const listingPopulation = classifyListing(listing).population
  const dkkApprox = listing.price_dkk != null && isApproximateDkk(listingPopulation)
    ? `≈ ${Math.round(Number(listing.price_dkk)).toLocaleString('da-DK')} kr`
    : null

  /** Real listing age, or nothing. `scraped_at` is when Klup looked. */
  const firstSeen = firstSeenTimestamp(listing)

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
    if (!isSaved) {
      posthog?.capture('listing_saved', { listing_id: listing.id, source: listing.source })
    }
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

  const imgSrc = listing.image_url ?? thomannImageUrl ?? null

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
        className="surface-interactive group flex flex-col rounded-2xl overflow-hidden"
        onClick={() => posthog?.capture('listing_clicked', { listing_id: listing.id, source: listing.source, price: listing.price ?? 0 })}
      >
        {/* Image area */}
        <div className="relative w-full aspect-[4/3] bg-muted overflow-hidden">
          {imgSrc && !imgError ? (
            <Image
              src={imgSrc}
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
            <span className="absolute bottom-2 left-2 text-xs font-bold px-2 py-0.5 rounded-full bg-accent text-accent-foreground">
              -{discountPct}%
            </span>
          )}

          {/* Heart — save listing */}
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleHeartClick() }}
            className="surface-overlay absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-surface-3"
            aria-label="Gem annonce"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isSaved ? 'text-red-500' : 'text-ink-muted'}>
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        </div>

        {/* Card body */}
        <div className="p-3 flex flex-col gap-1">
          <MarketVerdictBadge
            verdict={marketVerdict}
            basisLabelKey={marketVerdictBasisLabel}
            t={t as unknown as Record<string, string>}
          />
          <div className="flex justify-between items-start gap-2">
            <p className="text-sm font-semibold text-foreground flex-1 line-clamp-2 min-h-[2.5rem]">{listing.title}</p>
            <div className="flex flex-col items-end flex-shrink-0">
              <p className="text-sm font-semibold text-foreground tabular-nums">{priceFormatted}</p>
              {dkkApprox && (
                <p className="text-[10px] text-muted-foreground leading-tight">{dkkApprox}</p>
              )}
            </div>
          </div>

          {/* Location · time */}
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-auto pt-1">
            {getLocationDisplay(listing) && (
              <>
                <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: '12px' }}>location_on</span>
                <span className="truncate">{getLocationDisplay(listing)}</span>
                <span>·</span>
              </>
            )}
            {firstSeen && (
              <span className="flex-shrink-0">{timeSince(firstSeen, locale)}</span>
            )}
          </div>
        </div>
      </a>
    )
  }

  // ─── List variant (default) ─────────────────────────────────────────────────
  return (
    <div className="surface-card rounded-2xl overflow-hidden transition-colors hover:border-line-strong">
      {/* Clickable area: thumbnail + title/price/meta */}
      <a
        href={listing.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex gap-3 px-3 pt-3 pb-2"
        onClick={() => posthog?.capture('listing_clicked', { listing_id: listing.id, source: listing.source, price: listing.price ?? 0 })}
      >
        {/* Thumbnail */}
        <div className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
          {imgSrc && !imgError ? (
            <Image
              src={imgSrc}
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

        {/* Title + price + meta */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <p className="text-sm font-semibold text-foreground line-clamp-2 wrap-anywhere">{listing.title}</p>
          <div className="flex items-baseline gap-2 min-w-0">
            <p className="text-base font-semibold truncate tabular-nums" style={{ color: 'var(--foreground)' }}>
              {priceFormatted}
            </p>
            {dkkApprox && (
              <span className="text-[11px] text-muted-foreground flex-shrink-0">{dkkApprox}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] mt-auto text-muted-foreground min-w-0">
            <MarketVerdictBadge
              verdict={marketVerdict}
              basisLabelKey={marketVerdictBasisLabel}
              t={t as unknown as Record<string, string>}
            />
            <PlatformBadge listing={listing} />
            {firstSeen && (
              <>
                <span className="flex-shrink-0">·</span>
                <span className="flex-shrink-0">{timeSince(firstSeen, locale)}</span>
              </>
            )}
            {getLocationDisplay(listing) && (
              <>
                <span className="flex-shrink-0">·</span>
                <span className="truncate">{getLocationDisplay(listing)}</span>
              </>
            )}
          </div>
        </div>
      </a>

      {/* Thomann new price — outside <a> to avoid nested anchor */}
      {thomannPriceDkk != null && thomannUrl && (
        <div className="px-3 pb-1">
          <a
            href={thomannUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Ny hos Thomann: {thomannPriceDkk.toLocaleString('da-DK')} kr →
          </a>
        </div>
      )}

      {/* CTAs / inline login capture — outside the <a> */}
      <div className="px-3 pb-3">
        {showCapture ? (
          captureSent ? (
            <div className="flex flex-col gap-1 py-1">
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
            <form onSubmit={handleCaptureSubmit} className="flex flex-col gap-1.5">
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
                className="w-full rounded-xl py-2 min-h-[44px] text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
          <div className="flex gap-2">
            {/* Heart — save listing */}
            <button
              onClick={(e) => { e.stopPropagation(); handleHeartClick() }}
              className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-xl text-xs font-semibold whitespace-nowrap transition-all"
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
              onClick={(e) => { e.stopPropagation(); handleWatchlistClick() }}
              disabled={creating}
              className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-xl text-xs font-semibold whitespace-nowrap transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--border)', color: 'var(--secondary-foreground)' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>notifications</span>
              {t.createWatchlist}
            </button>
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-xl text-xs font-semibold whitespace-nowrap border border-border hover:border-border/80 transition-colors"
              style={{ color: 'var(--foreground)' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>open_in_new</span>
              {t.viewListing}
            </a>
            {productSlug && (
              <a
                href={`/product/${productSlug}`}
                className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-xl text-xs font-semibold whitespace-nowrap border border-border hover:border-border/80 transition-colors"
                style={{ color: 'var(--muted-foreground)' }}
              >
                Se produktside →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
