/**
 * The analytics core: the typed event surface, identity, and the fail-closed
 * PostHog configuration.
 *
 * Stage 3 WP-5. See docs/stage-3-v1-decision-and-build-plan.md §12.1, §12.2,
 * §12.4.6, §12.4.7 and §12.4.8, and the exact taxonomy in
 * docs/stage-3-measurement-spec.md §20.
 *
 * WP-5 IS THE ONLY WRITER OF THIS FILE (§15.7). WP-1, WP-2, WP-3 and WP-4 add
 * call sites inside files they own, by importing `track()`. They never import
 * posthog-js, never touch configuration and never add a tracker.
 *
 * NO RUNTIME DEPENDENCY ON posthog-js OR ON REACT. The client type is imported
 * with `import type`, which is erased, so:
 *   - importing this module can never be the thing that pulls a tracker into a
 *     bundle or initialises one;
 *   - the node test runner can import it directly and exercise the pure parts.
 * The live client arrives later, by injection, from AnalyticsRoot — and only
 * after consent (§12.4.2).
 *
 * WHY track() IS A PLAIN FUNCTION AND NOT A HOOK. A hook would need a React
 * provider above every call site, which would mean either mounting a provider
 * before consent (forbidden) or rewriting files owned by other packages
 * (forbidden). A module-level function with an injected client has neither
 * problem: before consent there is no client and every call is a no-op that
 * touches nothing.
 */

import { classifyPath } from './route-access'
import {
  allowsAnalytics,
  browserDocument,
  browserWindow,
  readInternalFlag,
  type ConsentState,
} from './consent'

/* ════════════════════════════════════════════════════════════════════════
   1. Configuration — fail closed, EU only
   ════════════════════════════════════════════════════════════════════════ */

/**
 * The complete set of accepted ingestion hosts. EU only, exhaustive, literal.
 *
 * There is NO fallback entry and no pattern match. The US ingestion hosts are
 * absent by intent, and a test asserts that neither of them appears anywhere
 * in the frontend source: the previous implementation reached the US region
 * whenever an environment variable was merely unset, which meant an absent
 * variable silently widened the destination of user data.
 */
export const POSTHOG_EU_HOSTS: readonly string[] = [
  'https://eu.i.posthog.com',
  'https://eu.posthog.com',
]

export interface AnalyticsEnv {
  host?: string
  token?: string
  vercelEnv?: string
  nodeEnv?: string
}

export type PostHogResolution =
  | { ok: true; host: string; token: string }
  | {
      ok: false
      reason: 'host_missing' | 'host_not_eu' | 'token_missing' | 'non_production'
    }

/** Trailing slashes and casing must not decide where user data goes. */
function normaliseHost(raw: string): string {
  return raw.trim().replace(/\/+$/, '').toLowerCase()
}

/**
 * Decide whether PostHog may initialise, and where it may send.
 *
 * Configuration is judged BEFORE the environment gate, so a misconfigured host
 * is reported as a misconfiguration in every environment rather than being
 * masked by "we would not have initialised here anyway". That ordering is what
 * makes the development throw in §12.4.6 reachable.
 *
 * Silence is the failure mode. There is no branch that returns a host which
 * was not written down above.
 */
export function resolvePostHogConfig(env: AnalyticsEnv): PostHogResolution {
  const rawHost = env.host?.trim()
  if (!rawHost) return { ok: false, reason: 'host_missing' }

  const host = normaliseHost(rawHost)
  if (!POSTHOG_EU_HOSTS.includes(host)) return { ok: false, reason: 'host_not_eu' }

  const token = env.token?.trim()
  if (!token) return { ok: false, reason: 'token_missing' }

  // Preview and development deployments emitted into the production project.
  if (env.vercelEnv !== 'production') return { ok: false, reason: 'non_production' }

  return { ok: true, host, token }
}

/**
 * Read the build-time environment.
 *
 * `process.env.NEXT_PUBLIC_*` must be referenced as literal member expressions
 * or Next.js cannot inline them into the client bundle, so this cannot be
 * written as a loop over key names.
 */
export function currentAnalyticsEnv(): AnalyticsEnv {
  return {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    token: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
  }
}

