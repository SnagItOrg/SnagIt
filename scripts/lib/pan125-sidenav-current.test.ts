/**
 * PAN-125 — the two gaps a production probe found after PAN-120/121 merged.
 *
 * Both are the same class of failure: something that works in the state I
 * happened to verify, and not in the state visitors actually get. PAN-120 made
 * the sidebar collapsed by default *after* PAN-121's sidenav marking was built
 * and measured expanded, so the marking was only ever checked in a state that
 * is no longer the default.
 *
 * Measured on production (1440x900), before the fix:
 *
 *   collapsed  /browse              a "Katalog"    aria-current=page
 *   collapsed  /browse/<root>       —              NONE
 *   collapsed  /browse/<root>?sub=  —              NONE
 *   collapsed  /product/<slug>      —              NONE
 *   expanded   every one of them    exactly one    aria-current=page
 *
 * So the owner's "you are here" fired only when expanded, and expanded is not
 * the default. The separator had the same shape of bug: present expanded,
 * absent collapsed, and collapsed is what a keyboard visitor meets first.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  currentCatalogueNode,
  type CatalogueTreeCategory,
} from '../../frontend/lib/catalogue-tree'

const ROOT = join(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(join(ROOT, 'frontend', ...p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

const SIDENAV = read('components', 'SideNav.tsx')
const SIDENAV_CODE = strip(SIDENAV)

const TREE: CatalogueTreeCategory[] = [
  {
    slug: 'keyboards-and-synths',
    name_da: 'Synthesizere & keyboards',
    name_en: 'Keyboards and Synths',
    product_count: 26,
    subcategories: [
      {
        slug: 'analog-synths',
        name_da: 'Analoge synths',
        name_en: 'Analog Synths',
        product_count: 13,
        products: [{ slug: 'roland-juno-106', label: 'Roland Juno-106' }],
      },
    ],
  },
]

test('one function decides the current node, and it picks exactly one', () => {
  assert.deepEqual(currentCatalogueNode(TREE, '/browse/keyboards-and-synths', null), {
    kind: 'branch',
    categorySlug: 'keyboards-and-synths',
  })

  // A facet narrows it. The branch must stop claiming to be current, or a
  // screen reader hears two current pages.
  assert.deepEqual(
    currentCatalogueNode(TREE, '/browse/keyboards-and-synths', 'analog-synths'),
    { kind: 'subcategory', categorySlug: 'keyboards-and-synths', subcategorySlug: 'analog-synths' },
  )

  assert.deepEqual(currentCatalogueNode(TREE, '/product/roland-juno-106', null), {
    kind: 'product',
    productSlug: 'roland-juno-106',
  })
})

test('it fails closed rather than marking a node that is not there', () => {
  // Catalogue-shaped paths naming things the tree does not carry. Each must
  // return null so the caller falls back to the section instead of inventing a
  // precise mark for a node the visitor cannot see.
  assert.equal(currentCatalogueNode(TREE, '/browse/not-a-root', null), null)
  assert.equal(currentCatalogueNode(TREE, '/product/not-a-product', null), null)
  assert.equal(currentCatalogueNode([], '/browse/keyboards-and-synths', null), null)

  // Not catalogue nodes at all.
  assert.equal(currentCatalogueNode(TREE, '/browse', null), null)
  assert.equal(currentCatalogueNode(TREE, '/search', null), null)
  assert.equal(currentCatalogueNode(TREE, '/family/fender-telecaster', null), null)

  // Deeper than the tree goes.
  assert.equal(currentCatalogueNode(TREE, '/browse/keyboards-and-synths/extra', null), null)

  // An unrecognised facet is not a place to stand, so it falls back to the
  // branch rather than marking nothing on a page that clearly has a branch.
  assert.deepEqual(currentCatalogueNode(TREE, '/browse/keyboards-and-synths', 'nope'), {
    kind: 'branch',
    categorySlug: 'keyboards-and-synths',
  })
})

test('the section carries the mark when the tree cannot — the collapsed default', () => {
  // This is the production defect. The tree holds the precise mark and does not
  // render at 72px, so without a fallback the collapsed default says nothing on
  // exactly the routes the owner asked about.
  assert.match(SIDENAV_CODE, /const isCataloguePath = /)
  assert.match(SIDENAV_CODE, /isCataloguePath\(pathname\) && !treeMarked/)

  // The fallback defers to the tree, so the two can never both mark.
  assert.match(SIDENAV_CODE, /treeMarked/)
  assert.match(SIDENAV_CODE, /onMarkedChange/)

  // And the tree reports false when it unmounts, or collapsing would leave the
  // sidebar believing a node it can no longer show is still marked.
  assert.match(SIDENAV_CODE, /return \(\) => onMarkedChange\(false\)/)

  // Still only ever `page`, never `true`.
  for (const m of SIDENAV_CODE.matchAll(/aria-current=\{([^}]*)\}/g)) {
    assert.match(m[1], /'page'/)
    assert.match(m[1], /undefined/)
  }
})

test('a family route is deliberately not treated as a catalogue section', () => {
  // WP-2 keeps `/family/<slug>` unlinked: it is noindex and reachable only by
  // the legacy redirects and one gated breadcrumb. Marking Katalog there would
  // have made the sidebar treat it as an ordinary catalogue destination, and
  // WP-2's navigation guard catches exactly that. Production shows the family
  // route marking nothing in either state, which is consistent rather than
  // broken; the orientation gap belongs to PAN-124's breadcrumb.
  const predicate = SIDENAV_CODE.slice(
    SIDENAV_CODE.indexOf('const isCataloguePath'),
    SIDENAV_CODE.indexOf('const SIDEBAR_MIN_WIDTH'),
  )
  assert.equal(predicate.includes('/family/'), false)
  assert.match(predicate, /\/browse\//)
  assert.match(predicate, /\/product\//)
})

test('the separator exists while collapsed, with a valid value', () => {
  // It used to be `{!collapsed && <SidebarResizeHandle …>}`, so the default
  // state had no resize control and a keyboard visitor met no separator at all.
  assert.equal(
    /\{!collapsed && \(\s*<SidebarResizeHandle/.test(SIDENAV_CODE),
    false,
    'the handle must not be conditional on the sidebar being expanded',
  )
  assert.match(SIDENAV_CODE, /<SidebarResizeHandle/)

  // Valid semantics in both states: the collapsed width is the bottom of the
  // range, so `aria-valuenow` is inside min and max while collapsed.
  assert.match(SIDENAV_CODE, /aria-valuemin=\{SIDEBAR_COLLAPSED_WIDTH\}/)
  assert.match(SIDENAV_CODE, /aria-valuenow=\{width\}/)
  assert.match(SIDENAV_CODE, /width=\{resolvedWidth\}/)
})

test('snapping keeps the range discontinuous, so the label floor still holds', () => {
  const min = Number(/const SIDEBAR_MIN_WIDTH = (\d+)/.exec(SIDENAV)![1])
  const collapsed = Number(/const SIDEBAR_COLLAPSED_WIDTH = (\d+)/.exec(SIDENAV)![1])

  // The gap between collapsed and the measured Danish-label floor is a snap
  // zone, not a set of reachable widths. Nothing may resolve inside it, or the
  // sidebar could sit at a width that truncates its own category names — the
  // defect PAN-120 measured at 240px.
  assert.match(SIDENAV_CODE, /const SIDEBAR_SNAP_THRESHOLD = /)
  assert.match(SIDENAV_CODE, /const snapWidth = /)
  assert.match(SIDENAV_CODE, /px < SIDEBAR_SNAP_THRESHOLD/)

  // The threshold sits strictly inside the gap, so both ends are reachable.
  const threshold = Math.round((collapsed + min) / 2)
  assert.ok(threshold > collapsed && threshold < min, 'the snap threshold must sit inside the gap')

  // The gap is crossed in one step in BOTH directions. Found by driving a real
  // browser: without the `width <= SIDEBAR_MIN_WIDTH` case, ArrowLeft at the
  // floor computed 240, which snaps straight back to 256 — so the keyboard
  // could expand from the separator but never collapse from it, while the
  // pointer could do both by dragging across.
  assert.match(SIDENAV_CODE, /collapsed \|\| width <= SIDEBAR_MIN_WIDTH/)
  assert.match(SIDENAV_CODE, /collapsed \? SIDEBAR_MIN_WIDTH : width \+ SIDEBAR_RESIZE_STEP/)

  // Every pointer and key path goes through the snap, never a bare clamp.
  assert.equal(
    /onResize=|onCommit=/.test(SIDENAV_CODE),
    false,
    'the handle now reports a snapped state, not a raw width',
  )
  assert.match(SIDENAV_CODE, /onResolve=\{applySidebarState\}/)

  // Both persisted axes move together: a snap can change width and collapsed at
  // once, and a reload must not restore half a gesture.
  const apply = SIDENAV_CODE.slice(SIDENAV_CODE.indexOf('const applySidebarState'))
  assert.match(apply, /SIDEBAR_COLLAPSED_KEY/)
  assert.match(apply, /SIDEBAR_WIDTH_KEY/)
  // Storage is written once per interaction, not once per pointer event.
  assert.match(apply, /if \(!commit\) return/)
})
