import type { IconName } from '@/components/Icon'

/**
 * The glyph a product shows where it has no image (PAN-281): one per root
 * of the music catalogue, and one per kind where the root's glyph would say
 * the wrong thing. The tree the sidebar and /browse read is the authority
 * for which roots and kinds exist; this map only names their glyphs.
 *
 * Lookup: the kind first, then the root, then the neutral note. A kind is
 * the bare slug the catalogue shows — a group (`synthesizers`) or a leaf
 * (`trumpets`); a full `root/leaf` slug is accepted too, by its last
 * segment. Where no glyph is clearly right the root's stands, and where
 * even that would mislead (a drum machine is not a keyboard) the kind is
 * listed as the note rather than another glyph pressed into service.
 *
 * Nothing here is a scraper or matcher selector — a placeholder says what
 * kind of thing is missing a photo, nothing more.
 */
const BY_ROOT: Readonly<Record<string, IconName>> = {
  'acoustic-guitars': 'guitar',
  amps: 'amp',
  'band-and-orchestra': 'brass',
  'bass-guitars': 'clef_bass',
  'dj-and-lighting-gear': 'turntable',
  'drums-and-percussion': 'drum',
  'effects-and-pedals': 'pedal',
  'electric-guitars': 'guitar_electric',
  'folk-instruments': 'music_note',
  'home-audio': 'speaker',
  'keyboards-and-synths': 'keyboard_music',
  'pro-audio': 'sliders_horizontal',
}

const BY_KIND: Readonly<Record<string, IconName>> = {
  'closed-back-headphones': 'headphones',
  'drum-machines': 'music_note',
  'electric-pianos': 'piano',
  grooveboxes: 'music_note',
  microphones: 'microphone',
  mixers: 'sliders_vertical',
  samplers: 'music_note',
  sequencers: 'music_note',
  'studio-headphones': 'headphones',
  'studio-monitors': 'speaker',
}

const last = (slug: string | null | undefined) => (slug ?? '').split('/').pop() ?? ''

export function placeholderIcon(root?: string | null, kind?: string | null): IconName {
  return BY_KIND[last(kind)] ?? BY_ROOT[last(root)] ?? 'music_note'
}
