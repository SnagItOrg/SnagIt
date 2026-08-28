/**
 * Stage 3 WP-5 — consent, privacy and analytics identity.
 *
 * Verifies the contract in docs/stage-3-v1-decision-and-build-plan.md §12.4,
 * and the parts of the R6 release gate in §16.6 that can be asserted without a
 * browser. The browser-observable parts — traces A to F — are recorded
 * separately against a running build; what is mechanised here is everything
 * that can regress silently in a diff.
 *
 * WHY THE SOURCE-SCANNING TESTS EXIST. Several requirements are absences: no
 * Google Analytics, no Vercel Analytics, no US host, no tracker origin loose
 * in the codebase, no email field in the taxonomy. An absence cannot be
 * asserted by calling a function, and an absence is exactly what comes back
 * quietly six months later. So those are read off the files themselves.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  CONSENT_STORAGE_KEY,
  INTERNAL_FLAG_STORAGE_KEY,
  allowsAnalytics,
  captureInternalFlagFromLocation,
  isTrackerStorageKey,
  parseConsentState,
  persistConsent,
  purgeTrackerStorage,
  readInternalFlag,
  readStoredConsent,
  type ConsentState,
} from '../../frontend/lib/consent'

import {
  ANALYTICS_URL_PARAM_ALLOWLIST,
  POSTHOG_EU_HOSTS,
  UNMATCHED_PATH_TEMPLATE,
  V1_EVENT_NAMES,
  attachAnalyticsClient,
  buildAnalyticsUrl,
  buildSuperProperties,
  capturePageview,
  detachAnalyticsClient,
  identifyUser,
  isAnalyticsActive,
  isSuppressedSurface,
  isTransmittableEvent,
  logPostHogMisconfigurationOnce,
  prepareOutgoingPayload,
  REQUIRED_SDK_EVENTS,
  pathTemplateFor,
  referrerHostOf,
  resetIdentity,
  resetMisconfigurationLatchForTests,
  resolvePostHogConfig,
  sanitiseOutgoingProperties,
  shouldThrowOnMisconfiguration,
  subscribeAnalyticsReady,
  surfaceFor,
  track,
  type AnalyticsClient,
} from '../../frontend/lib/analytics'

import { classifyPath, ROUTE_ACCESS } from '../../frontend/lib/route-access'

const REPO = join(__dirname, '..', '..')
const FRONTEND = join(REPO, 'frontend')
const SOURCE_DIRS = ['app', 'lib', 'components'].map((d) => join(FRONTEND, d))

/** The canary of §16.6 F. It must never survive into an outgoing payload. */
const CANARY = 'zzq-canary-7431'

/* ════════════════════════════════════════════════════════════════════════
   Test doubles
   ════════════════════════════════════════════════════════════════════════ */

class FakeStorage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v))
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
  clear(): void {
    this.map.clear()
  }
  snapshot(): string[] {
    return Array.from(this.map.keys()).sort()
  }
}

interface Captured {
  event: string
  properties: Record<string, unknown>
}

function installBrowser(pathname = '/', search = '', referrer = '') {
  const local = new FakeStorage()
  const session = new FakeStorage()
  const captured: Captured[] = []
  const identified: string[] = []
  let resets = 0
  let registered: Record<string, unknown> = {}

  const client: AnalyticsClient = {
    capture(event, properties) {
      captured.push({ event, properties: properties ?? {} })
      return undefined
    },
    identify(distinctId) {
      identified.push(distinctId)
    },
    reset() {
      resets += 1
    },
    register(properties) {
      registered = { ...registered, ...properties }
    },
  }

  const g = globalThis as unknown as Record<string, unknown>
  g.window = {
    localStorage: local,
    sessionStorage: session,
    location: { pathname, search, origin: 'https://www.klup.dk', hostname: 'www.klup.dk' },
  }
  g.document = { cookie: '', referrer }
  g.localStorage = local

  return {
    local,
    session,
    client,
    captured,
    identified,
    resets: () => resets,
    registered: () => registered,
    teardown() {
      detachAnalyticsClient()
      delete g.window
      delete g.document
      delete g.localStorage
    },
  }
}

/* ════════════════════════════════════════════════════════════════════════
   1. The three-state consent model  (§12.4.2 point 3)
   ════════════════════════════════════════════════════════════════════════ */

test('consent: exactly three states, and only `granted` allows anything', () => {
  const states: ConsentState[] = ['undecided', 'granted', 'rejected']
  assert.deepEqual(states.filter(allowsAnalytics), ['granted'])
})

test('consent: `undecided` behaves exactly as `rejected`', () => {
  assert.equal(allowsAnalytics('undecided'), allowsAnalytics('rejected'))
  assert.equal(allowsAnalytics('undecided'), false)
})

test('consent: nothing but the literal string can produce `granted`', () => {
  const notGranted = [
    null,
    undefined,
    '',
    'GRANTED',
    'true',
    '1',
    'yes',
    'accepted',
    'granted ',
    '{"state":"granted"}',
    CANARY,
  ]
  for (const raw of notGranted) {
    assert.notEqual(parseConsentState(raw as string | null), 'granted', `coerced: ${String(raw)}`)
    assert.equal(parseConsentState(raw as string | null), 'undecided', `coerced: ${String(raw)}`)
  }
  assert.equal(parseConsentState('granted'), 'granted')
  assert.equal(parseConsentState('rejected'), 'rejected')
})

