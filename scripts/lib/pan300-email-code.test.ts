/**
 * PAN-300 — every way into an account is e-mail, then a 6-digit code.
 *
 * The helper (`frontend/lib/email-code.ts`) is imported for real: it takes
 * the Supabase auth client structurally, so a fake stands in and every
 * decision runs here. The component and the call sites are read as source,
 * like signup-otp-failure and pan113, because the frontend's React tree is
 * not installed at the root.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import {
  CODE_LENGTH,
  RESEND_COOLDOWN_S,
  fillCode,
  isCompleteCode,
  resendSecondsLeft,
  sendEmailCode,
  verifyEmailCode,
  type EmailCodeAuth,
} from '../../frontend/lib/email-code'
import { classifyVerifyError } from '../../frontend/lib/otp-error'
import { translations } from '../../frontend/lib/i18n'

const FRONTEND = join(__dirname, '..', '..', 'frontend')
const read = (...p: string[]) => readFileSync(join(FRONTEND, ...p), 'utf8')
/** Strip comments, so prose explaining the old shape cannot satisfy a check. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* ── The helper ──────────────────────────────────────────────────────────── */

type Calls = { otp: unknown[]; verify: unknown[] }

function fakeAuth(opts: {
  sendError?: { status?: number; code?: string } | null
  sendThrows?: boolean
  verifyError?: { status?: number; code?: string } | null
  verifyThrows?: boolean
  user?: { email_confirmed_at?: string | null; last_sign_in_at?: string | null } | null
}): { auth: EmailCodeAuth; calls: Calls } {
  const calls: Calls = { otp: [], verify: [] }
  const auth: EmailCodeAuth = {
    async signInWithOtp(args) {
      calls.otp.push(args)
      if (opts.sendThrows) throw new Error('storage blocked')
      return { error: opts.sendError ?? null }
    },
    async verifyOtp(args) {
      calls.verify.push(args)
      if (opts.verifyThrows) throw new Error('network')
      return {
        data: { user: opts.user === undefined ? { email_confirmed_at: null, last_sign_in_at: null } : opts.user },
        error: opts.verifyError ?? null,
      }
    },
  }
  return { auth, calls }
}

test('send: one call, creating the user, with the fallback link', async () => {
  const { auth, calls } = fakeAuth({})
  assert.equal(await sendEmailCode(auth, 'a@b.dk', 'https://klup.dk/auth/confirm'), null)
  assert.deepEqual(calls.otp, [{
    email: 'a@b.dk',
    options: { shouldCreateUser: true, emailRedirectTo: 'https://klup.dk/auth/confirm' },
  }])
})

test('send: a returned failure is classified, and a throw is never a success', async () => {
  assert.equal(await sendEmailCode(fakeAuth({ sendError: { status: 429 } }).auth, 'a@b.dk'), 'otpErrorRateLimited')
  assert.equal(
    await sendEmailCode(fakeAuth({ sendError: { status: 400, code: 'email_address_invalid' } }).auth, 'x'),
    'otpErrorInvalidAddress',
  )
  assert.equal(await sendEmailCode(fakeAuth({ sendThrows: true }).auth, 'a@b.dk'), 'otpErrorGeneric')
})

test('verify: the code goes to Supabase as an email OTP', async () => {
  const { auth, calls } = fakeAuth({})
  await verifyEmailCode(auth, 'a@b.dk', '123456')
  assert.deepEqual(calls.verify, [{ email: 'a@b.dk', token: '123456', type: 'email' }])
})

test('verify: an incomplete code is refused without a request', async () => {
  for (const c of ['', '12345', '1234567', '12a456']) {
    const { auth, calls } = fakeAuth({})
    assert.deepEqual(await verifyEmailCode(auth, 'a@b.dk', c), { error: 'otpErrorCodeWrong' })
    assert.equal(calls.verify.length, 0, `"${c}" must not be sent`)
  }
})

test('verify: new and returning accounts are told apart by the confirmation stamp', async () => {
  const now = '2026-10-26T12:00:00Z'
  const fresh = fakeAuth({ user: { email_confirmed_at: '2026-10-26T11:59:58Z', last_sign_in_at: now } })
  assert.deepEqual(await verifyEmailCode(fresh.auth, 'a@b.dk', '123456'), { error: null, isNewUser: true })

  const old = fakeAuth({ user: { email_confirmed_at: '2026-03-01T09:00:00Z', last_sign_in_at: now } })
  assert.deepEqual(await verifyEmailCode(old.auth, 'a@b.dk', '123456'), { error: null, isNewUser: false })
})