/** True when the misconfiguration should stop a developer rather than a user. */
export function shouldThrowOnMisconfiguration(
  resolution: PostHogResolution,
  env: AnalyticsEnv,
): boolean {
  if (resolution.ok) return false
  if (resolution.reason === 'non_production') return false
  return env.nodeEnv === 'development'
}

let misconfigurationLogged = false

/**
 * Emit exactly one operational line when the host is unusable in production.
 *
 * OPERATIONAL, NOT BEHAVIOURAL (§12.4.8). It goes to the platform log, never
 * to PostHog — which would be absurd anyway, since the reason we are here is
 * that PostHog is not usable. It carries a route-free reason code and no user
 * identifier, no path, no query and no email.
 *
 * Called from the server layout, so the line appears in Vercel logs even for a
 * visitor who never grants consent and therefore never runs the client path.
 * The module-level latch makes it once per server instance rather than once
 * per render.
 */
export function logPostHogMisconfigurationOnce(env: AnalyticsEnv = currentAnalyticsEnv()): void {
  if (misconfigurationLogged) return
  const resolution = resolvePostHogConfig(env)
  if (resolution.ok || resolution.reason === 'non_production') return
  misconfigurationLogged = true
  console.error(
    JSON.stringify({
      channel: 'operational',
      component: 'analytics',
      event: 'posthog_not_initialised',
      reason: resolution.reason,
      detail: 'NEXT_PUBLIC_POSTHOG_HOST must be an EU PostHog host; there is no fallback',
    }),
  )
}

/** Test seam. Never called by application code. */
export function resetMisconfigurationLatchForTests(): void {
  misconfigurationLogged = false
}

/* ════════════════════════════════════════════════════════════════════════
   2. URL and surface derivation — no free text, ever
   ════════════════════════════════════════════════════════════════════════ */

/**
 * The complete set of query parameters allowed to reach the analytics
 * processor (§12.4.7). Both are bounded machine values written by our own
 * navigation. `q` is absent, and so is anything a visitor can type.
 */
export const ANALYTICS_URL_PARAM_ALLOWLIST: readonly string[] = ['page', 'sub']

/** Returned when a pathname matches no route in the shared authority. */
export const UNMATCHED_PATH_TEMPLATE = '/(unmatched)'

/**
 * The path with dynamic segments collapsed: `/product/[slug]`, never
 * `/product/roland-juno-106`.
 *
 * Derived from `lib/route-access.ts`, the same table the middleware uses, so a
 * new route cannot appear in analytics under a shape nobody classified. That
 * module is WP-1's and is imported read-only.
 */
export function pathTemplateFor(pathname: string): string {
  const rule = classifyPath(pathname)
  return rule ? rule.route : UNMATCHED_PATH_TEMPLATE
}

export type AnalyticsSurface =
  | 'landing'
  | 'browse_root'
  | 'browse_leaf'
  | 'product'
  | 'family'
  | 'search'
  | 'saved'
  | 'watchlists'
  | 'auth'
  | 'privacy'
  | 'about_data'
  | 'other'

/** Map a path template onto the surface vocabulary of the super-properties. */
export function surfaceFor(template: string): AnalyticsSurface {
  switch (template) {
    case '/':
      return 'landing'
    case '/browse':
      return 'browse_root'
    case '/browse/[root]':
      return 'browse_leaf'
    case '/product/[slug]':
      return 'product'
    case '/family/[slug]':
      return 'family'
    case '/search':
      return 'search'
    case '/saved':
      return 'saved'
    case '/watchlists':
      return 'watchlists'
    case '/login':
    case '/signup':
    case '/auth/callback':
    case '/auth/confirm':
      return 'auth'
    case '/privatliv':
      return 'privacy'
    case '/om-data':
      return 'about_data'
    default:
      return 'other'
  }
}

/**
 * Surfaces that emit no product events at all (§12.2).
 *
 * The private founder tool and the admin console are operator surfaces. Their
 * traffic is not product usage, and mixing it into the funnel would corrupt
 * every denominator in a fourteen-product catalogue.
 */
