'use client'

/**
 * The toast behaviour that /admin/match already had, extracted so a second
 * surface can use it instead of growing a second copy.
 *
 * NOTHING HERE IS NEW. The state slot, the 3000 ms lifetime, the "a new message
 * restarts the clock" rule and the unmount cleanup are lifted verbatim from
 * `app/admin/match/page.tsx`, which held them inline. That page now calls this
 * hook, so there is one implementation rather than two.
 *
 * There is deliberately no success/error variant: /admin/match has always
 * passed one string for both and prefixes failures itself. Adding a severity
 * would be inventing an API that no existing caller asked for.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react'

export function useToast(): [string | null, (message: string) => void] {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [toast, setToast] = useReducer(
    (_: string | null, next: string | null) => next,
    null as string | null,
  )

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 3000)
  }, [])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return [toast, showToast]
}
