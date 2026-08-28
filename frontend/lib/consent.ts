/**
 * The consent model.
 *
 * Stage 3 WP-5. See docs/stage-3-v1-decision-and-build-plan.md §12.4.2 and
 * §12.4.4.
 *
 * PURE MODULE. No React, no posthog-js, no DOM access at module scope, so the
 * node test runner can import it directly and so that importing it can never
 * be the thing that loads a tracker.
 *
 * THREE STATES, AND ONLY ONE OF THEM ALLOWS ANYTHING.
 *
 *   undecided  the visitor has not answered. Behaves EXACTLY as `rejected`.
 *   rejected   the visitor said no. No non-essential tracker loads.
 *   granted    the visitor said yes, deliberately, on a surface where saying
 *              no cost exactly the same effort.
 *
 * `undecided` is the initial state, it is also the state during server render
 * and during the first client render before hydration reads storage. That is
 * deliberate: the safe state is the one you get by default and the one you get
 * when anything goes wrong. There is no implied, scroll-based, timeout-based
 * or continued-use consent, and there is no state in which a tracker loads
 * while we work out what the visitor wanted.
 *
 * WHY localStorage AND NOT A COOKIE. The consent record is a first-party
 * preference read only by this application. A cookie would be transmitted on
 * every request to the origin, which is strictly more data movement for no
 * benefit, and it would put the consent record in the same mechanism the
 * contract exists to keep switched off. `localStorage` is not a tracking
 * store: nothing reads it but us, it never leaves the device on its own, and
 * it is disclosed on /privatliv as a data category.
 */

export type ConsentState = 'undecided' | 'granted' | 'rejected'

/** Every valid state, in the order the privacy page presents them. */
export const CONSENT_STATES: readonly ConsentState[] = ['undecided', 'granted', 'rejected']

/**
 * One key. Versioned, so that a future change to what consent covers cannot be
 * silently inherited by visitors who agreed to something narrower.
 */
export const CONSENT_STORAGE_KEY = 'klup-consent-v1'

/** The founder/internal tagging flag of §15 of the measurement spec. */
export const INTERNAL_FLAG_STORAGE_KEY = 'klup-internal'

/** The URL parameter that sets the flag above. */
export const INTERNAL_FLAG_QUERY_PARAM = 'klup_internal'

/**
 * Client-store key prefixes written by the two retained trackers.
 *
 * Used by the withdrawal sweep. PostHog namespaces everything it persists as
 * `ph_<token>_*` plus a small number of `__ph_*` control keys; Speed Insights
 * writes nothing persistent today, and is listed so that a future change is a
 * visible edit here rather than an invisible leak.
 */
export const TRACKER_STORAGE_PREFIXES: readonly string[] = ['ph_', '__ph_', 'posthog']

/**
 * The only question this module answers for a caller deciding whether to load
 * something. Written as an allow-list of one so that adding a fourth state can
 * never accidentally widen it.
 */
export function allowsAnalytics(state: ConsentState): boolean {
  return state === 'granted'
}

/**
 * Coerce anything at all into a state. Unknown values, corrupted storage, an
 * older schema and `null` all produce `undecided`, which behaves as rejected.
 * There is no input that can produce `granted` other than the literal string.
 */
export function parseConsentState(raw: string | null | undefined): ConsentState {
  if (raw === 'granted' || raw === 'rejected' || raw === 'undecided') return raw
  return 'undecided'
}

/* ── Browser access, without depending on the DOM lib ──────────────────────
 *
 * These two modules are imported by the node test runner through the ROOT
 * tsconfig, whose `lib` is `["ES2020"]` with no `dom`. Referring to `window`
 * or `document` as ambient globals would therefore add nineteen errors to a
 * type-check baseline that is fixed at seven, and CLAUDE.md §7 forbids
 * repairing that baseline.
 *
 * Reaching the same objects through `globalThis` with a narrow local shape is
 * not a workaround, it is better isolation: these modules now declare exactly
 * which four browser capabilities they use, and a test can provide them
 * without a DOM implementation.
 */

