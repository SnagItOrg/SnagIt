/**
 * PAN-121 — the position signal, and the count that may not lie.
 *
 * The acceptance criterion this file exists for: "a result count that equals
 * the rendered rows. Assert that equality in a test; it is the invariant
 * PAN-98 exists because nobody asserted."
 *
 * PAN-98's number was 187 advertised against 75 rendered on `fender-telecaster`
 * — a projection column counting one set while the page mapped over another.
 * So the tests below assert two different things, and both are needed:
 *
 *   1. that `buildPositionSignal` cannot produce a count that differs from the
 *      rows it was handed, and
 *   2. that each of the four routes hands it the array it actually renders,
 *      which is the half a pure-function test can never see.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { buildPositionSignal } from '../../frontend/lib/position-signal'
import { currentCatalogueNode } from '../../frontend/lib/catalogue-tree'
import { translations } from '../../frontend/lib/i18n'

const ROOT = join(__dirname, '..', '..')
const read = (...parts: string[]) => readFileSync(join(ROOT, 'frontend', ...parts), 'utf8')

const ROUTES = {
  browse: read('app', '(shell)', 'browse', 'page.tsx'),
  browseRoot: read('app', '(shell)', 'browse', '[root]', 'page.tsx'),
  search: read('app', '(shell)', 'search', 'page.tsx'),
  family: read('app', '(shell)', 'family', '[slug]', 'page.tsx'),
}
const COMPONENT = read('components', 'PositionSignal.tsx')
const MODULE = read('lib', 'position-signal.ts')

/**
 * Structural assertions must read the code, not the prose about it.
 *
 * Both of these files explain in comments what they refuse to do — "an
 * `opacity-60` treatment measured 2.61:1", "the `<h1>` above already names the
 * category" — and a naive `includes()` over the raw file fails on the very
 * sentence documenting the rule. Strip comments first and the assertion means
 * what it says.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

const COMPONENT_CODE = stripComments(COMPONENT)

test('the count is the rendered rows, at PAN-98 numbers and at the edges', () => {
  // The exact shape of PAN-98: a projection said 187, the page rendered 75.
  // The only number this module can reach is the length of the array it was
  // given, so the 187 has nowhere to enter from.
  const rendered = Array.from({ length: 75 }, (_, i) => ({ slug: `row-${i}` }))
  const signal = buildPositionSignal({ scope: 'Fender Telecaster', renderedRows: rendered })

  assert.equal(signal.count, 75)
  assert.equal(signal.count, rendered.length)
  assert.notEqual(signal.count, 187)

  // Filtering narrows the rendered array, and the count follows it down rather
  // than staying at the unfiltered total — the subcategory-chip case.
  const filtered = rendered.slice(0, 12)
  const narrowed = buildPositionSignal({
    scope: 'Fender Telecaster',
    renderedRows: filtered,
    filters: [{ id: 'telecaster-deluxe', kind: 'subcategory', label: 'Telecaster Deluxe' }],
  })
  assert.equal(narrowed.count, 12)
  assert.equal(narrowed.unfiltered, false)

  // Zero rendered rows is a real answer and must be reported as zero, not
  // suppressed into the unfiltered total.
  assert.equal(buildPositionSignal({ scope: 'x', renderedRows: [] }).count, 0)
  assert.equal(buildPositionSignal({ scope: 'x', renderedRows: [] }).unfiltered, true)

  // One row, so the singular copy path is exercised by a real count.
  assert.equal(buildPositionSignal({ scope: 'x', renderedRows: [{}] }).count, 1)
})

test('the signature offers no way to pass a count that is not the rows', () => {
  // The structural half of the guarantee. `renderedRows` is the only input the
  // count is derived from, and it is an array — there is no numeric field a
  // projection total could travel in, in the same way `FamilyListing` has no
  // field a price could travel in. If this ever becomes `count: number`, the
  // PAN-98 class of bug is reachable again by a single careless call site.
  assert.match(MODULE, /renderedRows: readonly Row\[\]/)
  assert.match(MODULE, /count: input\.renderedRows\.length/)

  // The argument object of `buildPositionSignal`, comments removed. A `count`
  // in here is the whole PAN-98 failure mode re-opened.
  const signature = stripComments(MODULE).slice(
    stripComments(MODULE).indexOf('export function buildPositionSignal'),
  )
  const argumentObject = signature.slice(0, signature.indexOf('): PositionSignal'))
  assert.equal(
    /count\s*[?:]/.test(argumentObject),
    false,
    'buildPositionSignal must not accept a count argument',
  )
})

test('every public listing surface mounts the signal on the rows it renders', () => {
  for (const [name, source] of Object.entries(ROUTES)) {
    assert.match(source, /<PositionSignal/, `${name} must mount the position signal`)
    assert.match(source, /buildPositionSignal\(/, `${name} must build it`)
  }

  // `/browse/[root]` is the PAN-98 route. It must count `filteredProducts` —
  // the array its grid maps over, after the subcategory chip — and must never
  // hand the projection total to the signal.
  const browseRoot = ROUTES.browseRoot
  assert.match(browseRoot, /renderedRows: filteredProducts/)
  assert.match(browseRoot, /\{filteredProducts\.map\(/)
  assert.equal(
    /renderedRows:\s*[^\n]*total_public_products/.test(browseRoot),
    false,
    'the projection total must never be the counted set',
  )

  // `/search` counts `options`, which is the memo both result branches render
  // — candidates when there are any, suggestions otherwise. Counting
  // `outcome.candidates` would report 0 on a screen showing suggestions.
  assert.match(ROUTES.search, /renderedRows: options/)

  // `/family/[slug]` counts the eligible children it maps into cards, not the
  // configured `family.children` list, which includes ineligible slugs.
  assert.match(ROUTES.family, /renderedRows: children/)
  assert.match(ROUTES.family, /\{children\.map\(/)
  assert.equal(/renderedRows:\s*family\.children/.test(ROUTES.family), false)

  // `/browse` counts the category tiles it renders.
  assert.match(ROUTES.browse, /renderedRows: data\.categories/)
  assert.match(ROUTES.browse, /\{data\.categories\.map\(/)
})

test('an active filter is removable by keyboard and announces what it removed', () => {
  // A real <button>, so Tab reaches it and Enter/Space activate it without any
  // key handler of our own. A div with onClick would pass a pointer test and
  // fail every keyboard visitor.
  assert.match(COMPONENT_CODE, /<button\s/)
  assert.match(COMPONENT_CODE, /type="button"/)
  assert.match(COMPONENT_CODE, /aria-label=\{fill\(t\.positionSignalRemoveFilter/)

  // Removal changes the result set without moving focus, so it must be spoken.
  assert.match(COMPONENT_CODE, /aria-live="polite"/)
  assert.match(COMPONENT, /positionSignalFilterRemoved/)
  assert.match(COMPONENT_CODE, /setLastRemoved\(/)

  // Round 2: on `/browse/[root]` the facet row is the one anchor and the chip
  // is not rendered. The facet must still reach the model — dropping it would
  // make the signal claim "no filters" while one is in force — and the row
  // that replaced the chip must expose its state and announce the change.
  assert.match(ROUTES.browseRoot, /<PositionSignal signal=\{positionSignal\} filtersShownByPage \/>/)
  assert.match(ROUTES.browseRoot, /filters: activeSubcategory/)
  assert.match(ROUTES.browseRoot, /aria-pressed=\{activeSubcat === null\}/)
  assert.match(ROUTES.browseRoot, /aria-pressed=\{activeSubcat === s\.slug\}/)
  assert.match(COMPONENT_CODE, /filtersShownByPage \? \(\s*<p aria-live="polite"/)
  // `/search` keeps its removable query chip: nothing else on that page removes it.
  assert.match(ROUTES.search, /onRemoveFilter=\{handleClearQuery\}/)

  // The removal handler runs before the caller's, so the announcement is not
  // lost to a re-render that unmounts the chip.
  const handler = COMPONENT.slice(COMPONENT.indexOf('function handleRemove'))
  assert.ok(
    handler.indexOf('setLastRemoved') < handler.indexOf('onRemoveFilter?.'),
    'announce the removal before delegating it',
  )
})

test('the signal is never green, and never signals state with opacity', () => {
  // Green is exhaustive — Kup-rating, the Aktiv badge, `under typisk`. A
  // filter chip is the visitor's own narrowing, not a Klup judgement.
  for (const token of ['--accent', '--primary', '#13ec6d', '#16d96b', 'green']) {
    assert.equal(
      COMPONENT_CODE.includes(token),
      false,
      `PositionSignal must not reference ${token}`,
    )
  }

  // PAN-113 measured an opacity-60 state treatment at 2.61:1 and failed it.
  // Active state here is weight, fill and border — since the owner's
  // 2026-09-24 comment, all three in `--here`, the one "you are here" colour.
  assert.equal(/opacity-\d/.test(COMPONENT_CODE), false, 'state must not be carried by opacity')
  assert.match(COMPONENT_CODE, /background: 'var\(--here-subtle\)'/)
  assert.match(COMPONENT_CODE, /border: '1px solid var\(--here-border\)'/)
  assert.match(COMPONENT_CODE, /color: 'var\(--here\)'/)
  assert.match(COMPONENT_CODE, /font-semibold/)

  // Motion comes from the existing tokens, never a new literal.
  assert.match(COMPONENT_CODE, /var\(--duration-fast\)/)
  assert.match(COMPONENT_CODE, /var\(--ease-standard\)/)
  assert.equal(/\b\d+ms\b/.test(COMPONENT_CODE), false, 'no literal durations')
})

test('every string is a translation key, present in both locales', () => {
  const keys = [
    'positionSignalRegion',
    'positionSignalUnfiltered',
    'positionSignalAllCategories',
    'positionSignalResultOne',
    'positionSignalResultMany',
    'positionSignalCategoryOne',
    'positionSignalCategoryMany',
    'positionSignalQueryFilter',
    'positionSignalRemoveFilter',
    'positionSignalFilterRemoved',
  ] as const

  for (const key of keys) {
    assert.ok(key in translations.da, `da is missing ${key}`)
    assert.ok(key in translations.en, `en is missing ${key}`)
    assert.ok((translations.da[key] as string).length > 0)
    assert.ok((translations.en[key] as string).length > 0)
  }

  // The templates must carry their placeholder, or `fill` silently renders the
  // sentence without its number.
  for (const locale of ['da', 'en'] as const) {
    for (const key of ['positionSignalResultOne', 'positionSignalResultMany',
      'positionSignalCategoryOne', 'positionSignalCategoryMany'] as const) {
      assert.match(translations[locale][key] as string, /\{count\}/)
    }
    assert.match(translations[locale].positionSignalQueryFilter as string, /\{query\}/)
    assert.match(translations[locale].positionSignalRemoveFilter as string, /\{label\}/)
    assert.match(translations[locale].positionSignalFilterRemoved as string, /\{label\}/)
  }

  // No raw Danish in the component.
  for (const word of ['resultat', 'Fjern', 'kategori', 'Ingen']) {
    assert.equal(COMPONENT_CODE.includes(`'${word}`), false, `raw Danish '${word}' in component`)
  }
})

test('the region leaves room for PAN-124 breadcrumb without a second bar', () => {
  // The region is a vertical stack: a position line the breadcrumb can take,
  // and a narrowing line the chips own. PAN-124 replaces the scope line in
  // place; if this were one flat row, a breadcrumb would have to become a
  // second bar of similar weight competing for the same "where am I" job.
  assert.match(COMPONENT_CODE, /className="flex flex-col gap-1\.5 py-3"/)
  assert.match(COMPONENT, /THE POSITION LINE/)
  assert.match(COMPONENT, /THE NARROWING LINE/)

  // The scope line is not a heading and does not restate the <h1> at title
  // weight.
  assert.equal(/<h[1-6][\s>]/.test(COMPONENT_CODE), false, 'the signal owns no heading level')

  // PAN-121 moves neither existing breadcrumb; PAN-124 unifies them.
  assert.match(ROUTES.browseRoot, /\{t\.browseAllCategories\}/)
})

test('the signal never restates the heading the page already shows', () => {
  // Found by looking at the screenshots, not by a unit test: on
  // `/browse/[root]` the category name was the breadcrumb tail, the <h1> and
  // then the signal's scope line — three position statements stacked, which is
  // precisely what one signal is supposed to prevent. Same on `/family/[slug]`
  // minus the breadcrumb.
  assert.equal(/scope: categoryName/.test(ROUTES.browseRoot), false)
  assert.equal(/scope: family\.label/.test(ROUTES.family), false)

  // Where the heading is a generic page title rather than the scope, the scope
  // carries real information and is rendered.
  assert.match(ROUTES.browse, /scope: t\.positionSignalAllCategories/)
  assert.match(ROUTES.search, /scope: t\.positionSignalAllCategories/)

  // And the component must tolerate its absence rather than rendering a blank
  // line where the scope used to be.
  assert.match(COMPONENT_CODE, /\{signal\.scope && \(/)
  const noScope = buildPositionSignal({ renderedRows: [{}, {}] })
  assert.equal(noScope.scope, undefined)
  assert.equal(noScope.count, 2)
})

/**
 * The sidenav half, moved into this ticket by the owner on 2026-09-23.
 *
 * Krug's Trunk Test diagnostic — "no 'you are here' indicator" is answered by
 * highlighting the current section in nav *and* breadcrumbs. This is the nav
 * half; PAN-124 owns the breadcrumb half. The sidebar and the filter chips must
 * state one truth, which is only possible because the facet moved into the URL.
 */
