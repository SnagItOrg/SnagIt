/**
 * scripts/lib/pan261-amps.test.ts
 *
 * PAN-261: the amp section. Twenty-seven rows become match targets (11 created with a verified Reverb CSP on
 * 2026-10-13, 16 re-anchored that existed as `known` since PAN-178). The boundaries are measured on the 1,938
 * active titles that name one of the models (read-only snapshot 2026-10-13): a Fender line's vintage, '65
 * Reissue, '68 Custom and Tone Master rows must each take their own titles and nothing else; the Boss "legend"
 * pedals, the covers, the recap and retube kits, a turret board, a flightcase sold alone and a poster are not
 * the amp; the SVT's cabinets and hybrids, the Dual Rectifier's variants and the JCM800's siblings stay out.
 * Every title is a production title.
 *
 * Run: npx tsx --test scripts/lib/pan261-amps.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, lineBoundaryRefusal, type Product } from '../../frontend/lib/matching/match-listings'
import { earliestInclusionMarker } from '../../frontend/lib/matching/listing-intent'
import config from '../rematch-configs/pan261-amps'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})

/** Every row the PAN-261 files make a match target, with the model names the identity file sets. */
const PRODUCTS: Product[] = [
  row('fender-twin-reverb-vintage', 'fender', 'Fender Twin Reverb (vintage)', 'Twin Reverb'),
  row('fender-65-twin-reverb-reissue', 'fender', "Fender '65 Twin Reverb Reissue", '65 Twin Reverb'),
  row('fender-tone-master-twin-reverb', 'fender', 'Fender Tone Master Twin Reverb', 'Tone Master Twin Reverb'),
  row('fender-deluxe-reverb-vintage', 'fender', 'Fender Deluxe Reverb (vintage)', 'Deluxe Reverb'),
  row('fender-65-deluxe-reverb-reissue', 'fender', "Fender '65 Deluxe Reverb Reissue", '65 Deluxe Reverb'),
  row('fender-68-custom-deluxe-reverb', 'fender', "Fender '68 Custom Deluxe Reverb", '68 Custom Deluxe Reverb'),
  row('fender-tone-master-deluxe-reverb', 'fender', 'Fender Tone Master Deluxe Reverb', 'Tone Master Deluxe Reverb'),
  row('fender-princeton-reverb-vintage', 'fender', 'Fender Princeton Reverb (vintage)', 'Princeton Reverb'),
  row('fender-65-princeton-reverb-reissue', 'fender', "Fender '65 Princeton Reverb Reissue", '65 Princeton Reverb'),
  row('fender-tone-master-princeton-reverb', 'fender', 'Fender Tone Master Princeton Reverb', 'Tone Master Princeton Reverb'),
  row('fender-super-reverb', 'fender', 'Fender Super Reverb', 'Super Reverb'),
  row('fender-vibrolux-reverb', 'fender', 'Fender Vibrolux Reverb', 'Vibrolux Reverb'),
  row('fender-pro-reverb', 'fender', 'Fender Pro Reverb', 'Pro Reverb'),
  row('fender-bassman', 'fender', 'Fender Bassman', 'Bassman'),
  row('fender-blues-junior', 'fender', 'Fender Blues Junior', 'Blues Junior'),
  row('fender-blues-junior-iii', 'fender', 'Fender Blues Junior III', 'Blues Junior III'),
  row('fender-blues-junior-iv', 'fender', 'Fender Blues Junior IV', 'Blues Junior IV'),
  row('fender-5e3-tweed-deluxe', 'fender', 'Fender 5E3 Tweed Deluxe', '5E3'),
  row('vox-ac30-vintage', 'vox', 'Vox AC30 (vintage)', 'AC30'),
  row('marshall-super-lead-plexi', 'marshall', 'Marshall Super Lead / Plexi', 'Super Lead'),
  row('marshall-jcm800-2203', 'marshall', 'Marshall JCM800 2203', '2203'),
  row('marshall-jcm800-2204', 'marshall', 'Marshall JCM800 2204', '2204'),
  row('mesa-boogie-dual-rectifier', 'mesa/boogie', 'Mesa/Boogie Dual Rectifier', 'Dual Rectifier'),
  row('peavey-5150', 'peavey', 'Peavey 5150', '5150'),
  row('peavey-6505', 'peavey', 'Peavey 6505', '6505'),
  row('roland-jc-120', 'roland', 'Roland JC-120', 'JC-120'),
  row('roland-jc-120h', 'roland', 'Roland JC-120H', 'JC-120H'),
  row('hiwatt-dr103', 'hiwatt', 'Hiwatt DR103', 'DR103'),
  row('soldano-slo-100', 'soldano', 'Soldano SLO-100', 'SLO-100'),
  row('ampeg-svt', 'ampeg', 'Ampeg SVT', 'SVT'),
  // Round 2 (2026-10-14): the reissue rows. A variant whose titles never spell its own name shares the base's model
  // name (the Minimoog pattern) and its boundary decides; the others carry the name Reverb gives them.
  row('vox-ac30c2', 'vox', 'Vox AC30C2', 'AC30C2'),
  row('vox-ac30cc2', 'vox', 'Vox AC30CC2', 'AC30CC2'),
  row('fender-59-bassman-ltd', 'fender', "Fender '59 Bassman LTD", 'Bassman'),
  row('marshall-1959slp', 'marshall', 'Marshall 1959SLP', 'Super Lead'),
  row('marshall-1959hw', 'marshall', 'Marshall 1959HW', 'Super Lead'),
  row('soldano-slo-100-custom-shop', 'soldano', 'Soldano SLO-100 Custom Shop', 'SLO-100'),
  row('peavey-6505-plus', 'peavey', 'Peavey 6505+', '6505'),
  row('peavey-6505-ii', 'peavey', 'Peavey 6505 II', '6505'),
  row('fender-tone-master-super-reverb', 'fender', 'Fender Tone Master Super Reverb', 'Tone Master Super Reverb'),
  row('fender-68-custom-twin-reverb', 'fender', "Fender '68 Custom Twin Reverb", '68 Custom Twin Reverb'),
  row('fender-68-custom-princeton-reverb', 'fender', "Fender '68 Custom Princeton Reverb", '68 Custom Princeton Reverb'),
  row('fender-68-custom-vibrolux-reverb', 'fender', "Fender '68 Custom Vibrolux Reverb", '68 Custom Vibrolux Reverb'),
  // Brand protection and a Telecaster bundle partner.
  row('boss-ds-1', 'boss', 'Boss DS-1', 'DS-1'),
  row('gibson-les-paul-standard', 'gibson', 'Gibson Les Paul Standard', 'Les Paul Standard'),
]
/** The identifiers and the alias the PAN-261 identity file writes. */
const IDENTS = [
  ['fender-65-twin-reverb-reissue', 'Twin Reverb Reissue'], ['fender-tone-master-twin-reverb', 'Tonemaster Twin Reverb'],
  ['fender-65-deluxe-reverb-reissue', 'Deluxe Reverb Reissue'], ['fender-tone-master-deluxe-reverb', 'Tonemaster Deluxe Reverb'],
  ['fender-65-princeton-reverb-reissue', 'Princeton Reverb Reissue'], ['fender-tone-master-princeton-reverb', 'Tonemaster Princeton Reverb'],
  ['mesa-boogie-dual-rectifier', 'Dual Rectifier'], ['vox-ac30-vintage', 'AC-30'], ['fender-5e3-tweed-deluxe', 'Tweed Deluxe'], ['hiwatt-dr103', 'DR-103'],
  // Round 2: the spellings the model names cannot see (spaced and hyphenated Vox codes, Reverb's "Reverb-Amp").
  ['vox-ac30c2', 'AC30 C2'], ['vox-ac30c2', 'AC-30C2'], ['vox-ac30c2', 'AC-30 C2'], ['vox-ac30c2', 'AC30 Custom'],
  ['vox-ac30cc2', 'AC30 CC2'], ['vox-ac30cc2', 'AC-30CC2'], ['vox-ac30cc2', 'AC-30 CC2'], ['vox-ac30cc2', 'Custom Classic'],
  ['marshall-1959slp', '1959SLP'], ['marshall-1959slp', '1959 SLP'], ['marshall-1959hw', '1959HW'], ['marshall-1959hw', '1959 HW'],
  ['peavey-6505-ii', '6505II'], ['fender-tone-master-super-reverb', 'Tonemaster Super Reverb'],
  ['fender-68-custom-twin-reverb', 'Custom Twin Reverb-Amp'], ['fender-68-custom-princeton-reverb', 'Custom Princeton Reverb-Amp'], ['fender-68-custom-vibrolux-reverb', 'Custom Vibrolux Reverb-Amp'],
].map(([slug, value]) => ({ product_id: `p-${slug}`, type: 'MODEL', value }))
const SYNONYMS = [{ alias: 'Plexi', canonical_query: 'marshall-super-lead-plexi' }]

