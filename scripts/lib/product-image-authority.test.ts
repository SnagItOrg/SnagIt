/**
 * PAN-133 — the product-image precedence has exactly one authority.
 *
 * THE DEFECT THIS LOCKS OUT. `kg_product` carries two image columns:
 * `hero_image_url` (curated, written by `/admin/image`) and `image_url`
 * (ingested, written by a Reverb pull or a storage upload). They mean
 * different things and both stay. What caused two production bugs is that
 * each surface decided its own precedence between them:
 *
 *   PAN-110  a TR-909 re-pull wrote `image_url` while the product page read
 *            `hero_image_url` — the re-pull changed a field nobody read.
 *   PAN-133  `/admin/image` wrote `hero_image_url` while
 *            `browse_product_projection` selected `image_url` alone — 16
 *            public products showed nothing or a stale picture on every card,
 *            and `has_image` was false for 13 rows that had an image.
 *
 * Same two columns, opposite directions. A third surface would have got it
 * wrong again. So the sentence "the curated image wins, the ingested one is
 * the fallback, blank counts as absent" is now written exactly twice — once in
 * TypeScript, once in SQL — and these tests fail closed if a third appears.
 *
 * WHY AN ALLOWLIST AND NOT A PATTERN HUNT. PAN-129 established the shape: a
 * reviewed set that a newcomer cannot join silently. You cannot re-derive a
 * precedence between two columns without naming one of them, so pinning the
 * set of files that may *mention* `hero_image_url` catches every form the
 * mistake can take — `??`, `||`, `coalesce`, a ternary, a helper — including
 * ones nobody thought to write a regex for.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { resolveProductImage } from '../../frontend/lib/product-image-source'

const ROOT = join(__dirname, '..', '..')
const RESOLVER = 'frontend/lib/product-image-source.ts'
const MIGRATION = 'scripts/migrations/058_browse_projection_resolves_curated_image.sql'
const ROLLBACK = 'scripts/migrations/058_rollback.sql'

/* ------------------------------------------------------------------ *
 * 1. The resolver itself — the behaviour everything else delegates to
 * ------------------------------------------------------------------ */

test('resolver: the curated image wins', () => {
  assert.deepEqual(
    resolveProductImage({ hero_image_url: 'https://cdn/hero.webp', image_url: 'https://cdn/ingested.webp' }),
    { url: 'https://cdn/hero.webp', source: 'curated' },
  )
})

test('resolver: the ingested image is the fallback', () => {
  assert.deepEqual(
    resolveProductImage({ hero_image_url: null, image_url: 'https://cdn/ingested.webp' }),
    { url: 'https://cdn/ingested.webp', source: 'ingested' },
  )
})

test('resolver: a curated image with no ingested one is still shown', () => {
  // This is the exact state of 13 of the 16 affected production rows.
  assert.deepEqual(
    resolveProductImage({ hero_image_url: 'https://cdn/hero.webp', image_url: null }),
    { url: 'https://cdn/hero.webp', source: 'curated' },
  )
})

test('resolver: blank is not a value, in either column', () => {
  // A cleared admin field must fall THROUGH, not render src="".
  assert.deepEqual(
    resolveProductImage({ hero_image_url: '   ', image_url: 'https://cdn/ingested.webp' }),
    { url: 'https://cdn/ingested.webp', source: 'ingested' },
  )
  assert.deepEqual(resolveProductImage({ hero_image_url: '', image_url: '  ' }), { url: null, source: null })
})

test('resolver: no image is reported honestly, not as an empty string', () => {
  assert.deepEqual(resolveProductImage({ hero_image_url: null, image_url: null }), { url: null, source: null })
  assert.deepEqual(resolveProductImage({}), { url: null, source: null })
})

test('resolver: surrounding whitespace is trimmed off the returned url', () => {
  assert.equal(resolveProductImage({ hero_image_url: '  https://cdn/hero.webp \n' }).url, 'https://cdn/hero.webp')
})

test('resolver: it is import-free, so a client bundle can reach it safely', () => {
  // The reason `catalogue.ts` and `publication.ts` are import-free, and the
  // reason this module is NOT called `product-image.ts`: that name belongs to
  // PAN-100's server-only pipeline, which value-imports `sharp`.
  const src = readFileSync(join(ROOT, RESOLVER), 'utf8')
  const imports = [...src.matchAll(/^\s*import\s/gm)]
  assert.deepEqual(imports.map((m) => m[0].trim()), [], `${RESOLVER} must import nothing`)
})

/* ------------------------------------------------------------------ *
 * 2. The allowlist — a new file cannot join it silently
 * ------------------------------------------------------------------ */

