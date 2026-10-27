'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { TextField } from '@/components/TextField'
import { Button } from '@/components/Button'
import { fill } from '@/lib/i18n'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { track } from '@/lib/analytics'
import type { OtpErrorKey, VerifyErrorKey } from '@/lib/otp-error'
import {
  CODE_LENGTH,
  fillCode,
  isCompleteCode,
  resendSecondsLeft,
  sendEmailCode,
  verifyEmailCode,
} from '@/lib/email-code'

/**
 * PAN-300 — "Fortsæt med e-mail", then a 6-digit code. The only way into an
 * account, on `/login` and inline on the product page, the listing cards and
 * the search page's demand panel. New and returning visitors see the same two
 * steps; what happens after the code is the caller's (`onSignedIn`).
 *
 * The code step: six boxes with `inputMode="numeric"`, the first carrying
 * `autocomplete="one-time-code"` so iOS and Android offer the code from the
 * mail; a paste or an autofill into any box fills them all (`fillCode`); the
 * sixth digit submits; "Send ny kode" waits out the cooldown; "Forkert
 * e-mail?" goes back with the address kept.
 *
 * Accessibility, from Astryx (clone 0aec0ee, read not imported):
 *   - status messages go to PERSISTENT live regions, errors assertive and the
 *     rest polite, because a region mounted with its content is not reliably
 *     announced (`core/src/FieldStatus/useFieldStatusAnnouncement.ts:22-30`,
 *     `core/src/Field/Field.spec.md` FR4). Both regions are rendered for the
 *     component's whole life and only their text changes;
 *   - the label is a native `<label htmlFor>` (Field.spec.md FR1), and the
 *     six boxes are a `role="group"` named by the code label, each box
 *     labelled with its position;
 *   - text controls stay at 16px or more so iOS does not zoom on focus
 *     (`core/src/inputFontFloor.test.ts:18-24`).
 */
type Props = {
  /** Runs once the code is accepted and the session cookie is written. */
  onSignedIn: (result: { isNewUser: boolean }) => void | Promise<void>
  /**
   * Runs when an address is submitted, before its first code is sent — to
   * park an intent for the mail's fallback link, or to record a demand signal
   * that must not depend on the send succeeding. Not called on "Send ny kode".
   */
  onEmailSubmit?: (email: string) => void
  /** Where the mail's fallback link returns to, through `/auth/confirm`. */
  next?: string | null
  /** The e-mail field's visible label. Defaults to "E-mail". */
  emailLabel?: string
  /** Inline on a card or panel: smaller type and spacing, same behaviour. */
  compact?: boolean
  autoFocus?: boolean
}

type Step = 'email' | 'code'
type ErrorKey = OtpErrorKey | VerifyErrorKey

const EMPTY = Array.from({ length: CODE_LENGTH }, () => '')

