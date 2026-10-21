import type { ComponentType, CSSProperties, ReactNode, SVGProps } from 'react'
import {
  ArchiveBoxXMarkIcon,
  ArrowDownRightIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpRightIcon,
  Bars2Icon,
  Bars3Icon,
  BellAlertIcon,
  BellIcon,
  BookmarkIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentMagnifyingGlassIcon,
  EllipsisVerticalIcon,
  EnvelopeOpenIcon,
  ExclamationCircleIcon,
  EyeIcon,
  GlobeEuropeAfricaIcon,
  LightBulbIcon,
  LinkIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  PaperAirplaneIcon,
  PencilIcon,
  PhotoIcon,
  PlusCircleIcon,
  PresentationChartLineIcon,
  QuestionMarkCircleIcon,
  RectangleGroupIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Square3Stack3DIcon,
  Squares2X2Icon,
  TagIcon,
  TrashIcon,
  TrophyIcon,
  UserCircleIcon,
  UsersIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import {
  ArchiveBoxXMarkIcon as ArchiveBoxXMarkSolid,
  BellIcon as BellSolid,
  DocumentMagnifyingGlassIcon as DocumentMagnifyingGlassSolid,
  LightBulbIcon as LightBulbSolid,
  LinkIcon as LinkSolid,
  PhotoIcon as PhotoSolid,
  PresentationChartLineIcon as PresentationChartLineSolid,
  RectangleGroupIcon as RectangleGroupSolid,
  SparklesIcon as SparklesSolid,
  Squares2X2Icon as Squares2X2Solid,
  TagIcon as TagSolid,
  TrophyIcon as TrophySolid,
  UsersIcon as UsersSolid,
} from '@heroicons/react/24/solid'

type Glyph = ComponentType<Omit<SVGProps<SVGSVGElement>, 'ref'>>

/*
 * One glyph stays Material Symbols, as inline SVG rather than the font:
 * `radar` is the Klup logo mark (the brand does not change with the icon
 * set). Path copied verbatim from google/material-design-icons @ 49d4db35,
 * symbols/web/radar/materialsymbolsoutlined/radar_24px.svg.
 * Copyright Google LLC, licensed under the Apache License 2.0
 * (https://www.apache.org/licenses/LICENSE-2.0).
 */
function materialGlyph(d: string): Glyph {
  return function MaterialGlyph(props) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" {...props}>
        <path d={d} />
      </svg>
    )
  }
}

const RadarIcon = materialGlyph(
  'M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q56 0 105.5-17.5T676-227l-57-57q-29 21-64.5 32.5T480-240q-100 0-170-70t-70-170q0-100 70-170t170-70q100 0 170 70t70 170q0 39-12 75t-33 65l57 57q32-41 50-91t18-106q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-160q22 0 42.5-5.5T561-342l-61-61q-5 2-10 2.5t-10 .5q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 6-.5 11.5T557-458l60 60q11-18 17-38.5t6-43.5q0-66-47-113t-113-47q-66 0-113 47t-47 113q0 66 47 113t113 47Z',
)

/*
 * THE INSTRUMENT GLYPHS (PAN-281) are inline SVG in Heroicons' outline
 * contract — 24×24, `fill="none"`, stroke 1.5, round caps and joins,
 * `currentColor`. Heroicons draws no instrument, so the artwork comes from
 * Lucide, the set Astryx's own themes draw with (facebook/astryx
 * packages/themes/neutral depends on lucide-react, read at caf5673,
 * 2026-10-20), and three glyphs Lucide lacks are Klup's own in the same
 * contract — which is how Astryx adds a glyph it cannot source:
 * packages/core/src/Icon/defaultIcons.tsx:29-40 declares that exact svg
 * contract for its hand-drawn fallbacks. Lucide draws at stroke 2; every
 * instrument glyph here renders at 1.5 so it weighs the same as the Heroicons
 * beside it. Outline only: no caller asks for `filled`.
 *
 * Lucide bodies copied verbatim from lucide-icons/lucide @ c29c276f
 * (v1.60.0, 2026-10-20), icons/<name>.svg, named per glyph. ISC License,
 * Copyright (c) 2026 Lucide Icons and Contributors. Permission to use, copy,
 * modify, and/or distribute this software for any purpose with or without
 * fee is hereby granted, provided that the above copyright notice and this
 * permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS"
 * AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE
 * INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO
 * EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR
 * CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE,
 * DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
 * TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE. `headphones` is one of the Lucide icons
 * derived from Feather — The MIT License (MIT), Copyright (c) 2013-present
 * Cole Bemis; the full text is in that repository's LICENSE.
 */
