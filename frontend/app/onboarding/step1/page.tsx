import { permanentRedirect } from 'next/navigation'

/**
 * Retired. Stage 3 WP-1.
 *
 * This step selected verticals (Fotografi, Dansk Design, Mode, Teknologi),
 * starred brands from the full 274-brand KG, or built a free-text watchlist
 * with a price slider. All three contradict a frozen 48-product music
 * catalogue, and four of the five verticals are already inactive in the KG —
 * this was the single most explicit contradiction left in the live product.
 *
 * The ROUTE FILE IS KEPT deliberately (build plan §19, D12): the
 * `onboarding-assets` storage bucket still serves the browse category images,
 * and deleting the segment would invite deleting the bucket with it.
 * Step 4 already redirected before Stage 3 and is untouched.
 *
 * 308, not 307: this is permanent, and any inbound link should be rewritten.
 */
export default function OnboardingStep1() {
  permanentRedirect('/')
}
