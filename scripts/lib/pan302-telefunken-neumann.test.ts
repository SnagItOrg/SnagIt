/**
 * scripts/lib/pan302-telefunken-neumann.test.ts
 *
 * PAN-302: the microphones. Thirty-one rows become match targets: 18 Telefunken (the AKG-built vintage ELA M 250 / 251,
 * Telefunken Elektroakustik's ELA M 251E, U47, C12 and ELA M 260 reissues, the R-F-T, Alchemy and dynamic lines) and
 * 13 Neumann (M 149, M 49, M 49 V, U 89, TLM 170, KM 86, KM 54, KM 56, and the M 147, KU 100, TLM 67, BCM 705 and V 402
 * title rows the identity file re-anchors); the Neumann U 47 and both U 67 rows are re-decided. A bare "Telefunken U47"
 * or "Telefunken ELA M 251E" is the reissue; a vintage word makes it the original — the Neumann U 47 through its
 * "Telefunken U47" alias, the AKG-built ELA M 251. Price decides identity (Reverb's sold population, 2026-10-26). Every
 * title is a Reverb sold title, a production title (SELECT, 2026-10-26) or a DBA / kleinanzeigen.de ad live that day.
 *
 * Run: npx tsx --test scripts/lib/pan302-telefunken-neumann.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import { NAVIGATION_FAMILIES } from '../../frontend/lib/families'
import config from '../rematch-configs/pan302-telefunken-neumann'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})
const tf = (slug: string, model: string, name = `Telefunken ${model}`): Product => row(`telefunken-${slug}`, 'telefunken', name, model)
const nm = (slug: string, model: string): Product => row(`neumann-${slug}`, 'neumann', `Neumann ${model}`, model)

/** Every row the PAN-302 files make a match target or re-decide, with the model names the files leave or set. */
const PRODUCTS: Product[] = [
  tf('ela-m-251', 'ELA M 251'), tf('ela-m-251e', 'ELA M 251E'), tf('u47', 'U47'), tf('c12', 'C12'), tf('ela-m-260', 'ELA M 260'),
  tf('ak-47', 'AK-47'), tf('ar-51', 'AR-51'), tf('m16', 'M16'),
  tf('tf11', 'TF11'), tf('tf17', 'TF17'), tf('tf29', 'TF29', 'Telefunken TF29 Copperhead'),
  tf('tf39', 'TF39', 'Telefunken TF39 Copperhead Deluxe'), tf('tf47', 'TF47'), tf('tf51', 'TF51'),
  tf('m80', 'M80'), tf('m81', 'M81'), tf('m82', 'M82'), tf('m60', 'M60'),
  nm('m-149', 'M 149'), nm('m-49', 'M 49'), nm('m-49-v', 'M 49 V'), row('neumann-u89', 'neumann', 'Neumann U 89', 'U 89'),
  nm('tlm-170', 'TLM 170'), nm('km-86', 'KM 86'), nm('km-54', 'KM 54'), nm('km-56', 'KM 56'),
  nm('m-147', 'M 147'), nm('ku-100', 'KU 100'), nm('tlm-67', 'TLM 67'), nm('bcm-705', 'BCM 705'), nm('v-402', 'V 402'),
  // The Neumann rows production holds that these titles could stray onto.
  row('neumann-u47', 'neumann', 'Neumann U 47', 'U 47'), row('neumann-u47-fet', 'neumann', 'Neumann U47 FET', 'U 47 fet'),
  row('neumann-u47-fet-collectors-edition', 'neumann', "Neumann U47 FET Collector's Edition", 'U 47 fet'),
  row('neumann-u67', 'neumann', 'Neumann U67', 'U 67'), row('neumann-u67-reissue', 'neumann', 'Neumann U 67 Reissue', 'U 67'),
  row('neumann-u87', 'neumann', 'Neumann U 87', 'U 87'), row('neumann-u87ai', 'neumann', 'Neumann U 87 Ai', 'U 87 Ai'),
  nm('km-84', 'KM 84'), nm('km-184', 'KM 184'), nm('tlm-49', 'TLM 49'), nm('tlm-103', 'TLM 103'),
  row('warm-audio-wa-47', 'warm audio', 'Warm Audio WA-47', 'WA-47'), row('warm-audio-wa-251', 'warm audio', 'Warm Audio WA-251', 'WA-251'),
]

