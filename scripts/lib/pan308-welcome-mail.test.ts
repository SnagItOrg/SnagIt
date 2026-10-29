/**
 * PAN-308 — welcome mail #1.
 *
 * The mail is built by a pure function and sent once, by a session-gated
 * route, for an account under an hour old. These tests pin: the window, the
 * one call to action and how it follows the account, the price check as a
 * P.S. rather than a second button, the copy in both languages, and the
 * trigger firing only for a new account after its sign-in handler.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { WELCOME_WINDOW_MS, buildWelcomeEmail, welcomeDue } from '../../frontend/lib/email'
import { translations } from '../../frontend/lib/i18n'

const FRONTEND = join(__dirname, '..', '..', 'frontend')
const read = (...p: string[]) => readFileSync(join(FRONTEND, ...p), 'utf8')
/** Strip comments, so prose cannot satisfy a check. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const NOW = Date.parse('2026-10-29T12:00:00Z')

test('welcomeDue: only inside the first hour of an account', () => {
  assert.equal(WELCOME_WINDOW_MS, 3_600_000)
  assert.equal(welcomeDue('2026-10-29T12:00:00Z', NOW), true)
  assert.equal(welcomeDue('2026-10-29T11:01:00Z', NOW), true)
  assert.equal(welcomeDue('2026-10-29T10:59:59Z', NOW), false)
  assert.equal(welcomeDue('2026-10-28T12:00:00Z', NOW), false)
  // A clock that says the account is from the future sends nothing.
  assert.equal(welcomeDue('2026-10-29T12:05:00Z', NOW), false)
  assert.equal(welcomeDue(undefined, NOW), false)
  assert.equal(welcomeDue('not a date', NOW), false)
})

test('one call to action: the catalogue, or the watch the account already has', () => {
  const t = translations.da
  const fresh = buildWelcomeEmail({ hasWatchlist: false })
  const watching = buildWelcomeEmail({ hasWatchlist: true })

  assert.match(fresh.html, new RegExp(`href="[^"]*/browse"[^>]*>${t.mailWelcomeCtaFollow}<`))
  assert.ok(!fresh.html.includes(t.mailWelcomeCtaWatchlists))
  assert.match(watching.html, new RegExp(`href="[^"]*/watchlists"[^>]*>${t.mailWelcomeCtaWatchlists}<`))
  assert.ok(!watching.html.includes(t.mailWelcomeCtaFollow))

  // Exactly one filled button.
  for (const m of [fresh, watching]) {
    assert.equal((m.html.match(/background:#131417;color:#ffffff;font-weight:600;text-decoration:none/g) ?? []).length, 1)
  }
})

test('the price check rides along as a P.S. link, and the text part says everything the HTML does', () => {
  const t = translations.da
  const m = buildWelcomeEmail({ hasWatchlist: false })
  assert.equal(m.subject, t.mailWelcomeSubject)
  assert.match(m.html, /href="[^"]*\/tjek-prisen"/)
  for (const s of [t.mailWelcomeIntro, t.mailWelcomeStep1Title, t.mailWelcomeStep2Title, t.mailWelcomeStep3Title, t.mailWelcomePsst, t.mailWelcomeWhy]) {
    assert.ok(m.text.includes(s), `text part misses: ${s}`)
  }
  assert.match(m.text, /\/tjek-prisen/)
  assert.match(m.text, /\/browse/)
})

test('the tutorial images are served from public/mail and carry alt text', () => {
  const m = buildWelcomeEmail({ hasWatchlist: false })
  const imgs = [...m.html.matchAll(/<img src="[^"]*\/mail\/([^"]+)"[^>]*alt="([^"]*)"/g)]
  assert.deepEqual(imgs.map((i) => i[1]), ['radar.png', 'welcome-step-1.jpg', 'welcome-step-2.jpg', 'welcome-step-3.jpg'])
  for (const [, file, alt] of imgs) {
    assert.ok(existsSync(join(FRONTEND, 'public', 'mail', file)), `missing public/mail/${file}`)
    // The logo is decorative ("Klup.dk" is written beside it); every step image is described.
    if (file !== 'radar.png') assert.ok(alt.length > 0, `${file} has no alt`)
  }
})

test('no green in the mail itself: Klup green belongs to its judgements, not to a welcome', () => {
  const m = buildWelcomeEmail({ hasWatchlist: true })
  for (const green of ['#13ec6d', '#16d96b', '#0a7c41', '#0bd25e']) assert.ok(!m.html.includes(green), green)
})

test('every welcome key exists in both languages', () => {
  const da = Object.keys(translations.da).filter((k) => k.startsWith('mailWelcome')).sort()
  const en = Object.keys(translations.en).filter((k) => k.startsWith('mailWelcome')).sort()
  assert.ok(da.length >= 18)
  assert.deepEqual(da, en)
})

test('the route: session-gated, due-window checked, one idempotency key per account, no PII logged', () => {
  const route = code(read('app', 'api', 'welcome', 'route.ts'))
  assert.match(route, /export async function POST\(\)/, 'the request carries nothing; the session decides')
  assert.match(route, /if \(!user\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  assert.match(route, /welcomeDue\(user\.created_at, Date\.now\(\)\)/)
  assert.ok(!/console\.\w+\([^)]*user\.email/.test(route), 'the address must never be logged')
  const email = code(read('lib', 'email.ts'))
  assert.match(email, /idempotencyKey: `welcome-1\/\$\{userId\}`/)
  const access = read('lib', 'route-access.ts')
  assert.match(access, /route: '\/api\/welcome', access: 'protected_api'/)
})

test('the trigger: only for a new account, after its sign-in handler has run', () => {
  const signIn = code(read('components', 'EmailCodeSignIn.tsx'))
  const handler = signIn.indexOf('await onSignedIn({ isNewUser: result.isNewUser })')
  const trigger = signIn.indexOf('if (result.isNewUser) requestWelcomeMail()')
  assert.ok(handler > 0 && trigger > handler, 'the welcome request follows onSignedIn')
  assert.equal((signIn.match(/requestWelcomeMail\(\)/g) ?? []).length, 1)

  const watchlists = code(read('app', '(shell)', 'watchlists', 'page.tsx'))
  assert.match(watchlists, /isNewAccountConfirmation\(data\.user\)\) \{[\s\S]*?pending\.finally\(requestWelcomeMail\)/)
})
