'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/* ==========================================================================
   Dialog — the modal contract, owned in one place.

   PAN-112. `CreateWatchlistModal` was a `fixed inset-0` with a backdrop and a
   panel and nothing else: no `role`, no `aria-modal`, no accessible name, no
   Escape, no focus management. A screen reader read it as part of the page it
   was covering, and a keyboard user could Tab straight out of it into content
   they could not see and could not click.

   WHY A PRIMITIVE, WITH ONE CALLER

   `CreateWatchlistModal` is the only modal in the product today, so extracting
   a component for it is the thing that is usually wrong. It is right here for
   one reason: the value is not the markup, it is the CONTRACT — six behaviours
   that are easy to half-implement and hard to notice missing. Written inline,
   the next modal copies the markup and re-loses two of them. Written here,
   they are the type signature.

   The contract:

     1. `role="dialog"` and `aria-modal="true"` on the panel.
     2. An accessible name. `labelledBy` is REQUIRED, not optional — a dialog
        with no name is the defect this file exists to fix, so it is a type
        error rather than a review comment.
     3. Escape closes.
     4. Focus moves into the panel on open and RETURNS to whatever opened it on
        close. A dialog that drops focus on `<body>` sends a keyboard user back
        to the top of the document.
     5. Tab is trapped. Focus cycles within the panel in both directions.
     6. The page behind does not scroll.

   The dialog does NOT own its own open state. `open` is a prop, because the
   thing that decides a dialog should exist is always the feature, never the
   dialog. It does own its CLOSING state, which is a rendering concern: the
   panel has to outlive the `open=false` that dismissed it for exactly as long
   as its exit animation.

   MOTION

   `.dialog-backdrop` / `.dialog-panel` in globals.css. Enter on
   `--ease-standard`, exit on `--ease-exit`, both on `--duration-medium-min`.
   The exit duration is read back from the token rather than restated here, so
   the CSS and the unmount cannot drift.
   ========================================================================== */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Milliseconds in a CSS duration token, read from the cascade. */
function durationOf(token: string): number {
  if (typeof window === 'undefined') return 0
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  if (raw.endsWith('ms')) return parseFloat(raw)
  if (raw.endsWith('s')) return parseFloat(raw) * 1000
  return 0
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

type Props = {
  open: boolean
  onClose: () => void
  /**
   * The id of the element that names this dialog. Required: see contract 2.
   */
  labelledBy: string
  /** Classes for the panel. The caller owns its shape; this file owns its behaviour. */
  panelClassName?: string
  children: React.ReactNode
}

export function Dialog({ open, onClose, labelledBy, panelClassName = '', children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusTo = useRef<HTMLElement | null>(null)
  // 'entering' for one frame so the enter transition has a value to move FROM.
  const [phase, setPhase] = useState<'entering' | 'open' | 'closing' | null>(null)

  useEffect(() => {
    if (open) {
      returnFocusTo.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      setPhase('entering')
      // Two frames, not one. A single rAF can still land in the same paint as
      // the mount, and a transition whose start and end values arrive together
      // does not run at all — the panel would appear rather than arrive.
      let inner = 0
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setPhase('open'))
      })
      return () => {
        cancelAnimationFrame(outer)
        cancelAnimationFrame(inner)
      }
    }
    // Not open. If nothing is mounted there is nothing to play out.
    setPhase((p) => (p == null ? null : 'closing'))
  }, [open])

  // Play the exit, then unmount. Reduced motion skips straight to unmounted:
  // there is no travel to wait for, so waiting would only delay the release of
  // focus back to the trigger.
  useEffect(() => {
    if (phase !== 'closing') return
    const ms = prefersReducedMotion() ? 0 : durationOf('--duration-medium-min')
    const id = window.setTimeout(() => setPhase(null), ms)
    return () => window.clearTimeout(id)
  }, [phase])

  const mounted = phase != null

  // Focus in on open, and back out on unmount. The restore runs in the same
  // effect's cleanup so it cannot be skipped by an early return above it.
  useEffect(() => {
    if (!mounted) return
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    // An `autoFocus` child has already claimed focus by now; re-focusing the
    // first focusable would fight it, so only act when focus is still outside.
    if (panelRef.current && !panelRef.current.contains(document.activeElement)) {
      ;(first ?? panelRef.current).focus()
    }
    const trigger = returnFocusTo.current
    return () => {
      if (trigger && document.contains(trigger)) trigger.focus()
    }
  }, [mounted])

  // Scroll lock. Restores the caller's own value rather than assuming 'auto' —
  // a page that was already locked must stay locked when this one closes.
  useEffect(() => {
    if (!mounted) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [mounted])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = Array.prototype.slice
        .call(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el: HTMLElement) => el.offsetParent !== null || el === document.activeElement)
      if (items.length === 0) {
        // Nothing to move to, so Tab must not escape the panel.
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    },
    [onClose],
  )

  if (!mounted) return null

  return (
    <>
      <div
        className="dialog-backdrop fixed inset-0 bg-black/50 z-50"
        data-state={phase}
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed bottom-0 left-0 right-0 md:inset-0 md:flex md:items-center md:justify-center z-50 pointer-events-none">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          data-state={phase}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={`dialog-panel surface-overlay pointer-events-auto outline-none ${panelClassName}`}
        >
          {children}
        </div>
      </div>
    </>
  )
}