export function isSuppressedSurface(pathname: string): boolean {
  return pathname === '/intel' || pathname.startsWith('/intel/') ||
    pathname === '/admin' || pathname.startsWith('/admin/')
}

/**
 * Build the URL that may be transmitted.
 *
 * CONSTRUCTED, NOT SANITISED. The allowed parameters are copied into a fresh,
 * empty parameter list; the incoming string is never assigned to the outgoing
 * value and then edited. That distinction is the whole point of §12.4.7: a
 * redaction step can be forgotten, reordered or bypassed by an early return,
 * whereas a value that is only ever built from an allow-list has no path by
 * which free text can arrive.
 */
export function buildAnalyticsUrl(origin: string, pathname: string, search: string): string {
  const allowed = new URLSearchParams()
  try {
    const incoming = new URLSearchParams(search)
    for (const key of ANALYTICS_URL_PARAM_ALLOWLIST) {
      const value = incoming.get(key)
      if (value !== null) allowed.set(key, value)
    }
  } catch {
    /* unparseable query: nothing is copied, which is the safe outcome */
  }
  const query = allowed.toString()
  return `${origin}${pathname}${query ? `?${query}` : ''}`
}

/** The referring origin only. A full referrer URL can carry another site's query. */
export function referrerHostOf(referrer: string): string | null {
  if (!referrer) return null
  try {
    return new URL(referrer).hostname
  } catch {
    return null
  }
}

/**
 * Properties PostHog attaches by itself that are built from `window.location`
 * or `document.referrer` and therefore may carry raw search text.
 *
 * They are rewritten — not merely denied — because several are load-bearing
 * for PostHog's own session handling, and because a denied property is absent
 * whereas a rewritten one still says which page, minus the free text.
 */
export const URL_BEARING_AUTOMATIC_PROPERTIES: readonly string[] = [
  '$current_url',
  '$initial_current_url',
  '$pathname',
  '$initial_pathname',
  '$referrer',
  '$initial_referrer',
  '$referring_domain',
  '$initial_referring_domain',
  '$host',
  '$initial_host',
  '$session_entry_url',
  '$session_entry_pathname',
  '$session_entry_referrer',
  '$session_entry_host',
]

/**
 * Rewrite every URL-bearing property on an outgoing payload.
 *
 * This runs as PostHog's `before_send` hook, which sees EVERY event including
 * the ones the SDK generates on its own ($pageleave, $identify, $set,
 * $web_vitals, exception reports). Sanitising only at our own call sites would
 * leave those untouched, and they are exactly the ones nobody remembers.
 */
export function sanitiseOutgoingProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...properties }
  for (const key of URL_BEARING_AUTOMATIC_PROPERTIES) {
    if (!(key in out)) continue
    const value = out[key]
    if (typeof value !== 'string' || value === '') continue

    if (key.includes('referr')) {
      const host = referrerHostOf(value)
      out[key] = host ?? null
      continue
    }
    if (key.includes('host')) continue // a hostname carries no query string

    try {
      const parsed = new URL(value, 'https://placeholder.invalid')
      // Only ordinary web URLs are rewritten. A `javascript:` or `data:` value
      // parses successfully but puts arbitrary text in `pathname`, so anything
      // outside http/https is dropped rather than reshaped.
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        out[key] = null
        continue
      }
      out[key] = key.includes('pathname')
        ? parsed.pathname
        : buildAnalyticsUrl(
            parsed.origin === 'https://placeholder.invalid' ? '' : parsed.origin,
            parsed.pathname,
            parsed.search,
          )
    } catch {
      out[key] = null
    }
  }
  return out
}

/* ════════════════════════════════════════════════════════════════════════
   3. The V1 event taxonomy — twelve events, compile-time checked
   ════════════════════════════════════════════════════════════════════════ */

export type ProductTier = 'legendary' | 'classic' | 'standard'
export type SupportState = 'known' | 'reserve' | 'supported'
export type BrowseVisibility = 'public' | 'qa_only' | 'hidden'
export type ListingSource =
  | 'dba.dk'
  | 'finn'
  | 'blocket'
  | 'kleinanzeigen'
  | 'reverb'
  | 'thomann'

