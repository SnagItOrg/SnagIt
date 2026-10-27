/**
 * A failed magic-link send must not be reported as a success.
 *
 * `supabase.auth.signInWithOtp()` RETURNS its failures instead of throwing
 * them. Verified against the installed `@supabase/auth-js` 2.96.0 rather than
 * from memory: `_request` throws on a non-2xx, `GoTrueClient.signInWithOtp`
 * catches it, and its catch ends `if (isAuthError(error)) return
 * this._returnResult({ …, error }); throw error`. Every failure that can reach
 * that line is already an AuthError — a rate limit and a rejected address are
 * `AuthApiError`, and a network or CORS failure is wrapped by `handleError`
 * into `AuthRetryableFetchError`, which extends `AuthError` too. So the throw
 * is effectively unreachable.
 *
 * Both public call sites got this wrong in opposite ways: SearchResultCard
 * discarded the return value and set its sent state unconditionally, and the
 * search page's demand panel wrapped the call in a `try/catch` that the
 * returned error walked straight past. Neither is a rare path — a repeated
 * submit is enough to be rate-limited.
 *
 * The classifier is a real import because `lib/otp-error.ts` has no imports.
 * The call sites are read as source, like pan113 and pan122, because the
 * frontend's React tree is not installed at the root.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { classifyOtpError } from '../../frontend/lib/otp-error'
import { translations } from '../../frontend/lib/i18n'

const FRONTEND = join(__dirname, '..', '..', 'frontend')

const CARD = readFileSync(join(FRONTEND, 'components', 'SearchResultCard.tsx'), 'utf8')
const SEARCH = readFileSync(join(FRONTEND, 'app', '(shell)', 'search', 'page.tsx'), 'utf8')

/** Strip comments, so prose explaining the old shape cannot satisfy a check. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const CARD_CODE = code(CARD)
const SEARCH_CODE = code(SEARCH)
const HELPER_CODE = code(readFileSync(join(FRONTEND, 'lib', 'email-code.ts'), 'utf8'))
const COMPONENT_CODE = code(readFileSync(join(FRONTEND, 'components', 'EmailCodeSignIn.tsx'), 'utf8'))

test('otp: a rate limit is told apart from a rejected address', () => {
  // These are the two that change what the reader should DO, so they are the
  // two the copy distinguishes.
  assert.equal(classifyOtpError({ status: 429 }), 'otpErrorRateLimited')
  assert.equal(
    classifyOtpError({ status: 429, code: 'over_email_send_rate_limit' }),
    'otpErrorRateLimited',
  )
  // A proxy may rewrite the status, so the code alone is enough.
  assert.equal(classifyOtpError({ code: 'over_request_rate_limit' }), 'otpErrorRateLimited')

  assert.equal(
    classifyOtpError({ status: 400, code: 'email_address_invalid' }),
    'otpErrorInvalidAddress',
  )
  assert.equal(classifyOtpError({ status: 400, code: 'validation_failed' }), 'otpErrorInvalidAddress')
})

test('otp: anything else is generic, and no error is not an error', () => {
  assert.equal(classifyOtpError({ status: 500 }), 'otpErrorGeneric')
  assert.equal(classifyOtpError({}), 'otpErrorGeneric')
  // The success path must produce no message at all.
  assert.equal(classifyOtpError(null), null)
  assert.equal(classifyOtpError(undefined), null)
})

test('otp: the one send site reads the returned error, and nothing claims a send that failed', () => {
  // PAN-300: both public call sites (and the product page's) now send through
  // `sendEmailCode` in lib/email-code.ts — the only `signInWithOtp` call left,
  // which pan300-email-code asserts. The exact regression this suite exists
  // for — `await signInWithOtp(...)` with the result thrown away — is checked
  // there, at the one place it could come back.
  assert.match(
    HELPER_CODE,
    /const \{ error \} = await auth\.signInWithOtp\(/,
    'the helper must read the returned error, not discard it',
  )
  assert.doesNotMatch(HELPER_CODE, /^\s*await auth\.signInWithOtp\(/m, 'the helper discards the result again')
  assert.match(HELPER_CODE, /return classifyOtpError\(error\)/, 'the helper must classify the failure')

  // The component moves to "enter the code" only on a successful send.
  assert.match(
    COMPONENT_CODE,
    /if \(failure\) return false/,
    'the code step must not open when the send failed',
  )
  for (const [name, src] of [['SearchResultCard', CARD_CODE], ['search/page', SEARCH_CODE]] as const) {
    assert.doesNotMatch(src, /signInWithOtp\(/, `${name} must send through the shared component`)
  }
})

test('otp: the demand signal survives a failed send', () => {
  // The whole point of that panel. PAN-300: the signal is emitted when the
  // address is submitted, which the component does BEFORE it sends, so a send
  // failure cannot cost Klup the signal.
  assert.match(
    SEARCH_CODE,
    /function handleEmailSubmit\(address: string\) \{[\s\S]{0,80}emit\('demand_signal_submitted', demandSignalPayload\(outcome, address\)\)/,
    'the demand signal must be recorded on submit',
  )
  assert.match(SEARCH_CODE, /onEmailSubmit=\{handleEmailSubmit\}/)
  assert.ok(
    COMPONENT_CODE.indexOf('onEmailSubmit?.(address)') < COMPONENT_CODE.indexOf('const ok = await send(address)'),
    'onEmailSubmit must run before the send attempt',
  )

  // And the panel still thanks the visitor, because the signal WAS recorded.
  assert.match(SEARCH_CODE, /\{t\.demandThanks\}/, 'the thanks is still true and must remain')
})

test('otp: the address is never logged and never leaves for analytics', () => {
  // Root CLAUDE.md §3, and the comment this change preserved at the call
  // site: the address goes to Supabase and NEVER to PostHog.
  for (const [name, src] of [['SearchResultCard', CARD_CODE], ['search/page', SEARCH_CODE]] as const) {
    assert.doesNotMatch(src, /console\.(log|error|warn|info)\(/, `${name} must not log`)
  }

  // The address IS handed to demandSignalPayload, which is the whole reason
  // that builder exists: it reduces it to a boolean and keeps the string out
  // of the payload. Asserting "no emit sees `address`" would be a false
  // positive on the very call that must stay, so assert the builder instead.
  const CONTRACT = code(readFileSync(join(FRONTEND, 'lib', 'search-contract.ts'), 'utf8'))
  const builder = CONTRACT.slice(CONTRACT.indexOf('export function demandSignalPayload'))
  const body = builder.slice(0, builder.indexOf('\n}'))
  assert.match(body, /has_email: hasEmail/, 'the payload must carry a boolean')
  assert.doesNotMatch(
    body,
    /(email_address|emailAddress|address)\s*,/,
    'the payload must never carry the address itself',
  )

  assert.doesNotMatch(
    CARD_CODE,
    /posthog\?\.capture\([^)]*\bemail\b/,
    'the address must never reach PostHog',
  )
})

test('otp: every message exists in both locales, translated and actionable', () => {
  const keys = [
    'otpErrorRateLimited',
    'otpErrorInvalidAddress',
    'otpErrorGeneric',
  ] as const

  for (const key of keys) {
    for (const locale of ['da', 'en'] as const) {
      const value = translations[locale][key]
      assert.equal(typeof value, 'string', `${locale}.${key} must exist`)
      assert.ok(value.length > 0, `${locale}.${key} must not be empty`)
    }
    assert.notEqual(
      translations.da[key],
      translations.en[key],
      `${key} must actually be translated, not copied between locales`,
    )
  }

  // The specific reason this ticket existed: the public copy was the generic
  // "Noget gik galt" while the admin copy was good. A message that says only
  // that something went wrong tells the reader nothing they can act on.
  for (const key of ['otpErrorRateLimited', 'otpErrorInvalidAddress'] as const) {
    assert.doesNotMatch(
      translations.da[key],
      /^Noget gik galt/,
      `${key} must say what happened, not "noget gik galt"`,
    )
  }

  // The shared component renders from i18n, never a literal.
  assert.match(COMPONENT_CODE, /\{t\[error\]\}/, 'the sign-in must render the message from i18n')
})

test('otp: the failure is announced, not merely drawn', () => {
  // A message that appears without a live region is silent to a screen
  // reader, and this one arrives after an action the visitor took. PAN-300:
  // one persistent assertive region in the shared component (Astryx's
  // FieldStatus rule: a region mounted with its content may not announce).
  assert.match(COMPONENT_CODE, /aria-live="assertive"/, 'the sign-in error needs an assertive live region')

  // Destructive tokens, not raw red utilities (frontend/CLAUDE.md).
  assert.match(
    COMPONENT_CODE,
    /bg-destructive-subtle[\s\S]{0,120}var\(--destructive-text\)/,
    'the sign-in error must use the destructive tokens',
  )
  // The demand panel's own signed-in failure still uses role="alert".
  assert.match(
    SEARCH_CODE,
    /role="alert"[\s\S]{0,120}var\(--destructive-text\)/,
    'the panel error must use the destructive tokens',
  )
})