/**
 * The MODEL identifiers the PAN-302 identity file writes, and the seed identifiers production holds on the U 47 and
 * U 87 Ai: each new Neumann row's code (so a keyword-stuffed "BCM 705 … u87 Sennheiser" title is the BCM 705, not the
 * U 87's score-80 alias), the glued variant letters the model tier cannot reach ("U89i", "KM54a", "M49b", "TLM170R"),
 * the predecessors that are a row by price ("KM 53" on the KM 54, "U48" on both U 47s, "CU-29" on the TF29) and the
 * ELA M spellings ("ELAM 251E", "ELA M 250E"), which both ELA M rows hold: their boundaries separate them.
 */
const M = (slug: string, ...values: string[]) => values.map((value) => ({ product_id: `p-${slug}`, type: 'MODEL', value }))
const IDENTS = [
  ...M('telefunken-ela-m-251', 'ELAM 251', 'ELAM 251E', 'ELA M 251E', 'ELA M251E', 'ELA M 251 E', 'ELA M 250', 'ELA M250', 'ELAM 250',
    'ELA M 250E', 'ELA M250E', 'ELAM 250E', 'ELA M 250 E', '251E'),
  ...M('telefunken-ela-m-251e', 'ELA M 251', 'ELA M251', 'ELAM 251', 'ELAM 251E', 'ELA M 251 E', 'ELA M 251T', 'ELA M251T', 'ELAM 251T',
    'ELA M 250', 'ELA M250', 'ELAM 250', 'ELA M 250E', 'ELA M250E', 'ELAM 250E', 'ELA M 250 E', '251E', '251T'),
  ...M('telefunken-u47', 'U47 M', 'U47M', 'U48', 'U 48', 'U-48'),
  ...M('neumann-u47', 'U48', 'U 48', 'U-48'),
  ...M('telefunken-c12', 'ELA M 12', 'ELA M12F'),
  ...M('telefunken-ela-m-260', 'ELAM 260', 'ELA M260'),
  ...M('telefunken-tf29', 'CU-29', 'CU29', 'CU 29', 'Copperhead'),
  ...M('telefunken-tf39', 'Copperhead Deluxe'),
  ...M('telefunken-m80', 'M80-SH', 'M80SH'), ...M('telefunken-m81', 'M81-SH', 'M81SH'),
  ...M('neumann-m-49', 'M 49', 'M49', 'M-49', 'M49b', 'M 49b', 'M 49 b', 'M-49b', 'M49c', 'M 49c', 'M 49 c', 'M-49c'),
  ...M('neumann-m-49-v', 'M49V', 'M 49V', 'M49 V', 'M-49 V'),
  ...M('neumann-u89', 'U 89', 'U89', 'U-89', 'U89i', 'U 89i', 'U 89 i', 'U89 i'),
  ...M('neumann-tlm-170', 'TLM 170', 'TLM170', 'TLM-170', 'TLM170R', 'TLM 170R', 'TLM 170 R', 'TLM170 R', 'TLM170i', 'TLM 170i', 'TLM 170 i'),
  ...M('neumann-km-86', 'KM 86', 'KM86', 'KM-86', 'KM86i', 'KM 86i', 'KM 86 i', 'KM86 i'),
  ...M('neumann-km-54', 'KM 54', 'KM54', 'KM-54', 'KM54a', 'KM 54a', 'KM 54 a', 'KM54c', 'KM 54c', 'KM 54 c', 'KM53', 'KM 53', 'KM53a',
    'KM 53a', 'KM 53 a', 'KM253', 'KM 253', 'KM254', 'KM 254'),
  ...M('neumann-km-56', 'KM 56', 'KM56', 'KM-56', 'KM56c', 'KM 56c', 'KM 56 c', 'KM56 C', 'KM256', 'KM 256'),
  ...M('neumann-m-147', 'M 147', 'M147', 'M-147'),
  ...M('neumann-m-149', 'M 149', 'M149', 'M-149'),
  ...M('neumann-ku-100', 'KU 100', 'KU100', 'KU-100'),
  ...M('neumann-tlm-67', 'TLM 67', 'TLM67', 'TLM-67'),
  ...M('neumann-bcm-705', 'BCM 705', 'BCM705', 'BCM-705'),
  ...M('neumann-v-402', 'V 402', 'V402', 'V-402'),
  // Production's seed identifiers.
  { product_id: 'p-neumann-u47', type: 'SKU', value: 'U47' }, { product_id: 'p-neumann-u47', type: 'MODEL', value: 'U 47' },
  { product_id: 'p-neumann-u87ai', type: 'SKU', value: 'U87Ai' }, { product_id: 'p-neumann-u87ai', type: 'SKU', value: 'U 87 Ai' },
]

