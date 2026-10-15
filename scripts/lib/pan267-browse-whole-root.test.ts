/**
 * PAN-267 — the browse leaf response carries the WHOLE root.
 *
 * The defect: /api/browse/[root] paged 48 products at a time, and the page
 * applied `?sub=` and the attribute facets over the pages it had loaded. The
 * moment a root exceeded one page (keyboards-and-synths reached 128 public
 * rows), every kind whose products sat on a later page rendered nothing until
 * "Vis flere" had been pressed — `?sub=grooveboxes` showed 0, then 1, then 2.
 *
 * These tests build a root of 49 public products whose only groovebox sorts
 * LAST, run the real `buildBrowseLeafResponse` against an in-memory Supabase
 * stand-in, and require the groovebox — and its chip — in the one response.
 * On the paged code the response held 48 rows and no groovebox.
 *
 * The root tsconfig maps `@/*` to `frontend/*` so this file can import the
 * builder itself rather than read its source.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildBrowseLeafResponse } from '../../frontend/lib/browse'

type Row = Record<string, unknown>

/**
 * The smallest PostgREST stand-in the builder needs: `from().select()` and the
 * filters it chains (`eq`, `is`, `in`, `neq`, `not`, `order`, `range`,
 * `maybeSingle`), resolved in `then()` against plain arrays. Anything the
 * builder does not call is deliberately absent, so a new query shape fails
 * loudly here instead of passing vacuously.
 */
function fakeAdmin(tables: Record<string, Row[]>): SupabaseClient {
  function query(table: string) {
    let rows = [...(tables[table] ?? [])]
    let single = false
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return q },
      neq: (col: string, v: unknown) => { rows = rows.filter((r) => r[col] !== v); return q },
      is: (col: string, v: unknown) => { rows = rows.filter((r) => (v === null ? r[col] == null : r[col] === v)); return q },
      in: (col: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[col])); return q },
      not: (col: string, op: string, v: unknown) => {
        assert.equal(op, 'is')
        rows = rows.filter((r) => !(v === null ? r[col] == null : r[col] === v))
        return q
      },
      order: (col: string) => { rows.sort((a, b) => String(a[col]).localeCompare(String(b[col]))); return q },
      range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return q },
      maybeSingle: () => { single = true; return q },
      then: (res: (v: { data: unknown; error: null }) => unknown, _rej?: unknown) =>
        Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null }).then(res),
    }
    return q
  }
  return { from: (table: string) => query(table) } as unknown as SupabaseClient
}

const ROOT_ID = 'root-keys'
const SYNTHS_ID = 'leaf-analog-synths'
const GROOVE_ID = 'leaf-grooveboxes'

function projectionRow(i: number, kind: 'synth' | 'groovebox'): Row {
  const slug = kind === 'synth' ? `synth-${String(i).padStart(2, '0')}` : 'roland-mc-303'
  return {
    id: `id-${slug}`,
    slug,
    canonical_name: kind === 'synth' ? `Synth ${String(i).padStart(2, '0')}` : 'Roland MC-303',
    brand_id: 'b', brand_slug: 'roland', brand_name: 'Roland',
    category_id: null, legacy_category_slug: null,
    subcategory_id: kind === 'synth' ? SYNTHS_ID : GROOVE_ID,
    subcategory_slug: kind === 'synth' ? 'keyboards-and-synths/analog-synths' : 'keyboards-and-synths/grooveboxes',
    subcategory_name_da: kind === 'synth' ? 'Analoge synths' : 'Grooveboxes',
    subcategory_name_en: kind === 'synth' ? 'Analog synths' : 'Grooveboxes',
    root_category_id: ROOT_ID, root_category_slug: 'keyboards-and-synths',
    root_category_name_da: 'Keyboards og synths', root_category_name_en: 'Keyboards and synths',
    browse_domain: 'music', status: 'active',
    // The groovebox sorts last: lowest tier rank, no listings.
    tier: kind === 'synth' ? 'legendary' : 'standard', tier_rank: kind === 'synth' ? 2 : 0,
    image_url: null, has_image: false,
    active_listing_count: kind === 'synth' ? 100 - i : 0,
    browse_visibility: 'public', taxonomy_state: 'classified',
    supply_state: kind === 'synth' ? 'live' : 'no_live_listings', is_public: true,
  }
}

function catalogue() {
  const projection = [...Array.from({ length: 48 }, (_, i) => projectionRow(i + 1, 'synth')), projectionRow(49, 'groovebox')]
  return {
    kg_category: [
      { id: ROOT_ID, slug: 'keyboards-and-synths', name_da: 'Keyboards og synths', name_en: 'Keyboards and synths', domain: 'music', parent_id: null },
      { id: SYNTHS_ID, slug: 'keyboards-and-synths/analog-synths', name_da: 'Analoge synths', name_en: 'Analog synths', domain: 'music', parent_id: ROOT_ID },
      { id: GROOVE_ID, slug: 'keyboards-and-synths/grooveboxes', name_da: 'Grooveboxes', name_en: 'Grooveboxes', domain: 'music', parent_id: ROOT_ID },
    ],
    kg_product: projection.map((p) => ({ slug: p.slug, status: 'active', support_state: 'supported', browse_visibility: 'public' })),
    browse_product_projection: projection,
  }
}

test('PAN-267: a kind whose only product sorts 49th is in the one response, with its chip', async () => {
  const res = await buildBrowseLeafResponse({ admin: fakeAdmin(catalogue()), rootSlug: 'keyboards-and-synths', includeDebug: false })
  assert.ok(res, 'the root exists')
  assert.equal(res.total_public_products, 49)
  assert.equal(res.products.length, 49, 'every public product of the root, not a page of 48')
  const groove = res.products.find((p) => p.slug === 'roland-mc-303')
  assert.ok(groove, 'the groovebox is in the response although it sorts after 48 synths')
  assert.equal(groove.subcategory_slug, 'grooveboxes')
  assert.deepEqual(res.subcategories.map((s) => s.slug).sort(), ['analog-synths', 'grooveboxes'], 'both kinds have a chip')
  // The client filters this array by kind; the filter must find the kind.
  assert.equal(res.products.filter((p) => p.subcategory_slug === 'grooveboxes').length, 1)
})

test('PAN-267: the response is the complete ordered set — no paging fields, count equals rows', async () => {
  const res = await buildBrowseLeafResponse({ admin: fakeAdmin(catalogue()), rootSlug: 'keyboards-and-synths', includeDebug: false })
  assert.ok(res)
  assert.equal(res.products.length, res.total_public_products)
  assert.equal('has_more' in res, false, 'nothing is left to load')
  assert.equal('page_size' in res, false)
  // compareProducts: tier_rank DESC, active_listing_count DESC, name ASC — the groovebox is last.
  assert.equal(res.products[res.products.length - 1].slug, 'roland-mc-303')
  assert.equal(res.products[0].slug, 'synth-01')
})

test('PAN-267: an unknown root is still absence (null), not an empty catalogue', async () => {
  const res = await buildBrowseLeafResponse({ admin: fakeAdmin(catalogue()), rootSlug: 'no-such-root', includeDebug: false })
  assert.equal(res, null)
})
