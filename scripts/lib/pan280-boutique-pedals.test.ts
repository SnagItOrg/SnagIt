/**
 * scripts/lib/pan280-boutique-pedals.test.ts
 *
 * PAN-280: boutique pedals. Sixty-eight rows become match targets (25 Strymon, 41 EarthQuaker Devices, 2 Hologram
 * Electronics; 3 of the Strymon rows existed as `known` and are anchored to their Reverb page, the rest created
 * 2026-10-20 with a verified Reverb page each). The boundaries are measured on the pedal titles live on DBA, Finn,
 * Blocket and Reverb that day: a pedal's model word plus its brand is the whole identity; the MX generation of a
 * Strymon is its own row and a V1 / V2 refresh is the same row; a power supply, a Decksaver, a key chain, the
 * maker's plug-in and a Eurorack module are not the pedal; "Earthquaker" and "EQD" name EarthQuaker Devices and
 * "Hologram" names Hologram Electronics; and a Blocket "Earthquake" subwoofer or a Finn "hologram" novelty names no
 * row. Every title is a production title unless marked synthetic.
 *
 * Run: npx tsx --test scripts/lib/pan280-boutique-pedals.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import { makerNamed } from '../../frontend/lib/matching/brand-guard'
import config from '../rematch-configs/pan280-boutique-pedals'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})

/** Every row the PAN-280 files make a match target, with the model names the create / identity files set. */
const PRODUCTS: Product[] = [
  row('strymon-big-sky', 'strymon', 'Strymon Big Sky', 'Big Sky'),
  row('strymon-nightsky', 'strymon', 'Strymon Nightsky', 'Nightsky'),
  row('strymon-timeline', 'strymon', 'Strymon TimeLine', 'TimeLine'),
  row('strymon-bigsky-mx', 'strymon', 'Strymon BigSky MX', 'BigSky MX'),
  row('strymon-timeline-mx', 'strymon', 'Strymon TimeLine MX', 'TimeLine MX'),
  row('strymon-volante', 'strymon', 'Strymon Volante', 'Volante'),
  row('strymon-iridium', 'strymon', 'Strymon Iridium', 'Iridium'),
  row('strymon-mobius', 'strymon', 'Strymon Mobius', 'Mobius'),
  row('strymon-el-capistan', 'strymon', 'Strymon El Capistan', 'El Capistan'),
  row('strymon-flint', 'strymon', 'Strymon Flint', 'Flint'),
  row('strymon-deco', 'strymon', 'Strymon Deco', 'Deco'),
  row('strymon-dig', 'strymon', 'Strymon DIG', 'DIG'),
  row('strymon-bluesky', 'strymon', 'Strymon blueSky', 'blueSky'),
  row('strymon-lex', 'strymon', 'Strymon Lex', 'Lex'),
  row('strymon-ola', 'strymon', 'Strymon Ola', 'Ola'),
  row('strymon-brigadier', 'strymon', 'Strymon Brigadier', 'Brigadier'),
  row('strymon-orbit', 'strymon', 'Strymon Orbit', 'Orbit'),
  row('strymon-riverside', 'strymon', 'Strymon Riverside', 'Riverside'),
  row('strymon-sunset', 'strymon', 'Strymon Sunset', 'Sunset'),
  row('strymon-compadre', 'strymon', 'Strymon Compadre', 'Compadre'),
  row('strymon-cloudburst', 'strymon', 'Strymon Cloudburst', 'Cloudburst'),
  row('strymon-zelzah', 'strymon', 'Strymon Zelzah', 'Zelzah'),
  row('strymon-ultraviolet', 'strymon', 'Strymon UltraViolet', 'UltraViolet'),
  row('strymon-ob-1', 'strymon', 'Strymon OB.1', 'OB.1'),
  row('strymon-fairfax', 'strymon', 'Strymon Fairfax', 'Fairfax'),
  ...[
    ['plumes', 'Plumes'], ['life-pedal', 'Life Pedal'], ['avalanche-run', 'Avalanche Run'], ['rainbow-machine', 'Rainbow Machine'],
    ['afterneath', 'Afterneath'], ['dispatch-master', 'Dispatch Master'], ['hoof', 'Hoof'], ['hoof-reaper', 'Hoof Reaper'],
    ['hizumitas', 'Hizumitas'], ['pyramids', 'Pyramids'], ['westwood', 'Westwood'], ['palisades', 'Palisades'],
    ['ghost-echo', 'Ghost Echo'], ['spatial-delivery', 'Spatial Delivery'], ['bit-commander', 'Bit Commander'],
    ['data-corrupter', 'Data Corrupter'], ['sea-machine', 'Sea Machine'], ['grand-orbiter', 'Grand Orbiter'],
    ['arpanoid', 'Arpanoid'], ['organizer', 'Organizer'], ['special-cranker', 'Special Cranker'], ['arrows', 'Arrows'],
    ['astral-destiny', 'Astral Destiny'], ['silos', 'Silos'], ['aurelius', 'Aurelius'], ['the-warden', 'Warden'],
    ['zoar', 'Zoar'], ['blumes', 'Blumes'], ['park-fuzz', 'Park Fuzz'], ['erupter', 'Erupter'], ['acapulco-gold', 'Acapulco Gold'],
    ['tone-job', 'Tone Job'], ['hummingbird', 'Hummingbird'], ['swiss-things', 'Swiss Things'], ['talons', 'Talons'],
    ['aqueduct', 'Aqueduct'], ['bellows', 'Bellows'], ['dirt-transmitter', 'Dirt Transmitter'], ['the-depths', 'Depths'],
    ['fuzz-master-general', 'Fuzz Master General'], ['levitation', 'Levitation'],
  ].map(([s, m]) => row(`earthquaker-devices-${s}`, 'earthquaker devices', `EarthQuaker Devices ${m}`, m)),
  row('hologram-electronics-microcosm', 'hologram electronics', 'Hologram Electronics Microcosm', 'Microcosm'),
  row('hologram-electronics-chroma-console', 'hologram electronics', 'Hologram Electronics Chroma Console', 'Chroma Console'),
  // Brand protection: a supported row a pedal title could stray onto.
  row('boss-ds-1', 'boss', 'Boss DS-1', 'DS-1'),
]
/** The identifiers the PAN-280 identity file writes: the split and glued spellings of the two Strymon lines. */
const IDENTS = [
  ['strymon-big-sky', 'BigSky'], ['strymon-bigsky-mx', 'Big Sky MX'], ['strymon-timeline', 'Time Line'], ['strymon-timeline-mx', 'Time Line MX'],
].map(([slug, value]) => ({ product_id: `p-${slug}`, type: 'MODEL', value }))
/** The alias production holds on strymon-big-sky since 2026-09-02. */
const SYNONYMS = [{ alias: 'Big Sky Reverb', canonical_query: 'strymon-big-sky' }]

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