/**
 * The curated aliases the PAN-302 identity file adds (synonym, canonical_query = the slug, score 80): the Neumanns sold
 * under the Telefunken badge. Each names the badge, so step 4 admits the Neumann row on a title whose only maker is
 * Telefunken (`alias_carries_brand`); the row's boundary decides whether the title is the vintage unit.
 */
const A = (slug: string, ...aliases: string[]) => aliases.map((alias) => ({ alias, canonical_query: slug }))
const ALIASES = [
  ...A('neumann-u47', 'Telefunken U47', 'Telefunken U 47', 'Telefunken U48', 'Telefunken U 48'),
  ...A('neumann-u67', 'Telefunken U67', 'Telefunken U 67'),
  ...A('neumann-km-54', 'Telefunken KM54', 'Telefunken KM 54', 'Telefunken KM53', 'Telefunken KM 53'),
  ...A('neumann-km-56', 'Telefunken KM56', 'Telefunken KM 56'),
]

/** Listing titles production holds as live aliases on these rows (synonym, 2026-10-26). */
const SYNONYMS = [
  ...ALIASES,
  ...A('neumann-u47-fet', 'U47 fet'), ...A('neumann-u67', 'U67'), ...A('neumann-u67-reissue', 'U67'), ...A('neumann-u87', 'U87'),
]

const index = buildMatchIndex(PRODUCTS, IDENTS, SYNONYMS, [
  'telefunken', 'neumann', 'akg', 'warm audio', 'shure', 'sennheiser', 'audio-technica', 'beesneez', 'schoeps', 'microtech gefell',
  'peluso', 'manley',
])
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (slug: string, titles: string[]) => { for (const t of titles) assert.equal(decide(t), slug, t) }
const notOn = (slugs: string[], titles: string[]) => {
  for (const t of titles) { const d = String(decide(t)); assert.ok(!slugs.includes(d), `${t} → ${d}`) }
}
const OURS = [...config.promoted, ...config.supportedToday, 'neumann-u47-fet', 'neumann-u47-fet-collectors-edition', 'neumann-u87', 'neumann-u87ai']