test('verify: wrong, expired, too many, no user and a throw each have an answer', async () => {
  const wrong = fakeAuth({ verifyError: { status: 403, code: 'otp_expired' } })
  assert.deepEqual(await verifyEmailCode(wrong.auth, 'a@b.dk', '000000'), { error: 'otpErrorCodeWrong' })
  const many = fakeAuth({ verifyError: { status: 429, code: 'over_request_rate_limit' } })
  assert.deepEqual(await verifyEmailCode(many.auth, 'a@b.dk', '000000'), { error: 'otpErrorTooManyTries' })
  assert.deepEqual(await verifyEmailCode(fakeAuth({ user: null }).auth, 'a@b.dk', '123456'), { error: 'otpErrorGeneric' })
  assert.deepEqual(await verifyEmailCode(fakeAuth({ verifyThrows: true }).auth, 'a@b.dk', '123456'), { error: 'otpErrorGeneric' })
})

test('classifyVerifyError: no error is no message, and 5xx is generic', () => {
  assert.equal(classifyVerifyError(null), null)
  assert.equal(classifyVerifyError(undefined), null)
  assert.equal(classifyVerifyError({ code: 'otp_expired' }), 'otpErrorCodeWrong')
  assert.equal(classifyVerifyError({ status: 400 }), 'otpErrorCodeWrong')
  assert.equal(classifyVerifyError({ status: 500 }), 'otpErrorGeneric')
})

/* ── The code boxes ──────────────────────────────────────────────────────── */

const empty = () => Array.from({ length: CODE_LENGTH }, () => '')

test('boxes: six of them, and a typed digit moves focus on', () => {
  assert.equal(CODE_LENGTH, 6)
  assert.deepEqual(fillCode(empty(), 0, '4'), { digits: ['4', '', '', '', '', ''], focus: 1 })
  assert.deepEqual(fillCode(['4', '', '', '', '', ''], 1, '2'), { digits: ['4', '2', '', '', '', ''], focus: 2 })
})

test('boxes: a full paste fills every box wherever it lands', () => {
  for (const at of [0, 3, 5]) {
    const r = fillCode(empty(), at, '123456')
    assert.deepEqual(r.digits, ['1', '2', '3', '4', '5', '6'], `paste into box ${at}`)
    assert.equal(isCompleteCode(r.digits.join('')), true)
  }
  // Mail clients and people format it; iOS autofill drops it in whole.
  assert.deepEqual(fillCode(empty(), 0, ' 123 456 ').digits, ['1', '2', '3', '4', '5', '6'])
  assert.deepEqual(fillCode(empty(), 0, '123-456').digits, ['1', '2', '3', '4', '5', '6'])
  assert.deepEqual(fillCode(empty(), 2, '12345678').digits, ['1', '2', '3', '4', '5', '6'])
})

test('boxes: a partial paste fills forward and stops at the last box', () => {
  assert.deepEqual(fillCode(empty(), 2, '789'), { digits: ['', '', '7', '8', '9', ''], focus: 5 })
  assert.deepEqual(fillCode(empty(), 4, '78'), { digits: ['', '', '', '', '7', '8'], focus: 5 })
})

test('boxes: letters are dropped, and clearing a box keeps focus on it', () => {
  assert.deepEqual(fillCode(empty(), 0, 'a'), { digits: empty(), focus: 0 })
  assert.deepEqual(fillCode(['1', '2', '3', '', '', ''], 2, ''), { digits: ['1', '2', '', '', '', ''], focus: 2 })
})

test('resend: the cooldown counts down from 60 s and never goes below 0', () => {
  assert.equal(RESEND_COOLDOWN_S, 60)
  const t0 = 1_000_000
  assert.equal(resendSecondsLeft(t0, t0), 60)
  assert.equal(resendSecondsLeft(t0, t0 + 999), 60)
  assert.equal(resendSecondsLeft(t0, t0 + 1000), 59)
  assert.equal(resendSecondsLeft(t0, t0 + 60_000), 0)
  assert.equal(resendSecondsLeft(t0, t0 + 600_000), 0)
  // A clock that steps back cannot lengthen the wait.
  assert.equal(resendSecondsLeft(t0, t0 - 5000), 60)
})

/* ── The component's flow ────────────────────────────────────────────────── */

const COMPONENT = code(read('components', 'EmailCodeSignIn.tsx'))