test('every promoted row has a boundary, the config lists 68 rows and the identity file writes 4 identifiers', () => {
  assert.equal(config.promoted.length, 68)
  for (const slug of config.promoted) assert.ok(LINE_BOUNDARIES[slug], `${slug} has no LINE_BOUNDARIES entry`)
  assert.equal(new Set(config.promoted).size, 68)
  assert.equal(IDENTS.length, 4)
})

test('a Strymon pedal is its model word in every spelling the market writes', () => {
  matches('Strymon BigSky reverb pedal', 'strymon-big-sky')
  matches('Strymon Big Sky Reverb 2013 - Present - Blue', 'strymon-big-sky')
  matches('Strymon Big Sky Mk1', 'strymon-big-sky')
  matches('Strymon BigSky Reverberator', 'strymon-big-sky')
  matches('Strymon Timeline delay', 'strymon-timeline')
  matches('STRYMON TIME LINE', 'strymon-timeline')
  matches('Strymon TimeLine Delay 2011 - Present - Silver', 'strymon-timeline')
  matches('Strymon NightSky Time-Warped Reverberator 2020 - Present - Blue', 'strymon-nightsky')
  matches('Strymon Nightsky reverbpedal för elgitarr/synth', 'strymon-nightsky')
  matches('Strymon Volante - Echo/Delay Guitarpedal/effektpedal', 'strymon-volante')
  matches('Strymon Iridium amp & cab simulator pedal', 'strymon-iridium')
  matches('Strymon Mobius Modulation – absolut nyskick + kablar', 'strymon-mobius')
  matches('Strymon Ola', 'strymon-ola')
  matches('Strymon Orbit Flanger', 'strymon-orbit')
  matches('Strymon Compadre kompressor och boost', 'strymon-compadre')
  matches('Strymon Cloudburst Reverb - 40% RABAT fra nypris.', 'strymon-cloudburst')
  matches('Strymon OB.1 (Kompressor og Boost)', 'strymon-ob-1')
  matches('Strymon Fairfax', 'strymon-fairfax')
  matches('SOLGT Strymon Brigadier', 'strymon-brigadier')
  // Reverb's "Night Sky" and Finn's "OB-1" are spellings the row cannot read without a brand-free identifier, which a
  // colour name ("Night Sky") or another maker's model (Oberheim OB-1) could claim: recall cost accepted, no row is wrong.
  notMatched('Strymon Night Sky Reverb')
  notMatched('Strymon OB-1 optical compressor')
  // No brand, no row (DBA "Blue Sky - perfekt stand" names Strymon only in its description).
  notMatched('Blue Sky - perfekt stand')
})