/**
 * Every non-test source file that may name `hero_image_url`, and why.
 *
 * TO ADD ONE: say what it does with the column. If the answer is "decides
 * which of the two images to show", the answer is wrong — call
 * `resolveProductImage()` instead.
 */
const MAY_NAME_THE_COLUMN: Record<string, string> = {
  [RESOLVER]: 'THE AUTHORITY. The precedence is defined here and nowhere else in TypeScript.',
  'frontend/lib/product-image.ts': 'PAN-100 curation pipeline. Server-only (imports sharp); names the column in its docblock to explain why curated heroes get their own storage prefix.',
  'frontend/lib/public-product.ts': 'The public read contract. SELECTs and transports both columns to the product page; decides nothing.',
  'frontend/lib/i18n.ts': 'Two operator-facing sentences in the admin image panel that name the column literally, in Danish and English.',
  'frontend/app/admin/images/page.tsx': 'The curation queue. Declares the row type and names the column in its SELECT; resolves through the resolver.',
  'frontend/app/admin/images/ImageCurationClient.tsx': 'Types the /admin/image API response, which echoes the stored hero back.',
  'frontend/app/admin/product/[slug]/page.tsx': 'Declares the row type and names the column in its SELECT; resolves through the resolver.',
  'frontend/app/api/admin/product/[slug]/image/route.ts': 'THE WRITER. The only thing in the app that writes hero_image_url.',
  'frontend/app/(shell)/product/[slug]/page.tsx': 'Declares the Product type it receives; resolves through the resolver.',
  'scripts/set-category-images.ts': 'Ranks products by picture quality for a category tile, which legitimately distinguishes curated from ingested. Its bestImage() delegates to the resolver.',
  'scripts/set-hero-images.ts': 'A one-shot operator writer for hero_image_url.',
  'scripts/promote-csp-images.ts': 'Names the column in a comment, to record that it never touches it.',
}

/** Source files under frontend/ and scripts/, excluding tests and build output. */
function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(full.replace(`${ROOT}/`, ''))
      }
    }
  }
  walk(join(ROOT, 'frontend'))
  walk(join(ROOT, 'scripts'))
  return out.sort()
}

test('authority: the walker actually finds the source tree', () => {
  // A walker that found nothing would pass every assertion below vacuously.
  const files = sourceFiles()
  assert.ok(files.length > 100, `expected a real source tree, found ${files.length} files`)
  assert.ok(files.includes(RESOLVER), 'the resolver itself must be in the walked set')
})

test('authority: no unreviewed file names hero_image_url', () => {
  const namers = sourceFiles().filter((f) => readFileSync(join(ROOT, f), 'utf8').includes('hero_image_url'))
  const unreviewed = namers.filter((f) => !(f in MAY_NAME_THE_COLUMN))

  assert.deepEqual(
    unreviewed,
    [],
    'a file outside the reviewed set reads or writes hero_image_url directly. ' +
      'If it needs to know which image a product shows, call resolveProductImage() from ' +
      `@/lib/product-image-source. If it has another reason, add it to MAY_NAME_THE_COLUMN in ${__filename} with that reason.`,
  )
})

test('authority: the allowlist has no stale entries', () => {
  // An entry that no longer names the column would quietly widen the gate.
  const namers = new Set(sourceFiles().filter((f) => readFileSync(join(ROOT, f), 'utf8').includes('hero_image_url')))
  const stale = Object.keys(MAY_NAME_THE_COLUMN).filter((f) => !namers.has(f))
  assert.deepEqual(stale, [], 'these files no longer name hero_image_url and should leave MAY_NAME_THE_COLUMN')
})

test('authority: not even an allowed file may re-derive the precedence', () => {
  // Being on the list buys the right to NAME the column, never to choose
  // between the two. `??`, `||` and `coalesce` are how that choice gets
  // written; the resolver is the one file allowed to write it.
  // Both columns, around a choosing operator, in either order. `(?<!hero_)`
  // matters: `image_url` is a substring of `hero_image_url`, so without it
  // `if (!res.ok || !body.hero_image_url)` — an ordinary boolean OR — reads as
  // a precedence and the test cries wolf.
  const OP = String.raw`(\?\?|\|\||coalesce)`
  const GAP = String.raw`[^\n]{0,40}`
  const curatedFirst = new RegExp(`hero_image_url${GAP}${OP}${GAP}(?<!hero_)image_url`, 'i')
  const ingestedFirst = new RegExp(`(?<!hero_)image_url${GAP}${OP}${GAP}hero_image_url`, 'i')

  const offenders: string[] = []
  for (const file of sourceFiles()) {
    if (file === RESOLVER) continue
    const src = readFileSync(join(ROOT, file), 'utf8')
    for (const line of src.split('\n')) {
      if (!line.includes('hero_image_url')) continue
      const t = line.trimStart()
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue // prose, not code
      if (curatedFirst.test(line) || ingestedFirst.test(line)) offenders.push(`${file}: ${line.trim()}`)
    }
  }
  assert.deepEqual(offenders, [], 'the image precedence is re-derived outside resolveProductImage()')
})