export type ProductEntryRef =
  | 'shelf'
  | 'browse'
  | 'search'
  | 'direct'
  | 'email'
  | 'related'
  | 'external'

export type SearchResolution =
  | 'canonical_exact'
  | 'accepted_alias'
  | 'disambiguation'
  | 'dangerous_alias_blocked'
  | 'unsupported'
  | 'error'

/**
 * The eleven explicitly-tracked V1 events. `$pageview` is the twelfth and is
 * captured by `capturePageview()` rather than through `track()`, because its
 * properties are derived from the router rather than passed by a caller.
 *
 * NO EMAIL-TYPED FIELD EXISTS IN THIS UNION, and a test asserts it. Demand
 * capture carries `has_email: boolean`; the address itself goes to Supabase
 * through the magic-link path and never to a processor whose purpose is
 * measurement (§8.5, §14.4).
 *
 * `has_image` follows the authority document §12.1; the measurement spec §20
 * calls the same flag `has_hero_image`.
 */
export interface KlupEventMap {
  /** §12.1 #2 — the canonical product page rendered. */
  product_viewed: {
    product_slug: string
    product_id: string
    brand_slug: string | null
    tier: ProductTier
    support_state: SupportState
    browse_visibility: BrowseVisibility
    active_listing_count: number
    has_image: boolean
    has_article: boolean
    has_specs: boolean
    has_history_timeline: boolean
    related_count: number
    entry_ref: ProductEntryRef
    referrer_product_slug: string | null
  }

  /** §12.1 #3 — fires on every product render, band present OR ABSENT. */
  price_context_shown: {
    product_slug: string
    has_band: boolean
    band_low: number | null
    band_high: number | null
    band_median: number | null
    band_count: number | null
    band_width_ratio: number | null
    history_points: number
    has_thomann_reference: boolean
    thomann_price_dkk: number | null
  }

  /** §12.1 #4 — outbound to a marketplace. The north star's raw input. */
  listing_click_out: {
    listing_id: string
    product_slug: string | null
    source: ListingSource
    price: number | null
    currency: string | null
    price_dkk: number | null
    band_delta_pct: number | null
    position: number
    variant: 'list' | 'grid'
    surface: 'product' | 'search' | 'saved' | 'watchlist'
    click_id: string
  }

  /** §12.1 #5 — outbound to retail. Never counted as marketplace traffic. */
  outbound_retail_click: {
    destination: 'thomann'
    placement: 'product_hero' | 'listing_card' | 'saved_card' | 'search_card'
    product_slug: string | null
    thomann_price_dkk: number | null
    click_id: string
    affiliate_tagged: boolean
  }

  /** §12.1 #6 — intent, split from outcome. */
  search_submitted: {
    query_norm: string
    query_length: number
    token_count: number
    entry_surface: 'landing' | 'search' | 'mobile_bar' | 'nav'
    input_method: 'typed' | 'suggestion' | 'url_param'
  }

  /** §12.1 #7 — exactly one per query. `auto_navigated` on a dangerous term is guardrail G1. */
  search_resolved: {
    query_norm: string
    resolution: SearchResolution
    candidate_count: number
    product_slug: string | null
    auto_navigated: boolean
    latency_ms: number
  }

  /** §12.1 #8 — the only demand record that exists in V1. */
  search_unsupported: {
    query_norm: string
    resolution_class:
      | 'unsupported'
      | 'ambiguous'
      | 'dangerous_alias_blocked'
      | 'zero_results_supported'
    raw_token_count: number
    suggested_slugs: string[]
    suggested_count: number
    nearest_distance: number | null
  }

  /** §12.1 #9 — intensity. The address never reaches PostHog. */
  demand_signal_submitted: {
    query_norm: string
    capture_method: 'inline_email' | 'notify_button'
    has_email: boolean
    suggested_shown: number
  }

  /** §12.1 #10 — any product card, on any shelf or grid. */
  discovery_product_clicked: {
    shelf: 'followed' | 'recent' | 'browse_grid' | 'related'
    product_slug: string
    position: number
    shelf_size: number
    has_image: boolean
    active_listing_count: number
    tier: ProductTier
  }