const index = buildMatchIndex(PRODUCTS, IDENTS, SYNONYMS)
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (title: string, slug: string) => assert.equal(decide(title), slug, title)
const notMatched = (title: string) => {
  const d = decide(title)
  assert.ok(d === 'none' || d === 'rejected' || String(d).startsWith('deferred:'), `${title} → ${d}`)
}

test('a Fender line splits into its vintage, reissue, custom and Tone Master rows', () => {
  matches('Fender Twin Reverb guitarforstærker', 'fender-twin-reverb-vintage')
  matches('Fender 1967 Vintage Twin Reverb Amp w/Cover', 'fender-twin-reverb-vintage')
  matches('Vintage 1972-76 Fender Twin Reverb 2x12" Combo Guitar Amp- Local Pickup ONLY, IL', 'fender-twin-reverb-vintage')
  matches('Fender 65 Twin Reverb guitarforstærker', 'fender-65-twin-reverb-reissue')
  matches("Tidlig USA-made Fender ’65 Twin Reverb Reissue, sandsynligvis fra 1990’erne", 'fender-65-twin-reverb-reissue')
  matches("Fender '65 Twin Reverb Reissue 85-Watt 2x12\" Guitar Combo 1991 - Present - Black", 'fender-65-twin-reverb-reissue')
  matches('Fender Tone Master Twin Reverb Blonde', 'fender-tone-master-twin-reverb')
  matches('Fender  tonemaster Deluxe Reverb blonde', 'fender-tone-master-deluxe-reverb')
  matches("Fender '68 Custom Deluxe Reverb 2-Channel 22-Watt 1x12\" Guitar Combo 2013 - Present - Black", 'fender-68-custom-deluxe-reverb')
  matches('Fender Deluxe Reverb (Drip Edge) 1968', 'fender-deluxe-reverb-vintage')
  matches('Fender Silverface deluxe reverb guitarforstærker med flight case.', 'fender-deluxe-reverb-vintage')
  matches("Fender '65 Deluxe Reverb Reissue 22-Watt 1x12\" Guitar Combo 1994 - Present - Black", 'fender-65-deluxe-reverb-reissue')
  matches('VINTAGE 1968 Fender Princeton Reverb "Silverface-Black Line-Drip Edge"  AA764', 'fender-princeton-reverb-vintage')
  matches("Fender '65 Princeton Reverb Reissue \"Lacquered Tweed\" FSR Limited Edition 12-Watt 1x12\" Guitar Combo", 'fender-65-princeton-reverb-reissue')
  matches('Fender Tone Master Princeton Reverb guitarforstærker', 'fender-tone-master-princeton-reverb')
  matches('Fender Blackface 1966 Super Reverb Amp guitarforstærker', 'fender-super-reverb')
  matches('Fender Super Reverb Silverface 1976 (USA) Master Volume med Pull Boost', 'fender-super-reverb')
})