test('consent: a decision persists, and undecided clears the record', () => {
  const env = installBrowser()
  try {
    assert.equal(readStoredConsent(), 'undecided')

    persistConsent('granted')
    assert.equal(env.local.getItem(CONSENT_STORAGE_KEY), 'granted')
    assert.equal(readStoredConsent(), 'granted')

    persistConsent('rejected')
    assert.equal(readStoredConsent(), 'rejected')

    persistConsent('undecided')
    assert.equal(env.local.getItem(CONSENT_STORAGE_KEY), null)
    assert.equal(readStoredConsent(), 'undecided')
  } finally {
    env.teardown()
  }
})

test('consent: corrupted storage fails to the safe state rather than throwing', () => {
  const env = installBrowser()
  try {
    env.local.setItem(CONSENT_STORAGE_KEY, '{"granted":true}')
    assert.equal(readStoredConsent(), 'undecided')
  } finally {
    env.teardown()
  }
})

/* ════════════════════════════════════════════════════════════════════════
   2. Withdrawal sweeps what the tracker persisted  (§12.4.4)
   ════════════════════════════════════════════════════════════════════════ */

test('withdrawal: every tracker key is swept and nothing else is touched', () => {
  const env = installBrowser()
  try {
    env.local.setItem('ph_abc123_posthog', '{"distinct_id":"x"}')
    env.local.setItem('__ph_opt_in_out_abc123', '1')
    env.local.setItem('posthog_extra', 'x')
    env.session.setItem('ph_session', 'x')

    // Everything the product legitimately owns must survive.
    env.local.setItem(CONSENT_STORAGE_KEY, 'rejected')
    env.local.setItem('klup-locale', 'da')
    env.local.setItem('klup-onboarding', '{}')
    env.local.setItem('sb-access-token', 'session')

    purgeTrackerStorage()

    assert.deepEqual(env.local.snapshot(), [
      'klup-locale',
      'klup-onboarding',
      CONSENT_STORAGE_KEY,
      'sb-access-token',
    ].sort())
    assert.deepEqual(env.session.snapshot(), [])
  } finally {
    env.teardown()
  }
})

test('withdrawal: the sweep recognises the tracker key families', () => {
  assert.equal(isTrackerStorageKey('ph_token_posthog'), true)
  assert.equal(isTrackerStorageKey('__ph_opt_in_out_token'), true)
  assert.equal(isTrackerStorageKey('posthog'), true)
  assert.equal(isTrackerStorageKey(CONSENT_STORAGE_KEY), false)
  assert.equal(isTrackerStorageKey('klup-locale'), false)
  assert.equal(isTrackerStorageKey('sb-refresh-token'), false)
})

/* ════════════════════════════════════════════════════════════════════════
   3. The EU host fails closed  (§12.4.6)
   ════════════════════════════════════════════════════════════════════════ */

test('host: an unset host initialises nothing — there is no fallback', () => {
  for (const host of [undefined, '', '   ']) {
    const r = resolvePostHogConfig({ host, token: 't', vercelEnv: 'production' })
    assert.equal(r.ok, false)
    assert.equal(r.ok === false && r.reason, 'host_missing')
  }
})

test('host: the US region is not an available outcome under any configuration', () => {
  const usHosts = [
    'https://app.posthog.com',
    'https://us.i.posthog.com',
    'https://us.posthog.com',
    'http://eu.i.posthog.com.evil.example',
    'https://eu.i.posthog.com.attacker.test',
    'https://posthog.com',
  ]
  for (const host of usHosts) {
    const r = resolvePostHogConfig({ host, token: 't', vercelEnv: 'production' })
    assert.equal(r.ok, false, `accepted a non-EU host: ${host}`)
    assert.equal(r.ok === false && r.reason, 'host_not_eu')
  }
})

test('host: only the two EU hosts resolve, and casing/trailing slash cannot decide', () => {
  for (const base of POSTHOG_EU_HOSTS) {
    for (const variant of [base, `${base}/`, base.toUpperCase(), ` ${base} `]) {
      const r = resolvePostHogConfig({ host: variant, token: 't', vercelEnv: 'production' })
      assert.equal(r.ok, true, `rejected an EU host: ${variant}`)
      assert.equal(r.ok === true && r.host, base)
    }
  }
  assert.deepEqual([...POSTHOG_EU_HOSTS], ['https://eu.i.posthog.com', 'https://eu.posthog.com'])
})

test('host: a missing token also initialises nothing', () => {
  const r = resolvePostHogConfig({
    host: 'https://eu.i.posthog.com',
    token: '',
    vercelEnv: 'production',
  })
  assert.equal(r.ok === false && r.reason, 'token_missing')
})

test('host: preview and development deployments emit nothing at all', () => {
  for (const vercelEnv of ['preview', 'development', undefined]) {
    const r = resolvePostHogConfig({
      host: 'https://eu.i.posthog.com',
      token: 't',
      vercelEnv,
    })
    assert.equal(r.ok, false, `initialised outside production: ${String(vercelEnv)}`)
    assert.equal(r.ok === false && r.reason, 'non_production')
  }
})

test('host: misconfiguration is judged before the environment gate, so dev can throw', () => {
  const env = { host: undefined, token: 't', vercelEnv: 'development', nodeEnv: 'development' }
  const r = resolvePostHogConfig(env)
  assert.equal(r.ok === false && r.reason, 'host_missing')
  assert.equal(shouldThrowOnMisconfiguration(r, env), true)
})

