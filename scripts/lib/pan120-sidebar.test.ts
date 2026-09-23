/**
 * PAN-120 — the resizable, headed, collapsed-by-default sidebar.
 *
 * These pin the properties a reviewer cannot see by reading a screenshot: that
 * the handle is a real `separator` with live bounds rather than a div with a
 * drag listener, that collapsing never costs a nav target its accessible name,
 * that the offset every page uses is one number rather than nine copies, and
 * that the selected state is carried by weight rather than by the accent.
 *
 * The behavioural half — that Tab reaches the separator, that arrows resize it,
 * that dragging it changes the content density, that the width survives a
 * reload and that none of it produces a hydration mismatch — was verified in a
 * real browser against a production build, and the numbers are in the PR. A
 * jsdom test could not have told the truth about any of them.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { translations } from '../../frontend/lib/i18n'

const ROOT = join(__dirname, '..', '..')
const read = (...parts: string[]) => readFileSync(join(ROOT, 'frontend', ...parts), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

const SIDENAV = read('components', 'SideNav.tsx')
const SIDENAV_CODE = strip(SIDENAV)
const CSS = read('app', 'globals.css')

test('the handle is a separator with live bounds in resolved pixels', () => {
  assert.match(SIDENAV_CODE, /role="separator"/)
  assert.match(SIDENAV_CODE, /aria-orientation="vertical"/)
  // PAN-125 changed this from `SIDEBAR_MIN_WIDTH`. Collapsed is now the bottom
  // of the range rather than a mode outside it, which is what lets the handle
  // exist while collapsed with a valid `aria-valuenow`. See the collapsed-state
  // test below.
  assert.match(SIDENAV_CODE, /aria-valuemin=\{SIDEBAR_COLLAPSED_WIDTH\}/)
  assert.match(SIDENAV_CODE, /aria-valuemax=\{SIDEBAR_MAX_WIDTH\}/)
  // `aria-valuenow` must track the live width, not a constant.
  assert.match(SIDENAV_CODE, /aria-valuenow=\{width\}/)
  assert.match(SIDENAV_CODE, /aria-label=\{label\}/)

  // Focusable and keyboard-operable. A resize control a keyboard cannot reach
  // is decoration, and this is the assertion that keeps it honest.
  assert.match(SIDENAV_CODE, /tabIndex=\{0\}/)
  assert.match(SIDENAV_CODE, /onKeyDown=\{handleKeyDown\}/)
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    assert.ok(SIDENAV_CODE.includes(`'${key}'`), `the separator must handle ${key}`)
  }
  // The arrows would otherwise scroll the sidebar's own overflow container.
  assert.match(SIDENAV_CODE, /e\.preventDefault\(\)/)

  // An enlarged invisible grab zone behind a small visible grip: the hit target
  // and the painted affordance are deliberately different sizes.
  assert.match(SIDENAV_CODE, /w-4 cursor-col-resize/)
  assert.match(SIDENAV_CODE, /w-0\.5/)
  assert.match(SIDENAV_CODE, /opacity-0/)
  assert.match(SIDENAV_CODE, /group-focus-visible:opacity-100/)
})

test('the minimum width is the measured Danish-label floor', () => {
  const min = Number(/const SIDEBAR_MIN_WIDTH = (\d+)/.exec(SIDENAV)?.[1])
  const max = Number(/const SIDEBAR_MAX_WIDTH = (\d+)/.exec(SIDENAV)?.[1])
  const step = Number(/const SIDEBAR_RESIZE_STEP = (\d+)/.exec(SIDENAV)?.[1])

  // Measured in a real browser: "Western- & akustiske guitarer" needs 184px of
  // text and gets 173px inside a 240px sidebar, so it truncates. 250 is the
  // first width that renders it in full — which makes the long-standing claim
  // that `w-60` fits the label false, and 240 an unacceptable minimum.
  assert.ok(min >= 250, `minimum ${min} truncates the longest Danish root label`)
  assert.equal(min % step, 0, 'the floor must sit on the arrow-key grid, so Home lands on it')
  assert.ok(max > min, 'maximum must exceed minimum')

  // Clamp order: the maximum wins when bounds conflict, and nothing may resolve
  // below the floor.
  assert.match(
    SIDENAV_CODE,
    /Math\.min\(SIDEBAR_MAX_WIDTH, Math\.max\(SIDEBAR_MIN_WIDTH/,
  )
})

test('collapsed is the default, persisted, and never costs an accessible name', () => {
  // Collapsed by default: the declared initial state, not a stored one.
  assert.match(SIDENAV_CODE, /useState\(true\)/)
  assert.match(SIDENAV_CODE, /SIDEBAR_COLLAPSED_KEY/)
  assert.match(SIDENAV_CODE, /SIDEBAR_WIDTH_KEY/)

  // Only an explicit "false" expands, so an absent key means a first-time
  // visitor and the default stands.
  assert.match(SIDENAV_CODE, /SIDEBAR_COLLAPSED_KEY\) === 'false'/)

  // Every nav target keeps a name at 72px, where the visible label is gone.
  assert.match(SIDENAV_CODE, /aria-label=\{collapsed \? label : undefined\}/)
  assert.match(SIDENAV_CODE, /title=\{collapsed \? label : undefined\}/)
  assert.match(SIDENAV_CODE, /aria-expanded=\{!collapsed\}/)
  assert.match(SIDENAV_CODE, /aria-label=\{collapsed \? t\.sidebarExpand : t\.sidebarCollapse\}/)

  // Storage is wrapped: private mode must not take the sidebar down with it.
  assert.ok(
    (SIDENAV_CODE.match(/catch\s*\{/g) ?? []).length >= 3,
    'every localStorage access needs its own guard',
  )
})

test('server and first client render agree, so there is no hydration mismatch', () => {
  // The whole hazard: `localStorage` cannot be read on the server, so the first
  // client render must use the same declared defaults the server used, and only
  // then adopt what was stored. If the stored values were read during render
  // instead of in an effect, the two trees would differ.
  const effect = SIDENAV_CODE.slice(SIDENAV_CODE.indexOf('useEffect(() => {\n    setMounted(true)'))
  assert.ok(effect.includes('localStorage.getItem'), 'stored state is adopted in an effect')
  assert.equal(
    /useState\([^)]*localStorage/.test(SIDENAV_CODE),
    false,
    'storage must never be read during render',
  )

  // The CSS fallback must equal the collapsed width for the same reason: a page
  // rendered before the variable exists must not jump sideways on hydration.
  const collapsed = Number(/const SIDEBAR_COLLAPSED_WIDTH = (\d+)/.exec(SIDENAV)?.[1])
  const fallback = /--sidebar-width,\s*([\d.]+)rem/.exec(CSS)
  assert.ok(fallback, 'the offset utility needs a fallback width')
  assert.equal(Number(fallback![1]) * 16, collapsed)
})

test('the content offset is one number, not nine copies of 240px', () => {
  assert.match(SIDENAV_CODE, /setProperty\('--sidebar-width'/)
  assert.match(CSS, /\.shell-offset\b/)
  assert.match(CSS, /\.shell-offset-pad\b/)

  // "Is there a sidebar at all" stays a viewport question; only its width is
  // dynamic. Converting this to a container query would be a bug.
  assert.match(CSS, /@media \(min-width: 768px\)[\s\S]{0,400}--sidebar-width/)

  // No page may reintroduce a hardcoded offset.
  const pages = [
    ['app', 'browse', 'page.tsx'],
    ['app', 'browse', '[root]', 'page.tsx'],
    ['app', 'search', 'page.tsx'],
    ['app', 'family', '[slug]', 'page.tsx'],
    ['app', 'saved', 'page.tsx'],
    ['app', 'profile', 'page.tsx'],
    ['app', 'watchlists', 'page.tsx'],
    ['app', 'product', '[slug]', 'page.tsx'],
  ]
  for (const parts of pages) {
    const src = read(...parts)
    assert.equal(
      /md:(ml|pl)-60/.test(src),
      false,
      `${parts.join('/')} must use the shared offset, not a hardcoded 240px`,
    )
    assert.match(src, /shell-offset/, `${parts.join('/')} must take the shared offset`)
  }
})

test('the selected nav item is weight and fill, never the accent', () => {
  // Astryx's icon/selectedIcon pair: the icon is a function of the selected
  // state, so the current item is marked by form rather than by hue.
  assert.match(SIDENAV_CODE, /icon: \(selected/)
  assert.match(SIDENAV_CODE, /icon\(isActive\)/)
  assert.match(SIDENAV_CODE, /'FILL' 1/)
  assert.match(SIDENAV_CODE, /isActive \? 'font-semibold' : 'font-medium'/)

  // Green is exhaustive — Kup-rating, "Aktiv", `under typisk`. Navigation is
  // not on the list, and neither a grip, a section heading nor a selected item
  // may borrow it.
  for (const token of ['--accent', '#13ec6d', '#16d96b']) {
    assert.equal(SIDENAV_CODE.includes(token), false, `SideNav must not reference ${token}`)
  }

  // Motion from the existing tokens, never a new literal.
  assert.match(SIDENAV_CODE, /var\(--duration-fast\)/)
  assert.match(SIDENAV_CODE, /var\(--ease-standard\)/)
  assert.equal(/\b\d+ms\b/.test(SIDENAV_CODE), false, 'no literal durations')
})

test('sections are headed, and no menu was built without actions to put in it', () => {
  assert.match(SIDENAV_CODE, /navSections/)
  assert.match(SIDENAV_CODE, /section\.title/)
  assert.match(SIDENAV_CODE, /section\.subtitle/)

  // `SideNavHeading`'s popover is deliberately absent: Klup has no nav-heading
  // actions, and a popover with two items is worse than two links.
  assert.equal(/NavHeadingMenu|role="menu"/.test(SIDENAV_CODE), false)

  // Astryx is a taste reference, never a dependency (PAN-111).
  for (const forbidden of ['@astryxdesign', '@stylexjs', 'xstyle']) {
    assert.equal(SIDENAV_CODE.includes(forbidden), false, `must not import ${forbidden}`)
  }
})

test('every new string is a key, in both locales', () => {
  const keys = [
    'sidebarCollapse',
    'sidebarExpand',
    'sidebarResize',
    'sidebarSectionDiscover',
    'sidebarSectionDiscoverSubtitle',
    'sidebarSectionYours',
  ] as const
  for (const key of keys) {
    assert.ok(key in translations.da, `da is missing ${key}`)
    assert.ok(key in translations.en, `en is missing ${key}`)
    assert.ok((translations.da[key] as string).length > 0)
    assert.ok((translations.en[key] as string).length > 0)
  }
})

test('the container queries are native, and the plugin was not added', () => {
  // Measured: 98 breakpoint utilities across 28 files, of which only a handful
  // are layout-changing content-density rules on the public surface. The ticket
  // is explicit that a build plugin for a handful is the wrong trade.
  const pkg = JSON.parse(read('package.json')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const all = { ...pkg.dependencies, ...pkg.devDependencies }
  assert.equal(
    '@tailwindcss/container-queries' in all,
    false,
    'a container-query plugin for two rules is the wrong trade',
  )

  // Native `@container`, which needs no plugin at all.
  assert.match(CSS, /container-type: inline-size/)
  assert.match(CSS, /@container \(min-width: 40rem\)/)

  // And the grids that were already container-responsive were left alone.
  assert.match(CSS, /repeat\(auto-fill, minmax\(min\(var\(--wall-card-min\), 100%\), 1fr\)\)/)
})