const SIDENAV_CODE = stripComments(read('components', 'SideNav.tsx'))

test('the sidebar marks where you are, with aria-current="page"', () => {
  // There was not one occurrence anywhere in this file before this ticket.
  const occurrences = SIDENAV_CODE.match(/aria-current=/g) ?? []
  assert.ok(
    occurrences.length >= 4,
    `expected aria-current at every level of the tree, found ${occurrences.length}`,
  )

  // `aria-current="true"` is weaker and is not the same statement.
  for (const m of SIDENAV_CODE.matchAll(/aria-current=\{([^}]*)\}/g)) {
    assert.match(m[1], /'page'/, `aria-current must resolve to 'page': ${m[1]}`)
    assert.match(m[1], /undefined/, 'aria-current must be absent, not false, when not current')
  }
})

test('the sidebar and the filter chips read the same facet', () => {
  // The agreement is only possible because the facet is in the URL. If
  // `/browse/[root]` ever returns the subcategory to component state, the
  // sidebar silently stops marking the current leaf.
  assert.match(ROUTES.browseRoot, /searchParams\.get\('sub'\)/)
  assert.match(SIDENAV_CODE, /searchParams\.get\('sub'\)/)

  // Both sides compare the bare leaf slug, with no second normalisation in the
  // sidebar that could drift from the route's.
  assert.match(SIDENAV_CODE, /\?sub=\$\{encodeURIComponent\(sub\.slug\)\}/)

  // PAN-125 moved the predicate out of the renderer and into
  // `lib/catalogue-tree.ts`, so the property is asserted where it now lives —
  // behaviourally, against the real function, rather than by matching the
  // source that used to hold it. A filtered view marks the subcategory and the
  // branch stops claiming it: exactly one node, still.
  const cats = [{
    slug: 'keyboards-and-synths',
    name_da: 'Synthesizere & keyboards',
    name_en: 'Keyboards and Synths',
    product_count: 27,
    subcategories: [{
      slug: 'drum-machines',
      name_da: 'Trommemaskiner',
      name_en: 'Drum Machines',
      product_count: 6,
      products: [{ slug: 'roland-tr-808', label: 'Roland TR-808' }],
    }],
    direct_product_count: 16,
    products: [{ slug: 'roland-juno-106', label: 'Roland Juno-106' }],
  }]

  assert.deepEqual(
    currentCatalogueNode(cats, '/browse/keyboards-and-synths', null),
    { kind: 'branch', categorySlug: 'keyboards-and-synths' },
  )
  assert.deepEqual(
    currentCatalogueNode(cats, '/browse/keyboards-and-synths', 'drum-machines'),
    { kind: 'subcategory', categorySlug: 'keyboards-and-synths', subcategorySlug: 'drum-machines' },
  )
  // Round 2: a facet `?sub=` still filters the page, but the sidebar marks the
  // root — the facet is not a node. Still exactly one mark.
  assert.deepEqual(
    currentCatalogueNode(cats, '/browse/keyboards-and-synths', 'analog-synths'),
    { kind: 'branch', categorySlug: 'keyboards-and-synths' },
  )

  // The facet must not reappear as component state beside the URL.
  assert.equal(
    /const \[activeSubcat, setActiveSubcat\] = useState/.test(ROUTES.browseRoot),
    false,
    'the subcategory facet must live in the URL, not in component state',
  )
})

