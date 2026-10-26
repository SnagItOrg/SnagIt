'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/components/LocaleProvider'
import { fill } from '@/lib/i18n'
import { TextField } from '@/components/TextField'
import { Button } from '@/components/Button'
import { Icon } from '@/components/Icon'
import { EmailCodeSignIn } from '@/components/EmailCodeSignIn'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { track } from '@/lib/analytics'

/**
 * PAN-273. "Overvåg denne model": one model, one max price, one mail when the
 * matcher attaches a listing under it. Replaces the free-text modal on the
 * product page, which prefilled the canonical name into a search nobody
 * could predict the hits of.
 *
 * Four states, one visible at a time. The price step is the whole decision,
 * so it is the first thing asked; who the visitor is comes second and only
 * when the session has no user — the e-mail and 6-digit code every sign-in
 * uses (PAN-300). The code signs the visitor in on this page and the watch is
 * created here. The intent is still parked in `pending_watchlist` first, so
 * the mail's fallback link creates it on `/watchlists?create_pending=1`.
 */
type Props = {
  productSlug: string
  productName: string
  /** The band's lower boundary, when the Danish or Reverb asking band has one. */
  suggestedMaxPrice: number | null
}

type Step = 'idle' | 'price' | 'email' | 'done'

export function WatchProductForm({ productSlug, productName, suggestedMaxPrice }: Props) {
  const { t } = useLocale()
  const [step, setStep] = useState<Step>('idle')
  const [maxPrice, setMaxPrice] = useState(suggestedMaxPrice != null ? String(suggestedMaxPrice) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'watchModelError' | null>(null)
  const priceId = useId()

  const price = Number(maxPrice)
  const priceOk = Number.isInteger(price) && price > 0

  async function handlePriceSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!priceOk || busy) return
    setBusy(true)
    setError(null)
    const supabase = createSupabaseBrowserClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setBusy(false)
      setStep('email')
      return
    }
    await createWatch()
  }

  async function createWatch() {
    let ok = false
    try {
      const res = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_slug: productSlug, max_price: price }),
      })
      ok = res.ok
    } catch {
      ok = false
    }
    setBusy(false)
    if (ok) {
      track('watchlist_created', { origin: 'product', product_slug: productSlug, has_max_price: true })
      setStep('done')
    } else {
      setError('watchModelError')
    }
  }

  function parkPendingWatch() {
    try {
      localStorage.setItem('pending_watchlist', JSON.stringify({ product_slug: productSlug, max_price: price }))
    } catch {
      // No storage, no pending intent: the code still signs the visitor in.
    }
  }

  async function handleSignedIn() {
    // Signed in on this page: create the watch here, not through the parked
    // intent, which would otherwise be created a second time on /watchlists.
    try { localStorage.removeItem('pending_watchlist') } catch { /* no storage */ }
    setStep('price')
    setBusy(true)
    await createWatch()
  }

  const errorLine = error && (
    <p role="alert" className="text-xs rounded-lg px-3 py-2 bg-destructive-subtle" style={{ color: 'var(--destructive-text)' }}>
      {t[error]}
    </p>
  )

  if (step === 'done') {
    return (
      <div className="flex flex-col gap-2 pt-4 border-t border-border">
        <div className="flex items-start gap-2">
          <Icon name="notifications_active" style={{ fontSize: '20px', color: 'var(--foreground)' }} className="flex-shrink-0 mt-0.5" />
          <p className="text-sm text-foreground">
            {fill(t.watchModelDone, { model: productName, price: price.toLocaleString('da-DK') })}
          </p>
        </div>
        <Link href="/watchlists" className="text-sm font-semibold text-foreground underline underline-offset-4 self-start">
          {t.watchModelSeeAll}
        </Link>
      </div>
    )
  }

  if (step === 'email') {
    return (
      <div className="flex flex-col gap-2 pt-4 border-t border-border">
        <p className="text-sm text-foreground">{t.watchModelAnonHint}</p>
        <EmailCodeSignIn compact autoFocus onEmailSubmit={parkPendingWatch} onSignedIn={handleSignedIn} />
      </div>
    )
  }

  if (step === 'price') {
    return (
      <form onSubmit={handlePriceSubmit} className="flex flex-col gap-2 pt-4 border-t border-border">
        <label htmlFor={priceId} className="text-sm text-foreground">
          {fill(t.watchModelPriceLead, { model: productName })}
        </label>
        {errorLine}
        <div className="flex items-center gap-2">
          <TextField
            id={priceId}
            type="number"
            inputMode="numeric"
            min={1}
            step={100}
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            aria-label={t.watchModelPriceLabel}
            required
            autoFocus
            className="w-full rounded-xl px-4 py-3 text-lg font-medium tabular-nums"
          />
          <span className="text-sm font-semibold text-muted-foreground">kr</span>
        </div>
        <Button
          variant="primary"
          type="submit"
          disabled={busy || !priceOk}
          className="w-full px-5 py-3 rounded-xl font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? '…' : t.watchModelSubmit}
        </Button>
        <button
          type="button"
          onClick={() => { setStep('idle'); setError(null) }}
          className="text-xs text-muted-foreground text-center w-full transition-opacity hover:opacity-70"
        >
          {t.cancel}
        </button>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-2 pt-4 border-t border-border">
      <Button
        variant="primary"
        onClick={() => setStep('price')}
        className="w-full px-5 py-3 rounded-xl font-semibold text-sm"
      >
        {t.watchModel}
      </Button>
      <p className="text-xs text-muted-foreground text-center">{t.watchModelHint}</p>
    </div>
  )
}