export function EmailCodeSignIn({ onSignedIn, onEmailSubmit, next, emailLabel, compact = false, autoFocus = false }: Props) {
  const { t } = useLocale()
  const id = useId()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [digits, setDigits] = useState<string[]>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorKey | null>(null)
  /** Polite status line: a new code was sent, or the visitor is signed in. */
  const [status, setStatus] = useState<string>('')
  const [sentAt, setSentAt] = useState(0)
  const [now, setNow] = useState(0)
  const emailRef = useRef<HTMLInputElement>(null)
  const boxRefs = useRef<(HTMLInputElement | null)[]>([])
  /** Strict mode and a fast sixth keystroke must not verify one code twice. */
  const verifying = useRef(false)

  const secondsLeft = sentAt ? resendSecondsLeft(sentAt, now) : 0

  // The cooldown ticks only while there is one to show.
  useEffect(() => {
    if (step !== 'code' || secondsLeft === 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [step, secondsLeft])

  // Focus follows the step: the first box on arrival, the address on the way back.
  useEffect(() => {
    if (step === 'code') boxRefs.current[0]?.focus()
  }, [step])

  function redirectTo(): string {
    const query = next ? `?next=${encodeURIComponent(next)}` : ''
    return `${window.location.origin}/auth/confirm${query}`
  }

  async function send(address: string): Promise<boolean> {
    const failure = await sendEmailCode(createSupabaseBrowserClient().auth, address, redirectTo())
    setError(failure)
    if (failure) return false
    const sent = Date.now()
    setSentAt(sent)
    setNow(sent)
    return true
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    const address = email.trim()
    if (!address || busy) return
    setBusy(true)
    setStatus('')
    onEmailSubmit?.(address)
    const ok = await send(address)
    setBusy(false)
    if (ok) {
      setDigits(EMPTY)
      setStep('code')
    }
  }

  async function handleResend() {
    if (busy || secondsLeft > 0) return
    setBusy(true)
    setStatus('')
    const ok = await send(email.trim())
    setBusy(false)
    if (ok) {
      setDigits(EMPTY)
      setStatus(t.emailCodeResent)
      boxRefs.current[0]?.focus()
    }
  }

  function handleWrongEmail() {
    setStep('email')
    setDigits(EMPTY)
    setError(null)
    setStatus('')
    // After the step has rendered the field again.
    window.setTimeout(() => emailRef.current?.focus(), 0)
  }

  async function verify(code: string) {
    if (verifying.current || !isCompleteCode(code)) return
    verifying.current = true
    setBusy(true)
    setError(null)
    setStatus(t.emailCodeVerifying)
    const result = await verifyEmailCode(createSupabaseBrowserClient().auth, email.trim(), code)
    if (result.error) {
      verifying.current = false
      setBusy(false)
      setStatus('')
      setError(result.error)
      setDigits(EMPTY)
      boxRefs.current[0]?.focus()
      return
    }
    if (result.isNewUser) track('signup_completed', { method: 'email_code' })
    setStatus(t.emailCodeSignedIn)
    // Stays busy: the caller navigates away or swaps this component out.
    await onSignedIn({ isNewUser: result.isNewUser })
  }

  function handleBoxInput(index: number, value: string) {
    // Typing over a filled box appends to its digit; keep the new one.
    const old = digits[index]
    const typed = old && value.length === 2 ? (value[0] === old ? value[1] : value[0]) : value
    const filled = fillCode(digits, index, typed)
    setDigits(filled.digits)
    if (error) setError(null)
    const code = filled.digits.join('')
    if (isCompleteCode(code)) void verify(code)
    else boxRefs.current[filled.focus]?.focus()
  }

  function handleBoxKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      e.preventDefault()
      setDigits(fillCode(digits, index - 1, '').digits)
      boxRefs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      boxRefs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
      e.preventDefault()
      boxRefs.current[index + 1]?.focus()
    }
  }

  function handlePaste(index: number, e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    handleBoxInput(index, e.clipboardData.getData('text'))
  }

  const errorId = `${id}-error`
  const codeLabelId = `${id}-code-label`
  const gap = compact ? 'gap-2' : 'gap-4'
  const fieldClass = compact
    ? 'w-full rounded-xl px-3 py-2.5 text-base'
    : 'w-full rounded-xl px-4 py-3 text-base'
  const buttonClass = `w-full min-h-[44px] rounded-xl font-semibold text-sm transition-opacity disabled:opacity-50 disabled:cursor-not-allowed ${compact ? 'py-2' : 'py-3'}`

  return (
    <div>
      {/* Persistent live regions — first in the tree, so they survive the
          step change; only their text is swapped. Empty, they take no space. */}
      <div id={errorId} aria-live="assertive" aria-atomic="true">
        {error && (
          <p className={`text-sm rounded-lg px-3 py-2 bg-destructive-subtle ${compact ? 'mb-2' : 'mb-4'}`} style={{ color: 'var(--destructive-text)' }}>
            {t[error]}
          </p>
        )}
      </div>
      <div aria-live="polite" aria-atomic="true">
        {status && <p className={`text-sm text-muted-foreground ${compact ? 'mb-2' : 'mb-4'}`}>{status}</p>}
      </div>
      {step === 'email' ? (
        <form onSubmit={handleEmailSubmit} className={`flex flex-col ${gap}`}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-email`} className="text-sm font-semibold text-foreground">
              {emailLabel ?? t.email}
            </label>
            <TextField
              ref={emailRef}
              id={`${id}-email`}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (error) setError(null) }}
              placeholder={t.emailPlaceholder}
              required
              autoFocus={autoFocus}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={fieldClass}
            />
          </div>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || !email.trim()}
            className={buttonClass}
          >
            {busy ? t.emailCodeSending : t.emailCodeContinue}
          </Button>
          <p className="text-xs text-center text-muted-foreground">{t.emailCodeHint}</p>
        </form>
      ) : (
        <div className={`flex flex-col ${gap}`}>
          <p className="text-sm text-foreground">
            {t.emailCodeSentTo}{' '}
            <span className="font-semibold break-all">{email.trim()}</span>
          </p>
          <div className="flex flex-col gap-1.5">
            <span id={codeLabelId} className="text-sm font-semibold text-foreground">
              {t.emailCodeLabel}
            </span>
            <div
              role="group"
              aria-labelledby={codeLabelId}
              aria-describedby={error ? errorId : undefined}
              aria-busy={busy || undefined}
              className="grid grid-cols-6 gap-1.5 sm:gap-2"
            >
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { boxRefs.current[i] = el }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  aria-label={fill(t.emailCodeDigit, { n: i + 1, total: CODE_LENGTH })}
                  aria-invalid={error ? true : undefined}
                  value={digit}
                  readOnly={busy}
                  onChange={(e) => handleBoxInput(i, e.target.value)}
                  onKeyDown={(e) => handleBoxKeyDown(i, e)}
                  onPaste={(e) => handlePaste(i, e)}
                  onFocus={(e) => e.currentTarget.select()}
                  className={`field w-full min-w-0 rounded-xl text-center font-semibold tabular-nums ${compact ? 'h-11 text-lg' : 'h-12 text-xl'}`}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <button
              type="button"
              onClick={handleResend}
              disabled={busy || secondsLeft > 0}
              className="min-h-[44px] text-sm font-semibold text-foreground underline underline-offset-4 disabled:no-underline disabled:text-muted-foreground disabled:cursor-not-allowed"
            >
              {secondsLeft > 0 ? fill(t.emailCodeResendIn, { s: secondsLeft }) : t.emailCodeResend}
            </button>
            <button
              type="button"
              onClick={handleWrongEmail}
              disabled={busy}
              className="min-h-[44px] text-sm text-muted-foreground underline underline-offset-4 disabled:opacity-50"
            >
              {t.emailCodeWrongEmail}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t.emailCodeSpamHint}</p>
        </div>
      )}
    </div>
  )
}