test('the sidebar indicator is weight, fill and a rail — never green', () => {
  // The selected state must survive colour being ignored, so all three
  // non-colour signals have to be present.
  assert.match(SIDENAV_CODE, /border-l-2/)
  assert.match(SIDENAV_CODE, /font-(semibold|bold)/)
  assert.match(SIDENAV_CODE, /backgroundColor: isCurrent(Branch|Sub) \? 'var\(--here-subtle\)'/)

  for (const token of ['--accent', '#13ec6d', '#16d96b']) {
    assert.equal(
      SIDENAV_CODE.includes(token),
      false,
      `the sidebar indicator must not reference ${token}`,
    )
  }
})

test('the facet in the URL keeps the filtered view linkable and reversible', () => {
  // `replace` not `push`, so toggling chips does not build a back-button trail
  // of every facet the visitor tried; `scroll: false`, because refining a view
  // is not arriving at a new page.
  assert.match(ROUTES.browseRoot, /router\.replace\(/)
  assert.match(ROUTES.browseRoot, /scroll: false/)
})

/**
 * `--here` is exhaustive, like green — so the list is asserted, not trusted.
 *
 * The owner asked for ONE "you are here" colour, "used consistently and
 * mindfully". A colour that marks location stops meaning location the first
 * time it lands on a button, which is exactly how a helpful next agent would
 * spread it. This fails the moment any file outside the list in
 * frontend/CLAUDE.md reads the token, and when a listed file stops using it
 * altogether (so the list cannot rot into a superset).
 */
test('the "you are here" colour appears only at its permitted sites', () => {
  const PERMITTED = [
    'app/globals.css',
    'components/SideNav.tsx',
    'components/Breadcrumb.tsx',
    'components/PositionSignal.tsx',
    'components/BottomNav.tsx',
    'app/(shell)/browse/[root]/page.tsx',
  ]
  const frontend = join(ROOT, 'frontend')
  const users: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(tsx?|css)$/.test(name) && /--here\b/.test(stripComments(readFileSync(full, 'utf8')))) {
        users.push(full.slice(frontend.length + 1))
      }
    }
  }
  for (const top of ['app', 'components', 'lib']) walk(join(frontend, top))

  assert.deepEqual(users.sort(), [...PERMITTED].sort())

  // Never beside green: a location mark is not a Klup judgement.
  for (const file of PERMITTED.filter((f) => f.endsWith('.tsx'))) {
    for (const line of stripComments(read(...file.split('/'))).split('\n')) {
      if (line.includes('--here')) {
        assert.equal(/--accent|#13ec6d|#16d96b/.test(line), false, `${file}: --here beside green`)
      }
    }
  }
})