test('the amp trade\'s extras and other makers\' amps are not the amp', () => {
  notMatched('Udgangs transformator 125A29AX til FENDER TWIN REVERB (radiorør)')
  notMatched('Fender Telecaster & Twin Reverb Authentic Vintage Poster "The High-Flying Mellow-Throated Telecaster"')
  notMatched('Rare “torpedo” Vintage Amber Amp Jewel Pilot Light Lens Mesa Boogie Rectifier Fender Twin Reverb')
  notMatched('guyatone twin reverb')
  notMatched('General Vintage Tone Custom aged cabinet for Fender ®️Deluxe reverb combo')
  notMatched('Safe Case ATA Case Fender 65 Deluxe Reverb Vintage Reissue')
  notMatched('Fromel ReCap Kit for Vintage Fender Twin Reverb, Pro Reverb, Super Reverb and Bandmaster')
  notMatched('Vintage Style Blackface Fender Twin, Super Reverb RCA Reverb Cables')
  notMatched('Fender 68 costum Vibrolux Reverb Amp')
  // A bundle keeps its extras: the case comes after the inclusion marker.
  matches('Fender Twin Reverb guitarforstærker m hardcase', 'fender-twin-reverb-vintage')
})

test('the Bassman row is the tweed 5F6, and the Boss pedal named for it is a pedal', () => {
  matches('Fender Bassman fra 1958', 'fender-bassman')
  notMatched("Boss FBM-1 Fender '59 Bassman 2007 - Present - Tan")
  matches('Fender 59 Bassman LTD', 'fender-59-bassman-ltd')
  notMatched('Fender Bassman 100')
  notMatched('Fender Bassman 135 Blackface')
  notMatched('Flightcase til Fender Bassman 100T – 100 W')
  notMatched('Fender Super Bassman  Silverface amp 70’')
})