test('authority: the browse read path holds no opinion about the columns', () => {
  // `lib/browse.ts` reads `browse_product_projection`, which resolves the
  // precedence in SQL. It must consume `image_url` from the view and never
  // reach for the raw columns — that reach is exactly what PAN-133 was.
  const src = readFileSync(join(ROOT, 'frontend/lib/browse.ts'), 'utf8')
  assert.equal(src.includes('hero_image_url'), false, 'lib/browse.ts must read the resolved view, not the raw columns')
})

/* ------------------------------------------------------------------ *
 * 3. The SQL half says the same sentence
 * ------------------------------------------------------------------ */

test('sql: the projection computes the precedence once and reads it twice', () => {
  const sql = readFileSync(join(ROOT, MIGRATION), 'utf8')

  // One LATERAL holds the rule...
  assert.match(sql, /LEFT JOIN LATERAL \(\s*SELECT COALESCE\(/, 'the precedence must be computed in one place')
  // ...and both outputs read that one value, so they cannot disagree.
  assert.match(sql, /image_resolved\.url AS image_url/)
  assert.match(sql, /\(image_resolved\.url IS NOT NULL\) AS has_image/)

  // Exactly one COALESCE over the two columns — not one per output column.
  const coalesces = sql.match(/COALESCE\(\s*NULLIF\(btrim/g) ?? []
  assert.equal(coalesces.length, 1, 'the precedence is written more than once in the migration')
})

test('sql: the migration agrees with the resolver that blank is not a value', () => {
  const sql = readFileSync(join(ROOT, MIGRATION), 'utf8')
  // btrim/NULLIF on BOTH columns, mirroring resolveProductImage()'s trim rule.
  assert.match(sql, /NULLIF\(btrim\(COALESCE\(p\.hero_image_url, ''\)\), ''\)/)
  assert.match(sql, /NULLIF\(btrim\(COALESCE\(p\.image_url, ''\)\), ''\)/)
})

test('sql: the migration writes no data', () => {
  // The whole point of resolving at read time is that no backfill is needed.
  // A stray UPDATE here would be an unauthorised production write.
  const sql = readFileSync(join(ROOT, MIGRATION), 'utf8')
  const body = sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
  for (const verb of [/\bUPDATE\s+kg_product\b/i, /\bINSERT\s+INTO\b/i, /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i]) {
    assert.equal(verb.test(body), false, `migration 058 must perform no DML (matched ${verb})`)
  }
})

test('sql: the view is replaced, never dropped, so its GRANTs survive', () => {
  // DROP + CREATE would strip the anon/authenticated SELECT that PostgREST
  // needs and blank /browse for every visitor.
  for (const file of [MIGRATION, ROLLBACK]) {
    const sql = readFileSync(join(ROOT, file), 'utf8')
    const body = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    assert.match(sql, /CREATE OR REPLACE VIEW browse_product_projection/, `${file} must use CREATE OR REPLACE`)
    assert.equal(/DROP VIEW/i.test(body), false, `${file} must not drop the view`)
  }
})

test('sql: the rollback restores the 036 definition exactly', () => {
  const rollback = readFileSync(join(ROOT, ROLLBACK), 'utf8')
  assert.match(rollback, /^ {2}p\.image_url,$/m, 'the rollback must restore 036\'s plain p.image_url')
  assert.match(
    rollback,
    /\(NULLIF\(btrim\(COALESCE\(p\.image_url, ''\)\), ''\) IS NOT NULL\) AS has_image/,
    "the rollback must restore 036's has_image expression",
  )
  const body = rollback.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
  assert.equal(body.includes('image_resolved'), false, 'the rollback must drop the LATERAL')
})

test('sql: the rehearsal reproduces the defect before it fixes it', () => {
  // An "after" assertion alone would pass against a view that was never
  // broken. The rehearsal must show the hero-only row invisible under 036.
  const sh = readFileSync(join(ROOT, 'scripts/verify-migrations-isolated.sh'), 'utf8')
  assert.match(sh, /DEFECT REPRODUCED/, 'the rehearsal must assert the before state, not only the after')
  assert.match(sh, /browse_projection_fixture\.sql/)
  assert.ok(
    existsSync(join(ROOT, 'scripts/fixtures/browse_projection_fixture.sql')),
    'the 058 rehearsal fixture must exist',
  )
})