  /** §12.1 #11 — `page > 1` at ten products means the filter is wrong. */
  browse_leaf_viewed: {
    root_slug: string
    page: number
    page_size: number
    total_public_products: number
    rendered_count: number
    subcategory_count: number
  }

  /** §12.1 #12 — `origin_product_slug` recovers product-bound intent with no schema change. */
  watch_created: {
    query_norm: string
    watch_type: 'query' | 'listing'
    origin_surface: 'product' | 'search' | 'saved' | 'watchlists'
    origin_product_slug: string | null
    has_max_price: boolean
    max_price: number | null
  }
}

export type KlupEventName = keyof KlupEventMap

/** Every V1 event name, for the taxonomy assertions. */
export const V1_EVENT_NAMES: readonly KlupEventName[] = [
  'product_viewed',
  'price_context_shown',
  'listing_click_out',
  'outbound_retail_click',
  'search_submitted',
  'search_resolved',
  'search_unsupported',
  'demand_signal_submitted',
  'discovery_product_clicked',
  'browse_leaf_viewed',
  'watch_created',
]

/**
 * The PostHog-internal events V1 needs, named one by one.
 *
 * WHY THIS IS A LIST AND NOT A `$` PREFIX TEST. The first version of this gate
 * allowed every `$`-prefixed event on the reasoning that they are the SDK's
 * own and are governed by the init config. That is true of the SDK as it is
 * configured today, and it is not a property anyone can hold still: `$`
 * belongs to PostHog's namespace, so an SDK upgrade may add `$`-events that no
 * configuration flag in this file disables, and they would transmit on the
 * strength of a naming convention nobody at Klup controls. A prefix test fails
 * open on exactly the change it is least likely to be reviewed against.
 *
 * So the rule is the same one the URL builder uses: name what is allowed, and
 * let everything else be absent by default. An unknown `$future_event` is
 * dropped without anyone having to notice it exists.
 *
 *   $pageview   the sanitised pageview of §12.1 #1, sent by capturePageview().
 *   $identify   emitted by posthog.identify(), which is the whole of the
 *               identity flow in §12.2. Verified against the SDK: identify()
 *               with no properties captures `$identify` carrying
 *               `distinct_id` and `$anon_distinct_id`, and `$set`/`$set_once`
 *               ride along as CAPTURE OPTIONS on that event rather than as
 *               separate ones. Nothing else is needed for identity to work.
 *
 * Deliberately absent, each because nothing in V1 calls the API that emits it:
 * `$set` and `$set_once` (no setPersonProperties call — the taxonomy sets no
 * person properties yet), `$create_alias` (no alias() call), `$groupidentify`
 * (no groups), `$feature_flag_called` (flags disabled), `$web_vitals`
 * (capture_performance off — Speed Insights covers vitals), `$exception`
 * (capture_exceptions off), `$pageleave`, `$autocapture`, `$rageclick`,
 * `$dead_click`, `$snapshot` and the survey events (all off in init).
 *
 * Adding one later is a one-line edit here, next to the reason it is needed.
 * That is the point: the list is where the decision is visible.
 */
export const REQUIRED_SDK_EVENTS: readonly string[] = ['$pageview', '$identify']

