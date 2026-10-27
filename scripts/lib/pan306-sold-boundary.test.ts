/**
 * scripts/lib/pan306-sold-boundary.test.ts
 *
 * PAN-306: the Reverb sold writer links a sale only when its title passes the product's line boundary, and it
 * pages the sold search until 20 usable sales pass (five pages at most). The boundary fixes A–F are the
 * over-refusals measured on the 5,385 linked sold titles (production, 2026-10-27): an amp's own "Tube Combo",
 * a 5E3's "Narrow Panel", a "2 x 12-inch" speaker layout, Fender's "Color Trio" finish, a vintage mic's "full
 * original kit" and a mouthpiece listed with the horn. Every title is a production title unless marked.
 *
 * Run: npx tsx --test scripts/lib/pan306-sold-boundary.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { namesBrassAccessory } from '../../frontend/lib/brand-wall'
import { SOLD_MAX_PAGES, SOLD_TARGET, collectSold, soldRefusal, type SoldListing } from './sold-boundary'

const passes = (slug: string, title: string) => assert.equal(soldRefusal(title, slug, null), null, `${slug}: ${title}`)
const refuses = (slug: string, title: string) => assert.notEqual(soldRefusal(title, slug, null), null, `${slug}: ${title}`)

test('PAN-306: the sold writer refuses what the matcher refuses — pairs, siblings, parts', () => {
  refuses('neumann-km-54', 'Pair of Neumann KM54a Small Diaphragm Cardioid Valve Condenser Microphones 1955 & 1957 - Nickel')
  refuses('dbx-160', 'dbx 160 Compressor / Limiter Pair')
  refuses('neumann-u87', 'Neumann U 87 Ai Large Diaphragm Multipattern Condenser Microphone - Nickel')
  refuses('peavey-6505', 'Synergy Peavey 6505 2-Channel Tube Preamp Module')
  refuses('fender-blues-junior-iii', 'Tuki Padded Cover for Fender Blues Junior III 1x12 Combo Amp (fend242p)')
  passes('neumann-km-54', 'NEUMANN KM54a Vintage (full original kit) telefunken badge incredible condition')
})

test('PAN-306 A: "Tube Combo Amp" and "Valve Amp" describe the amp; a tube sold alone is still a part', () => {
  passes('fender-65-deluxe-reverb-reissue', "Fender '65 Deluxe Reverb Tube Combo Amp")
  passes('soldano-slo-100', 'Soldano SLO-100 Super Lead Overdrive 100W Tube Amp Head Regular Snakeskin')
  passes('fender-blues-junior', 'Fender Blues Junior PR295 15W Tube Guitar Amplifier Combo - Excellent Condition')
  passes('vox-ac30c2', 'Vox AC30C2 30W 2x12 Valve Combo - Greenbacks')
  passes('hiwatt-dr103', '1970 Hiwatt DR103 Bass Valve Amp')
  refuses('fender-65-deluxe-reverb-reissue', 'Fender ’65 Deluxe Reverb - Electro-Harmonix Tube Bundle (With Rectifier)')
  refuses('fender-pro-reverb', "fender '63 tube spring Reverb Unit-mint condition")
  // Not a production title: a tube maker's name is not the amp.
  refuses('soldano-slo-100', 'Tube Amp Doctor EL34 matched quad for Soldano SLO-100')
})

test('PAN-306 A guard: the SVT-3PRO and SVT-4PRO are their own heads, not the SVT', () => {
  refuses('ampeg-svt', 'Ampeg SVT-3PRO 450-watt Tube Preamp Bass Head')
  refuses('ampeg-svt', 'Ampeg SVT-4PRO Bass Amplifier Head')
})

test('PAN-306 B: a tweed "Narrow Panel" and a signed "Purple Panel" are the amp; a front panel is a part', () => {
  passes('fender-5e3-tweed-deluxe', 'Fender Deluxe 5E3 Narrow Panel 15-Watt 1x12" Guitar Combo 1955 - 1960 - Tweed')
  passes('soldano-slo-100', 'Soldano SLO-100 - Signed Purple Panel - White Head')
  // Not a production title.
  refuses('fender-5e3-tweed-deluxe', 'Fender Deluxe 5E3 front panel')
})

test('PAN-306 C: "2 x 12-inch" is a speaker layout; two units and two tubes still refuse', () => {
  passes('fender-65-twin-reverb-reissue', "Fender '65 Twin Reverb - 2 x 12-inch 85-watt Tube Guitar Combo Amplifier")
  passes('vox-ac30c2', 'Vox AC30C2 2 x 12-inch 30-watt Tube Combo Amp - Limited Edition Blue Cream 2-Tone')
  passes('roland-jc-120', 'Roland JC-120 Jazz Chorus 2 x 12-inch 120-watt Stereo Combo Amp')
  refuses('roland-jc-120', 'Roland JC-120 Jazz Chorus 2 x 12-inch 120-watt Stereo Combo Amp (2-pack) Bundle')
  refuses('dbx-160a', '2x dbx 160A Compressor Limiter - Black')
  // Not production titles.
  refuses('neumann-km-84', '2 x Neumann KM 84')
  refuses('fender-blues-junior', '2 x 12AX7 for Fender Blues Junior')
})

test('PAN-306 D: Fender\'s "Color Trio" is a finish; a matched trio is three mics', () => {
  passes('fender-blues-junior-iv', 'Fender FSR Blues Junior IV Tube Combo Amp - Color Trio - Red, White and Blue')
  passes('fender-blues-junior-iv', "FENDER FSR BLUES JUNIOR IV COLOUR TRIO WITH 12'' CANNABIS REX SPEAKER")
  refuses('neumann-km-84', 'Matched Trio Neumann Km84')
})

test('PAN-306 E: a vintage mic\'s "original kit" is the mic as it shipped; a kit to build one is not', () => {
  passes('neumann-km-56', 'NEUMANN KM56c Vintage (very early serial) all original kit')
  // Not a production title.
  refuses('neumann-km-56', 'Neumann KM56 DIY kit')
})

test('PAN-306 F: a mouthpiece listed after the trumpet comes with it; a trumpet mouthpiece alone does not', () => {
  passes('bach-stradivarius-72', 'Vincent Bach Stradivarius 72 MLV Vindabona trumpet Bach case and mouthpiece GAMONBRASS')
  passes('yamaha-ytr-232', 'Vintage Yamaha YTR-232S Silver-Plated Bb Trumpet, Made in Japan — Original Owner, Documents, Mouthpiece, Excellent Condition')
  // Not production titles.
  refuses('bach-stradivarius-72', 'Bach Stradivarius 72 Trumpet Mouthpiece 3C')
  refuses('yamaha-ytr-232', 'Mouthpiece for Yamaha YTR-232 trumpet')
  // The brand wall reads the same list (PAN-271).
  assert.equal(namesBrassAccessory('Bach Trumpet Mouthpiece 3C'), true)
  assert.equal(namesBrassAccessory('Vincent Bach Stradivarius 72 trumpet Bach case and mouthpiece'), false)
})

test('PAN-154 sold rule: a Brand New or B-Stock sale on a vintage-only product is current production', () => {
  assert.equal(soldRefusal('Moog Minimoog Model D', 'moog-minimoog', 'Brand New'), 'condition:brand new')
  assert.equal(soldRefusal('Moog Minimoog Model D', 'moog-minimoog', 'Excellent'), null)
})

// ── paging ──────────────────────────────────────────────────────────────────

const sale = (i: number, title = 'Neumann KM 54 Vintage Tube Microphone', extra: Partial<SoldListing> = {}): SoldListing => ({
  title, price: { amount: '1000', currency: 'USD' }, _links: { web: { href: `https://reverb.com/item/${i}` } }, ...extra,
})
const pair = (i: number) => sale(i, 'Pair of Neumann KM54a Small Diaphragm Valve Condenser Microphones')
const pagesOf = (pages: (SoldListing[] | null)[]) => {
  const asked: number[] = []
  return { asked, fetch: async (page: number) => { asked.push(page); return page <= pages.length ? pages[page - 1] : [] } }
}
const range = <T>(from: number, n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, k) => f(from + k))

test('PAN-306: a refused sale is never accepted, and the search pages on to replace it', async () => {
  const { asked, fetch } = pagesOf([
    [...range(0, 10, sale), ...range(10, 10, pair)],
    range(20, 20, sale),
  ])
  const got = await collectSold('neumann-km-54', fetch, 20)
  assert.ok(got)
  assert.deepEqual(asked, [1, 2])
  // The page that reaches the target is kept whole: 10 + 20.
  assert.ok(got.accepted.length >= SOLD_TARGET)
  assert.equal(got.accepted.length, 30)
  assert.equal(got.refused, 10)
  assert.ok(got.accepted.every((l) => !/pair/i.test(l.title ?? '')))
})

test(`PAN-306: paging stops after ${SOLD_MAX_PAGES} pages, at a short page, and never fetches past either`, async () => {
  const many = pagesOf(range(0, 8, (p) => range(p * 20, 20, pair)))
  const capped = await collectSold('neumann-km-54', many.fetch, 20)
  assert.deepEqual(many.asked, [1, 2, 3, 4, 5])
  assert.equal(capped?.accepted.length, 0)
  assert.equal(capped?.refused, 100)

  const short = pagesOf([range(0, 7, sale)])
  const got = await collectSold('neumann-km-54', short.fetch, 20)
  assert.deepEqual(short.asked, [1])
  assert.equal(got?.accepted.length, 7)
})

test('PAN-306: parts are kept but do not count towards the target; a repeated URL is read once', async () => {
  const part = (i: number) => sale(i, 'Neumann KM 54 Vintage Tube Microphone', {
    categories: [{ full_name: 'Pro Audio / Microphone Parts & Accessories' }],
  })
  const { asked, fetch } = pagesOf([
    [...range(0, 15, sale), ...range(15, 5, part)],
    [...range(0, 5, sale), ...range(20, 15, sale)],
  ])
  const got = await collectSold('neumann-km-54', fetch, 20)
  assert.deepEqual(asked, [1, 2])
  // 15 usable + 5 parts on page 1; page 2 repeats 5 URLs and adds 15 new — usable reaches 30 on page 2.
  assert.equal(got?.accepted.length, 35)
})

test('PAN-306: a failed first page fails the row; a failed later page keeps what was accepted', async () => {
  assert.equal(await collectSold('neumann-km-54', pagesOf([null]).fetch, 20), null)
  const got = await collectSold('neumann-km-54', pagesOf([range(0, 20, pair), null]).fetch, 20)
  assert.deepEqual(got, { accepted: [], refused: 20, pages: 1, complete: false })
})
