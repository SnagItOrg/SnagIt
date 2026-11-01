'use client'

/**
 * PostHog initialisation. Fail closed, EU only. The full client only after
 * consent; before it, only the cookieless page count at the end of this file.
 *
 * Stage 3 WP-5. See docs/stage-3-v1-decision-and-build-plan.md §12.4.2 and
 * §12.4.6.
 *
 * WHAT CHANGED AND WHY. Before this package the module read the host from the
 * environment with `?? <the US ingestion host>` as a fallback, and ran
 * unconditionally on first paint. Two defects, one line apart: an
 * UNSET environment variable silently redirected European user data to the US
 * region, and initialisation happened before anyone had been asked anything.
 * The absence of configuration must never widen the destination of user data,
 * and there is now no branch that produces a host which is not in the EU
 * allow-list. Silence is the failure mode.
 *
 * THIS COMPONENT RENDERS NOTHING AND WRAPS NOTHING. It is mounted only by
 * AnalyticsRoot, only while consent is `granted`, and it hands the initialised
 * client to lib/analytics.ts by injection. `posthog-js` is imported
 * DYNAMICALLY inside the effect, so this client is not merely un-initialised
 * before consent — it does not exist.
 *
 * WHY NO REACT PROVIDER. Every event goes through `track()` in
 * lib/analytics.ts (PAN-161); nothing calls `usePostHog()` or captures through
 * the singleton, so there is nothing for a provider to serve.
 */

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

import {
  attachAnalyticsClient,
  buildSuperProperties,
  currentAnalyticsEnv,
  detachAnalyticsClient,
  pageviewProperties,
  prepareOutgoingPayload,
  resolvePostHogConfig,
  shouldThrowOnMisconfiguration,
  type AnalyticsClient,
} from '@/lib/analytics'

/**
 * What both PostHog instances leave off, so the consented client and the
 * cookieless page count cannot drift apart on what the SDK may send by itself.
 */
const DECLARED_EVENTS_ONLY = {
  defaults: '2026-01-30',

  // We send our own sanitised $pageview (§12.4.7). $pageleave carries a
  // URL and is not in the V1 taxonomy.
  capture_pageview: false,
  capture_pageleave: false,

  // Only the declared events. Autocapture, dead clicks and
  // rageclicks would send DOM content nobody declared; exception capture
  // would send URLs and stack frames through the behavioural channel,
  // which §12.4.8 keeps separate from operational logging.
  autocapture: false,
  capture_dead_clicks: false,
  rageclick: false,
  capture_exceptions: false,
  capture_performance: false,

  // Session replay would record raw search text keystroke by keystroke.
  // Surveys and the toolbar are additional processing purposes that are
  // not on /privatliv, so they are off rather than merely unused.
  disable_session_recording: true,
  disable_surveys: true,
  disable_external_dependency_loading: true,

  // No feature flags are used. Disabling them removes the /flags request
  // on init, so the only PostHog traffic is the events themselves.
  advanced_disable_flags: true,
  advanced_disable_feature_flags: true,

  // Campaign parameters are an unbounded free-text channel straight out
  // of the URL: anyone can craft a link with any `utm_*` value, and a
  // trace confirmed the canary reaching PostHog through `utm_campaign`
  // while `$current_url` was clean. V1 runs no paid campaigns (§13.2),
  // the event taxonomy declares no campaign property, and
  // /privatliv does not list one as a data category. So it is off —
  // turning it on later is a taxonomy and privacy-page change, not a
  // configuration tweak.
  save_campaign_params: false,
  save_referrer: false,
} as const