test('every promoted row has a boundary, the config lists 31 rows, and the two families hold eight of them', () => {
  assert.equal(config.promoted.length, 31)
  assert.equal(new Set([...config.promoted, ...config.supportedToday]).size, 34)
  for (const slug of [...config.promoted, ...config.supportedToday]) {
    assert.ok(LINE_BOUNDARIES[slug], `${slug} has no LINE_BOUNDARIES entry`)
    assert.ok(PRODUCTS.some((p) => p.slug === slug), `${slug} is not in the fixture`)
  }
  const fam = (slug: string) => NAVIGATION_FAMILIES.find((f) => f.slug === slug)!
  assert.deepEqual(fam('telefunken-ela-m-251-condenser').children, ['telefunken-ela-m-251', 'telefunken-ela-m-251e'])
  assert.deepEqual(fam('telefunken-alchemy').children,
    ['telefunken-tf11', 'telefunken-tf17', 'telefunken-tf29', 'telefunken-tf39', 'telefunken-tf47', 'telefunken-tf51'])
  for (const f of ['telefunken-ela-m-251-condenser', 'telefunken-alchemy']) {
    for (const c of fam(f).children) {
      assert.ok(config.promoted.includes(c), c)
      // A family label must never equal a child's name (catalogue-audit, family_label_equals_child_name).
      assert.notEqual(fam(f).label.toLowerCase(), PRODUCTS.find((p) => p.slug === c)!.canonical_name.toLowerCase())
    }
  }
})

test('the ELA M 251: a vintage word makes it the AKG-built original, anything else is the Elektroakustik reissue', () => {
  matches('telefunken-ela-m-251', [
    'Vintage Original Telefunken ELAM 251',
    'Original, Vintage Telefunken ELA M 251E - 1961',
    'TELEFUNKEN ELA M 251E VINTAGE tube microphone',
    'Vintage Telefunken  ELA M 251E (S# 310)',
    'Telefunken ELA M251E  True real Vintage and Legendary microphone',
    'Telefunken ELA M 251 - AC701 (Vintage - not reissue)',
    'Telefunken ELA M 250 Vintage Tube Microphone',
    'Telefunken ELA M 250E 1960s - Mint Green',
  ])
  matches('telefunken-ela-m-251e', [
    'Telefunken ELA M 251E Multipattern Tube Condenser Microphone 2010s - Mint Green',
    'Telefunken Elektroakustik ELA M 251E Tube Condenser Microphone (Demo Deal)',
    'Telefunken ELA M 251E Tube Condenser Microphone',
    'Telefunken ELAM 251e',
    'Telefunken ELA M251E',
    'Telefunken ELA M 251',
    'Telefunken 251E Tube Microphone',
    'Telefunken ELA M 251T',
    'TELEFUNKEN - ELA M251 - DIAMOND SERIE',
    'Telefunken Elektroakustik ELA M 250E Tube Microphone',
    'Telefunken ELA M251E - Classic Tube Condenser Microphone, NOS 6072a',
  ])
  // The 251 F (no row), stereo sets, copies, Telefunken's own parts, papers, tubes and power supplies name neither.
  notOn(OURS, [
    'Telefunken ELA M 251 F Tube Microphone',
    'Telefunken ELA M 251E Stereo Pair 2017 - Green',
    'Telefunken Elektroakustik ELA M 251E Tube Condenser Microphone Stereo Set',
    'Circle Audio EVO 251 | Vintage Colorway | Telefunken ELA M 251 Inspired Tube Mic | Neumann-Telefunken-AKG Genu',
    'Bock Audio 251 (241 - Cardioid) - Amazing ! / ELA m / Telefunken / FLEA',
    'Jeanne Audio  JA-251 Tube Microphone ELA M 251 Telefunken Clone',
    'Soundelux E251C 2007 - Telefunken ELA M 251 Clone',
    'Fox Audio "Telefunken ELA M 251" Special Edition I Tube Mic w/RK12 capsule 2017  - Awesome!',
    'Telefunken M 750 Ela M 251E Shock Mount',
    'TELEFUNKEN Elektroakustik M 850E Tube Microphone Cable (ELA M 251E)',
    'New Telefunken Elektroakustik M 950E Power Supply for ELA M 250E & 251E Tube Microphones',
    'Telefunken FC50 Microphone System Flight Case (ELA M 251E)',
    'Telefunken ELA M 251E mic badge',
    '1961 Telefunken Ela M 251 Serial NR. 801 Original Frequency Response document & Guarantee Card',
    'Telefunken ELA M 250 / M 251 brochure and schematics',
    'Akg Vintage Original Custom Telefunken Ela M251 Female 6 pin  Connector  50s',
    'New Telefunken Elektroakustik 6072A Vacuum Tube (ELA M 251E, TF51, AR-51)',
    'Warm Audio WA-251 Tube Condenser Mic',
  ])
})

