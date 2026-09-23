'use client'

/* ==========================================================================
   Toast — the transient-message contract, owned in one place.

   PAN-122. This file used to be a 20-line `fixed bottom-6 left-1/2` div with
   one `message: string` prop. It could not say that something had FAILED: a
   save, a rejected write and a network error all rendered identically and all
   vanished on whatever timer the caller happened to own.

   WHY A PRIMITIVE, AND WHY NOW

   The ticket called this mostly-admin. That was true of the callers, not of
   the direction: save/like on a listing and watchlist creation are public
   actions whose only confirmation is a toast. Built as an admin utility it
   would be rebuilt in a month, so it is built as a public primitive — which
   is also why the announcement, the dismiss control and the consent-banner
   collision below are treated as requirements rather than polish.

   THE CONTRACT

     1. `type: 'info' | 'error'`, and `isAutoHide` defaults TRUE for info and
        FALSE for error. Astryx's asymmetry, and the point of the ticket: a
        confirmation may vanish, an error may not. Owned by `lib/use-toast.ts`.
     2. `role="status"` for info, `role="alert"` for error — plus the singleton
        live regions below, which are what actually makes the announcement
        happen. See ANNOUNCEMENT.
     3. A dismiss control on every toast. Keyboard-operable, with an accessible
        name from `lib/i18n.ts`.
     4. A viewport that stacks, in a defined order, with a cap.
     5. Nothing keyed on `vw` or on the viewport's centre. See POSITION.

   The viewport does NOT own its own list. `toasts` is a prop, exactly as
   `Dialog`'s `open` is a prop: the thing that decides a message should exist
   is always the feature, never the overlay. It DOES own the exit, which is a
   rendering concern — a row has to outlive its removal for as long as its exit
   animation, and `lib/use-toast.ts` has no business knowing that.

   POSITION

   Bottom, inline-start, as a column. Astryx's default is actually `bottomEnd`;
   `bottomStart` is one of its four first-class placements and is the one the
   owner asked for. Either is defensible — what is NOT defensible is the
   viewport centre this file used to use, because PAN-120 makes the sidebar
   resizable and the content area then stops sharing a centre with the window.

   Nothing here is viewport-relative. The stack spans the inline axis and the
   card is capped in `rem`, so there is no `vw` to go wrong and no `left-1/2`
   to be centred on the wrong box. `--toast-inset-inline-start` is the single
   seam PAN-120 can set to push the stack past a sidebar; it defaults to 0 and
   this package does not read their code.

   Astryx recorded a trap in their own viewport that is worth not
   rediscovering: a box that spans both inset-inline edges cannot also be
   `width: fit-content`, and if it is, an end-aligned toast lands to the right
   of a box that is itself sitting on the left ("Measured in Chromium at 1200px
   wide: 438px box at x=0, end-positioned toast landing at x=19"). We span the
   axis, so `align-items` is set explicitly in `globals.css` rather than left
   to a default.

   ANNOUNCEMENT — the part that is not the `role` attribute

   Most screen readers do NOT announce a live region that is created together
   with its content: the region has to already exist so the insertion reads as
   a change. A toast that mounts as `<div role="status">Gemt</div>` is
   therefore frequently announced by nobody, which is the silent half of
   defect 2 in the ticket — adding `role="alert"` alone would not have fixed
   it. Astryx solved this with a singleton pair of regions mounted up front and
   mutated later; `announce()` below is the same shape. The per-toast `role`
   stays, for browse-mode discoverability.

   MOTION

   `.toast-viewport` / `.toast` in globals.css, same family and same tokens as
   `.dialog-panel`: `--ease-standard` in, `--ease-exit` out, both on
   `--duration-medium-min`. The exit duration is read back from the token, so
   the CSS and the unmount cannot drift.
   ========================================================================== */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import type { ToastEntry } from '@/lib/use-toast'

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

/* --- the singleton live regions ---------------------------------------- */

const VISUALLY_HIDDEN =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;' +
  'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;' +
  'inset-block-start:0;inset-inline-start:0;pointer-events:none;'

/**
 * How long an announcement sits in its region before being cleared. Long
 * enough to be read out; clearing afterwards keeps a stale "Gemt" out of the
 * accessibility tree for anyone who browses the DOM later.
 */
const ANNOUNCE_CLEAR_MS = 2000

let regions: { polite: HTMLElement; assertive: HTMLElement } | null = null
const clearTimers: Record<'polite' | 'assertive', number | null> = {
  polite: null,
  assertive: null,
}

function ensureRegions(): typeof regions {
  if (typeof document === 'undefined') return null
  if (!regions) {
    const make = (politeness: 'polite' | 'assertive') => {
      const el = document.createElement('div')
      el.setAttribute('data-klup-live-region', politeness)
      el.setAttribute('aria-live', politeness)
      el.setAttribute('aria-atomic', 'true')
      el.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status')
      el.style.cssText = VISUALLY_HIDDEN
      document.body.appendChild(el)
      return el
    }
    regions = { polite: make('polite'), assertive: make('assertive') }
  }
  // Re-attach rather than recreate: a region that was torn out (a test, a
  // stray DOM mutation) must not become a second pair, or one of them stops
  // being the region anything writes to.
  if (!regions.polite.isConnected) document.body.appendChild(regions.polite)
  if (!regions.assertive.isConnected) document.body.appendChild(regions.assertive)
  return regions
}

