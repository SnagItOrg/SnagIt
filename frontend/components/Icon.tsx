import type { ComponentType, CSSProperties, SVGProps } from 'react'
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
 * Two glyphs stay Material Symbols, as inline SVG rather than the font:
 * `radar` is the Klup logo mark (the brand does not change with the icon
 * set), and `piano` is the product image placeholder. Paths copied verbatim
 * from google/material-design-icons @ 49d4db35,
 * symbols/web/{radar,piano}/materialsymbolsoutlined/*_24px.svg.
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

const PianoIcon = materialGlyph(
  'M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h130v-180h-10q-17 0-28.5-11.5T280-420v-340h-80v560Zm430 0h130v-560h-80v340q0 17-11.5 28.5T640-380h-10v180Zm-240 0h180v-180h-10q-17 0-28.5-11.5T520-420v-340h-80v340q0 17-11.5 28.5T400-380h-10v180Z',
)

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
 * the closest Heroicon.
 */
const ICONS = {
  account_circle: [UserCircleIcon],
  account_tree: [RectangleGroupIcon, RectangleGroupSolid], // ≈ no tree glyph
  add_circle: [PlusCircleIcon],
  admin_panel_settings: [ShieldCheckIcon], // ≈ shield without the person/gear
  arrow_back: [ArrowLeftIcon],
  arrow_forward: [ArrowRightIcon],
  auto_awesome: [SparklesIcon, SparklesSolid],
  bookmark: [BookmarkIcon],
  cancel: [XCircleIcon],
  check: [CheckIcon],
  check_circle: [CheckCircleIcon],
  chevron_left: [ChevronLeftIcon],
  chevron_right: [ChevronRightIcon],
  close: [XMarkIcon],
  delete: [TrashIcon],
  drag_handle: [Bars2Icon],
  edit: [PencilIcon],
  error: [ExclamationCircleIcon],
  expand_more: [ChevronDownIcon],
  grid_view: [Squares2X2Icon, Squares2X2Solid],
  group: [UsersIcon, UsersSolid],
  help: [QuestionMarkCircleIcon],
  image: [PhotoIcon, PhotoSolid],
  image_not_supported: [PhotoIcon], // ≈ no struck-through photo
  left_panel_close: [ChevronDoubleLeftIcon], // ≈ no panel glyph
  left_panel_open: [ChevronDoubleRightIcon], // ≈ no panel glyph
  lightbulb: [LightBulbIcon, LightBulbSolid],
  link: [LinkIcon, LinkSolid],
  location_on: [MapPinIcon],
  lock: [LockClosedIcon],
  manage_search: [DocumentMagnifyingGlassIcon, DocumentMagnifyingGlassSolid], // ≈ lines + magnifier
  mark_email_read: [EnvelopeOpenIcon], // ≈ no envelope with a check
  menu: [Bars3Icon],
  monitoring: [PresentationChartLineIcon, PresentationChartLineSolid], // ≈ line chart
  mop: [ArchiveBoxXMarkIcon, ArchiveBoxXMarkSolid], // ≈ no mop; "clear out"
  more_vert: [EllipsisVerticalIcon],
  north_east: [ArrowUpRightIcon],
  notifications: [BellIcon, BellSolid],
  notifications_active: [BellAlertIcon],
  notifications_none: [BellIcon],
  open_in_new: [ArrowTopRightOnSquareIcon],
  piano: [PianoIcon], // Material Symbols, above
  progress_activity: [ArrowPathIcon], // ≈ spinner; callers add animate-spin
  radar: [RadarIcon], // Material Symbols, above: the logo mark
  search: [MagnifyingGlassIcon],
  search_off: [MagnifyingGlassIcon], // ≈ no struck-through magnifier
  security: [ShieldCheckIcon],
  sell: [TagIcon, TagSolid],
  send: [PaperAirplaneIcon],
  south_east: [ArrowDownRightIcon],
  stacks: [Square3Stack3DIcon],
  travel_explore: [GlobeEuropeAfricaIcon], // ≈ globe without the magnifier
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