test('the U 47: a bare "Telefunken U47" is the reissue, a vintage word or the Neumann name the Neumann; U 48 joins each', () => {
  matches('telefunken-u47', [
    'Telefunken U47',
    'Telefunken U47 2010s - Nickel',
    'Telefunken Elektroakustik U47 Switchable Pattern Tube Microphone',
    'Telefunken U47 M Large-Diaphragm Condenser Microphone w/ Case #52105',
    '2006 Telefunken U47 Vacuum Tube Condensor Microphone U47M #43149',
    'Telefunken USA U47 2018',
    'Telefunken U-47 2022 Nickel',
    // The reissue's year outweighs the Neumann word in the description.
    'Telefunken U47 Tube Condenser Microphone. All original. Like New! Made in 2022! Neumann',
    'Telefunken Elektroakustik U48 Tube Microphone',
    'Telefunken USA U 48 2016 - Chrome/Grey',
  ])
  matches('neumann-u47', [
    'Telefunken U47 vintage tube mic. s/n 3320 1950s Grey, Plated',
    'Vintage Telefunken U47 Dual Pattern Tube Microphone (1955)',
    '1958 Neumann Telefunken U47',
    'TELEFUNKEN U47 NEUMANN TUBE MIKROPHON #470 ULTRA VINTAGE GENUINE',
    'Neumann/Telefunken U 47 1950s - Nickel',
    '1951 Neumann U47 VF14 Telefunken Badged Microphone Chrome Basket Amazing Condition',
    'Vintage Neumann U47 Tube Microphone – Telefunken Badge – Dual Power Supplies',
    'Neumann U48 Vintage 1958 #250 Rare! U47 only 800 produced',
    'Neumann U48 (Beatles mic)',
    'Vintage Neumann U47 Large Diaphragm Tube Condenser Microphone Serial #4341',
  ])
  matches('neumann-u47-fet', ['Neumann U47 FET Condensor Microphone'])
  notOn(['neumann-u47', 'telefunken-u47'], [
    // The fet's other spellings, a reissue with an old capsule, Blue rebuilds, copies.
    'Neumann U47 feti FET47 1981',
    'Telefunken U47 With Vintage K49 Capsule',
    'Telefunken U47 2010s - Nickel with vintage k49 upgrade',
    'BLUE-refurbished Neumann/Telefunken U47',
    'Telefunken  BLUE U47 Silver/chrome',
    'Telefunken U47 (Clone)',
    'Wagner U47 Tube Microphone Großmembran Röhrenmikrofon wie Neumann',
    'Warm Audio WA-47F Neumann/Telefunken U47 Replica. Large-diaphragm FET Condenser Mic',
    'Telefunken U47, Nuvistor',
    // The tube and parts trade.
    'Telefunken VF14M VF 14 M Tube For Neumann U47 U48 Quiet Gorgeous Tone. Buy Confidently!',
    'Telefunken VF14 NEUMANN TUBE MICROPHONE U47 U48',
    'SATURN SOUND RV -14 M TUBE Neumann U47& U48 ( VF14)',
    'Neumann Original 1950s U48 Pattern Selector',
    'Tuchel Amphenol Neumann U47 U48 50s 60s 6pin',
    'Neumann Telefunken U47 U48 Repro Bottom Bell',
    'Flea U48 w/ Power Supply & Road Case - Neumann U47 - 47 48',
    'Telefunken Case for Neumann u47',
    'Telefunken U47 neumann logo original',
    // An AK-47 that names the U 47 it resembles (kleinanzeigen.de).
    'Telefunken AK47 Röhrenmikrofon U47 Mega Clone Spitzenklasse',
  ])
})