test('the Blues Junior line and the 5E3 keep their editions apart', () => {
  matches('Fender Blues Junior, USA Made', 'fender-blues-junior')
  matches('Fender Blues Junior LTD guitarforstærker tweed', 'fender-blues-junior')
  matches('Fender Blues Junior III – Velholdt rørforstærker', 'fender-blues-junior-iii')
  matches('Fender Blues Junior IV guitarforstærker', 'fender-blues-junior-iv')
  notMatched('Udgangs transformator Fender blues junior, hot rod serie (radiorør) 004-9969-000')
  notMatched('Fender ’57 Customshop tweed Deluxe guitarforstærker')
  notMatched('Amp-N Custom 5E3 Deluxe')
})

test('the vintage AC30 needs its own cue, and the Korg-era lines are other members', () => {
  matches('VOX AC30 Top Boost 1967 Silver Bulldogs, TOP, Vintage', 'vox-ac30-vintage')
  matches('Vintage Vox AC-30. 3-Channel 2x12" Guitar Combo. Very rare.', 'vox-ac30-vintage')
  notMatched('Vox AC30 CH  gitarforsterker rør topp')
  notMatched('Vox AC30 Top Boost Vintage Edition 1992 - W/ Stand')
  notMatched('Vintage 1970s Vox Escort B2 battery practice amplifier mini AC30')
  notMatched('Vox Vintage Voltage selector 1960-64 AC30')
  notMatched('Vox Vintage JMI 1960\'s AC-30 Super Reverb Twin Logo #3')
})

test('the Marshalls: Plexi by alias, 2203 and 2204 apart, never a part, a kit or a reissue', () => {
  matches('1967 Marshall Superlead 100 plexi', 'marshall-super-lead-plexi')
  matches('Marshall JMP 1959 "EVH\'s 1968  Plexi Specs" + Mods...', 'marshall-super-lead-plexi')
  notMatched('K&E "Straight 8" Plexi')
  notMatched('Marshall SV20H Plexi Super Lead (1959)')
  notMatched('Marshall 1959 Overdrive Pedal super lead plexi')
  notMatched('Turret Board for Marshall Plexi / Super Lead 100W 1959 Kit guitar amplifier')
  matches('Marshall JCM800 2203 1987', 'marshall-jcm800-2203')
  matches('Marshall JCM 800 Lead Series Model 2203 100-Watt Master Volume Head 1981 - 1989 - Black', 'marshall-jcm800-2203')
  matches('Marshall JCM 800 2204 1982', 'marshall-jcm800-2204')
  // Owner decision 2026-10-14: a head sold with its cabinet is refused, before or after a marker; the price is the pair's.
  notMatched('Marshall Jcm800 Lead Series 2203 + Cassa 1960AX del 2002')
  notMatched('Marshall JCM 800 Lead Series Model 2204 50-Watt with 1982B 400W Cab')
  notMatched('Marshall JCM800 2203 m kabinet')
  notMatched('Marshall SC20H 20-Watt 2203 JCM800 Guitar Head - Open Box')
  notMatched('1983 Marshall JCM800 4104 2x12 combo (2204)')
  notMatched('New F&T Electrolytic Capacitor Set for Early 80s Marshall 100 watt JCM800 2203')
  notMatched('G&A TB for Marshall JCM800 2204 amplifier.')
  notMatched('Mojotone JCM 800 2204 Marshall Clone')
  // An unlabelled 2203 with a 2000s year is the reissue at the original's price and stays with the row.
  matches('Marshall JCM 800 Lead Series Model 2203 100-Watt Master Volume Head 1995 RED', 'marshall-jcm800-2203')
})