test('host: a correctly configured non-production build does NOT throw', () => {
  const env = {
    host: 'https://eu.i.posthog.com',
    token: 't',
    vercelEnv: 'preview',
    nodeEnv: 'development',
  }
  const r = resolvePostHogConfig(env)
  assert.equal(r.ok === false && r.reason, 'non_production')
  assert.equal(shouldThrowOnMisconfiguration(r, env), false)
})

test('host: production misconfiguration logs exactly one operational line, never to PostHog', () => {
  const lines: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => lines.push(String(args[0]))
  try {
    resetMisconfigurationLatchForTests()
    const env = { host: undefined, token: 't', vercelEnv: 'production', nodeEnv: 'production' }
    logPostHogMisconfigurationOnce(env)
    logPostHogMisconfigurationOnce(env)
    logPostHogMisconfigurationOnce(env)
  } finally {
    console.error = original
    resetMisconfigurationLatchForTests()
  }

  assert.equal(lines.length, 1, 'expected exactly one operational line per instance')
  const payload = JSON.parse(lines[0]) as Record<string, unknown>
  assert.equal(payload.channel, 'operational')
  assert.equal(payload.event, 'posthog_not_initialised')
  assert.equal(payload.reason, 'host_missing')
  // Operational logging carries no behavioural content (§12.4.8).
  for (const forbidden of ['query_norm', 'product_slug', 'user_id', 'email', 'distinct_id']) {
    assert.equal(forbidden in payload, false, `operational log leaked ${forbidden}`)
  }
})

/* ════════════════════════════════════════════════════════════════════════
   4. Raw search text cannot reach the processor  (§12.4.7, §16.6 F)
   ════════════════════════════════════════════════════════════════════════ */

test('url: the allow-list is exactly the two bounded parameters', () => {
  assert.deepEqual([...ANALYTICS_URL_PARAM_ALLOWLIST], ['page', 'sub'])
  assert.equal(ANALYTICS_URL_PARAM_ALLOWLIST.includes('q'), false)
})

test('url: a search query never survives into the transmitted URL', () => {
  const built = buildAnalyticsUrl(
    'https://www.klup.dk',
    '/search',
    `?q=${encodeURIComponent(CANARY)}&page=2&sub=synths&utm_source=x`,
  )
  assert.equal(built.includes(CANARY), false)
  assert.equal(built.includes('q='), false)
  assert.equal(built.includes('utm_source'), false)
  assert.equal(built, 'https://www.klup.dk/search?page=2&sub=synths')
})

test('url: a path with no allowed parameters transmits no query string at all', () => {
  assert.equal(
    buildAnalyticsUrl('https://www.klup.dk', '/product/roland-juno-106', `?q=${CANARY}`),
    'https://www.klup.dk/product/roland-juno-106',
  )
})

test('url: an unparseable query copies nothing rather than falling back to the raw string', () => {
  const built = buildAnalyticsUrl('https://www.klup.dk', '/search', `?=${CANARY}&&&%%%`)
  assert.equal(built.includes(CANARY), false)
})

test('referrer: only the host survives, never another site’s query string', () => {
  assert.equal(referrerHostOf(`https://www.klup.dk/search?q=${CANARY}`), 'www.klup.dk')
  assert.equal(referrerHostOf(`https://www.google.com/search?q=${CANARY}`), 'www.google.com')
  assert.equal(referrerHostOf(''), null)
  assert.equal(referrerHostOf('not-a-url'), null)
})

test('before_send: every URL-bearing automatic property is rewritten, not just ours', () => {
  const dirty = {
    $current_url: `https://www.klup.dk/search?q=${CANARY}&page=2`,
    $initial_current_url: `https://www.klup.dk/search?q=${CANARY}`,
    $pathname: '/search',
    $referrer: `https://www.klup.dk/browse?q=${CANARY}`,
    $initial_referrer: `https://external.example/x?q=${CANARY}`,
    $referring_domain: 'www.klup.dk',
    $host: 'www.klup.dk',
    $session_entry_url: `https://www.klup.dk/?q=${CANARY}`,
    product_slug: 'roland-juno-106',
  }

  const clean = sanitiseOutgoingProperties(dirty)
  const serialised = JSON.stringify(clean)

  assert.equal(serialised.includes(CANARY), false, `canary survived: ${serialised}`)
  assert.equal(clean.$current_url, 'https://www.klup.dk/search?page=2')
  assert.equal(clean.$referrer, 'www.klup.dk')
  assert.equal(clean.$initial_referrer, 'external.example')
  assert.equal(clean.$host, 'www.klup.dk')
  // Declared, non-URL properties are untouched.
  assert.equal(clean.product_slug, 'roland-juno-106')
})

test('before_send: an unrecognised URL becomes null rather than passing through', () => {
  const clean = sanitiseOutgoingProperties({ $current_url: `javascript:alert('${CANARY}')` })
  assert.equal(JSON.stringify(clean).includes(CANARY), false)
})

/* ════════════════════════════════════════════════════════════════════════
   5. Path templates and surfaces
   ════════════════════════════════════════════════════════════════════════ */