/**
 * May this event name be transmitted at all?
 *
 * AN ALLOW-LIST, FOR THE SAME REASON THE URL IS BUILT RATHER THAN STRIPPED.
 * §12.1 is explicit that the V1 taxonomy is twelve events and "anything not
 * listed is deferred". Legacy pre-Stage-3 call sites still exist in files
 * owned by other packages — `search_performed`, `listing_clicked`,
 * `listing_saved`, `watchlist_created`, `signup_completed` — and they capture
 * through the SDK singleton, which WP-5 initialises. Two problems follow if
 * they are simply allowed through:
 *
 *   1. RAW SEARCH TEXT. `app/search/page.tsx` captures
 *      `search_performed { query }` with the string the visitor typed. That is
 *      precisely the leak §12.4.7 exists to close, arriving by a different
 *      door than `$current_url`. A recorded trace confirmed it: searching for
 *      `zzq-canary-7431` put the canary in a PostHog payload even though the
 *      URL properties were clean.
 *
 *   2. SCHEMA COLLISION. Those events carry v1 property shapes but would be
 *      stamped `klup_schema_version: 2`, which is the exact "silently
 *      averaging two different definitions" failure §14.2 introduced the
 *      version property to prevent.
 *
 * WP-5 cannot edit those call sites — they belong to WP-3 and WP-4 — but it
 * does own the tracker boundary, and the honest boundary is one that refuses
 * to transmit anything the taxonomy has not declared. When WP-3 and WP-4
 * migrate their call sites to `track()`, their events appear here by name and
 * begin flowing; until then they are dropped at the edge rather than sent with
 * a property nobody reviewed.
 *
 * There is no prefix rule, no pattern and no default-allow branch. Every
 * transmittable name is in one of the two lists above.
 */
export function isTransmittableEvent(event: string): boolean {
  if (REQUIRED_SDK_EVENTS.includes(event)) return true
  return (V1_EVENT_NAMES as readonly string[]).includes(event as KlupEventName)
}

/**
 * The complete `before_send` decision, in one testable function.
 *
 * PostHog calls this immediately before data leaves the browser, for EVERY
 * event including the ones the SDK generates on its own. It is the last gate,
 * so it lives here rather than as an inline closure in the provider: a gate
 * that cannot be unit-tested is a gate nobody can prove.
 *
 * Returning null drops the event entirely.
 */
export function prepareOutgoingPayload<
  T extends { event: string; properties?: Record<string, unknown> },
>(payload: T | null): T | null {
  if (!payload) return payload
  if (!isTransmittableEvent(payload.event)) return null
  return { ...payload, properties: sanitiseOutgoingProperties(payload.properties ?? {}) }
}

/* ════════════════════════════════════════════════════════════════════════
   4. Super-properties
   ════════════════════════════════════════════════════════════════════════ */

export interface SuperProperties {
  klup_schema_version: 2
  app_env: string
  surface: AnalyticsSurface
  locale: string
  is_internal: boolean
  internal_role: 'founder' | null
}

/**
 * `klup_schema_version: 2` separates this taxonomy from the five pre-Stage-3
 * events, whose property sets are incompatible. Without it every query would
 * silently average two different definitions of the same name.
 */
export function buildSuperProperties(pathname: string): SuperProperties {
  const isInternal = readInternalFlag()
  let locale = 'da'
  try {
    locale = browserWindow()?.localStorage?.getItem('klup-locale') ?? 'da'
  } catch {
    /* storage unavailable; the default is the shipped locale */
  }
  return {
    klup_schema_version: 2,
    app_env: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
    surface: surfaceFor(pathTemplateFor(pathname)),
    locale,
    is_internal: isInternal,
    internal_role: isInternal ? 'founder' : null,
  }
}

/* ════════════════════════════════════════════════════════════════════════
   5. The injected client
   ════════════════════════════════════════════════════════════════════════ */

/**
 * The narrow slice of the tracker this module actually uses.
 *
 * Declared structurally rather than imported from posthog-js, so that:
 *   - this module has no dependency on the SDK at all, not even a type one,
 *     and nothing about importing it can pull a tracker anywhere;
 *   - the node test runner can inject a plain object and observe every call;
 *   - the SDK's own `loaded` callback hands back `PostHogInterface` rather
 *     than the concrete class, and a structural type accepts both.
 *
 * Four methods. If a fifth is ever needed, adding it here is a visible edit in
 * the file that owns the analytics boundary.
 */
export interface AnalyticsClient {
  capture(event: string, properties?: Record<string, unknown>): unknown
  identify(distinctId: string, properties?: Record<string, unknown>): void
  reset(resetDeviceId?: boolean): void
  register(properties: Record<string, unknown>): void
}

let client: AnalyticsClient | null = null
let enabled = false

