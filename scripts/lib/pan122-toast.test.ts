/**
 * PAN-122 — the toast carries a type, persists an error, and is one system.
 *
 * Three tests, which is the ticket's budget.
 *
 *   1. the behavioural contract: the auto-hide asymmetry, the role mapping,
 *      and a cap that cannot silently eat an unread error;
 *   2. the colour and position rules, which are the two things a later change
 *      is most likely to undo by reflex;
 *   3. one toast system — no page may re-grow its own copy.
 *
 * These read source rather than render it, matching pan113 and the rest of
 * this directory: the frontend's React tree is not installed at the root, so
 * `lib/use-toast.ts` (which imports React) cannot be imported here. The
 * i18n assertions below ARE a real import, because `lib/i18n.ts` has no
 * imports of its own.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { translations } from '../../frontend/lib/i18n'

const ROOT = join(__dirname, '..', '..')
const FRONTEND = join(ROOT, 'frontend')

const TOAST = readFileSync(join(FRONTEND, 'components', 'Toast.tsx'), 'utf8')
const USE_TOAST = readFileSync(join(FRONTEND, 'lib', 'use-toast.ts'), 'utf8')
const CSS = readFileSync(join(FRONTEND, 'app', 'globals.css'), 'utf8')

/**
 * Strip block comments. Both files DOCUMENT the viewport-keyed values they
 * replaced (`left-1/2`, `max-w-[92vw]`), and a check that cannot tell prose
 * from code would force the explanation to be deleted to stay green — which
 * is the opposite of what these files are for.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The toast's own slice of globals.css, so a rule elsewhere cannot satisfy a check. */
function toastCss(): string {
  const start = CSS.indexOf('.toast-viewport {')
  assert.notEqual(start, -1, 'globals.css must define .toast-viewport')
  const end = CSS.indexOf('/* =====', start)
  return CSS.slice(start, end === -1 ? CSS.length : end)
}

