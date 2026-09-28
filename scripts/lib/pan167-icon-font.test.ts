/**
 * PAN-167 — the Material Symbols subset must carry every glyph the app draws.
 *
 * The icon font is requested with `icon_names=` (lib/icon-font.ts), which
 * brings it from 452 KB down to 7.5 KB. The price of that is a new failure mode. A glyph
 * drawn in code but missing from ICON_GLYPHS has no ligature in the subset
 * font, so its icon box stays empty in production and nothing else notices.
 *
 * Glyph names reach the DOM four ways in this codebase, and the scan reads all
 * four:
 *   <Icon name="x" />                      a literal
 *   <Icon name={c ? 'x' : 'y'} />          ternary branches
 *   { icon: 'x' } / icon="x" / glyph: 'x'  config rows and props forwarded to <Icon>
 *   <span className="material-symbols-outlined">x</span>   admin's raw spans
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { ICON_GLYPHS } from '../../frontend/lib/icon-font'

const FRONTEND = join(__dirname, '..', '..', 'frontend')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(p)
    return /\.tsx?$/.test(e.name) ? [p] : []
  })
}

/** glyph name -> files that draw it */
function drawnGlyphs(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const add = (name: string, file: string) => {
    const where = relative(FRONTEND, file)
    found.set(name, [...(found.get(name) ?? []), where])
  }
  const files = ['app', 'components', 'lib']
    .flatMap((d) => sourceFiles(join(FRONTEND, d)))
    .filter((f) => !f.endsWith(join('lib', 'icon-font.ts')))

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/<Icon\b[^>]*?\bname=\{?\s*["']([a-z0-9_]+)["']/g)) add(m[1], file)
    for (const m of src.matchAll(/<Icon\b[^>]*?\bname=\{([^}]*)\}/g)) {
      for (const q of m[1].matchAll(/[?:]\s*["']([a-z0-9_]+)["']/g)) add(q[1], file)
    }
    for (const m of src.matchAll(/\b(?:icon|glyph)\s*[:=]\s*\{?\s*["']([a-z0-9_]+)["']/g)) add(m[1], file)
    for (const m of src.matchAll(/material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*</g)) add(m[1], file)
  }
  return found
}

test('every glyph the app draws is in the icon-font subset', () => {
  const listed = new Set<string>(ICON_GLYPHS)
  const missing = [...drawnGlyphs()]
    .filter(([name]) => !listed.has(name))
    .map(([name, files]) => `${name} (${[...new Set(files)].join(', ')})`)
  assert.deepEqual(missing, [], `add these to ICON_GLYPHS in frontend/lib/icon-font.ts: ${missing.join('; ')}`)
})

test('every glyph in the subset is still drawn somewhere', () => {
  // Keeps the list from carrying dead weight. It also proves the scan above is
  // not passing vacuously: a broken pattern would find nothing, and then fail
  // here.
  const drawn = drawnGlyphs()
  const unused = ICON_GLYPHS.filter((name) => !drawn.has(name))
  assert.deepEqual(unused, [], `no longer drawn; remove from ICON_GLYPHS: ${unused.join(', ')}`)
})