test('template: a product slug never appears in the path template', () => {
  assert.equal(pathTemplateFor('/product/roland-juno-106'), '/product/[slug]')
  assert.equal(pathTemplateFor('/browse/music-gear'), '/browse/[root]')
  assert.equal(pathTemplateFor('/'), '/')
  assert.equal(pathTemplateFor('/search'), '/search')
  assert.equal(pathTemplateFor('/privatliv'), '/privatliv')
  assert.equal(pathTemplateFor('/nothing-here-xyz'), UNMATCHED_PATH_TEMPLATE)
})

test('surface: every template maps onto the declared vocabulary', () => {
  assert.equal(surfaceFor('/'), 'landing')
  assert.equal(surfaceFor('/browse'), 'browse_root')
  assert.equal(surfaceFor('/browse/[root]'), 'browse_leaf')
  assert.equal(surfaceFor('/product/[slug]'), 'product')
  assert.equal(surfaceFor('/search'), 'search')
  assert.equal(surfaceFor('/privatliv'), 'privacy')
  assert.equal(surfaceFor('/login'), 'auth')
  assert.equal(surfaceFor(UNMATCHED_PATH_TEMPLATE), 'other')
})

test('surface: /admin and /intel are suppressed, ordinary pages are not', () => {
  for (const p of ['/admin', '/admin/products', '/admin/product/x', '/intel', '/intel/x']) {
    assert.equal(isSuppressedSurface(p), true, `not suppressed: ${p}`)
  }
  for (const p of ['/', '/browse', '/product/roland-juno-106', '/administration', '/intelligence']) {
    assert.equal(isSuppressedSurface(p), false, `wrongly suppressed: ${p}`)
  }
})

/* ════════════════════════════════════════════════════════════════════════
   6. track() — gated, typed, unbuffered
   ════════════════════════════════════════════════════════════════════════ */

test('track: before consent there is no client, so nothing is captured and nothing is queued', () => {
  const env = installBrowser('/product/roland-juno-106')
  try {
    assert.equal(isAnalyticsActive(), false)

    track('product_viewed', {
      product_slug: 'roland-juno-106',
      product_id: 'id',
      brand_slug: 'roland',
      tier: 'legendary',
      support_state: 'supported',
      browse_visibility: 'public',
      active_listing_count: 3,
      has_image: true,
      has_article: false,
      has_specs: true,
      has_history_timeline: false,
      related_count: 2,
      entry_ref: 'direct',
      referrer_product_slug: null,
    })

    assert.deepEqual(env.captured, [])

    // Attaching later must NOT replay anything from before consent.
    attachAnalyticsClient(env.client)
    assert.deepEqual(env.captured, [], 'a pre-consent event was replayed on grant')
  } finally {
    env.teardown()
  }
})

test('track: after consent an event carries the six super-properties', () => {
  const env = installBrowser('/product/roland-juno-106')
  try {
    attachAnalyticsClient(env.client)
    track('discovery_product_clicked', {
      shelf: 'followed',
      product_slug: 'roland-juno-106',
      position: 0,
      shelf_size: 14,
      has_image: true,
      active_listing_count: 3,
      tier: 'legendary',
    })

    assert.equal(env.captured.length, 1)
    const { event, properties } = env.captured[0]
    assert.equal(event, 'discovery_product_clicked')
    assert.equal(properties.klup_schema_version, 2)
    assert.equal(properties.surface, 'product')
    assert.equal(properties.locale, 'da')
    assert.equal(properties.is_internal, false)
    assert.equal(properties.internal_role, null)
    assert.equal(properties.shelf, 'followed')
  } finally {
    env.teardown()
  }
})

test('track: withdrawal stops sending at once, not at the next render', () => {
  const env = installBrowser('/')
  try {
    attachAnalyticsClient(env.client)
    track('browse_leaf_viewed', {
      root_slug: 'music-gear',
      page: 1,
      page_size: 48,
      total_public_products: 10,
      rendered_count: 10,
      subcategory_count: 4,
    })
    assert.equal(env.captured.length, 1)

    detachAnalyticsClient()
    assert.equal(isAnalyticsActive(), false)

    track('browse_leaf_viewed', {
      root_slug: 'music-gear',
      page: 1,
      page_size: 48,
      total_public_products: 10,
      rendered_count: 10,
      subcategory_count: 4,
    })
    assert.equal(env.captured.length, 1, 'an event was sent after withdrawal')
  } finally {
    env.teardown()
  }
})

test('track: /admin and /intel emit no product events even with consent granted', () => {
  for (const pathname of ['/admin/products', '/intel']) {
    const env = installBrowser(pathname)
    try {
      attachAnalyticsClient(env.client)
      track('watch_created', {
        query_norm: 'roland juno 106',
        watch_type: 'query',
        origin_surface: 'product',
        origin_product_slug: 'roland-juno-106',
        has_max_price: false,
        max_price: null,
      })
      capturePageview(pathname, '')
      assert.deepEqual(env.captured, [], `${pathname} emitted an event`)
    } finally {
      env.teardown()
    }
  }
})

test('track: the internal flag tags a session rather than dropping it', () => {
  const env = installBrowser('/', '?klup_internal=1')
  try {
    assert.equal(readInternalFlag(), false)
    captureInternalFlagFromLocation('?klup_internal=1')
    assert.equal(env.local.getItem(INTERNAL_FLAG_STORAGE_KEY), '1')

    attachAnalyticsClient(env.client)
    const props = buildSuperProperties('/')
    assert.equal(props.is_internal, true)
    assert.equal(props.internal_role, 'founder')
  } finally {
    env.teardown()
  }
})

