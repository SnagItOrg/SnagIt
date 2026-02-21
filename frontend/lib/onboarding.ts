// Shared utilities for the anonymous-first onboarding flow.

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

// ── localStorage ────────────────────────────────────────────────────────────

const STORAGE_KEY = 'klup-onboarding'

export interface OnboardingData {
  categories: string[]
  brands: string[]
  query: string
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

// ── GA4 ─────────────────────────────────────────────────────────────────────

export function fireEvent(event: string, params: Record<string, unknown>): void {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', event, params)
  }
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