export interface StorageLike {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface BrowserLocation {
  pathname: string
  search: string
  origin: string
  hostname: string
}

interface BrowserWindow {
  localStorage?: StorageLike
  sessionStorage?: StorageLike
  location?: BrowserLocation
}

interface BrowserDocument {
  cookie: string
  referrer: string
}

/** The window object, or null on the server. Never throws. */
export function browserWindow(): BrowserWindow | null {
  const g = globalThis as { window?: BrowserWindow }
  return g.window ?? null
}

/** The document object, or null on the server. Never throws. */
export function browserDocument(): BrowserDocument | null {
  const g = globalThis as { document?: BrowserDocument }
  return g.document ?? null
}

/**
 * Read the persisted state.
 *
 * Storage access is wrapped because Safari in private mode, a locked-down
 * enterprise profile and a disabled-storage setting all throw on access rather
 * than returning null. Every failure resolves to `undecided`.
 */
export function readStoredConsent(): ConsentState {
  try {
    const store = browserWindow()?.localStorage
    if (!store) return 'undecided'
    return parseConsentState(store.getItem(CONSENT_STORAGE_KEY))
  } catch {
    return 'undecided'
  }
}

/**
 * Persist a decision. `undecided` removes the record rather than storing the
 * word, so that "no record" and "explicitly undecided" cannot drift apart.
 */
export function persistConsent(state: ConsentState): void {
  try {
    const store = browserWindow()?.localStorage
    if (!store) return
    if (state === 'undecided') store.removeItem(CONSENT_STORAGE_KEY)
    else store.setItem(CONSENT_STORAGE_KEY, state)
  } catch {
    /* storage unavailable: the state stays in memory for this page only */
  }
}

/** True when this browser has been tagged internal (founder or deliberate QA). */
export function readInternalFlag(): boolean {
  try {
    return browserWindow()?.localStorage?.getItem(INTERNAL_FLAG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Persist the internal flag when `?klup_internal=1` is present.
 *
 * The founder is user zero and their sessions are the first evidence Klup has,
 * so internal traffic is TAGGED, never dropped (measurement spec §15). This
 * runs regardless of consent state because it writes no tracker storage and
 * sends nothing: it only records how to label a session if one is ever
 * measured.
 */
export function captureInternalFlagFromLocation(search: string): boolean {
  try {
    const store = browserWindow()?.localStorage
    if (!store) return false
    const params = new URLSearchParams(search)
    if (params.get(INTERNAL_FLAG_QUERY_PARAM) === '1') {
      store.setItem(INTERNAL_FLAG_STORAGE_KEY, '1')
      return true
    }
  } catch {
    /* ignore */
  }
  return readInternalFlag()
}

/** True when a storage key belongs to one of the retained trackers. */
export function isTrackerStorageKey(key: string): boolean {
  return TRACKER_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/**
 * Remove every client-store key and cookie the retained trackers set.
 *
 * Called on withdrawal, and also called defensively when the app boots into a
 * non-granted state: a visitor who consented, was measured, and then cleared
 * only the consent key must not be left with tracker identifiers on disk.
 *
 * Cookies are swept even though PostHog is configured with `localStorage`
 * persistence and therefore should not set any. That is the point — the sweep
 * is what makes the configuration verifiable rather than merely intended.
 */
export function purgeTrackerStorage(): void {
  const win = browserWindow()
  if (!win) return

  for (const store of [win.localStorage, win.sessionStorage]) {
    if (!store) continue
    try {
      const doomed: string[] = []
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i)
        if (key && isTrackerStorageKey(key)) doomed.push(key)
      }
      doomed.forEach((key) => store.removeItem(key))
    } catch {
      /* storage unavailable: nothing was written either */
    }
  }

  const doc = browserDocument()
  if (!doc) return
  try {
    const host = win.location?.hostname ?? ''
    for (const raw of doc.cookie.split(';')) {
      const name = raw.split('=')[0]?.trim()
      if (!name || !isTrackerStorageKey(name)) continue
      // Expire on every path/domain scope the tracker could have used.
      const scopes = host ? [undefined, host, `.${host}`] : [undefined]
      for (const domain of scopes) {
        doc.cookie =
          `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/` +
          (domain ? `; domain=${domain}` : '')
      }
    }
  } catch {
    /* no document, or cookies disabled */
  }
}