test('the Dual Rectifier, the 6505, the JC-120, the DR103, the SLO-100 and the SVT', () => {
  matches("Mesa Boogie Mesa Boogie Dual Rectifier Solo Head (3-Channel) Early 2000's - Factory", 'mesa-boogie-dual-rectifier')
  notMatched('Mesa Boogie Dual Rectifier Roadster 2x12" Combo – 50/100W – MINT / Fully Retubed')
  notMatched('Mesa Boogie Dual Rectifier KT88-KT66 Gold Pin Option JJ Retube(TM) Kit with GZ34')
  notMatched('Jessup mesa boogie dual rectifier red channel standalone pre amp')
  notMatched('Black Vinyl Cover for Peavey 5150, 5150 II, 6505, 6505+, or 6534+ Amplifier Head (peav001)')
  matches('Roland JC-120 Jazz Chorus 2-Channel 120-Watt 2x12" Guitar Combo 1975 - 1993 - Black', 'roland-jc-120')
  matches('Roland JC-120H Jazz Chorus 120-Watt Guitar Head', 'roland-jc-120h')
  notMatched('Studio Slips Roland JC-120 2x12 Combo #1742 Clamshell Gig Bag - Black')
  notMatched('Roland 50th Anniversary Limited Edition JC-120 Jazz Chorus Amp - 71/350 (Store Demo)')
  notMatched('Hiwatt SE 4123 Custom Shop vurderes solgt. 8 Ohm!')
  matches('Hiwatt DR-103 Custom 100 head 1974', 'hiwatt-dr103')
  matches('Soldano SLO 100 fra 1998 (Pre B.A.D.)', 'soldano-slo-100')
  matches('Soldano modded 1981 Marshall JCM800 2204 1981', 'marshall-jcm800-2204')
  matches('Ampeg SVT "Black Line" 300-Watt Bass Amp Head 1972 - 1975', 'ampeg-svt')
  matches('Ampeg SVT Mid 80’s / MTI era  - Black', 'ampeg-svt')
  notMatched('Ampeg SVT Classic 300 watt bass amp 2024\'ish - Black')
  notMatched('Ampeg SVT III Pro 450-Watt Hybrid Rackmount Bass Amp Head 1990s - Black')
  notMatched('1970s Ampeg SVT 8x10 Cabinet')
  notMatched('Ampeg SVT 4-PRO basforstærker i rack med tuner')
  notMatched('Ampeg SVT Tube DI Box')
  notMatched('Ampeg SVT 410 HEN/500 watts 8ohm')
})

