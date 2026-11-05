/**
 * PAN-308 — "Stop dem her" for welcome mails 2 and 3.
 *
 * The flag lives in `app_metadata` (owner, 2026-10-29): no table, no
 * migration. These tests pin: the token is the credential and is compared
 * whole, the links' shape, the route changes nothing on GET and keeps the
 * account's other app_metadata keys, the one-click answer is a 200 and never
 * a redirect, the page only asks, and both routes are classified public.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  newWelcomeStopToken, welcomeStopMatches, welcomeStopParams, welcomeStopped, welcomeStopToken, welcomeStopUrls,
} from '../../frontend/lib/welcome-stop'
import { classifyPath, requiresAuth } from '../../frontend/lib/route-access'
import { translations } from '../../frontend/lib/i18n'

const FRONTEND = join(__dirname, '..', '..', 'frontend')
const read = (...p: string[]) => readFileSync(join(FRONTEND, ...p), 'utf8')
/** Strip comments, so prose cannot satisfy a check. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const UID = '3f2c8a10-5b7e-4c1d-9a2b-0c1d2e3f4a5b'
const TOKEN = 'Ab3dEf6hIj9K'

test('the token is the credential, compared whole', () => {
  const meta = { provider: 'email', welcome_stop_token: TOKEN }
  assert.equal(welcomeStopMatches(meta, TOKEN), true)
  assert.equal(welcomeStopMatches(meta, 'Ab3dEf6hIj9L'), false)
  assert.equal(welcomeStopMatches(meta, TOKEN.slice(0, 11)), false)
  assert.equal(welcomeStopMatches(meta, null), false)
  // No stored token, or a malformed one, opens nothing — not even an empty guess.
  assert.equal(welcomeStopMatches({}, TOKEN), false)
  assert.equal(welcomeStopMatches(null, TOKEN), false)
  assert.equal(welcomeStopMatches({ welcome_stop_token: '' }, ''), false)
  assert.equal(welcomeStopToken({ welcome_stop_token: 'short' }), null)

  const fresh = newWelcomeStopToken()
  assert.match(fresh, /^[0-9A-Za-z]{12}$/)
  assert.notEqual(fresh, newWelcomeStopToken())
})

test('stopped means a stop time is on the account', () => {
  assert.equal(welcomeStopped({ welcome_stopped_at: '2026-11-01T06:00:00Z' }), true)
  assert.equal(welcomeStopped({ welcome_stop_token: TOKEN }), false)
  assert.equal(welcomeStopped(undefined), false)
})

test('the link parameters: a user id and a token, nothing else', () => {
  assert.deepEqual(welcomeStopParams(UID.toUpperCase(), TOKEN), { userId: UID, token: TOKEN })
  assert.equal(welcomeStopParams('not-a-uuid', TOKEN), null)
  assert.equal(welcomeStopParams(UID, 'x'), null)
  assert.equal(welcomeStopParams(undefined, undefined), null)

  const { page, oneClick } = welcomeStopUrls('https://www.klup.dk', UID, TOKEN)
  assert.equal(page, `https://www.klup.dk/stop-velkomst?u=${UID}&t=${TOKEN}`)
  assert.equal(oneClick, `https://www.klup.dk/api/welcome/stop?u=${UID}&t=${TOKEN}`)
})

test('the route: POST only, token-checked, keeps the other app_metadata keys, one-click gets a 200', () => {
  const route = code(read('app', 'api', 'welcome', 'stop', 'route.ts'))
  assert.match(route, /export async function POST\(req: Request\)/)
  assert.ok(!/export (async )?function (GET|HEAD|PUT|DELETE|PATCH)/.test(route), 'only a POST may stop the series')
  assert.match(route, /welcomeStopMatches\(meta, params\.token\)/)
  assert.match(route, /app_metadata: \{ \.\.\.meta, welcome_stopped_at: new Date\(\)\.toISOString\(\) \}/)
  // RFC 8058: the one-click POST is answered, never redirected.
  assert.match(route, /get\('List-Unsubscribe'\) === 'One-Click'/)
  assert.match(route, /oneClick\s*\?\s*NextResponse\.json/)
  assert.ok(!/console\./.test(route), 'nothing is logged')
})

test('the page only asks: no write, a POST form, noindex and no referrer', () => {
  const page = code(read('app', '(shell)', 'stop-velkomst', 'page.tsx'))
  assert.ok(!/updateUserById|\.update\(|\.insert\(|\.upsert\(/.test(page), 'a visit must change nothing')
  assert.match(page, /<form method="post" action=\{`\/api\/welcome\/stop\?u=/)
  assert.match(page, /robots: \{ index: false, follow: false \}/)
  assert.match(page, /referrer: 'no-referrer'/)
})

test('both routes are public: the mail is opened on a phone that is not signed in', () => {
  assert.equal(classifyPath('/stop-velkomst')?.access, 'public_page')
  assert.equal(classifyPath('/api/welcome/stop')?.access, 'public_api')
  assert.equal(requiresAuth('/api/welcome/stop'), false)
  // Mail #1's route stays session-gated.
  assert.equal(requiresAuth('/api/welcome'), true)
})

test('the page copy exists in both languages', () => {
  const keys = (l: 'da' | 'en') => Object.keys(translations[l]).filter((k) => k.startsWith('welcomeStop')).sort()
  assert.equal(keys('da').length, 9)
  assert.deepEqual(keys('da'), keys('en'))
})
