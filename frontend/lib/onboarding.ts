// Shared utilities for the anonymous-first onboarding flow.

// ── localStorage ────────────────────────────────────────────────────────────

const STORAGE_KEY = 'klup-onboarding'

export interface OnboardingData {
  categories: string[]
  brands: string[]
  query: string
  min_price: number
  max_price: number
}

export function loadOnboarding(): Partial<OnboardingData> {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function saveOnboarding(patch: Partial<OnboardingData>): void {
  const current = loadOnboarding()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }))
}

export function clearOnboarding(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
}

// ── Retired analytics sender ────────────────────────────────────────────────
//
// Stage 3 WP-5. Google Analytics 4 was REMOVED, not consent-gated: its only
// product use was the onboarding funnel, WP-1 retired onboarding steps 1-3,
// and deleting it removes one processor, one cookie family and one
// cross-border transfer rather than putting a third behavioural tracker behind
// a gate (build plan §12.4.1, tracker 1).
//
// The Google Analytics global declaration and the send are both gone. This
// stays as an inert no-op for exactly one reason: `app/watchlists/page.tsx:94`
// still calls it, and that file belongs to no Stage 3 package, so removing the
// export here would break a file WP-5 has no authority to edit. It sends
// nothing, loads nothing and touches no storage — a call is genuinely a
// no-operation, not a suppressed send.
//
// FOLLOW-UP, NOT A DEFECT: whichever package next takes ownership of
// `app/watchlists/page.tsx` should drop the import and the single call site,
// after which this function and this comment go with it. The V1 replacement is
// the typed `track()` in `lib/analytics.ts`.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function fireEvent(_event: string, _params: Record<string, unknown>): void {
  /* intentionally empty — see above */
}

// ── Supabase Storage URLs ────────────────────────────────────────────────────
// Bucket: onboarding-assets (public)
// Pattern: {SUPABASE_URL}/storage/v1/object/public/onboarding-assets/{path}

const STORAGE_BASE =
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/onboarding-assets`

export function categoryImageUrl(name: string): string {
  return `${STORAGE_BASE}/categories/${name}.webp`
}

export function brandLogoUrl(name: string): string {
  return `${STORAGE_BASE}/brands/${name}.webp`
}