test('panter\'s G1 dry run (2026-10-14): a harmonica, a guitar + amp bundle and the \'59 LTD are not the amp', () => {
  notMatched('Fender Blues Junior Harmonica with Necklace Lanyard, Key of A, 099-0701-203')
  notMatched('Fender Blues Junior Harmonica with Necklace Lanyard, Key of C, 099-0701-201')
  notMatched('Fender Blues Junior Harmonica with Necklace Lanyard, Key of G, 099-0701-202')
  notMatched('Fender  USA Stratocaster og Fender Blues Junior.')
  notMatched('Fender Telecaster Vinteras Roadworn + Fender blues junior förstärkare')
  // "og" alone is ordinary Danish, never a refusal (manager review, 2026-10-14); the bundle is refused by the guitar's name.
  assert.equal(lineBoundaryRefusal('Fender Twin Reverb 1966 flot og velholdt', 'fender-twin-reverb-vintage'), null)
  assert.equal(lineBoundaryRefusal('Fender Blues Junior III - god og billig', 'fender-blues-junior-iii'), null)
  // "i god stand" is the condition, not a stand; a stand sold alone still is one.
  assert.equal(lineBoundaryRefusal('Marshall JCM800 2203 100W top, lyder fantastisk og er i god stand', 'marshall-jcm800-2203'), null)
  assert.equal(lineBoundaryRefusal('Stand til Marshall JCM800 2203', 'marshall-jcm800-2203'), 'accessory:stand')
  // Round 2 gave the '59 LTD its own row, so the title the vintage row refuses is now that row's (owner, 2026-10-14).
  matches('FENDER BASSMAN 59 tweed', 'fender-59-bassman-ltd')
  notMatched('Fender Super Reverb 1966 with a new vibroverb cabinet and two baffles  1x15 & 2x10 (without speakers)')
  // The LTD / FSR finishes are the same amp and stay with their row.
  matches('2018 Fender Blues Junior - FSR Bordeaux Reserve -  Limited Edition', 'fender-blues-junior')
  matches('Fender - Blues Junior Ltd - Lacquered Tweed - 0213205700', 'fender-blues-junior')
  matches('Fender Blues Junior Texas Red Limited Edition **COLLECTION ONLY** - 2nd Hand', 'fender-blues-junior')
  matches('Fender   Blues Junior Iii Ltd. Sparkling Red', 'fender-blues-junior-iii')
  matches('Fender Blues Junior IV FSR Limited Edition "LA Vice" 15-Watt 1x12" Guitar Combo 2020 - Hot Pink / Seafoam Green', 'fender-blues-junior-iv')
  matches('New Fender Blues Junior IV 30th Anniversary', 'fender-blues-junior-iv')
  matches('Fender Blues Junior III with Speaker Upgrade', 'fender-blues-junior-iii')
  matches('Fender Super Reverb Silverface 1969', 'fender-super-reverb')
  matches('Fender Vibrolux Reverb Blackface (60s)', 'fender-vibrolux-reverb')
  matches('1956 Fender Deluxe 5E3 Amplifier Vintage Tweed', 'fender-5e3-tweed-deluxe')
})

test('the config names every promoted row and a line for each', () => {
  const slugs = new Set(PRODUCTS.map((p) => p.slug))
  for (const s of config.promoted) assert.ok(slugs.has(s), `${s} is in the test index`)
  assert.equal(new Set(config.promoted).size, 39, '27 from round 1 and the 12 reissue rows of round 2')
  assert.ok(!config.promoted.includes('roland-jc-120'), 'the JC-120 was supported by the owner, not by a PAN-261 promote file')
  assert.deepEqual(config.supportedToday, ['peavey-5150', 'roland-jc-120'])
  assert.ok(config.lines.some((l) => l.line === 'jc-120' && l.names.test('Roland JC-120 Jazz Chorus') && l.names.test('Roland JC120')), 'the JC-120 line')
  const ac30 = config.lines.find((l) => l.line === 'ac30')!
  for (const t of ['Vox AC30C2 guitarforstærker', 'Vox AC30CC2 Custom Classic', 'Vox AC-30C2X', 'Vox AC30 Top Boost 1967']) assert.ok(ac30.names.test(t), `${t} is in the ac30 cohort`)
  assert.ok(!ac30.names.test('Vox AC300 bass'), 'an AC300 is not')
  for (const l of config.lines) assert.ok(l.ilike.length > 0 && l.names instanceof RegExp)
})

