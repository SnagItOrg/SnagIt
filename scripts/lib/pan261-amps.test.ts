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
  notMatched('Fender 59 Bassman LTD')
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
  matches('Marshall Jcm800 Lead Series 2203 + Cassa 1960AX del 2002', 'marshall-jcm800-2203')
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
  notMatched('FENDER BASSMAN 59 tweed')
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
  assert.equal(new Set(config.promoted).size, 27)
  assert.ok(!config.promoted.includes('roland-jc-120'), 'the clean-marked JC-120 waits for the owner')
  assert.deepEqual(config.supportedToday, ['peavey-5150'])
  for (const l of config.lines) assert.ok(l.ilike.length > 0 && l.names instanceof RegExp)
})
