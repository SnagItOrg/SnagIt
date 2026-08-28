'use client'

/**
 * Consent state for the whole application.
 *
 * Stage 3 WP-5. See docs/stage-3-v1-decision-and-build-plan.md §12.4.2 and
 * §12.4.4.
 *
 * NOTHING NON-ESSENTIAL MOUNTS BENEATH THIS WHILE THE STATE IS `rejected` OR
 * `undecided`. The provider itself loads no tracker, imports no tracker, and
 * makes no request; it holds a preference and nothing else.
 *
 * WHY THE STATE STARTS `undecided` EVEN FOR A VISITOR WHO ALREADY AGREED.
 * Storage is not readable during server render, and reading it during the
 * first client render would produce a hydration mismatch. So the first render
 * is always the safe state, and the stored decision is applied in an effect.
 * The cost is that a consenting visitor's trackers start a few milliseconds
 * later. The benefit is that there is no code path — not a race, not a
 * suspense boundary, not a hydration error — in which a tracker loads before
 * the stored answer has actually been read. Consent-then-load has to survive
 * the awkward frames, or it is not a gate.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { useLocale } from '@/components/LocaleProvider'
import {
  CONSENT_STORAGE_KEY,
  allowsAnalytics,
  captureInternalFlagFromLocation,
  persistConsent,
  purgeTrackerStorage,
  readStoredConsent,
  type ConsentState,
} from '@/lib/consent'
import { detachAnalyticsClient, resetIdentity } from '@/lib/analytics'

interface ConsentContextValue {
  /** The current decision. `undecided` behaves exactly as `rejected`. */
  state: ConsentState
  /** False until the stored decision has been read. Nothing may load while false. */
  hydrated: boolean
  /** True only for `granted`. The single question a mount point should ask. */
  analyticsAllowed: boolean
  grant: () => void
  reject: () => void
  withdraw: () => void
}

const ConsentContext = createContext<ConsentContextValue>({
  state: 'undecided',
  hydrated: false,
  analyticsAllowed: false,
  grant: () => {},
  reject: () => {},
  withdraw: () => {},
})

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConsentState>('undecided')
  const [hydrated, setHydrated] = useState(false)
  const { locale } = useLocale()

  /**
   * Keep the document language in step with the chosen locale.
   *
   * PLACEMENT NOTE. `app/layout.tsx` renders `<html lang="da">` on the server
   * and cannot see client locale state, and `components/LocaleProvider.tsx` is
   * not a WP-5 file. This provider is the only client component WP-5 owns that
   * mounts on every page beneath the locale context, so the two-line sync
   * lives here. It is unrelated to consent and is marked as such.
   */
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    captureInternalFlagFromLocation(window.location.search)

    const stored = readStoredConsent()
    setState(stored)
    setHydrated(true)

    // A visitor who consented, was measured, and then cleared only the consent
    // key would otherwise keep tracker identifiers on disk with no consent
    // record justifying them. Sweep whenever we boot into a non-granted state.
    if (!allowsAnalytics(stored)) purgeTrackerStorage()
  }, [])

  /**
   * Withdrawal in one tab must stop sending in every tab, not at the next
   * navigation. `storage` fires in the other tabs of the same origin.
   */
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== null && event.key !== CONSENT_STORAGE_KEY) return
      const next = readStoredConsent()
      setState(next)
      if (!allowsAnalytics(next)) {
        resetIdentity()
        detachAnalyticsClient()
        purgeTrackerStorage()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const grant = useCallback(() => {
    persistConsent('granted')
    setState('granted')
  }, [])

  /**
   * Reject and withdraw differ only in what has to be cleaned up, and both are
   * a single click. Rejection is recorded so the banner never asks again: a
   * prompt that returns after a "no" is not a question, it is pressure.
   */
  const reject = useCallback(() => {
    persistConsent('rejected')
    setState('rejected')
    resetIdentity()
    detachAnalyticsClient()
    purgeTrackerStorage()
  }, [])

  const withdraw = useCallback(() => {
    // Order matters. reset() needs the live client, so it runs before the
    // client is dropped; the storage sweep runs last so that nothing the SDK
    // writes on its way out survives it.
    resetIdentity()
    detachAnalyticsClient()
    persistConsent('rejected')
    setState('rejected')
    purgeTrackerStorage()
  }, [])

  const value = useMemo<ConsentContextValue>(
    () => ({
      state,
      hydrated,
      analyticsAllowed: hydrated && allowsAnalytics(state),
      grant,
      reject,
      withdraw,
    }),
    [state, hydrated, grant, reject, withdraw],
  )

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>
}

export function useConsent(): ConsentContextValue {
  return useContext(ConsentContext)
}