function announce(message: string, politeness: 'polite' | 'assertive'): void {
  const pair = ensureRegions()
  if (!pair) return
  const target = pair[politeness]
  if (clearTimers[politeness] != null) window.clearTimeout(clearTimers[politeness]!)
  target.textContent = message
  clearTimers[politeness] = window.setTimeout(() => {
    clearTimers[politeness] = null
    target.textContent = ''
  }, ANNOUNCE_CLEAR_MS)
}

/* --- one row ------------------------------------------------------------ */

type RowProps = {
  entry: ToastEntry
  isExiting: boolean
  onDismiss: (id: number) => void
}

function ToastRow({ entry, isExiting, onDismiss }: RowProps) {
  const { t } = useLocale()
  // 'entering' for one paint so the enter transition has a value to move FROM.
  const [phase, setPhase] = useState<'entering' | 'open'>('entering')
  // Hover or keyboard focus holds the countdown. Without this, a toast can
  // unmount out from under the very dismiss button a keyboard user has just
  // tabbed to, which drops focus to <body>.
  const [isHeld, setIsHeld] = useState(false)

  useEffect(() => {
    // Two frames, not one: a single rAF can land in the same paint as the
    // mount, and a transition whose start and end values arrive together does
    // not run at all. Same reasoning as Dialog.
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setPhase('open'))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [])

  useEffect(() => {
    if (!entry.isAutoHide || isExiting || isHeld) return
    const id = window.setTimeout(() => onDismiss(entry.id), entry.autoHideDuration)
    return () => window.clearTimeout(id)
    // Releasing a hold restarts the countdown rather than resuming it. The
    // message is short and the visitor has just stopped reading it; a resumed
    // 400ms remainder would be the same as no pause at all.
  }, [entry.isAutoHide, entry.autoHideDuration, entry.id, isExiting, isHeld, onDismiss])

  const isError = entry.type === 'error'

  return (
    <div
      className={`toast ${isError ? 'toast--error' : 'toast--info'}`}
      data-state={isExiting ? 'closing' : phase}
      role={isError ? 'alert' : 'status'}
      onPointerEnter={() => setIsHeld(true)}
      onPointerLeave={() => setIsHeld(false)}
      onFocus={() => setIsHeld(true)}
      onBlur={() => setIsHeld(false)}
    >
      {isError && (
        <>
          {/* Colour is never the only signal: the glyph carries the
              distinction for anyone who cannot separate the two fills. */}
          <span className="material-symbols-outlined toast__icon" aria-hidden="true">
            error
          </span>
          <span className="sr-only">{t.toastErrorLabel}</span>
        </>
      )}
      <span className="toast__message">{entry.message}</span>
      <button
        type="button"
        data-toast-dismiss
        className="toast__dismiss"
        aria-label={t.toastDismiss}
        disabled={isExiting}
        onClick={() => onDismiss(entry.id)}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          close
        </span>
      </button>
    </div>
  )
}

/* --- the viewport ------------------------------------------------------- */

type Props = {
  /** Oldest first. From `useToast()`. */
  toasts: ToastEntry[]
  onDismiss: (id: number) => void
}

export function ToastViewport({ toasts, onDismiss }: Props) {
  const { t } = useLocale()
  const containerRef = useRef<HTMLDivElement>(null)
  const [exiting, setExiting] = useState<ReadonlySet<number>>(() => new Set())
  // Ids are monotonic and never reused, so "what have I already announced" is
  // one number rather than a set that would grow for the life of the page.
  const lastAnnounced = useRef(-1)
  const shouldRestoreFocus = useRef(false)

  useEffect(() => {
    for (const entry of toasts) {
      if (entry.id <= lastAnnounced.current) continue
      lastAnnounced.current = entry.id
      announce(entry.message, entry.type === 'error' ? 'assertive' : 'polite')
    }
  }, [toasts])

  const requestDismiss = useCallback(
    (id: number) => {
      setExiting((prev) => {
        if (prev.has(id)) return prev
        const next = new Set(prev)
        next.add(id)
        return next
      })
      const container = containerRef.current
      shouldRestoreFocus.current =
        !!container && container.contains(document.activeElement)
      const ms = prefersReducedMotion() ? 0 : durationOf('--duration-medium-min')
      window.setTimeout(() => {
        setExiting((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        onDismiss(id)
      }, ms)
    },
    [onDismiss],
  )

  // A dismissed row takes the focused button with it. Hand focus to the
  // nearest surviving toast rather than letting it fall to <body>, which would
  // send a keyboard user back to the top of the document.
  useEffect(() => {
    if (!shouldRestoreFocus.current) return
    if (document.activeElement && document.activeElement !== document.body) return
    shouldRestoreFocus.current = false
    const buttons = containerRef.current?.querySelectorAll<HTMLElement>(
      '[data-toast-dismiss]',
    )
    buttons?.[buttons.length - 1]?.focus()
  }, [toasts])

  if (toasts.length === 0) return null

  return (
    <div
      ref={containerRef}
      className="toast-viewport"
      role="region"
      aria-label={t.toastRegionLabel}
    >
      {toasts.map((entry) => (
        <ToastRow
          key={entry.id}
          entry={entry}
          isExiting={exiting.has(entry.id)}
          onDismiss={requestDismiss}
        />
      ))}
    </div>
  )
}
