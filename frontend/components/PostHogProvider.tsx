'use client'

/**
 * PostHog initialisation. Fail closed, EU only, post-consent only.
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
 * DYNAMICALLY inside the effect, so the module is not merely un-initialised
 * before consent — it is not fetched.
 *
 * WHY NO REACT PROVIDER ANY MORE. `posthog.init()` initialises the library's
 * global singleton, and `usePostHog()` from `posthog-js/react` returns that
 * same singleton when no provider is present. So the pre-existing call sites
 * in files owned by WP-3 and WP-4 keep working after consent without WP-5
 * touching them, and before consent they call `capture()` on an uninitialised
 * instance, which posthog-js guards with `if (this.__loaded && ...)` — no
 * request, no storage, no queue.
 */

import { useEffect } from 'react'

import {
  attachAnalyticsClient,
  buildSuperProperties,
  currentAnalyticsEnv,
  detachAnalyticsClient,
  prepareOutgoingPayload,
  resolvePostHogConfig,
  shouldThrowOnMisconfiguration,
} from '@/lib/analytics'

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
        api_host: resolution.host,
        defaults: '2026-01-30',

        // We send our own sanitised $pageview (§12.4.7). $pageleave carries a
        // URL and is not in the V1 taxonomy.
        capture_pageview: false,
        capture_pageleave: false,

        // Only the twelve declared events. Autocapture, dead clicks and
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
        // the twelve-event taxonomy declares no campaign property, and
        // /privatliv does not list one as a data category. So it is off —
        // turning it on later is a taxonomy and privacy-page change, not a
        // configuration tweak.
        save_campaign_params: false,
        save_referrer: false,

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
        // allow-list. Legacy call sites in other packages' files capture
        // through this same singleton, and one of them sends raw search text.
        before_send: (payload) => prepareOutgoingPayload(payload),

        loaded: (instance) => {
          attachAnalyticsClient(instance)
          const { klup_schema_version, app_env, is_internal, internal_role } =
            buildSuperProperties(window.location.pathname)
          // Static super-properties are registered so that they also reach the
          // legacy call sites in other packages' files, which capture through
          // the singleton rather than through track(). `surface` and `locale`
          // change during a session and are computed per event instead.
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
