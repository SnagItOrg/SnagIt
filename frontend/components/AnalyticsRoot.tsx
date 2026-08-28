'use client'

/**
 * The only mount point for a non-essential tracker.
 *
 * Stage 3 WP-5. See docs/stage-3-v1-decision-and-build-plan.md §12.4.1 and
 * §12.4.2.
 *
 * CONSENT-THEN-LOAD, NEVER LOAD-THEN-SUPPRESS. While consent is `undecided` or
 * `rejected` this component returns `null` before any tracker module is
 * referenced. Both trackers arrive through `import()` inside a subtree that
 * does not exist until the state is `granted`, so before consent there is no
 * script tag, no `init()`, no request and no client-store key. An SDK loaded
 * with tracking "disabled" has already made its request and set its
 * identifiers, and would not satisfy the contract.
 *
 * NO PRE-CONSENT BUFFER. Nothing queues interactions for later delivery.
 * Behaviour from before the answer is lost on purpose: a queue that flushed on
 * grant would be retroactive collection of exactly the data the visitor had
 * not yet agreed to (§12.4.2 point 2).
 *
 * THE TWO REMOVED TRACKERS CANNOT APPEAR HERE. Google Analytics and Vercel
 * Analytics were deleted rather than gated (§12.4.1), so no consent state
 * loads them and there is no configuration that turns them back on.
 */

import dynamic from 'next/dynamic'
import { Suspense, useEffect } from 'react'
import { usePathname } from 'next/navigation'

import { useConsent } from '@/components/ConsentProvider'
import { PostHogProvider } from '@/components/PostHogProvider'
import { PostHogPageView } from '@/components/PostHogPageView'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import {
  buildAnalyticsUrl,
  identifyUser,
  isSuppressedSurface,
  pathTemplateFor,
  resetIdentity,
} from '@/lib/analytics'

/**
 * Web Vitals, measured on real sessions and therefore behavioural rather than
 * operational — which is why guardrail G8 is measured on the consenting
 * population only, and every G8 figure has to be reported with that
 * denominator (§12.4.1, tracker 4).
 *
 * `ssr: false` keeps the module out of the server render; the dynamic import
 * keeps it out of the bundle until this subtree mounts.
 */
const SpeedInsights = dynamic(
  () => import('@vercel/speed-insights/next').then((m) => m.SpeedInsights),
  { ssr: false },
)

/**
 * Connect the authenticated identity, and only after consent.
 *
 * There was no `identify()` call anywhere in the codebase before this package,
 * so no person-level metric — activation, return, retention — was computable
 * at all. It runs on every authenticated session start rather than only at
 * signup, because an identity established once is an identity missing for
 * every returning visitor.
 *
 * The Supabase user UUID is the only value sent. The email address on the
 * session object is never read.
 */
function AnalyticsIdentity() {
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    let active = true

    void supabase.auth.getUser().then(({ data }) => {
      if (active && data.user) identifyUser(data.user.id)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'SIGNED_OUT') resetIdentity()
      else if (session?.user) identifyUser(session.user.id)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  return null
}

export function AnalyticsRoot() {
  const { analyticsAllowed } = useConsent()
  const pathname = usePathname() ?? '/'

  // `analyticsAllowed` is false until the stored decision has been read, so
  // `undecided` and `rejected` take the identical path: return before any
  // tracker module is referenced.
  if (!analyticsAllowed) return null

  // The private founder tool and the admin console emit no product events
  // (§12.2). Not mounting is stronger than filtering at the call site.
  if (isSuppressedSurface(pathname)) return null

  return (
    <>
      <PostHogProvider />
      <AnalyticsIdentity />
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <SpeedInsights
        beforeSend={(event) => {
          // Speed Insights reports the full URL of the measured navigation,
          // which on /search carries the raw ?q=. Same rule as $pageview: the
          // outgoing value is built from an allow-list, not edited afterwards.
          try {
            const parsed = new URL(event.url)
            return {
              ...event,
              url: buildAnalyticsUrl(parsed.origin, parsed.pathname, parsed.search),
              route: pathTemplateFor(parsed.pathname),
            }
          } catch {
            return null
          }
        }}
      />
    </>
  )
}