/** Every .tsx under frontend/app and frontend/components. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (name.endsWith('.tsx')) out.push(full)
  }
  return out
}

test('an error persists, an info expires, and the cap cannot eat an unread error', () => {
  // The asymmetry IS the ticket. `isAutoHide` defaults from the type, so a
  // caller that passes nothing still gets a persistent error.
  assert.match(
    USE_TOAST,
    /isAutoHide:\s*options\.isAutoHide\s*\?\?\s*type === 'info'/,
    'isAutoHide must default to true for info and false for error',
  )

  // The row's countdown is conditional on isAutoHide, so a persistent toast
  // never arms a timer at all rather than arming one nobody cancels.
  assert.match(
    TOAST,
    /if \(!entry\.isAutoHide \|\| isExiting \|\| isHeld\) return/,
    'the auto-hide timer must not run for a persistent or held toast',
  )
  // WCAG 2.2.1: hover and focus hold the countdown, so a toast cannot unmount
  // out from under the dismiss button a keyboard user has just reached.
  for (const handler of ['onPointerEnter', 'onPointerLeave', 'onFocus', 'onBlur']) {
    assert.ok(TOAST.includes(handler), `the row must pause its timer on ${handler}`)
  }

  // Assertive for a failure, polite for a confirmation — in BOTH places: the
  // per-toast role, and the singleton live region that does the announcing.
  assert.match(
    TOAST,
    /role=\{isError \? 'alert' : 'status'\}/,
    'error toasts need role="alert", info toasts role="status"',
  )
  assert.match(
    TOAST,
    /entry\.type === 'error' \? 'assertive' : 'polite'/,
    'the announcement must be assertive for an error and polite otherwise',
  )
  // A live region born with its content is not announced by most screen
  // readers, so the regions must be created empty and mutated afterwards.
  assert.match(TOAST, /aria-live/, 'a singleton live region pair must exist')
  assert.match(
    TOAST,
    /textContent = message/,
    'announcements must be written into a pre-existing region, not mounted with it',
  )

  // The cap drops the oldest AUTO-HIDING entry, not simply the oldest: an
  // undismissed error evicted to make room for a "Gemt" would vanish unread,
  // which is the defect this component exists to fix.
  assert.match(
    USE_TOAST,
    /findIndex\(\(entry\) => entry\.isAutoHide\)/,
    'the cap must prefer to evict an auto-hiding toast over a persistent one',
  )
  assert.match(USE_TOAST, /TOAST_MAX_VISIBLE = \d+/, 'the stack must be capped')

  // A dismiss control, keyboard-operable, with a name from i18n.
  assert.match(TOAST, /<button/, 'every toast needs a dismiss control')
  assert.match(TOAST, /aria-label=\{t\.toastDismiss\}/, 'the control needs an accessible name')

  // Copy lives in i18n, in both locales, and neither is left as a stub.
  for (const key of ['toastDismiss', 'toastErrorLabel', 'toastRegionLabel'] as const) {
    for (const locale of ['da', 'en'] as const) {
      const value = translations[locale][key]
      assert.equal(typeof value, 'string', `${locale}.${key} must exist`)
      assert.ok(value.length > 0, `${locale}.${key} must not be empty`)
    }
    assert.notEqual(
      translations.da[key],
      translations.en[key],
      `${key} must actually be translated, not copied between locales`,
    )
  }
})

test('error colour is the destructive token, nothing is green, nothing is viewport-keyed', () => {
  const css = toastCss()
  const cssCode = code(css)
  const toastCode = code(TOAST)

  // Destructive tokens only. frontend/CLAUDE.md forbids raw red utilities.
  assert.match(css, /var\(--destructive-subtle\)/, 'the error fill must be a destructive token')
  assert.match(css, /var\(--destructive-border\)/, 'the error rule must be a destructive token')
  assert.match(css, /var\(--destructive-text\)/, 'the error glyph must be a destructive token')
  for (const source of [cssCode, toastCode]) {
    assert.doesNotMatch(source, /\bred-\d{2,3}\b/, 'no raw red-* utility')
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, 'no hardcoded colour value')
  }

  // The tint must LAYER over the opaque surface. Set as `background-color` it
  // would replace the base and composite the card against whatever the page
  // puts behind it — PAN-113's failure mode, where a fade pulled ink and fill
  // toward the canvas together and measured 2.61:1.
  assert.match(
    css,
    /\.toast--error \{[^}]*background-color: var\(--surface-raised\)/s,
    'the error card must keep an opaque base under its tint',
  )

  // Green is exhaustive: Kup-rating, "Aktiv", `under typisk`. A confirmation
  // that something saved is not one of Klup's judgements.
  for (const green of ['--accent', '--ramp-green', 'bg-accent', 'text-accent']) {
    assert.ok(!css.includes(green), `the toast must not use ${green}: green is exhaustive`)
    assert.ok(!toastCode.includes(green), `the toast must not use ${green}: green is exhaustive`)
  }
  assert.ok(!toastCode.includes('✅'), 'a success toast is not a green tick')

  // Not keyed on the viewport. PAN-120 makes the sidebar resizable, after
  // which the window centre and the content centre are different places.
  assert.doesNotMatch(cssCode, /\dvw\b/, 'no vw unit may survive in the toast')
  assert.doesNotMatch(cssCode, /left:\s*50%/, 'the toast must not be centred on the viewport')
  for (const banned of ['left-1/2', '-translate-x-1/2', 'max-w-[92vw]', 'vw]']) {
    assert.ok(!toastCode.includes(banned), `${banned} is viewport-keyed and must not return`)
  }
  // The one documented seam PAN-120 may set, and the explicit alignment that
  // Astryx measured the cost of omitting.
  assert.match(css, /--toast-inset-inline-start/, 'PAN-120 needs a decoupled inline offset')
  assert.match(css, /align-items: flex-start/, 'a viewport that spans the axis must align explicitly')

  // The recorded fix: a long review message wraps rather than widening the
  // page. Verified in a browser at 320px; pinned here so it cannot regress.
  assert.match(css, /overflow-wrap: anywhere/, 'a long message must wrap')
  assert.match(css, /min-width: 0/, 'the message must be allowed to shrink')

  // Motion comes from the existing tokens, and reduced motion is honoured.
  assert.match(css, /var\(--ease-standard\)/, 'entry uses --ease-standard')
  assert.match(css, /var\(--ease-exit\)/, 'exit uses --ease-exit')
  assert.match(css, /prefers-reduced-motion: reduce/, 'reduced motion must be honoured')
})

test('there is exactly one toast system', () => {
  const files = [
    ...sourceFiles(join(FRONTEND, 'app')),
    ...sourceFiles(join(FRONTEND, 'components')),
  ]

  const viewportPath = join(FRONTEND, 'components', 'Toast.tsx')
  const offenders: string[] = []
  const renderers: string[] = []

  for (const file of files) {
    if (file === viewportPath) continue
    const src = readFileSync(file, 'utf8')
    // A hand-rolled toast: its own string slot, or the centred chip that used
    // to be copied from page to page.
    if (/const \[toast,\s*setToast\]/.test(src)) offenders.push(file)
    if (/fixed bottom-6 left-1\/2 -translate-x-1\/2/.test(src)) offenders.push(file)
    if (src.includes('<ToastViewport')) renderers.push(file)
  }

  assert.deepEqual(
    offenders.map((f) => f.slice(FRONTEND.length + 1)),
    [],
    'no page may hold its own toast state or its own centred toast chip',
  )

  // Every surface that shows a toast goes through the one viewport, and the
  // old single-message component is gone rather than merely unused.
  assert.ok(renderers.length > 0, 'something must render the toast viewport')
  assert.doesNotMatch(
    TOAST,
    /export function Toast\(/,
    'the old single-message Toast must not survive alongside the viewport',
  )
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    assert.doesNotMatch(
      src,
      /import \{ Toast \} from '@\/components\/Toast'/,
      `${file.slice(FRONTEND.length + 1)} still imports the retired Toast`,
    )
  }
})
