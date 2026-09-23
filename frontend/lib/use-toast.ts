'use client'

/**
 * Toast state — the queue, the type, and the one asymmetry that is the point.
 *
 * PAN-122. This used to hold a single `string | null` and a 3000 ms timer, with
 * a comment saying a severity would be "inventing an API that no existing
 * caller asked for". That was true while toasts were an admin convenience. It
 * stopped being true when save/like and watchlist creation — public actions
 * whose only confirmation is a toast — were scheduled, and it was never true
 * for the failure messages the admin surfaces were already passing through it
 * as plain strings.
 *
 * THE ASYMMETRY (Astryx `Toast.doc.mjs`, verbatim):
 *
 *   type: 'info' | 'error'  — "Error toasts persist until dismissed."
 *   isAutoHide              — "Defaults to true for info, false for error."
 *
 * A confirmation may vanish: the visitor knows what they just did, and the
 * result is on the screen behind it. An error that vanishes before it is read
 * is an error nobody was told about — on /admin/products that is a failed
 * write the operator believes succeeded.
 *
 * The timers do NOT live here. A row owns its own countdown because it also
 * owns the hover/focus pause, and splitting those two across a module boundary
 * is how the pause silently stops working. This module owns the list.
 */

import { useCallback, useRef, useState } from 'react'

export type ToastType = 'info' | 'error'

/**
 * Astryx's `autoHideDuration` default, not the 3000 ms this file used to hold.
 * Their prop carries the reason: "Timed content must satisfy WCAG 2.2.1." Five
 * seconds is the measured floor for reading a short message; Klup's admin
 * messages name a listing AND a product and are longer than short. The row
 * pauses this countdown on hover and on focus, which is the part of 2.2.1 a
 * fixed duration alone cannot satisfy.
 */
export const TOAST_AUTO_HIDE_MS = 5000

/**
 * How many toasts are visible at once. Astryx defaults to 5; Klup raises
 * toasts one action at a time and three is already a pile-up worth capping.
 */
export const TOAST_MAX_VISIBLE = 3

export interface ToastOptions {
  type?: ToastType
  /** Overrides the type's default. Rarely needed; the default is the design. */
  isAutoHide?: boolean
  autoHideDuration?: number
}

export interface ToastEntry {
  id: number
  message: string
  type: ToastType
  isAutoHide: boolean
  autoHideDuration: number
}

/**
 * Drop one entry when the stack is over its cap.
 *
 * NOT simply "evict the oldest". A persistent toast is persistent precisely
 * because nobody has read it yet, so evicting an undismissed error to make
 * room for a "Gemt" would reintroduce the exact defect this module exists to
 * fix — the error would disappear unread, just via a different mechanism than
 * a timer. The oldest AUTO-HIDING entry goes first.
 *
 * If every visible entry is persistent the oldest still goes. The alternative
 * is a stack wedged by three unread errors, which would suppress every later
 * error too — strictly worse than losing the oldest of them.
 */
function evictToCap(entries: ToastEntry[]): ToastEntry[] {
  if (entries.length <= TOAST_MAX_VISIBLE) return entries
  const oldestAutoHiding = entries.findIndex((entry) => entry.isAutoHide)
  const drop = oldestAutoHiding === -1 ? 0 : oldestAutoHiding
  return entries.filter((_, index) => index !== drop)
}

export interface UseToast {
  /** Oldest first. The viewport renders them in this order. */
  toasts: ToastEntry[]
  showToast: (message: string, options?: ToastOptions) => void
  dismissToast: (id: number) => void
}

export function useToast(): UseToast {
  // Monotonic and never reused, which is what lets the viewport decide what it
  // has already announced by comparing a single number.
  const nextId = useRef(0)
  const [toasts, setToasts] = useState<ToastEntry[]>([])

  const showToast = useCallback((message: string, options: ToastOptions = {}) => {
    const type = options.type ?? 'info'
    const entry: ToastEntry = {
      id: nextId.current++,
      message,
      type,
      isAutoHide: options.isAutoHide ?? type === 'info',
      autoHideDuration: options.autoHideDuration ?? TOAST_AUTO_HIDE_MS,
    }
    setToasts((prev) => evictToCap([...prev, entry]))
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((entry) => entry.id !== id))
  }, [])

  return { toasts, showToast, dismissToast }
}
