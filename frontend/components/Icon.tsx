import type { CSSProperties } from 'react'
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
  MusicalNoteIcon,
  PaperAirplaneIcon,
  PencilIcon,
  PhotoIcon,
  PlusCircleIcon,
  PresentationChartLineIcon,
  QuestionMarkCircleIcon,
  RectangleGroupIcon,
  ShieldCheckIcon,
  SignalIcon,
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

type Glyph = typeof XMarkIcon

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
  piano: [MusicalNoteIcon], // ≈ no instrument glyphs
  progress_activity: [ArrowPathIcon], // ≈ spinner; callers add animate-spin
  radar: [SignalIcon], // ≈ no radar
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