test("round 2: the reissues with their own page take their titles and leave the originals' alone", () => {
  // Vox: the C2 and CC2 Custom lines, spelt glued, spaced or hyphenated; the X editions, the CC1 and the heads stay out.
  matches('Vox AC30C2 guitarforstærker', 'vox-ac30c2')
  matches('Vox AC30 C2 rørforstærker', 'vox-ac30c2')
  matches('Vox AC-30C2 Custom 2x12 combo', 'vox-ac30c2')
  matches('Vox AC30 Custom 2x12', 'vox-ac30c2')
  matches('Vox AC30CC2 Custom Classic', 'vox-ac30cc2')
  matches('Vox AC30 CC2 i god stand', 'vox-ac30cc2')
  matches('Vox AC30 Custom Classic 2x12', 'vox-ac30cc2')
  notMatched('Vox AC30C2X Blue Alnico')
  notMatched('Vox AC30CC2X Custom Classic Blue Alnico')
  notMatched('Vox AC30CC1 Custom Classic 1x12')
  notMatched('Vox AC30CH head')
  notMatched('Vox AC15 Custom Classic')
  matches('VOX AC30 Top Boost 1967 Silver Bulldogs, TOP, Vintage', 'vox-ac30-vintage')
  // Bassman: a two-digit "59", "LTD" or "reissue" is the LTD; a 1950s year written in full is the tweed original's.
  matches('FENDER BASSMAN 59 tweed', 'fender-59-bassman-ltd')
  matches("Fender '59 Bassman LTD Reissue 45-Watt 4x10\" Guitar Combo", 'fender-59-bassman-ltd')
  matches('Fender Bassman 1959 reissue', 'fender-59-bassman-ltd')
  matches('Fender Bassman fra 1958', 'fender-bassman')
  matches('Fender Bassman tweed 1959 original', 'fender-bassman')
  notMatched('Fender Bassman 100')
  // Marshall: the SLP and the HW each by its cue; a reissue with a 1990-on year is the SLP; the 35th Anniversary and a stack stay out.
  matches('Marshall 1959SLP Super Lead reissue', 'marshall-1959slp')
  matches('Marshall 1959 SLP 100W plexi', 'marshall-1959slp')
  // PAN-261 I2: a collectible lapel pin of the amp is not the amp.
  notMatched('Future Primitive Marshall 1959 SLP Plexi Amplifier Head Collectible Lapel Pin w/ Original Card')
  matches('Marshall 1959 Super Lead plexi reissue 2008', 'marshall-1959slp')
  matches('Marshall 1959HW Handwired JMP Reissue 2-Channel 100-Watt Guitar Amp Head', 'marshall-1959hw')
  matches('Marshall 1959 HW hand wired plexi', 'marshall-1959hw')
  matches('1967 Marshall Superlead 100 plexi', 'marshall-super-lead-plexi')
  notMatched('Marshall 1959SLP 35th Anniversary')
  notMatched('Marshall 1959SLP + 1960AX cab')
  notMatched('Marshall SV20H Plexi Super Lead (1959)')
  // Soldano: "Custom Shop" or a 2019-on year is the Custom Shop head; a 1987–2018 year is the original's.
  matches('Soldano SLO-100 Custom Shop 2-Channel 100-Watt Guitar Amp Head', 'soldano-slo-100-custom-shop')
  matches('Soldano SLO-100 2022 head', 'soldano-slo-100-custom-shop')
  matches('Soldano SLO 100 fra 1998 (Pre B.A.D.)', 'soldano-slo-100')
  matches('Soldano SLO 100', 'soldano-slo-100')
  notMatched('Soldano SLO-100 Custom Shop half stack')
  // Peavey: the 6505+ (also "6505 Plus" and "6505 +") and the 6505 II; the base, the combo and the cabinet stay apart.
  matches('Peavey 6505+ 2-Channel 120-Watt Guitar Amp Head', 'peavey-6505-plus')
  matches('Peavey 6505 Plus head', 'peavey-6505-plus')
  matches('Peavey 6505 + topteil', 'peavey-6505-plus')
  matches('Peavey 6505 II head 2023', 'peavey-6505-ii')
  matches('Peavey 6505II', 'peavey-6505-ii')
  matches('Peavey 6505 2-Channel 120-Watt Guitar Amp Head', 'peavey-6505')
  notMatched('Peavey 6505+ 112 combo')
  notMatched('Peavey 6505 II 4x12 cabinet')
  notMatched('Peavey 5150 II')
  // Fender: the Tone Master Super Reverb and the '68 Customs, including Reverb's "Reverb-Amp" spelling.
  matches('Fender Tone Master Super Reverb 2-Channel 45-Watt 4x10\" Digital Guitar Combo', 'fender-tone-master-super-reverb')
  matches('Fender tonemaster super reverb', 'fender-tone-master-super-reverb')
  matches('Fender Blackface 1966 Super Reverb Amp guitarforstærker', 'fender-super-reverb')
  matches("Fender '68 Custom Twin Reverb-Amp 2-Channel 85-Watt 2x12\" Guitar Combo", 'fender-68-custom-twin-reverb')
  matches('Fender 68 Custom Twin Reverb', 'fender-68-custom-twin-reverb')
  matches('Fender ’68 Custom Princeton Reverb', 'fender-68-custom-princeton-reverb')
  matches("Fender '68 Custom Vibrolux Reverb-Amp 2-Channel 35-Watt 2x10\" Guitar Combo", 'fender-68-custom-vibrolux-reverb')
  matches('Fender Vibrolux Reverb 1966', 'fender-vibrolux-reverb')
  matches('Fender 65 Twin Reverb guitarforstærker', 'fender-65-twin-reverb-reissue')
  // A drip-edge or silverface title that writes the year as "68" is the original, never a '68 Custom.
  notMatched('Fender Princeton Reverb 68 silverface drip edge')
  notMatched('Fender Deluxe Reverb 68 silverface drip edge')
})


