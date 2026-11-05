/**
 * PAN-308 — welcome mails #2 (day 2, "Tjek prisen før du byder") and #3
 * (day 7, "Din første uge").
 *
 * Both are built by pure functions; the runner that sends them is a later PR.
 * These tests pin: one call to action each, the "Stop dem her" opt-out in both
 * parts of both mails, mail #3's numbers and its honest quiet week, the
 * verdict rule (no price word without a band), the images, and the copy in
 * both languages.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { buildFirstWeekEmail, buildPriceTipEmail } from '../../frontend/lib/email'
import { translations } from '../../frontend/lib/i18n'

const FRONTEND = join(__dirname, '..', '..', 'frontend')
const STOP = 'https://www.klup.dk/stop-velkomst?u=00000000-0000-0000-0000-000000000000&t=abc'
const BUTTON = /background:#131417;color:#ffffff;font-weight:600;text-decoration:none/g
const t = translations.da

const week = (over: Partial<Parameters<typeof buildFirstWeekEmail>[0]> = {}) =>
  buildFirstWeekEmail({ watchCount: 2, newListings: 14, underCount: 3, stopUrl: STOP, ...over })

test('mail #2: one call to action, to the price check', () => {
  const m = buildPriceTipEmail({ stopUrl: STOP })
  assert.equal(m.subject, t.mailPriceTipSubject)
  assert.equal((m.html.match(BUTTON) ?? []).length, 1)
  assert.match(m.html, new RegExp(`href="[^"]*/tjek-prisen"[^>]*>${t.mailPriceTipCta}<`))
  assert.match(m.text, new RegExp(`${t.mailPriceTipCta}: \\S*/tjek-prisen`))
  for (const s of [t.mailPriceTipIntro, t.mailPriceTipStep1Title, t.mailPriceTipStep2Title, t.mailPriceTipStep2Body, t.mailPriceTipWhy]) {
    assert.ok(m.text.includes(s), `text part misses: ${s}`)
  }
})

test('mail #2: two step images, served from public/mail, each described', () => {
  const m = buildPriceTipEmail({ stopUrl: STOP })
  const imgs = [...m.html.matchAll(/<img src="[^"]*\/mail\/([^"]+)"[^>]*alt="([^"]*)"/g)]
  assert.deepEqual(imgs.map((i) => i[1]), ['radar.png', 'price-tip-step-1.jpg', 'price-tip-step-2.jpg'])
  for (const [, file, alt] of imgs) {
    assert.ok(existsSync(join(FRONTEND, 'public', 'mail', file)), `missing public/mail/${file}`)
    if (file !== 'radar.png') assert.ok(alt.length > 0, `${file} has no alt`)
  }
})

test('both mails carry "Stop dem her", in the HTML and in the text part', () => {
  for (const m of [buildPriceTipEmail({ stopUrl: STOP }), week()]) {
    const href = STOP.replace(/&/g, '&amp;')
    assert.ok(m.html.includes(`href="${href}"`), 'stop link in HTML')
    assert.ok(m.html.includes(`>${t.mailWelcomeStopLink}</a>`))
    assert.ok(m.text.includes(`${t.mailWelcomeStopLink}: ${STOP}`), 'stop link in text')
    // The stop link is a quiet footer link, never a second button.
    assert.equal((m.html.match(BUTTON) ?? []).length, 1)
  }
})

test('mail #3: the week in numbers, and one call to action to the watchlists', () => {
  const m = week()
  assert.equal(m.subject, t.mailFirstWeekSubject)
  const line = 'Vi så 14 nye annoncer på dine 2 overvågninger – 3 under typisk.'
  assert.ok(m.text.includes(line), m.text)
  assert.ok(m.html.includes(line))
  assert.match(m.html, new RegExp(`href="[^"]*/watchlists"[^>]*>${t.mailFirstWeekCta}<`))
  assert.equal((m.html.match(BUTTON) ?? []).length, 1)
})

test('mail #3: singular forms and Danish thousands', () => {
  assert.ok(week({ watchCount: 1, newListings: 1, underCount: null }).text
    .includes('Vi så 1 ny annonce på din overvågning.'))
  assert.ok(week({ watchCount: 3, newListings: 1204, underCount: 0 }).text
    .includes('Vi så 1.204 nye annoncer på dine 3 overvågninger.'))
})

test('mail #3: no price word without a band, and no zero shown as a verdict', () => {
  for (const underCount of [null, 0]) {
    const m = week({ underCount })
    assert.ok(!m.text.includes(t.verdictUnder.toLowerCase()), `underCount ${underCount}`)
    assert.ok(!m.html.includes(t.mailFirstWeekTileUnder))
    assert.ok(!m.html.includes('#0a7c41'), 'no verdict ink without a verdict')
  }
  // With a verdict, the label carries the alert mail's verdict ink — the word, not the number.
  assert.match(week().html, new RegExp(`color:#0a7c41">${t.mailFirstWeekTileUnder}<`))
})

test('mail #3: a quiet week says so, and shows no zero', () => {
  const m = week({ newListings: 0, underCount: null })
  const quiet = 'Stille uge: ingen nye annoncer på dine 2 overvågninger endnu.'
  assert.ok(m.text.includes(quiet))
  assert.ok(m.html.includes(quiet))
  assert.ok(!m.html.includes('font-size:44px'), 'no number tiles in a quiet week')
  assert.equal((m.html.match(BUTTON) ?? []).length, 1)
})

test('only the verdict label is green: no brand green anywhere in either mail', () => {
  for (const m of [buildPriceTipEmail({ stopUrl: STOP }), week()]) {
    for (const green of ['#13ec6d', '#16d96b', '#0bd25e']) assert.ok(!m.html.includes(green), green)
  }
  assert.ok(!buildPriceTipEmail({ stopUrl: STOP }).html.includes('#0a7c41'))
})

test('every mail-2 and mail-3 key exists in both languages', () => {
  const keys = (l: 'da' | 'en') => Object.keys(translations[l])
    .filter((k) => k.startsWith('mailPriceTip') || k.startsWith('mailFirstWeek') || k.startsWith('mailWelcomeStop')).sort()
  assert.equal(keys('da').length, 29)
  assert.deepEqual(keys('da'), keys('en'))
})