test('the MX generation is its own Strymon row, a V1 / V2 refresh is the same row, and a TimeLine II names no row', () => {
  matches('Strymon Big Sky MX', 'strymon-bigsky-mx')
  matches('STRYMON BIGSKY MX : BRAND NEW :  [DETROIT MODULAR]', 'strymon-bigsky-mx')
  matches('Strymon   Big Sky Mx Reverb', 'strymon-bigsky-mx')
  matches('Strymon Big Sky MX Reverb Workstation', 'strymon-bigsky-mx')
  // A dash glued to "MX" hides the model word from the MX row, but it must not make the title the original (forecast
  // 2026-10-20): recall cost accepted, no row is wrong.
  assert.notEqual(decide('Strymon Big Sky MX- New!'), 'strymon-big-sky')
  matches('Strymon TimeLine MX Delay 2026 - Present - Grey', 'strymon-timeline-mx')
  matches('Used Strymon Timeline MX Delay', 'strymon-timeline-mx')
  matches('Strymon Time Line MX', 'strymon-timeline-mx')
  notMatched('Strymon TimeLine II Multi Delay')
  notMatched('Strymon Timeline V2')
  matches('Strymon El Capistan dTape Echo effektpedal', 'strymon-el-capistan')
  matches('Strymon El Capistan V1 + Favorite Switch säljes', 'strymon-el-capistan')
  matches('Strymon Flint v.1', 'strymon-flint')
  matches('Strymon DIG V2 dual digital delay', 'strymon-dig')
  matches('Strymon Deco guitar effektpedal', 'strymon-deco')
  matches('Strymon blueSky reverb guitar pedal blå', 'strymon-bluesky')
  matches('Strymon BlueSky V1', 'strymon-bluesky')
})

test("the pedal trade's extras, the maker's plug-in and a wanted ad are not the pedal; a bundle keeps its extras", () => {
  notMatched('Strymon strømforsyning - 9V DC center negativ, 660 mA')
  notMatched('Strymon Zuma + Mounting Kit / power supply til pedaler')
  notMatched('Strymon Zuma R300')
  notMatched('Strymon Starlab svart')
  notMatched('Decksaver Strymon Timeline/Big Sky/Mobius Staubschutzcover')
  notMatched('Strymon Big Sky Key Chain')
  notMatched('Replacement for Boss 9V PSA Adapter Guitar Pedal Power Supply, 9V 1000mA 6-10ft Power Cord for Boss DS-1,BD-2,DD-7,RV-6,DD-500... for MXR EHX TC Electronic Strymon and More. (10FT)')
  notMatched('Strymon MultiSwitch och MiniSwitch fotkontroller')
  notMatched('Strymon BigSky Plugin')          // synthetic
  notMatched('Strymon Timeline Decksaver')    // synthetic
  notMatched('SØGES: Strymon Deco V1')
  notMatched('Strymon og J. Rockett The Dude V2')
  matches('Strymon TimeLine Delay With Multi Switch', 'strymon-timeline')
  matches('Strymon TimeLine Delay 2011 - Present - Silver - incl. Ext Pedal', 'strymon-timeline')
  matches('Strymon Timeline incl. 1x Cordial CCFI 3 PP - Bundle Set', 'strymon-timeline')
  matches('Strymon TimeLine + American Loopers Clickless Strymon', 'strymon-timeline')
  notMatched('Strymon Zuma med Pedaltrain mounting kit')
})