function outlineGlyph(body: ReactNode): Glyph {
  return function OutlineGlyph(props) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        {body}
      </svg>
    )
  }
}

// Lucide, verbatim (icons/<name>.svg).
const GuitarIcon = outlineGlyph(<><path d="m11.9 12.1 4.514-4.514"/><path d="M20.1 2.3a1 1 0 0 0-1.4 0l-1.114 1.114A2 2 0 0 0 17 4.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 17.828 7h1.344a2 2 0 0 0 1.414-.586L21.7 5.3a1 1 0 0 0 0-1.4z"/><path d="m6 16 2 2"/><path d="M8.23 9.85A3 3 0 0 1 11 8a5 5 0 0 1 5 5 3 3 0 0 1-1.85 2.77l-.92.38A2 2 0 0 0 12 18a4 4 0 0 1-4 4 6 6 0 0 1-6-6 4 4 0 0 1 4-4 2 2 0 0 0 1.85-1.23z"/></>) // guitar
const GuitarElectricIcon = outlineGlyph(<><path d="m12.172 11.828 4.242-4.242"/><path d="M16.414 7.586A2 2 0 0017 6.172V5a2 2 0 011.177-1.823L20.59 2.09a1 1 0 011.32 1.32l-1.088 2.412A2 2 0 0119 7h-1a2 2 0 00-1.586.586"/><path d="m6 16 2 2"/><path d="M8.23 9.85a3 3 0 011.28-1.454 1 1 0 011.496.815 4 4 0 003.783 3.783 1 1 0 01.815 1.496 3 3 0 01-1.454 1.28l-.92.38A2 2 0 0012 18a4 4 0 01-4 4 6 6 0 01-6-6 4 4 0 014-4 2 2 0 001.85-1.23z"/></>) // guitar-electric
const ClefBassIcon = outlineGlyph(<><path d="M19 11h.01"/><path d="M19 6h.01"/><path d="M5 8c0-4 4-4 4-4 6 0 6 6 6 6 0 7-10 11-10 11"/><circle cx="7" cy="8" r="2"/></>) // clef-bass
const KeyboardMusicIcon = outlineGlyph(<><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h4"/><path d="M14 8h.01"/><path d="M18 8h.01"/><path d="M2 12h20"/><path d="M6 12v4"/><path d="M10 12v4"/><path d="M14 12v4"/><path d="M18 12v4"/></>) // keyboard-music
const PianoIcon = outlineGlyph(<><path d="M10 13v4"/><path d="M14 13v4"/><path d="M18 13v4"/><path d="M2 13h20"/><path d="M22 11.5A3.5 3.5 0 0018.5 8a3.52 3.52 0 01-3.173-2A7 7 0 002 9v10a2 2 0 002 2h16a2 2 0 002-2z"/><path d="M6 13v4"/></>) // piano
const MusicNoteIcon = outlineGlyph(<><path d="m19 6-5.2-3.9a.5.5 0 0 0-.8.4V18"/><circle cx="9" cy="18" r="4"/></>) // eighth-note
const DrumIcon = outlineGlyph(<><path d="m2 2 8 8"/><path d="m22 2-8 8"/><ellipse cx="12" cy="9" rx="10" ry="5"/><path d="M7 13.4v7.9"/><path d="M12 14v8"/><path d="M17 13.4v7.9"/><path d="M2 9v8a10 5 0 0 0 20 0V9"/></>) // drum
const MicIcon = outlineGlyph(<><path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/></>) // mic
const SpeakerIcon = outlineGlyph(<><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 6h.01"/><circle cx="12" cy="14" r="4"/><path d="M12 14h.01"/></>) // speaker
const SlidersHorizontalIcon = outlineGlyph(<><path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/></>) // sliders-horizontal
const SlidersVerticalIcon = outlineGlyph(<><path d="M10 8h4"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M17 16h4"/><path d="M19 12V3"/><path d="M19 21v-5"/><path d="M3 14h4"/><path d="M5 10V3"/><path d="M5 21v-7"/></>) // sliders-vertical
const HeadphonesIcon = outlineGlyph(<><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></>) // headphones
const TurntableIcon = outlineGlyph(<><path d="M10 12.01h.01"/><path d="M18 8v4a8 8 0 0 1-1.07 4"/><circle cx="10" cy="12" r="4"/><rect x="2" y="4" width="20" height="16" rx="2"/></>) // turntable

// Klup's own, where Lucide has nothing: a trumpet (mouthpiece, leadpipe,
// three valves, slide loop, bell), a combo amp (knob strip over a speaker)
// and a stompbox (two knobs, LED, footswitch). Drawn 2026-10-20.
const BrassIcon = outlineGlyph(<path d="M2.25 12h12M2.25 10.5v3M8.25 7.5v8.25M11.25 7.5v8.25M14.25 7.5v8.25M5.25 12v2.25a1.5 1.5 0 0 0 1.5 1.5h8.25a1.5 1.5 0 0 0 1.5-1.5v-1.5M14.25 12c2.75 0 5-1.5 7.5-4.5v9c-2.5-3-4.75-4.5-7.5-4.5"/>)
const AmpIcon = outlineGlyph(<><rect x="2" y="5" width="20" height="15" rx="2"/><path d="M2 10h20"/><path d="M7 7.5h.01M11 7.5h.01M15 7.5h.01"/><circle cx="12" cy="15" r="2.5"/></>)
const PedalIcon = outlineGlyph(<><rect x="6" y="2" width="12" height="20" rx="2"/><circle cx="9.5" cy="6.5" r="1.5"/><circle cx="14.5" cy="6.5" r="1.5"/><path d="M12 11h.01"/><circle cx="12" cy="16.5" r="2.5"/></>)

/**
 * THE ONE TABLE: icon name -> [outline, solid].
 *
 * The names are the Material Symbols ligatures the app used before Heroicons
 * replaced the icon font, kept so the call sites did not have to change.
 * Heroicons is the set Astryx itself draws with: facebook/astryx
 * apps/storybook/stories/Icon.stories.tsx:17 imports `@heroicons/react/24/outline`
 * and :21 `/24/solid` (read at b790a9e3, 2026-10-16).
 *
 * A solid glyph is listed only where a caller asks for `filled` (the current
 * item in SideNav and the admin nav); every listed glyph is shipped, so an
 * unused one is dead weight.
 *
 * `≈` marks a Material glyph Heroicons has no counterpart for; the entry is
 * the closest Heroicon. The instrument glyphs (above) are the image
 * placeholders `lib/placeholder-icon.ts` picks by catalogue category; a
 * category with no glyph of its own falls back in that map, never here.
 */
const ICONS = {
  account_circle: [UserCircleIcon],
  account_tree: [RectangleGroupIcon, RectangleGroupSolid], // ≈ no tree glyph
  add_circle: [PlusCircleIcon],
  admin_panel_settings: [ShieldCheckIcon], // ≈ shield without the person/gear
  amp: [AmpIcon], // Klup's own
  arrow_back: [ArrowLeftIcon],
  arrow_forward: [ArrowRightIcon],
  auto_awesome: [SparklesIcon, SparklesSolid],
  bookmark: [BookmarkIcon],
  brass: [BrassIcon], // Klup's own
  cancel: [XCircleIcon],
  check: [CheckIcon],
  check_circle: [CheckCircleIcon],
  chevron_left: [ChevronLeftIcon],
  chevron_right: [ChevronRightIcon],
  clef_bass: [ClefBassIcon], // Lucide
  close: [XMarkIcon],
  delete: [TrashIcon],
  drag_handle: [Bars2Icon],
  drum: [DrumIcon], // Lucide
  edit: [PencilIcon],
  error: [ExclamationCircleIcon],
  expand_more: [ChevronDownIcon],
  grid_view: [Squares2X2Icon, Squares2X2Solid],
  group: [UsersIcon, UsersSolid],
  guitar: [GuitarIcon], // Lucide
  guitar_electric: [GuitarElectricIcon], // Lucide
  headphones: [HeadphonesIcon], // Lucide
  help: [QuestionMarkCircleIcon],
  image: [PhotoIcon, PhotoSolid],
  image_not_supported: [PhotoIcon], // ≈ no struck-through photo
  keyboard_music: [KeyboardMusicIcon], // Lucide
  left_panel_close: [ChevronDoubleLeftIcon], // ≈ no panel glyph
  left_panel_open: [ChevronDoubleRightIcon], // ≈ no panel glyph
  lightbulb: [LightBulbIcon, LightBulbSolid],
  link: [LinkIcon, LinkSolid],
  location_on: [MapPinIcon],
  lock: [LockClosedIcon],
  manage_search: [DocumentMagnifyingGlassIcon, DocumentMagnifyingGlassSolid], // ≈ lines + magnifier
  mark_email_read: [EnvelopeOpenIcon], // ≈ no envelope with a check
  menu: [Bars3Icon],
  microphone: [MicIcon], // Lucide `mic`
  monitoring: [PresentationChartLineIcon, PresentationChartLineSolid], // ≈ line chart
  mop: [ArchiveBoxXMarkIcon, ArchiveBoxXMarkSolid], // ≈ no mop; "clear out"
  more_vert: [EllipsisVerticalIcon],
  music_note: [MusicNoteIcon], // Lucide `eighth-note`: the neutral fallback
  north_east: [ArrowUpRightIcon],
  notifications: [BellIcon, BellSolid],
  notifications_active: [BellAlertIcon],
  notifications_none: [BellIcon],
  open_in_new: [ArrowTopRightOnSquareIcon],
  pedal: [PedalIcon], // Klup's own
  piano: [PianoIcon], // Lucide
  progress_activity: [ArrowPathIcon], // ≈ spinner; callers add animate-spin
  radar: [RadarIcon], // Material Symbols, above: the logo mark
  search: [MagnifyingGlassIcon],
  search_off: [MagnifyingGlassIcon], // ≈ no struck-through magnifier
  security: [ShieldCheckIcon],
  sell: [TagIcon, TagSolid],
  send: [PaperAirplaneIcon],
  sliders_horizontal: [SlidersHorizontalIcon], // Lucide
  sliders_vertical: [SlidersVerticalIcon], // Lucide
  south_east: [ArrowDownRightIcon],
  speaker: [SpeakerIcon], // Lucide
  stacks: [Square3Stack3DIcon],
  travel_explore: [GlobeEuropeAfricaIcon], // ≈ globe without the magnifier
  turntable: [TurntableIcon], // Lucide
  visibility: [EyeIcon],
  workspace_premium: [TrophyIcon, TrophySolid], // ≈ no rosette; tier badge
} satisfies Record<string, readonly [Glyph, Glyph?]>

export type IconName = keyof typeof ICONS

/**
 * ONE ICON — an inline SVG, always hidden from assistive technology.
 *
 * THERE IS NO PROP THAT UNHIDES THE ICON, and that is deliberate (PAN-126).
 * An icon-only control gets `aria-label` on the *control*, from `t`, because
 * `lib/i18n.ts` owns user-facing copy and an icon name is an English machine
 * token. `aria-hidden` is unconditional.
 *
 * THERE IS NO SIZE SCALE, because the call sites do not agree: they carry 16
 * distinct sizes from 11 to 72 px, written variously as `18` and `'18px'`.
 * The SVG is 1em square (`.icon` in globals.css), so `style={{ fontSize }}`
 * sizes it exactly as it sized the font glyph, and nothing shifts. Colour is
 * `currentColor`, set through `style` or inherited. Tokens only — `var(--…)`,
 * never a literal — and green stays off icons entirely: `frontend/CLAUDE.md`
 * lists the three permitted uses and an icon is not among them.
 *
 * An unknown `name` does not compile: `IconName` is the table's keys.
 */
export function Icon({
  name,
  filled = false,
  className,
  style,
}: {
  name: IconName
  /** The solid glyph, for a selected state. Falls back to outline where the table lists none. */
  filled?: boolean
  className?: string
  style?: CSSProperties
}) {
  const [outline, solid] = ICONS[name] as readonly [Glyph, Glyph?]
  const Glyph = filled && solid ? solid : outline
  return (
    <Glyph
      aria-hidden="true"
      className={className ? `icon ${className}` : 'icon'}
      style={style}
    />
  )
}
