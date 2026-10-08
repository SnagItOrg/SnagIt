'use client'

import { useId, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Dialog } from '@/components/Dialog'
import { Button } from '@/components/Button'
import { TextField } from '@/components/TextField'
import { useLocale } from '@/components/LocaleProvider'
import { track } from '@/lib/analytics'
import { FEEDBACK_KINDS, type FeedbackKind, type FeedbackSurface } from '@/lib/feedback'

/**
 * PAN-251: "Giv feedback" — one link, one small sheet.
 *
 * One choice, an optional text, an optional email ("may we answer you?"), one
 * send. The page path, the product and the tjek-prisen state ride along; the
 * visitor's IP never does. A honeypot field no person sees catches bots. The
 * sheet is the site's one Dialog, so Escape, focus and the backdrop behave as
 * everywhere else.
 */

const KIND_KEY = {
  wrong_product: 'feedbackWrongProduct',
  wrong_price: 'feedbackWrongPrice',
  missing: 'feedbackMissing',
  other: 'feedbackOther',
} as const

export function FeedbackLink({
  surface,
  productSlug,
  state,
  className = '',
}: {
  surface: FeedbackSurface
  productSlug?: string | null
  state?: string | null
  className?: string
}) {
  const { t } = useLocale()
  const pathname = usePathname()
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<FeedbackKind>('other')
  const [text, setText] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'sending') return
    setStatus('sending')
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, surface, path: pathname, text, email, productSlug: productSlug ?? null, state: state ?? null, website }),
      })
      if (!res.ok) throw new Error(String(res.status))
      // Kind and surface only: never the text, never the email.
      track('feedback_sent', { kind, surface })
      setStatus('sent')
    } catch {
      setStatus('failed')
    }
  }

  function close() {
    setOpen(false)
    if (status === 'sent') {
      setKind('other')
      setText('')
      setEmail('')
    }
    if (status !== 'sending') setStatus('idle')
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`min-h-[44px] text-sm font-semibold text-ink underline underline-offset-4 ${className}`}
      >
        {t.feedbackLink}
      </button>
      <Dialog
        open={open}
        onClose={close}
        labelledBy={titleId}
        panelClassName="w-full md:max-w-lg rounded-t-2xl md:rounded-2xl p-6 flex flex-col gap-5"
      >
        <h2 id={titleId} className="type-card-title">{t.feedbackTitle}</h2>
        {status === 'sent' ? (
          <>
            <p className="type-body">{t.feedbackSent}</p>
            <Button variant="primary" type="button" onClick={close} className="min-h-[44px] self-start rounded-xl px-5 text-sm font-semibold">
              {t.feedbackClose}
            </Button>
          </>
        ) : (
          <form onSubmit={send} className="flex flex-col gap-4">
            <fieldset className="flex flex-wrap gap-2">
              <legend className="type-meta mb-2">{t.feedbackKindLabel}</legend>
              {FEEDBACK_KINDS.map((k) => (
                <label
                  key={k}
                  className="flex min-h-[44px] cursor-pointer items-center rounded-xl px-3 text-sm font-semibold"
                  style={kind === k
                    ? { backgroundColor: 'var(--secondary)', border: '1px solid var(--border)', color: 'var(--foreground)' }
                    : { backgroundColor: 'transparent', border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
                >
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                  {t[KIND_KEY[k]]}
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1">
              <span className="type-meta">{t.feedbackTextLabel}</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={2000}
                rows={4}
                className="field w-full rounded-xl px-4 py-3 text-base"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="type-meta">{t.feedbackEmailLabel}</span>
              <TextField
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full rounded-xl px-4 py-3 text-base"
              />
            </label>
            {/* The honeypot: off-screen, out of the tab order, never seen by a person. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                Website
                <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
            </div>
            {status === 'failed' && <p role="alert" className="type-body">{t.feedbackFailed}</p>}
            <div className="flex flex-col gap-2 md:flex-row">
              <Button variant="primary" type="submit" disabled={status === 'sending'} className="w-full min-h-[44px] rounded-xl px-5 text-sm font-semibold md:w-auto">
                {status === 'sending' ? t.loading : t.feedbackSend}
              </Button>
              <Button variant="secondary" type="button" onClick={close} className="w-full min-h-[44px] rounded-xl px-5 text-sm font-semibold md:w-auto">
                {t.feedbackClose}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  )
}
