'use client'

/**
 * The sanitised `$pageview`.
 *
 * Stage 3 WP-5. See docs/stage-3-v1-decision-and-build-plan.md §12.4.7.
 *
 * WHAT CHANGED AND WHY. The previous implementation built
 *
 *     window.location.origin + pathname + (searchParams ? `?${searchParams}` : '')
 *
 * and sent it as `$current_url`, so every search pageview delivered
 * `?q=<whatever the visitor typed>` to a third-party processor. Free text
 * typed by a person is the one category of URL content that can contain
 * anything at all — a name, an address, a phone number pasted by mistake.
 *
 * The replacement never holds the raw query. `buildAnalyticsUrl()` copies an
 * allow-list of two bounded parameters into an empty list; the incoming string
 * is read, never forwarded. Sanitising after the fact would leave the raw value
 * in a payload for as long as it took to remember to strip it, and a stripping
 * step can be skipped by an early return. Building cannot.
 *
 * `path_template` (`/product/[slug]`) is the primary path property, and the
 * referrer is reduced to a hostname.
 *
 * Mounted only by AnalyticsRoot, therefore only while consent is `granted`.
 */

import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

import { capturePageview, isAnalyticsActive, subscribeAnalyticsReady } from '@/lib/analytics'

export function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // The tracker is imported dynamically and initialises asynchronously, so on
  // a full page load this component mounts before there is a client. Waiting
  // for readiness is what makes the first pageview of a page load arrive at
  // all; without it the effect ran once against nothing and never re-ran.
  const [ready, setReady] = useState(() => isAnalyticsActive())

  useEffect(() => subscribeAnalyticsReady(() => setReady(true)), [])

  useEffect(() => {
    if (!ready || !pathname) return
    capturePageview(pathname, searchParams?.toString() ?? '')
  }, [ready, pathname, searchParams])

  return null
}