test('"Earthquaker" and "EQD" name EarthQuaker Devices; a model word is the row, a generation is the same row', () => {
  assert.ok(makerNamed('earthquaker dispatch master', 'earthquaker devices'))
  assert.ok(makerNamed('eqd plumes', 'earthquaker devices'))
  assert.ok(makerNamed('hologram microcosm', 'hologram electronics'))
  matches('EarthQuaker Devices Plumes guitarpedal overdrive', 'earthquaker-devices-plumes')
  matches('EarthQuaker Devices Devices Plumes Signal Shredder', 'earthquaker-devices-plumes')
  matches('EQD Plumes', 'earthquaker-devices-plumes')  // synthetic
  matches('Earthquaker Dispatch Master', 'earthquaker-devices-dispatch-master')
  matches('Earthquaker Devices Life Pedal V2', 'earthquaker-devices-life-pedal')
  matches('EarthQuaker Devices sunn O))) Life Pedal Octave Distortion + Booster V3', 'earthquaker-devices-life-pedal')
  matches('EarthQuaker Devices Afterneath Otherworldly Reverberation Machine V3', 'earthquaker-devices-afterneath')
  matches('EarthQuaker Devices Arpanoid V2', 'earthquaker-devices-arpanoid')
  matches('EarthQuaker Devices Grand Orbiter phaser & vibrato', 'earthquaker-devices-grand-orbiter')
  matches('Earthquaker Devices Bellows Fuzz Driver', 'earthquaker-devices-bellows')
  matches('EarthQuaker Devices Tone Job EQ', 'earthquaker-devices-tone-job')
  matches('Earthquaker Devices Zoar', 'earthquaker-devices-zoar')
  matches('EarthQuaker Devices Palisades overdrive pedal hvid', 'earthquaker-devices-palisades')
  matches('EarthQuaker Devices Levitation Reverb V2', 'earthquaker-devices-levitation')
  matches('Earthquaker Devices The Depths', 'earthquaker-devices-the-depths')
  matches('EarthQuaker Devices Warden Optical Compressor V2', 'earthquaker-devices-the-warden')
  matches('EarthQuaker Devices Special Cranker', 'earthquaker-devices-special-cranker')
  matches('EarthQuaker Devices Blumes Low Signal Shredder', 'earthquaker-devices-blumes')
  matches('EarthQuaker Devices Astral Destiny', 'earthquaker-devices-astral-destiny')
  matches('Earthquaker Devices Aqueduct', 'earthquaker-devices-aqueduct')
})

test('the Hoof line, the Eurorack module, the collaboration row and the models Klup does not hold', () => {
  matches('EarthQuaker Devices Hoof Hybrid Fuzz V2', 'earthquaker-devices-hoof')
  matches('Earthquaker Devices Hoof Reaper', 'earthquaker-devices-hoof-reaper')
  matches('EarthQuaker Devices Hoof Reaper Double Fuzz with Octave Up V2', 'earthquaker-devices-hoof-reaper')
  notMatched('EarthQuaker Devices Cloven Hoof Fuzz Grinder V2')
  notMatched('EarthQuaker Devices Afterneath Reverb Eurorack Module')
  notMatched('EarthQuaker Devices Speaker Cranker Overdrive')
  notMatched('EarthQuaker Devices / Death By Audio Time Shadows II Subharmonic Multi-Delay Resonator')
  notMatched('EarthQuaker Devices Dr.Z ZEQD Preamp')
  notMatched('Earthquaker devices Towers Reverb stereo modulator guitar pedal effect pedal')
  // Blocket's "earthquaker" search returns subwoofers and trading cards; none names a row.
  notMatched('Earthquake MiniMe P10 aktiv subwoofer')
  notMatched('Pokémonkort Tyranitar Pokémon GO Raging Crash/Earthquake')
})

test('Hologram Electronics: the two rows, the short brand form, and the novelties a "hologram" search returns', () => {
  matches('Chroma Console - Hologram Electronics', 'hologram-electronics-chroma-console')
  matches('Hologram Electronics Microcosm', 'hologram-electronics-microcosm')
  matches('Hologram Microcosm', 'hologram-electronics-microcosm')  // synthetic
  notMatched('Hologram Electronics Dream Sequence')
  notMatched('Nya Holoswim 2 PRO AR Smart Swim Hologram Goggles smarta simglasögon oöppnad')
  notMatched('National Geographic Afganistan girl + holograms')
})