test('pageview: the captured payload carries a template and no raw query', () => {
  const env = installBrowser('/search', '', `https://www.klup.dk/browse?q=${CANARY}`)
  try {
    attachAnalyticsClient(env.client)
    capturePageview('/search', `q=${CANARY}&page=3`)

    assert.equal(env.captured.length, 1)
    const { event, properties } = env.captured[0]
    assert.equal(event, '$pageview')
    assert.equal(properties.path_template, '/search')
    assert.equal(properties.$current_url, 'https://www.klup.dk/search?page=3')
    assert.equal(properties.referrer_host, 'www.klup.dk')
    assert.equal(JSON.stringify(properties).includes(CANARY), false)
  } finally {
    env.teardown()
  }
})

test('identity: the Supabase uuid is sent, and reset is available for sign-out', () => {
  const env = installBrowser('/watchlists')
  try {
    identifyUser('11111111-2222-3333-4444-555555555555')
    assert.deepEqual(env.identified, [], 'identified before consent')

    attachAnalyticsClient(env.client)
    identifyUser('11111111-2222-3333-4444-555555555555')
    assert.deepEqual(env.identified, ['11111111-2222-3333-4444-555555555555'])

    identifyUser('')
    assert.equal(env.identified.length, 1, 'an empty identity was sent')

    resetIdentity()
    assert.equal(env.resets(), 1)
  } finally {
    env.teardown()
  }
})

test('outgoing: the SDK allow-list is exactly the events V1 needs', () => {
  assert.deepEqual([...REQUIRED_SDK_EVENTS], ['$pageview', '$identify'])
})

test('outgoing: the required SDK events transmit', () => {
  for (const name of REQUIRED_SDK_EVENTS) {
    assert.equal(isTransmittableEvent(name), true, `required SDK event refused: ${name}`)
  }
  assert.equal(isTransmittableEvent('$pageview'), true)
  assert.equal(isTransmittableEvent('$identify'), true)
})

test('outgoing: every typed Klup event still transmits, unchanged', () => {
  for (const name of V1_EVENT_NAMES) {
    assert.equal(isTransmittableEvent(name), true, `taxonomy event refused: ${name}`)
  }
  assert.equal(V1_EVENT_NAMES.length, 11)
})

test('outgoing: every other $ event is dropped, by name and not by prefix', () => {
  // Real SDK events that a configuration change, an SDK upgrade or a stray
  // call could otherwise put on the wire. None is needed by V1.
  const sdkEventsWeDoNotSend = [
    '$set',
    '$set_once',
    '$create_alias',
    '$groupidentify',
    '$pageleave',
    '$autocapture',
    '$rageclick',
    '$dead_click',
    '$snapshot',
    '$exception',
    '$web_vitals',
    '$feature_flag_called',
    '$opt_in',
    '$survey_shown',
    '$survey_sent',
    '$survey_dismissed',
    '$copy_autocapture',
    '$posthog_cookieless',
  ]
  for (const name of sdkEventsWeDoNotSend) {
    assert.equal(isTransmittableEvent(name), false, `undeclared SDK event allowed: ${name}`)
  }
})