test('Danish "m" / "m." is "med": an inclusion marker, except after a number (owner decision 2026-10-14)', () => {
  matches('Fender Twin Reverb m cover', 'fender-twin-reverb-vintage')
  matches('Fender Twin Reverb guitarforstærker m. cover og footswitch', 'fender-twin-reverb-vintage')
  matches('Roland JC-120 Jazz Chorus 2x12 m cover', 'roland-jc-120')
  assert.equal(earliestInclusionMarker('fender twin reverb m cover'), 19)
  // A bare "m" after a number is a metre, and a glued letter is a model code: neither suppresses the noun that follows.
  matches('Fender Twin Reverb 1966 m cover', 'fender-twin-reverb-vintage')
  assert.equal(earliestInclusionMarker('4 m kabel'), -1)
  assert.equal(earliestInclusionMarker('10m kabel'), -1)
  assert.equal(earliestInclusionMarker('korg m1 cover'), -1)
  assert.equal(earliestInclusionMarker('korg m1 m. cover'), 8)
  assert.equal(lineBoundaryRefusal('fender twin reverb 4 m cable', 'fender-twin-reverb-vintage'), 'accessory:cable')
  assert.equal(lineBoundaryRefusal('fender twin reverb 4 m. cable', 'fender-twin-reverb-vintage'), 'accessory:cable')
  // An accessory with no marker is still refused.
  notMatched('Vox Vintage Voltage selector 1960-64 AC30')
  notMatched('Udgangs transformator 125A29AX til FENDER TWIN REVERB (radiorør)')
})

test("panter's I1 (2026-10-15): accessories named after the model's own cue, a part sold for a reissue, a speaker by its spec", () => {
  // The 6505+'s "plus" / "+" is its name, not an inclusion marker: covers and a footswitch are refused, the heads stay.
  notMatched('Peavey 6505 plus  Amp Cover - Black leatherette - 2010s')
  notMatched('Peavey 03582650 6505+ 3-Button Footswitch 2010s - Black')
  matches('Peavey 6505+ 120-Watt 2-Channel Guitar Amp Head', 'peavey-6505-plus')
  matches('Peavey 6505+ 2-Channel 120-Watt Guitar Amp Head 2005 - 2022', 'peavey-6505-plus')
  matches('Peavey 6505+ USA Head W/ New Footswitch!', 'peavey-6505-plus')
  notMatched('Peavey 6505 Amp Cover')
  notMatched('Peavey 6505 II amp cover black')
  // "for Fender '68 Custom …": the reissue year's apostrophe no longer hides the model from the "for" rule.
  notMatched('"Always On" Plug (TM) for Fender \'68 Custom Vibrolux Reverb Reissue')
  notMatched("Footswitch for Fender '65 Deluxe Reverb Reissue")
  // A replacement speaker sold by its spec, and a cover maker's tagline.
  notMatched('Roland 12" 16 ohm 30-105A JC-120H')
  matches('Roland JC-120H Jazz Chorus 120-Watt Guitar Head 1984 - 1990', 'roland-jc-120h')
  notMatched('Fender Tone Master Super Reverb Guitar Amplifiers | Ultimate Amp Protection Made in the U.S.A.')
})
