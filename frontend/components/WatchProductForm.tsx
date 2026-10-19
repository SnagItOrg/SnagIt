'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/components/LocaleProvider'
import { fill } from '@/lib/i18n'
import { TextField } from '@/components/TextField'
import { Button } from '@/components/Button'
import { Icon } from '@/components/Icon'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { classifyOtpError, type OtpErrorKey } from '@/lib/otp-error'
import { track } from '@/lib/analytics'

/**
 * PAN-273. "Overvåg denne model": one model, one max price, one mail when the
 * matcher attaches a listing under it. Replaces the free-text modal on the
 * product page, which prefilled the canonical name into a search nobody
 * could predict the hits of.
 *
 * Five states, one visible at a time. The price step is the whole decision,
 * so it is the first thing asked; who the visitor is comes second and only
 * when the session has no user — the same magic-link path the search cards
 * use, with the intent parked in `pending_watchlist` and created on
 * `/watchlists?create_pending=1`.
 */
type Props = {
  productSlug: string
  productName: string
  /** The band's lower boundary, when the Danish or Reverb asking band has one. */
  suggestedMaxPrice: number | null
}

type Step = 'idle' | 'price' | 'email' | 'sent' | 'done'
type ErrorKey = OtpErrorKey | 'watchModelError'

export function WatchProductForm({ productSlug, productName, suggestedMaxPrice }: Props) {
  const { t } = useLocale()
  const [step, setStep] = useState<Step>('idle')
  const [maxPrice, setMaxPrice] = useState(suggestedMaxPrice != null ? String(suggestedMaxPrice) : '')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorKey | null>(null)
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

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    const address = email.trim()
    if (!address || busy) return
    setBusy(true)
    setError(null)
    try {
      localStorage.setItem('pending_watchlist', JSON.stringify({ product_slug: productSlug, max_price: price }))
    } catch {
      // No storage, no pending intent: the link still signs the visitor in.
    }
    // signInWithOtp RETURNS its failures (lib/otp-error.ts); the try/catch is
    // for the residue that throws, so the button never spins for good.
    let failure: OtpErrorKey | null
    try {
      const { error: otpError } = await createSupabaseBrowserClient().auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: true, emailRedirectTo: window.location.origin + '/auth/confirm' },
      })
      failure = classifyOtpError(otpError)
    } catch {
      failure = 'otpErrorGeneric'
    }
    setBusy(false)
    if (failure) setError(failure)
    else setStep('sent')
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

  if (step === 'sent') {
    return (
      <div className="flex flex-col gap-1 pt-4 border-t border-border">
        <div className="flex items-center gap-1.5">
          <Icon name="mark_email_read" style={{ fontSize: '18px', color: 'var(--foreground)' }} />
          <span className="text-sm font-semibold text-foreground">{t.checkInbox}</span>
        </div>
        <p className="text-xs text-muted-foreground">{t.watchModelCheckEmail}</p>
      </div>
    )
  }

  if (step === 'email') {
    return (
      <form onSubmit={handleEmailSubmit} className="flex flex-col gap-2 pt-4 border-t border-border">
        <p className="text-sm text-foreground">{t.watchModelAnonHint}</p>
        {errorLine}
        <TextField
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t.email}
          required
          autoFocus
          className="w-full rounded-xl px-4 py-3 text-sm"
        />
        <Button
          variant="primary"
          type="submit"
          disabled={busy || !email.trim()}
          className="w-full px-5 py-3 rounded-xl font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? '…' : t.sendLoginLink}
        </Button>
        <p className="text-xs text-center text-muted-foreground">{t.noPasswordNeeded}</p>
      </form>
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