test('flow: two steps, and the code step is reached only by a successful send', () => {
  assert.match(COMPONENT, /type Step = 'email' \| 'code'/)
  assert.match(COMPONENT, /const ok = await send\(address\)[\s\S]{0,120}if \(ok\) \{[\s\S]{0,60}setStep\('code'\)/)
  // The intent is parked before the send, so a failed send cannot lose it.
  assert.ok(
    COMPONENT.indexOf('onEmailSubmit?.(address)') < COMPONENT.indexOf('const ok = await send(address)'),
    'onEmailSubmit must run before the first send',
  )
  // "Send ny kode" does not re-run it.
  const resend = COMPONENT.slice(COMPONENT.indexOf('async function handleResend'), COMPONENT.indexOf('function handleWrongEmail'))
  assert.doesNotMatch(resend, /onEmailSubmit/)
})

test('flow: the code boxes carry the platform contract', () => {
  assert.match(COMPONENT, /inputMode="numeric"/)
  assert.match(COMPONENT, /autoComplete=\{i === 0 \? 'one-time-code' : 'off'\}/)
  assert.match(COMPONENT, /onPaste=\{\(e\) => handlePaste\(i, e\)\}/)
  assert.match(COMPONENT, /role="group"[\s\S]{0,80}aria-labelledby=\{codeLabelId\}/)
  assert.match(COMPONENT, /aria-label=\{fill\(t\.emailCodeDigit/)
  // The sixth digit submits.
  assert.match(COMPONENT, /if \(isCompleteCode\(code\)\) void verify\(code\)/)
})

test('flow: resend waits out the cooldown, and "Forkert e-mail?" goes back', () => {
  assert.match(COMPONENT, /disabled=\{busy \|\| secondsLeft > 0\}/)
  assert.match(COMPONENT, /if \(busy \|\| secondsLeft > 0\) return/)
  assert.match(COMPONENT, /\{t\.emailCodeWrongEmail\}/)
  const back = COMPONENT.slice(COMPONENT.indexOf('function handleWrongEmail'), COMPONENT.indexOf('async function verify'))
  assert.match(back, /setStep\('email'\)/)
  assert.doesNotMatch(back, /setEmail\(/, 'going back keeps the address')
})

test('flow: a rejected code clears the boxes and refocuses the first', () => {
  const verify = COMPONENT.slice(COMPONENT.indexOf('async function verify'), COMPONENT.indexOf('function handleBoxInput'))
  assert.match(verify, /if \(result\.error\) \{[\s\S]*?setError\(result\.error\)[\s\S]*?setDigits\(EMPTY\)[\s\S]*?boxRefs\.current\[0\]\?\.focus\(\)/)
  // Guarded, so strict mode or a fast keystroke cannot verify one code twice.
  assert.match(verify, /if \(verifying\.current/)
  // A new account is reported once, as a code signup, never with the address.
  assert.match(verify, /if \(result\.isNewUser\) track\('signup_completed', \{ method: 'email_code' \}\)/)
})

test('a11y: errors and status are persistent live regions, in the destructive tokens', () => {
  assert.match(COMPONENT, /aria-live="assertive"[\s\S]{0,300}\{t\[error\]\}/)
  assert.match(COMPONENT, /aria-live="polite"[\s\S]{0,200}\{status\}/)
  // Persistent: the region elements are not themselves conditional.
  assert.match(COMPONENT, /<div id=\{errorId\} aria-live="assertive" aria-atomic="true">\s*\{error &&/)
  assert.match(COMPONENT, /bg-destructive-subtle[\s\S]{0,120}var\(--destructive-text\)/)
  assert.match(COMPONENT, /<label htmlFor=\{`\$\{id\}-email`\}/)
  assert.doesNotMatch(COMPONENT, /console\.(log|error|warn|info)\(/)
})

/* ── Every way in uses it, and no password path is left ──────────────────── */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (f === 'node_modules' || f.startsWith('.')) return []
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })
}
const SOURCES = ['app', 'components', 'lib', 'middleware.ts'].flatMap((d) => {
  const p = join(FRONTEND, d)
  return statSync(p).isDirectory() ? walk(p) : [p]
}).map((p) => ({ file: relative(FRONTEND, p), src: code(readFileSync(p, 'utf8')) }))

test('paths: signInWithOtp has one call site, the helper', () => {
  const sites = SOURCES.filter((s) => /\.signInWithOtp\(/.test(s.src)).map((s) => s.file)
  assert.deepEqual(sites, ['lib/email-code.ts'])
  // verifyOtp: the helper, and /auth/confirm for links already in inboxes.
  const verifies = SOURCES.filter((s) => /\.verifyOtp\(/.test(s.src)).map((s) => s.file).sort()
  assert.deepEqual(verifies, ['app/auth/confirm/route.ts', 'lib/email-code.ts'])
})

test('paths: no password sign-in, signup, reset or field remains', () => {
  for (const { file, src } of SOURCES) {
    assert.doesNotMatch(src, /signInWithPassword\(/, `${file} signs in with a password`)
    assert.doesNotMatch(src, /\.auth\.signUp\(/, `${file} signs up with a password`)
    assert.doesNotMatch(src, /resetPasswordForEmail\(/, `${file} sends a password reset`)
    assert.doesNotMatch(src, /type="password"/, `${file} renders a password field`)
  }
})

test('paths: every surface that signs a visitor in renders the shared component', () => {
  for (const f of [
    ['app', 'login', 'page.tsx'],
    ['components', 'SearchResultCard.tsx'],
    ['components', 'WatchProductForm.tsx'],
    ['app', '(shell)', 'search', 'page.tsx'],
  ]) {
    assert.match(code(read(...f)), /<EmailCodeSignIn\b/, `${f.join('/')} must use EmailCodeSignIn`)
  }
})

test('paths: /signup is one door with /login, and /auth/confirm still serves old links', () => {
  const signup = code(read('app', 'signup', 'page.tsx'))
  assert.match(signup, /redirect\(next \? `\/login\?next=\$\{encodeURIComponent\(next\)\}` : '\/login'\)/)
  assert.match(signup, /safeNextPath\(/)

  const confirm = code(read('app', 'auth', 'confirm', 'route.ts'))
  assert.match(confirm, /exchangeCodeForSession\(code\)/, 'PKCE links still work')
  assert.match(confirm, /verifyOtp\(\{ type, token_hash \}\)/, 'token_hash links still work')

  for (const f of [['components', 'BottomNav.tsx'], ['app', 'login', 'page.tsx']]) {
    assert.doesNotMatch(code(read(...f)), /['"`]\/signup/, `${f.join('/')} must not send anyone to /signup`)
  }
})

test('paths: an inline sign-in finishes the action and drops the parked intent', () => {
  for (const f of [['components', 'SearchResultCard.tsx'], ['components', 'WatchProductForm.tsx']]) {
    const src = code(read(...f))
    assert.match(src, /localStorage\.setItem\('pending_watchlist'/, `${f.join('/')} parks the intent for the link`)
    assert.match(src, /localStorage\.removeItem\('pending_watchlist'\)/, `${f.join('/')} drops it once signed in here`)
  }
  // The nav follows an in-page sign-in without a reload.
  for (const f of [['components', 'SideNav.tsx'], ['components', 'BottomNav.tsx']]) {
    assert.match(code(read(...f)), /onAuthStateChange\(/, `${f.join('/')} must follow the session`)
  }
})

test('copy: every new message exists in both locales and is translated', () => {
  const keys = [
    'otpErrorCodeWrong', 'otpErrorTooManyTries',
    'emailCodeContinue', 'emailCodeSending', 'emailCodeHint', 'emailCodeSentTo',
    'emailCodeLabel', 'emailCodeDigit', 'emailCodeResend', 'emailCodeResendIn',
    'emailCodeResent', 'emailCodeWrongEmail', 'emailCodeSpamHint',
    'emailCodeVerifying', 'emailCodeSignedIn',
    'authHeading', 'authSubheading', 'authLinkExpired', 'welcomeNewAccount',
  ] as const
  for (const key of keys) {
    for (const locale of ['da', 'en'] as const) {
      const value = translations[locale][key]
      assert.equal(typeof value, 'string', `${locale}.${key} must exist`)
      assert.ok(value.length > 0, `${locale}.${key} must not be empty`)
    }
    assert.notEqual(translations.da[key], translations.en[key], `${key} must be translated`)
  }
  assert.equal(translations.da.emailCodeContinue, 'Fortsæt med e-mail')
  assert.equal(translations.da.emailCodeResend, 'Send ny kode')
  assert.equal(translations.da.emailCodeWrongEmail, 'Forkert e-mail?')
  // The send errors talk about a code now, not a link.
  for (const key of ['otpErrorRateLimited', 'otpErrorGeneric'] as const) {
    assert.doesNotMatch(translations.da[key], /link/i, `da.${key} still says link`)
  }
})
