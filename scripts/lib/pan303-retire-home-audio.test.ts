/**
 * scripts/lib/pan303-retire-home-audio.test.ts
 *
 * PAN-303 (owner, 2026-10-27): "Hi-fi & hjemmelyd" (`home-audio`) is too broad and consumer for music professionals.
 * Its one public product, the Neumann NDH 20, moves to a new kind `pro-audio/studio-headphones` by guarded SQL that
 * runs BEFORE this code deploys; this code then leaves the root out of every surface through the one exclusion list
 * (PAN-270), and 308s its old URLs to the new kind.
 *
 * Run: npx tsx --test scripts/lib/pan303-retire-home-audio.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  EXCLUDED_ROOT_SLUGS,
  RETIRED_ROOT_TARGETS,
  buildHomeCategories,
  isRenderableRoot,
  retiredRootTarget,
} from '../../frontend/lib/home-categories'
import { buildCatalogueTree, subcategoryHref, type CatalogueTreeRow } from '../../frontend/lib/catalogue-tree'
import { placeholderIcon } from '../../frontend/lib/placeholder-icon'

const TARGET = '/browse/pro-audio/studio-headphones'

test('home-audio is excluded from every surface, through the one list', () => {
  assert.equal(EXCLUDED_ROOT_SLUGS.has('home-audio'), true)
  assert.equal(isRenderableRoot({ slug: 'home-audio', domain: 'music', parent_id: null }), false)
  // The shelf drops it even while it still holds a public row: between the SQL and the deploy, or if a row is
  // published there again by mistake, the card cannot come back.
  const shelf = buildHomeCategories(
    [
      { id: 'id:home-audio', slug: 'home-audio', name_da: 'Hi-fi & hjemmelyd', name_en: 'Home Audio', domain: 'music', parent_id: null, image_url: null },
      { id: 'id:pro-audio', slug: 'pro-audio', name_da: 'Studieudstyr', name_en: 'Studio Equipment', domain: 'music', parent_id: null, image_url: null },
    ],
    ['id:home-audio', 'id:pro-audio'],
  )
  assert.deepEqual(shelf.map((c) => c.slug), ['pro-audio'])
})

test('every old home-audio URL 308s to the studio headphones kind, and nothing else does', () => {
  assert.deepEqual(RETIRED_ROOT_TARGETS, { 'home-audio': TARGET })
  for (const path of [
    '/browse/home-audio',
    '/browse/home-audio/',
    // The one kind that answered 200 and was in the sitemap, and any other kind under the root.
    '/browse/home-audio/closed-back-headphones',
    '/browse/home-audio/bookshelf-speakers/',
  ]) {
    assert.equal(retiredRootTarget(path), TARGET, path)
  }
  for (const path of [
    '/browse', '/browse/pro-audio', '/browse/pro-audio/studio-headphones', '/browse/home-audio-x',
    '/browse/home-audio/a/b', '/product/neumann-ndh-20', '/home-audio', '/browse/accessories',
  ]) {
    assert.equal(retiredRootTarget(path), null, path)
  }
})

test('the redirect target is the URL the tree gives the new kind', () => {
  const ndh: CatalogueTreeRow = {
    slug: 'neumann-ndh-20', canonical_name: 'Neumann NDH 20',
    root_category_slug: 'pro-audio', root_category_name_da: 'Studieudstyr', root_category_name_en: 'Studio Equipment',
    subcategory_slug: 'pro-audio/studio-headphones', subcategory_name_da: 'Studiehovedtelefoner', subcategory_name_en: 'Studio Headphones',
  }
  const tree = buildCatalogueTree([ndh], { synthesizers: { name_da: 'Synthesizere', name_en: 'Synthesizers' } })
  const pro = tree.find((c) => c.slug === 'pro-audio')
  const kind = pro?.subcategories.find((s) => s.slug === 'studio-headphones')
  assert.ok(kind, 'pro-audio has a studio-headphones node')
  assert.deepEqual(kind.product_slugs, ['neumann-ndh-20'])
  assert.equal(subcategoryHref('pro-audio', kind.slug), TARGET)
})

test('the middleware answers the retired root ahead of the ?sub= rule and the auth client', () => {
  const src = readFileSync(join(__dirname, '../../frontend/middleware.ts'), 'utf8')
  const retired = src.indexOf('retiredRootTarget(request.nextUrl.pathname)')
  const sub = src.indexOf("request.nextUrl.searchParams.get('sub')")
  const auth = src.indexOf('createServerClient(')
  assert.ok(retired > 0 && retired < sub && sub < auth, 'order: retired root, then ?sub=, then auth')
  assert.match(src, /NextResponse\.redirect\(new URL\(retiredTarget, request\.url\), 308\)/)
})

test('the new kind has the headphones placeholder', () => {
  assert.equal(placeholderIcon('pro-audio', 'pro-audio/studio-headphones'), 'headphones')
})