test('the other Telefunken-badged Neumanns: the U 67, KM 54 and KM 56 through their aliases', () => {
  matches('neumann-u67', ['Telefunken U67', 'Telefunken U 67 1960\'s', 'Vintage Telefunken Neumann U67 Tube Condenser Microphone'])
  matches('neumann-km-54', [
    'Neumann KM 54 a TUBE Telefunken AC701 Mikrofon vintage rare',
    'Neumann KM254c KM-54 KM 54 Tube Microphone Nickel Diaphragm Telefunken AC701k Tube, EXC++',
    'Neumann KM 54 Small Diaphragm Cardioid Condenser Microphone 1953 - 1970 - Nickel',
    'Vintage Neumann KM 53a tube microphone',
  ])
  matches('neumann-km-56', [
    'Telefunken KM56 Vintage Tube Small Condenser Microphone with Power Supply',
    'Telefunken Neumann KM56 C Miniature Multipattern Vintage Tube Microphone',
    'Neumann KM56c Excellent',
    'Neumann KM 56 1960s - Nickel',
  ])
  notOn(OURS, [
    'Neumann TLM 67 w/ioaudio MaxMod mk67 upgrade, u67 sleeve, telefunken tubes!',
    'Telefunken Neumann SM2 - Stereo KM 56 Tube Microphone',
    'Neumann Telefunken KM 56 Matched Pair 1950s',
    'TELEFUNKEN KM54 TUBE MIKROFON STEREO SET NEUMANN AC 701K NIKEL',
    'Neumann Telefunken KM 54 KM 56 Condenser mic floorstands 1950s grey wrinkle,nickel',
    'Kabler. Passer til Neumann KM54 mfl.',
    'Neumann AC connector for original Neumann u47 Km56, etc. Microphone power supply 80s? - white',
  ])
})

test('the Telefunken reissues, R-F-T, Alchemy and dynamic lines, each by its code beside the maker', () => {
  matches('telefunken-c12', ['Telefunken C12 Multipolarpattern Tube Condenser Microphone. AKG C 12. MINT!', 'Telefunken Elektroakustik C12 Tube Condenser Microphone', 'TELEFUNKEN C-12 Microphone'])
  matches('telefunken-ela-m-260', ['Telefunken ELA M 260 Cardioid Small Diaphragm Tube Condenser Microphone', 'Telefunken ELA M 260 2010s - Mint Green', 'Telefunken ELA-M-260 mint'])
  matches('telefunken-ak-47', ['Telefunken AK-47 MkII Large Diaphragm Multipattern Tube Condenser Microphone', 'TELEFUNKEN AK-47 AK47 AK 47 MKII TUBE CONDENSER MIC MK2 U67 U87'])
  matches('telefunken-ar-51', ['Telefunken AR-51 Tube Condenser Microphone - Like ELA-M 251 and C12'])
  matches('telefunken-m16', ['Telefunken M16 MKII'])
  matches('telefunken-tf11', ['Telefunken TF11 Large Diaphragm Cardioid Condenser Microphone'])
  matches('telefunken-tf17', ['Telefunken TF17 FET Large Diaphragm Cardoid Condenser Microphone'])
  matches('telefunken-tf29', ['Telefunken CU-29 Copperhead', 'Telefunken TF29 Röhrenmikrofon Kondensator Microphone', 'Telefunken TF 29'])
  matches('telefunken-tf39', ['Telefunken TF39 Copperhead Deluxe', '*MINT* Telefunken TF39 Copperhead Large Diaphragm Cardioid Tube Condenser Microphone 2019 - Black'])
  matches('telefunken-tf47', ['Telefunken TF47 Grossmembran Studio Mikrofon Mic'])
  matches('telefunken-tf51', ['Telefunken TF51 Large Diaphragm Multipattern Tube Condenser Microphone', 'Telefunken TF-51 Tube Mic C12'])
  matches('telefunken-m80', ['Telefunken M80 Custom Handheld Supercardioid Dynamic Microphone', 'Telefunken M80-SH Short Handle Dynamic Microphone'])
  matches('telefunken-m81', ['Telefunken M81', 'Telefunken M81-SH Short Handle Supercardioid Dynamic Microphone'])
  matches('telefunken-m82', ['Telefunken M82 Cardioid Dynamic Microphone'])
  matches('telefunken-m60', ['Telefunken M60 FET Small Diaphragm Cardioid Condenser Microphone', 'Telefunken M60 FET Master Set'])
  notOn(OURS, [
    'Telefunken M60 FET Cardioid Stereo Condenser Microphone Set',
    'Telefunken ELA M 260 Stereo Set',
    'Telefunken Elektroakustik ELA M 260 Tri-Mono Tube Microphones',
    'Telefunken DD5 5-Piece Dynamic Drum Microphone Package',
    'Telefunken M82 Dynamic Microphone Podcast Package',
    'Telefunken M62 Small Diaphragm Hypercardioid FET Condenser Microphone',
    'Câble de microphone à tube M 803 (TF29, TF39, TF47, TF51, AK-47 MkII, AR-51, AR-7',
    'TELEFUNKEN Elektroakustik WB60 Microphone Wooden Box (ELA M 260, M60)',
    'Telefunken Ela M260 1960 - White',
  ])
})

