'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/components/LocaleProvider'
import { TextField } from '@/components/TextField'
import { Button } from '@/components/Button'
import { MarketVerdictBadge, SearchResultCard } from '@/components/SearchResultCard'
import { ListingErrorBoundary } from '@/components/ListingErrorBoundary'
import { stripDecorativeEmoji } from '@/lib/listing-title'
import { track } from '@/lib/analytics'
import { fill } from '@/lib/i18n'
import type { PriceCheckCause, PriceCheckResult } from '@/lib/price-check'

/**
 * Tjek prisen (PAN-207): one link in, one price answer out.
 * The answer is decided by /api/tjek-prisen; this page only renders it.
 */

const CAUSE_KEY = {
  not_a_link: 'priceCheckNotALink',
  unsupported_site: 'priceCheckUnsupportedSite',
  not_single_ad: 'priceCheckNotSingleAd',
  gone: 'priceCheckGone',
  no_price: 'priceCheckNoPrice',
  unreachable: 'priceCheckUnreachable',
} as const satisfies Record<PriceCheckCause, string>

const MARKET_KEY = { 'dk-asking': 'dkMarketTypical', 'reverb-sold': 'soldOnReverb' } as const

const kr = (n: number) => Math.round(n).toLocaleString('da-DK')

export default function TjekPrisenPage() {
  const { t } = useLocale()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [result, setResult] = useState<PriceCheckResult | null>(null)
  /** "Ingen af dem": the guesses go, the answer stays. */
  const [guessesDismissed, setGuessesDismissed] = useState(false)

  /** One check; with `pick`, the same link answered for the product the user chose (PAN-244 part 2). */
  async function check(pick?: string) {
    if (!url.trim() || loading) return
    setLoading(true)
    setFailed(false)
    setResult(null)
    setGuessesDismissed(false)
    try {
      const res = await fetch('/api/tjek-prisen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pick ? { url, pick } : { url }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as PriceCheckResult
      setResult(data)
      track('price_check_result', { state: data.state, source: data.source })
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  function choose(picked: 0 | 1 | 2 | 'none') {
    if (!result) return
    track('price_check_guess', { shown: result.guesses.length, picked })
    if (picked === 'none') setGuessesDismissed(true)
    else void check(result.guesses[picked].slug)
  }

  const message = !result
    ? null
    : result.state === 'cant_read'
      ? t[CAUSE_KEY[result.cause ?? 'unreachable']]
      : result.state === 'not_enough_data'
        ? result.dkFew ? null : t.priceCheckWatching
        : result.state === 'not_recognised'
          ? result.guide
            ? t.priceCheckUnknownModel
            : result.source === 'thomann' ? t.priceCheckNotFollowed : t.priceCheckUnknownItem
          : null
  const product = result?.product ?? null

  return (
    <main id="main-content" className="flex-1 min-w-0 shell-offset pb-24 md:pb-10">
      <div className="shell-reading pt-6 flex flex-col gap-5 max-w-xl">
        <div>
          <h1 className="type-title">{t.priceCheckHeading}</h1>
          <p className="type-body-secondary mt-2">{t.priceCheckIntro}</p>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); void check() }} className="flex flex-col gap-2">
          <label htmlFor="klup-price-check" className="sr-only">{t.priceCheckInputLabel}</label>
          {/* 16px text: anything smaller makes iOS Safari zoom on focus. */}
          <TextField
            id="klup-price-check"
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.dba.dk/…"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="w-full rounded-xl px-4 py-3 text-base font-medium"
          />
          <Button
            variant="primary"
            type="submit"
            disabled={loading}
            className="w-full min-h-[44px] rounded-xl px-5 text-sm font-semibold md:w-auto md:self-start md:px-6"
          >
            {loading ? t.loading : t.priceCheckHeading}
          </Button>
        </form>

        <div aria-live="polite">
          {failed && <p role="alert" className="type-body">{t.somethingWentWrong}</p>}
          {result && (
            <section className="surface-card rounded-2xl p-5 flex flex-col gap-3">
              {result.title && <h2 className="type-card-title">{result.title}</h2>}
              {result.fromPick && <p className="type-meta">{t.priceCheckFromPick}</p>}
              {result.priceDkk != null && (
                <p className="text-2xl font-semibold text-ink">
                  {kr(result.priceDkk)} kr
                  {result.source === 'thomann' && (
                    <span className="type-meta ml-2">{t.thomannNewPrice}</span>
                  )}
                </p>
              )}
              <MarketVerdictBadge
                verdict={result.verdict}
                basisLabelKey="verdictBasisDk"
                t={t as unknown as Record<string, string>}
              />
              {result.dkFew && (
                <p className="type-body">
                  <span className="type-meta block">{t.dkMarketAskingNow}</span>
                  {result.dkFew.low === result.dkFew.high
                    ? kr(result.dkFew.low)
                    : `${kr(result.dkFew.low)}–${kr(result.dkFew.high)}`} kr
                  {result.dkFew.median != null && (
                    <span className="type-meta block">{kr(result.dkFew.median)} kr {t.priceBandMedian}</span>
                  )}
                  <span className="type-meta block">
                    {result.dkFew.n === 1 ? t.dkFewCaveatOne : fill(t.dkFewCaveat, { n: result.dkFew.n })}
                  </span>
                </p>
              )}
              {result.ranges.map((r) => (
                <p key={r.market} className="type-body">
                  <span className="type-meta block">{t[MARKET_KEY[r.market]]}</span>
                  {r.low === r.high ? kr(r.low) : `${kr(r.low)}–${kr(r.high)}`} kr
                </p>
              ))}
              {message && <p className="type-body">{message}</p>}
              {result.guesses.length > 0 && !guessesDismissed && (
                <div className="flex flex-col gap-2">
                  <p className="type-body">{fill(t.priceCheckGuess, { label: result.guesses[0].name })}</p>
                  <div className="flex flex-wrap gap-2">
                    {result.guesses.map((g, i) => (
                      <Button
                        key={g.slug}
                        type="button"
                        variant={i === 0 ? 'primary' : 'secondary'}
                        disabled={loading}
                        onClick={() => choose(i as 0 | 1 | 2)}
                        className="min-h-[44px] rounded-xl px-4 text-sm font-semibold"
                      >
                        {g.name}
                      </Button>
                    ))}
                    <Button type="button" variant="secondary" disabled={loading} onClick={() => choose('none')} className="min-h-[44px] rounded-xl px-4 text-sm font-semibold">
                      {t.priceCheckGuessNone}
                    </Button>
                  </div>
                </div>
              )}
              {result.product && (
                <Link href={`/product/${result.product.slug}`} className="text-sm font-semibold text-ink underline underline-offset-4">
                  {result.product.name} →
                </Link>
              )}
              {result.guide && (
                <Link href={result.guide.href} className="text-sm font-semibold text-ink underline underline-offset-4">
                  {fill(t.priceCheckGuide, { label: result.guide.label })}
                </Link>
              )}
            </section>
          )}
        </div>

        {/* PAN-244: the product's own listings under the answer, Danish first. Outside the live region: five cards are not an announcement. */}
        {product && result && result.listings.length > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby="klup-price-check-listings">
            <h2 id="klup-price-check-listings" className="text-sm font-medium text-foreground">{t.priceCheckListings}</h2>
            <div className="grid-wall grid-wall-lg">
              {result.listings.map((listing) => (
                <ListingErrorBoundary key={listing.id} listingId={listing.id}>
                  <SearchResultCard
                    listing={{ ...listing, title: stripDecorativeEmoji(listing.title) }}
                    marketVerdict={listing.marketVerdict}
                    marketVerdictBasisLabel={listing.marketVerdictBasisLabel}
                    variant="list"
                    trackedProductSlug={product.slug}
                  />
                </ListingErrorBoundary>
              ))}
            </div>
            <Link href={`/product/${product.slug}`} className="text-sm font-semibold text-ink underline underline-offset-4 self-start">
              {t.priceCheckSeeAll}
            </Link>
          </section>
        )}
      </div>
    </main>
  )
}