/**
 * Listeners waiting for the client to arrive.
 *
 * The tracker is imported dynamically and initialises asynchronously, so on a
 * full page load the router has already told <PostHogPageView /> which path it
 * is on before there is anything to send to. Without this, the effect ran once
 * against a null client, its dependencies never changed again, and the FIRST
 * pageview of every page load was silently lost — which a trace caught: the
 * granted-consent payloads contained `$set` and nothing else.
 *
 * This is not a pre-consent buffer. Nothing is stored and nothing is replayed;
 * a listener is simply told that it may now ask for a fresh capture.
 */
const readyListeners = new Set<() => void>()

export function subscribeAnalyticsReady(listener: () => void): () => void {
  readyListeners.add(listener)
  if (enabled && client) listener()
  return () => {
    readyListeners.delete(listener)
  }
}

/**
 * Hand the initialised client over. Called by AnalyticsRoot, after consent,
 * and by nothing else.
 */
export function attachAnalyticsClient(instance: AnalyticsClient): void {
  client = instance
  enabled = true
  readyListeners.forEach((listener) => listener())
}

/**
 * Stop immediately.
 *
 * `enabled` is cleared FIRST and separately from the client reference, so that
 * a call already in flight cannot slip through between withdrawal and the
 * client being torn down. Withdrawal has to stop sending at the instant the
 * visitor asks, not at the next render.
 */
export function detachAnalyticsClient(): void {
  enabled = false
  client = null
}

/** Exposed for the consent surface and the tests; never for feature logic. */
export function isAnalyticsActive(): boolean {
  return enabled && client !== null
}

function currentPathname(): string {
  return browserWindow()?.location?.pathname ?? '/'
}

/**
 * Every gate an event must pass, in one place: a live client, a consent state
 * that allows measurement, and a surface that is not an operator tool.
 */
function mayEmit(): boolean {
  if (!enabled || !client) return false
  if (isSuppressedSurface(currentPathname())) return false
  return true
}

/**
 * Emit one V1 event.
 *
 * Type-safe by construction: the event name selects the property shape, and
 * because callers pass an object literal, TypeScript's excess-property check
 * rejects an unknown key as well as a missing or mistyped one.
 *
 * Before consent this is a no-op that touches nothing — no network, no
 * storage, and NO BUFFER. Pre-consent interactions are lost deliberately
 * (§12.4.2 point 2): a queue that flushed on grant would be retroactive
 * collection of behaviour from someone who had not yet agreed to any.
 */
export function track<E extends KlupEventName>(event: E, properties: KlupEventMap[E]): void {
  if (!mayEmit()) return
  try {
    client!.capture(event, { ...buildSuperProperties(currentPathname()), ...properties })
  } catch {
    /* analytics must never break the product */
  }
}

/** The sanitised `$pageview` of §12.1 #1. */
export function capturePageview(pathname: string, search: string): void {
  if (!mayEmit()) return
  try {
    const origin = browserWindow()?.location?.origin ?? ''
    const referrer = browserDocument()?.referrer ?? ''
    client!.capture('$pageview', {
      ...buildSuperProperties(pathname),
      $current_url: buildAnalyticsUrl(origin, pathname, search),
      path_template: pathTemplateFor(pathname),
      referrer_host: referrerHostOf(referrer),
    })
  } catch {
    /* analytics must never break the product */
  }
}

/**
 * Connect the authenticated identity.
 *
 * The Supabase user UUID, and nothing else. Never an email address — not as
 * distinct id, not as a person property, not in a URL (§12.2, CLAUDE.md §7).
 * Called on every authenticated session start rather than only at signup,
 * because identity that is only established once is identity that is missing
 * for every returning visitor.
 */
export function identifyUser(userId: string): void {
  if (!mayEmit()) return
  if (!userId) return
  try {
    client!.identify(userId)
  } catch {
    /* analytics must never break the product */
  }
}

/** Called on sign-out, and as the first step of withdrawal. */
export function resetIdentity(): void {
  if (!client) return
  try {
    client.reset()
  } catch {
    /* analytics must never break the product */
  }
}

/**
 * The one-line summary the consent surface needs, without exposing the client.
 */
export function analyticsStatus(state: ConsentState): 'active' | 'inactive' {
  return allowsAnalytics(state) && isAnalyticsActive() ? 'active' : 'inactive'
}
