/**
 * The Material Symbols glyphs this app draws — the ONE list (PAN-167).
 *
 * WHY A LIST. Without `icon_names`, Google Fonts serves every glyph in the
 * family: 452 KB of woff2 on every page, fetched at the highest priority,
 * for about fifty icons. On a throttled phone it holds the connection that
 * the HTML, CSS and JS need. Measured on production with Lighthouse mobile
 * (median of 3): blocking only that file took FCP from 4.8 s to 2.4 s on `/`,
 * `/browse` and `/search`. With `icon_names` the same URL returns a subset
 * with just these ligatures: 7.5 KB.
 *
 * THE FAILURE MODE. A glyph missing from this list does not fall back to
 * anything useful. The subset font has no ligature for it, so the icon box
 * stays empty, or shows a clipped scrap of the ligature word. So a new icon
 * is added HERE, in the same change that draws it.
 * `scripts/lib/pan167-icon-font.test.ts` scans app/, components/ and lib/ and
 * fails on any glyph name that this list does not carry.
 *
 * NO IMPORTS: the test reads this module from plain Node.
 */
export const ICON_GLYPHS = [
  'account_circle',
  'add_circle',
  'admin_panel_settings',
  'arrow_back',
  'arrow_forward',
  'auto_awesome',
  'bookmark',
  'cancel',
  'check',
  'check_circle',
  'chevron_left',
  'chevron_right',
  'close',
  'delete',
  'drag_handle',
  'edit',
  'error',
  'expand_more',
  'grid_view',
  'group',
  'help',
  'image',
  'image_not_supported',
  'left_panel_close',
  'left_panel_open',
  'lightbulb',
  'link',
  'location_on',
  'lock',
  'manage_search',
  'mark_email_read',
  'menu',
  'monitoring',
  'mop',
  'more_vert',
  'north_east',
  'notifications',
  'notifications_active',
  'notifications_none',
  'open_in_new',
  'piano',
  'progress_activity',
  'radar',
  'search',
  'search_off',
  'security',
  'sell',
  'send',
  'south_east',
  'travel_explore',
  'visibility',
  'workspace_premium',
] as const

/**
 * The stylesheet URL. The axes are PAN-71's, unchanged: GRAD 0, opsz 24,
 * wght 400 pinned, and FILL 0..1 kept for `.filled`. Google asks for
 * `icon_names` in alphabetical order, so the list is sorted here rather than
 * trusted to stay sorted by hand.
 */
export const ICON_FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:FILL,GRAD,opsz,wght@0..1,0,24,400' +
  `&icon_names=${[...ICON_GLYPHS].sort().join(',')}&display=swap`