export function PostHogProvider() {
  useEffect(() => {
    const env = currentAnalyticsEnv()
    const resolution = resolvePostHogConfig(env)

    if (!resolution.ok) {
      // Development must not be able to overlook a misconfigured host. In
      // production the server layout has already written one operational line
      // (§12.4.8) and the correct behaviour here is to do nothing at all.
      if (shouldThrowOnMisconfiguration(resolution, env)) {
        throw new Error(
          `PostHog not initialised: ${resolution.reason}. ` +
            'NEXT_PUBLIC_POSTHOG_HOST must be an EU PostHog host. There is no fallback host.',
        )
      }
      return
    }

    let cancelled = false

    void import('posthog-js').then(({ default: posthog }) => {
      if (cancelled) return

      posthog.init(resolution.token, {
        ...DECLARED_EVENTS_ONLY,
        api_host: resolution.host,

        // localStorage, not cookies. Withdrawal can then verifiably remove
        // everything the tracker persisted, and /privatliv can say plainly
        // that Klup sets no tracking cookie.
        persistence: 'localStorage',

        // The last line of defence for §12.4.7. This hook sees EVERY outgoing
        // event, including ones the SDK generates itself, so a URL-bearing
        // property added by a future SDK version is rewritten rather than
        // relying on each call site to remember.
        // Nothing outside the declared taxonomy leaves the browser, and every
        // URL-bearing property on what does leave is rebuilt from an
        // allow-list.
        before_send: (payload) => prepareOutgoingPayload(payload),

        loaded: (instance) => {
          attachAnalyticsClient(instance)
          const { klup_schema_version, app_env, is_internal, internal_role } =
            buildSuperProperties(window.location.pathname)
          // Static super-properties are registered so that they also reach the
          // SDK's own `$identify`, which does not go through track().
          // `surface` and `locale` change during a session and are computed
          // per event instead.
          instance.register({ klup_schema_version, app_env, is_internal, internal_role })
        },
      })
    })

    return () => {
      cancelled = true
      detachAnalyticsClient()
    }
  }, [])

  return null
}

/**
 * The cookieless page count: how many people visit, also when nobody has
 * answered the consent question, or the answer was no.
 *
 * WHY IT EXISTS. Only consenting visitors were counted, so the traffic figure
 * was a floor of unknown height (owner, 2026-11-01: "Hvor meget traffik har
 * jeg?"). This reverses one clause of the WP-5 contract on purpose — before
 * consent there is now one request per page — and keeps the rest of it.
 *
 * WHAT IT SENDS. The sanitised `$pageview` and nothing else: `before_send`
 * drops every other event, including the SDK's own. Cookieless mode sets no
 * cookie and writes nothing to local or session storage; PostHog counts
 * visitors with a server-side hash that rotates daily, so there is no id that
 * follows a visitor from one day to the next. Product events, `$identify` and
 * Speed Insights stay behind consent: this instance is never handed to
 * lib/analytics.ts, so `track()` still has no client before a yes.
 *
 * The PostHog project must have cookieless mode switched on, or the server
 * drops these events.
 */
let cookieless: Promise<AnalyticsClient | null> | null = null

function cookielessClient(): Promise<AnalyticsClient | null> {
  if (cookieless) return cookieless
  const resolution = resolvePostHogConfig(currentAnalyticsEnv())
  // A misconfigured host is reported by the consented provider; here it only
  // means there is nothing to count with.
  if (!resolution.ok) return Promise.resolve(null)

  cookieless = import('posthog-js').then(
    ({ default: posthog }) =>
      posthog.init(
        resolution.token,
        {
          ...DECLARED_EVENTS_ONLY,
          api_host: resolution.host,
          cookieless_mode: 'always',
          persistence: 'memory',
          before_send: (payload) =>
            payload?.event === '$pageview' ? prepareOutgoingPayload(payload) : null,
        },
        'klup_cookieless',
      ) ?? null,
  )
  return cookieless
}

export function CookielessPageCount() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!pathname) return
    let cancelled = false
    const search = searchParams?.toString() ?? ''
    void cookielessClient().then((client) => {
      // Consent granted while the SDK loaded: the consented provider counts
      // this page instead.
      if (cancelled || !client) return
      try {
        client.capture('$pageview', pageviewProperties(pathname, search))
      } catch {
        /* analytics must never break the product */
      }
    })
    return () => {
      cancelled = true
    }
  }, [pathname, searchParams])

  return null
}
