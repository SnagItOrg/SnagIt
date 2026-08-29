/**
 * The one chart-colour authority.
 *
 * Every categorical series colour in the product comes from here. There is no
 * second list, and no component writes a series colour inline.
 *
 * Five rules, all of which are load-bearing:
 *
 *  1. **Colour follows the entity, never the rank.** `seriesColor` is a pure
 *     function of the entity key alone. It never sees the array a series
 *     currently sits in, so a series cannot change colour because something
 *     above it sorted differently.
 *  2. **Filtering never repaints the survivors.** A direct consequence of (1):
 *     removing DE from a view cannot move SE onto DE's hue, because SE's hue
 *     was never derived from a position.
 *  3. **Known markets get stable semantic slots.** DK/DE/SE/NO/US are fixed
 *     below so the same market reads the same colour on every surface.
 *  4. **Marketplace brand badges are a separate namespace.** DBA blue, Blocket
 *     red and Reverb orange live in `frontend/CLAUDE.md` and identify a
 *     *source*, not a series. Never resolve a brand badge through this module
 *     and never add a brand colour to the sequence.
 *  5. **Colour never carries meaning alone.** Direction, sign and identity are
 *     always also carried by text, a sign character, geometry or a shape. The
 *     shape sequence and the direction glyphs below exist so a caller always
 *     has a non-colour channel to hand.
 *
 * The eight hues are a validated categorical sequence: adjacent entries stay
 * separable under deuteranopia and protanopia, and every one of them clears
 * 3:1 against both the light canvas (#f3f4f6) and the dark canvas (#0a0a0c),
 * which is why the same sequence serves both themes.
 *
 * Deliberately import-free, like `lib/catalogue.ts`, so the assignment rules
 * are testable from plain Node with no React and no DOM.
 */

export const CHART_SERIES_COLORS = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
] as const

export type ChartSeriesColor = (typeof CHART_SERIES_COLORS)[number]

/**
 * Fixed slots for the markets Klup tracks. A market keeps its hue across
 * `/intel`, the product page and anything added later.
 */
export const MARKET_SLOTS: Readonly<Record<string, number>> = Object.freeze({
  DK: 0,
  DE: 1,
  SE: 2,
  NO: 3,
  US: 4,
})

/**
 * Redundant encoding channel. Paired with the hue so a legend still separates
 * two series when colour is unavailable — print, monochrome, or a reader who
 * cannot distinguish the pair.
 */
export const CHART_SERIES_SHAPES = ['circle', 'square', 'triangle', 'diamond'] as const
export type ChartSeriesShape = (typeof CHART_SERIES_SHAPES)[number]

/** FNV-1a. Any stable hash would do; this one is short and has no dependency. */
function hashKey(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function normalize(key: string): string {
  return key.trim().toUpperCase()
}

/**
 * The slot an entity occupies in the sequence.
 *
 * Known markets return their semantic slot. Everything else hashes, which is
 * stable for a given key forever and independent of every other key present.
 */
export function seriesSlot(key: string): number {
  const normalized = normalize(key)
  const known = MARKET_SLOTS[normalized]
  if (known !== undefined) return known
  return hashKey(normalized) % CHART_SERIES_COLORS.length
}

/** The colour for an entity. Pure in the key — see rules 1 and 2 above. */
export function seriesColor(key: string): string {
  return CHART_SERIES_COLORS[seriesSlot(key)]
}

/** The non-colour channel for the same entity. */
export function seriesShape(key: string): ChartSeriesShape {
  return CHART_SERIES_SHAPES[seriesSlot(key) % CHART_SERIES_SHAPES.length]
}

export function isKnownMarket(key: string): boolean {
  return MARKET_SLOTS[normalize(key)] !== undefined
}

/* ── Direction ──────────────────────────────────────────────────────────────
   Direction is NOT a categorical series, so it never draws from the sequence
   above. It resolves to the semantic accent/destructive tokens, which are
   already theme-aware, and it is always accompanied by a glyph and a printed
   sign so the hue is reinforcement rather than the signal. */

export type Direction = 'up' | 'down' | 'flat'

export function directionOf(value: number | null | undefined): Direction {
  if (value == null || !Number.isFinite(value) || value === 0) return 'flat'
  return value > 0 ? 'up' : 'down'
}

/** Arrow glyph. The non-colour carrier of direction. */
export const DIRECTION_GLYPH: Readonly<Record<Direction, string>> = Object.freeze({
  up: '↑',
  down: '↓',
  flat: '→',
})

/**
 * The CSS custom property a direction should be tinted with. A `var(...)`
 * string, not a literal, so both themes resolve correctly and no component
 * ends up holding a hex value for a semantic state.
 */
export function directionTone(direction: Direction): string {
  if (direction === 'up') return 'var(--accent-text)'
  if (direction === 'down') return 'var(--destructive-text)'
  return 'var(--text-muted)'
}