test('the Neumann classics: each by its code and its glued variant letter, never a sibling, a mod or a part', () => {
  matches('neumann-m-147', ['Neumann M 147 Large Diaphragm Cardioid Tube Condenser Microphone 1999 - Present - Nickel', 'Neumann M147 Röhrenmikrofon'])
  matches('neumann-m-149', ['Neumann M 149 Large Diaphragm Multipattern Tube Condenser Microphone', 'Neumann M149 Röhrenmikrofon'])
  matches('neumann-m-49', ['Neumann M49b #2250c in perfect condition', 'Original Neumann M 49C 1960s  perfect condition!', 'Neumann M 49 Large Diaphragm Multipattern Tube Condenser Microphone 1952 - 1974 - Nickel'])
  matches('neumann-m-49-v', ['Neumann M 49 V Large Diaphragm Multipattern Tube Condenser Microphone 2022 - Present - Nickel', 'Neumann M49V'])
  matches('neumann-u89', ['Neumann U89i - stormembran kondensator mikrofon', 'Neumann u89i Studio Mikrofon & original Spinne -Vintage ähnl. U87', 'Neumann U 89 i Grossmembran-Studiomikrofon im Holzkasten'])
  matches('neumann-tlm-170', ['Neumann TLM170i Studiomikrofon Bj. 1985', 'Neumann TLM 170 R mikrofon Studiomikrofon Kondensatormikrofon'])
  matches('neumann-km-86', ['Neumann KM 86'])
  matches('neumann-ku-100', ['Neumann KU 100 Binaural Dummy Head Microphone'])
  matches('neumann-tlm-67', ['NEUMANN TLM 67 Microfono a condensatore con diaframma largo'])
  matches('neumann-bcm-705', ['Neumann BCM705 Broadcast Microphone', 'Neumann BCM 705 Hypercardioid Dynamic Microphone u87 Sennheiser MD-431'])
  matches('neumann-v-402', ['NEUMANN V 402 Preamplificatore microfonico a 2 canali'])
  notOn(OURS, [
    'Neumann KM 76, wie KM 86 mit Adapter',
    'Neumann TLM 67 inkl. U67 Kit IOaudio',
    'BLUE M49b Remanufactured Restored',
    'Neumann M49 M249 M50 M250 yoke mount',
    'Tuchel M49 Neumann 8 pin connectors 1950-1960',
    'Neumann Original 1960\'s Parts of M 49 Condenser Microphone',
    'Neumann N52t Netzteil für M49 und andere mit Telefunken AC701',
    'Neumann U 47a original K47 capsule / Nuvistor tube / NG psu w/ cable, shock mount, mic box',
  ])
})