test('outgoing: an unknown future $ event fails closed', () => {
  for (const name of ['$future_event', '$whatever_posthog_adds_next', '$', '$$', '$PAGEVIEW']) {
    assert.equal(isTransmittableEvent(name), false, `unknown $ event allowed: ${name}`)
  }
  // The guarantee is structural: no prefix test, no pattern and no
  // default-allow branch exists in the source, so a $ event PostHog adds in a
  // future release cannot inherit permission from its name.
  const analytics = readFileSync(join(FRONTEND, 'lib', 'analytics.ts'), 'utf8')
  const open = analytics.indexOf('export function isTransmittableEvent')
  const close = analytics.indexOf('\n}\n', open)
  const fn = analytics.slice(open, close)
  assert.ok(open > 0 && close > open && fn.length < 400, 'could not isolate isTransmittableEvent')
  assert.equal(/startsWith\(/.test(fn), false, 'a prefix rule survives in the gate')
  assert.equal(/charAt\(|\[0\]|indexOf\(/.test(fn), false, 'a positional test survives in the gate')
  assert.equal(/RegExp|\.test\(/.test(fn), false, 'a pattern match survives in the gate')
})

test('outgoing: pre-Stage-3 call sites in other packages are still dropped', () => {
  for (const legacy of [
    'search_performed',
    'listing_clicked',
    'listing_saved',
    'watchlist_created',
    'signup_completed',
    'anything_at_all',
  ]) {
    assert.equal(isTransmittableEvent(legacy), false, `undeclared event allowed: ${legacy}`)
  }
})

test('outgoing: before_send drops the undeclared and sanitises the rest', () => {
  // The real send-path function, not a re-implementation of it.
  assert.equal(prepareOutgoingPayload(null), null)

  for (const event of ['$future_event', '$set', '$exception', 'search_performed']) {
    assert.equal(
      prepareOutgoingPayload({ event, properties: { query: CANARY } }),
      null,
      `${event} was not dropped on the send path`,
    )
  }

  const pageview = prepareOutgoingPayload({
    event: '$pageview',
    properties: {
      $current_url: `https://www.klup.dk/search?q=${CANARY}&page=2`,
      $referrer: `https://www.klup.dk/browse?q=${CANARY}`,
      path_template: '/search',
    },
  })
  assert.ok(pageview, '$pageview was dropped')
  assert.equal(JSON.stringify(pageview).includes(CANARY), false, 'the canary survived the send path')
  assert.equal(pageview.properties?.$current_url, 'https://www.klup.dk/search?page=2')
  assert.equal(pageview.properties?.$referrer, 'www.klup.dk')

  const identify = prepareOutgoingPayload({
    event: '$identify',
    properties: { distinct_id: '11111111-2222-3333-4444-555555555555' },
  })
  assert.ok(identify, '$identify was dropped — the identity flow would break')
  assert.equal(identify.properties?.distinct_id, '11111111-2222-3333-4444-555555555555')

  const tracked = prepareOutgoingPayload({
    event: 'product_viewed',
    properties: { product_slug: 'roland-juno-106' },
  })
  assert.ok(tracked, 'a typed Klup event was dropped')
  assert.equal(tracked.properties?.product_slug, 'roland-juno-106')
})

test('outgoing: capture features that would emit undeclared $ events stay disabled', () => {
  const provider = readFileSync(join(FRONTEND, 'components', 'PostHogProvider.tsx'), 'utf8')
  assert.match(provider, /before_send: \(payload\) => prepareOutgoingPayload\(payload\)/)
  for (const off of [
    'autocapture: false',
    'capture_pageview: false',
    'capture_pageleave: false',
    'capture_exceptions: false',
    'capture_dead_clicks: false',
    'rageclick: false',
    'capture_performance: false',
    'disable_session_recording: true',
    'disable_surveys: true',
    'save_campaign_params: false',
    'save_referrer: false',
    "persistence: 'localStorage'",
  ]) {
    assert.ok(provider.includes(off), `posthog init is missing: ${off}`)
  }
})

test('outgoing: consent still gates everything the allow-list would otherwise permit', () => {
  const env = installBrowser('/product/roland-juno-106')
  try {
    // Undecided and rejected share this path: no client, so an event the
    // allow-list permits is still not sent, and identity is not connected.
    capturePageview('/product/roland-juno-106', '')
    identifyUser('11111111-2222-3333-4444-555555555555')
    // Length, not deepEqual: node's strict deepEqual narrows the operand to
    // `never[]`, which would make every later assertion on it a type error.
    assert.equal(env.captured.length, 0, 'an allowed event was sent before consent')
    assert.equal(env.identified.length, 0, 'identity was connected before consent')

    // Granted: both required SDK events reach the client.
    attachAnalyticsClient(env.client)
    capturePageview('/product/roland-juno-106', '')
    identifyUser('11111111-2222-3333-4444-555555555555')
    assert.deepEqual(env.captured.map((c) => c.event), ['$pageview'])
    assert.deepEqual(env.identified, ['11111111-2222-3333-4444-555555555555'])

    // Withdrawal: reset runs, then everything stops again.
    resetIdentity()
    detachAnalyticsClient()
    assert.equal(env.resets(), 1, 'reset() was not called on withdrawal')
    capturePageview('/product/roland-juno-106', '')
    identifyUser('11111111-2222-3333-4444-555555555555')
    assert.equal(env.captured.length, 1, 'an event was sent after withdrawal')
    assert.equal(env.identified.length, 1, 'identity was reconnected after withdrawal')
  } finally {
    env.teardown()
  }
})

test('readiness: a listener fires when the client arrives, and only then', () => {
  const env = installBrowser('/')
  try {
    let fired = 0
    const unsubscribe = subscribeAnalyticsReady(() => {
      fired += 1
    })
    assert.equal(fired, 0, 'a listener fired before the client existed')

    attachAnalyticsClient(env.client)
    assert.equal(fired, 1, 'the listener was not told the client arrived')

    // Subscribing after the fact must resolve immediately, or a late mount
    // would wait forever for an event that has already happened.
    let late = 0
    const unsubscribeLate = subscribeAnalyticsReady(() => {
      late += 1
    })
    assert.equal(late, 1)

    unsubscribe()
    unsubscribeLate()
    detachAnalyticsClient()
    attachAnalyticsClient(env.client)
    assert.equal(fired, 1, 'an unsubscribed listener was still called')
  } finally {
    env.teardown()
  }
})

test('readiness: the pageview waits for the client instead of firing into nothing', () => {
  const view = readFileSync(join(FRONTEND, 'components', 'PostHogPageView.tsx'), 'utf8')
  assert.match(view, /subscribeAnalyticsReady/)
  assert.match(view, /\[ready, pathname, searchParams\]/)
})

/* ════════════════════════════════════════════════════════════════════════
   7. The taxonomy carries no direct identifier  (§16.6 G, acceptance 11)
   ════════════════════════════════════════════════════════════════════════ */

test('taxonomy: exactly the eleven tracked V1 events, plus $pageview', () => {
  assert.deepEqual([...V1_EVENT_NAMES].sort(), [
    'browse_leaf_viewed',
    'demand_signal_submitted',
    'discovery_product_clicked',
    'listing_click_out',
    'outbound_retail_click',
    'price_context_shown',
    'product_viewed',
    'search_resolved',
    'search_submitted',
    'search_unsupported',
    'watch_created',
  ])
  assert.equal(V1_EVENT_NAMES.length, 11)
})

test('taxonomy: no email-typed or direct-identifier field exists in the event union', () => {
  const source = readFileSync(join(FRONTEND, 'lib', 'analytics.ts'), 'utf8')
  const start = source.indexOf('export interface KlupEventMap {')
  assert.ok(start > 0, 'KlupEventMap not found')
  const end = source.indexOf('\n}\n', start)
  const union = source.slice(start, end)

  const fields = Array.from(union.matchAll(/^\s{4}([a-z_][a-z0-9_]*)\s*:/gim)).map((m) => m[1])
  assert.ok(fields.length > 40, 'field scan found suspiciously little')

  const forbidden = /(^|_)(email|mail|phone|tel|address|name|ip|postcode|zip)($|_)/i
  const offenders = fields.filter((f) => f !== 'has_email' && forbidden.test(f))
  assert.deepEqual(offenders, [], `direct-identifier fields in the taxonomy: ${offenders.join(', ')}`)

  // The one permitted mention is a boolean, never the address itself.
  assert.match(union, /has_email:\s*boolean/)
  assert.equal(/email:\s*string/.test(union), false)
})

/* ════════════════════════════════════════════════════════════════════════
   8. Tracker inventory — absences, read off the files  (§16.6 G)
   ════════════════════════════════════════════════════════════════════════ */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    // node_modules is a symlink in this worktree; statSync would follow it.
    if (entry === 'node_modules' || entry === '.next') continue
    const info = statSync(full)
    if (info.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) out.push(full)
  }
  return out
}

const SOURCE_FILES = SOURCE_DIRS.flatMap((d) => walk(d))

test('inventory: Google Analytics is removed from the source, not merely disabled', () => {
  const offenders = SOURCE_FILES.filter((f) =>
    /gtag|dataLayer|googletagmanager|google-analytics|NEXT_PUBLIC_GA_ID|G-TCHJJVVWK8/.test(
      readFileSync(f, 'utf8'),
    ),
  )
  assert.deepEqual(offenders, [], `Google Analytics survives in: ${offenders.join(', ')}`)
})

test('inventory: Vercel Analytics is removed from the source and from the manifest', () => {
  const offenders = SOURCE_FILES.filter((f) => readFileSync(f, 'utf8').includes('@vercel/analytics'))
  assert.deepEqual(offenders, [], `Vercel Analytics survives in: ${offenders.join(', ')}`)

  const manifest = readFileSync(join(FRONTEND, 'package.json'), 'utf8')
  assert.equal(manifest.includes('@vercel/analytics'), false)
  assert.equal(
    readFileSync(join(FRONTEND, 'package-lock.json'), 'utf8').includes('@vercel/analytics'),
    false,
  )

  // Tracker 4 is retained and consent-gated, so its dependency must remain.
  assert.equal(manifest.includes('@vercel/speed-insights'), true)
})

test('inventory: the US PostHog host appears nowhere in the frontend source', () => {
  const offenders = SOURCE_FILES.filter((f) =>
    /app\.posthog\.com|us\.i\.posthog\.com/.test(readFileSync(f, 'utf8')),
  )
  assert.deepEqual(offenders, [], `US host referenced in: ${offenders.join(', ')}`)
})

test('inventory: tracker origins are confined to the one module that owns them', () => {
  const ORIGIN = /posthog\.com|vercel-scripts\.com|vercel-insights\.com/
  const allowed = join(FRONTEND, 'lib', 'analytics.ts')
  const offenders = SOURCE_FILES.filter(
    (f) => f !== allowed && ORIGIN.test(readFileSync(f, 'utf8')),
  )
  assert.deepEqual(
    offenders,
    [],
    `a tracker origin escaped lib/analytics.ts into: ${offenders.join(', ')}`,
  )
})

test('inventory: only two trackers can be mounted, and only from AnalyticsRoot', () => {
  const importers = SOURCE_FILES.filter((f) => {
    const src = readFileSync(f, 'utf8')
    return /from '@vercel\/speed-insights|import\('@vercel\/speed-insights/.test(src)
  })
  assert.deepEqual(importers.map((f) => f.replace(FRONTEND + '/', '')), [
    'components/AnalyticsRoot.tsx',
  ])

  const posthogImporters = SOURCE_FILES.filter((f) => {
    const src = readFileSync(f, 'utf8')
    return /from 'posthog-js|import\('posthog-js/.test(src)
  }).map((f) => f.replace(FRONTEND + '/', ''))

  // WP-5 initialises PostHog in exactly one place. Any other file that still
  // reaches for the SDK is a legacy call site owned by another package; it may
  // read the singleton, but it may not create or configure one.
  assert.ok(
    posthogImporters.includes('components/PostHogProvider.tsx'),
    'PostHogProvider no longer imports the SDK',
  )
  const initialisers = SOURCE_FILES.filter((f) => /posthog\.init\(/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(initialisers.map((f) => f.replace(FRONTEND + '/', '')), [
    'components/PostHogProvider.tsx',
  ])
})

test('inventory: both trackers arrive by dynamic import, so nothing loads before consent', () => {
  const analyticsRoot = readFileSync(join(FRONTEND, 'components', 'AnalyticsRoot.tsx'), 'utf8')
  const provider = readFileSync(join(FRONTEND, 'components', 'PostHogProvider.tsx'), 'utf8')

  assert.match(analyticsRoot, /import\('@vercel\/speed-insights\/next'\)/)
  assert.equal(/^import .*'@vercel\/speed-insights/m.test(analyticsRoot), false)

  assert.match(provider, /import\('posthog-js'\)/)
  assert.equal(/^import posthog from 'posthog-js'/m.test(provider), false)

  // The gate returns before either module is referenced.
  assert.match(analyticsRoot, /if \(!analyticsAllowed\) return null/)
})

test('inventory: the root layout mounts the consent gate and no tracker directly', () => {
  const layout = readFileSync(join(FRONTEND, 'app', 'layout.tsx'), 'utf8')
  for (const required of ['ConsentProvider', 'ConsentBanner', 'ConsentFooterControl', 'AnalyticsRoot']) {
    assert.ok(layout.includes(`<${required}`), `layout does not mount ${required}`)
  }
  assert.equal(layout.includes('<Analytics />'), false, 'Vercel Analytics still mounted')
  assert.equal(layout.includes('@vercel/'), false, 'the layout still imports a Vercel tracker')
  assert.equal(layout.includes('<SpeedInsights'), false, 'Speed Insights mounted outside the gate')
  assert.equal(layout.includes('<Script'), false, 'a script tag survives in the layout')
  assert.equal(layout.includes('next/script'), false, 'the script loader is still imported')
  assert.match(layout, /export const metadata = siteMetadata/)
})

test('consent surface: reject and accept share one style, so neither can be cheapened', () => {
  const banner = readFileSync(join(FRONTEND, 'components', 'ConsentBanner.tsx'), 'utf8')
  const actions = Array.from(banner.matchAll(/className=\{ACTION_CLASS\}\s*\n\s*style=\{ACTION_STYLE\}/g))
  assert.equal(actions.length, 2, 'the two consent actions do not share one style')
  assert.match(banner, /data-testid="consent-reject"/)
  assert.match(banner, /data-testid="consent-accept"/)
  // The banner exists only while the answer is unknown: no re-prompt after a no.
  assert.match(banner, /state !== 'undecided'\) return null/)
  // Not a modal: no scroll lock, no focus trap, nothing withheld behind it.
  assert.equal(/overflow-hidden|backdrop-blur|inset-0/.test(banner), false)
})

/* ════════════════════════════════════════════════════════════════════════
   9. The privacy route  (§12.4.5)
   ════════════════════════════════════════════════════════════════════════ */

test('privacy: /privatliv is classified public and is no longer planned', () => {
  const rule = ROUTE_ACCESS.find((r) => r.route === '/privatliv')
  assert.ok(rule, '/privatliv has no classification')
  assert.equal(rule!.access, 'public_page')
  assert.equal(rule!.planned, undefined, 'the route file exists; planned must be dropped')
  assert.equal(classifyPath('/privatliv')?.access, 'public_page')
})

test('privacy: the page names every processor, purpose, category, period and region', () => {
  const page = readFileSync(join(FRONTEND, 'app', 'privatliv', 'page.tsx'), 'utf8')

  for (const processor of [
    'Supabase',
    'Vercel',
    'Cloudflare',
    'Resend',
    'Frankfurter',
    'PostHog (EU)',
    'Vercel Speed Insights',
  ]) {
    assert.ok(page.includes(processor), `privacy page omits processor: ${processor}`)
  }
  for (const marketplace of ['DBA', 'Finn.no', 'Blocket', 'Kleinanzeigen', 'Reverb']) {
    assert.ok(page.includes(marketplace), `privacy page omits marketplace: ${marketplace}`)
  }

  for (const heading of [
    't.privacyProcessorsHeading',
    't.privacyPurposeHeading',
    't.privacyDataHeading',
    't.privacyRetentionHeading',
    't.privacyRightsHeading',
    't.privacyContactHeading',
  ]) {
    assert.ok(page.includes(heading), `privacy page omits section: ${heading}`)
  }

  // Concrete retention, never "as long as necessary".
  assert.match(page, /12 måneder/)
  assert.equal(/så længe det er nødvendigt|as long as necessary/i.test(page), false)

  // A withdrawal control lives on the page itself, not only in the footer.
  assert.match(page, /data-testid="privacy-consent-withdraw"/)
  assert.match(page, /data-testid="privacy-consent-grant"/)

  // A contact route for rights requests must exist.
  assert.match(page, /mailto:\$\{PRIVACY_CONTACT_EMAIL\}/)
})

test('privacy: the withdrawal control is on every public page, and not on operator surfaces', () => {
  const footer = readFileSync(join(FRONTEND, 'components', 'ConsentFooterControl.tsx'), 'utf8')
  assert.match(footer, /isSuppressedSurface\(pathname\)/)
  assert.match(footer, /data-testid="consent-withdraw"/)
  assert.match(footer, /data-testid="consent-grant"/)
  assert.match(footer, /href="\/privatliv"/)
})

/* ════════════════════════════════════════════════════════════════════════
   10. Channel separation  (§12.4.8)
   ════════════════════════════════════════════════════════════════════════ */

test('channels: no operational logging is routed through the analytics client', () => {
  const analytics = readFileSync(join(FRONTEND, 'lib', 'analytics.ts'), 'utf8')
  // The single console line in this module is the operational one, and it is
  // console.error rather than a capture() call.
  const captures = Array.from(analytics.matchAll(/client!?\.capture\(/g))
  assert.equal(captures.length, 2, 'unexpected capture() call sites in the analytics core')
  assert.match(analytics, /channel: 'operational'/)

  // The rate limiter and the scrape route logging stay operational and stay put.
  const middleware = readFileSync(join(FRONTEND, 'middleware.ts'), 'utf8')
  assert.equal(/posthog|analytics/i.test(middleware), false, 'analytics leaked into middleware')
})
