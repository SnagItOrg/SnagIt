/**
 * Stage 3 WP-1 — public response contract, eligibility freshness, failure model.
 *
 * Covers review findings H1 (stale public eligibility), H2 (kg_product.* leak)
 * and D (absence vs infrastructure failure).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  FORBIDDEN_ATTRIBUTE_KEYS,
  FORBIDDEN_LISTING_FIELDS,
  FORBIDDEN_PRODUCT_FIELDS,
  PUBLIC_LISTING_FIELDS,
  PUBLIC_ATTRIBUTE_KEYS,
  PUBLIC_PRODUCT_FIELDS,
  PUBLIC_PRODUCT_SELECT,
  PUBLIC_RELATED_SELECT,
  toPublicAttributes,
  toPublicListing,
  toPublicProduct,
  toPublicRelatedProduct,
} from '../../frontend/lib/public-product'

import {
  CatalogueUnavailableError,
  assertSupportedCohortIsMusic,
  isCatalogueUnavailable,
  loadCanonicalSlugs,
  loadSupportedSlugs,
} from '../../frontend/lib/catalogue'

const FRONTEND = join(__dirname, '..', '..', 'frontend')

/**
 * Read a source file with comments removed.
 *
 * Source assertions must inspect CODE, not prose: this file's own explanatory
 * comments legitimately quote the patterns being banned (`listings(*)`,
 * `select('*')`), and a naive substring check would match those and fail.
 */
function readCode(...segments: string[]): string {
  return readFileSync(join(FRONTEND, ...segments), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * A full kg_product row as production would return it under `select('*')`.
 * Every column present, including the ones that must never be public.
 */
const FULL_ROW = {
  id: '11111111-2222-3333-4444-555555555555',
  slug: 'roland-juno-106',
  canonical_name: 'Roland Juno-106',
  model_name: 'Juno-106',
  brand_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  category_id: 'cccccccc-dddd-eeee-ffff-000000000000',
  subcategory_id: 'dddddddd-eeee-ffff-0000-111111111111',
  subcategory_confidence: 0.82,
  attributes: {
    description: 'A polyphonic synthesizer.',
    specs: { voices: 6, _source: 'internal-scrape-v3' },
    history: [{ year: 1984, title: 'Launch', body: 'Released.' }],
    external_links: [{ label: 'Vintage Synth', url: 'https://example.org' }],
    related_products: [{ slug: 'roland-juno-60', reason: 'sibling' }],
    reverb_csp: 'csp-abc-123',
    reverb_csp_candidates: ['csp-abc-123', 'csp-def-456'],
    type: 'synthesizer',
  },
  price_min_dkk: 9000,
  price_max_dkk: 21000,
  msrp_dkk: 17000,
  era: '1980s',
  reference_url: 'https://internal.example/notes',
  status: 'active',
  created_at: '2026-01-02T03:04:05Z',
  thomann_url: 'https://thomann.example/juno',
  thomann_price_dkk: 12000,
  thomann_price_updated_at: '2026-08-01T00:00:00Z',
  image_url: 'https://cdn.example/juno.webp',
  hero_image_url: null,
  reverb_root_slug: 'keyboards',
  reverb_sub_slug: 'synths',
  reverb_csp_id: 'csp-abc-123',
  tier: 'legendary',
  tags: ['internal-review', 'do-not-publish-note'],
  year_released: 1984,
  cleanup_status: 'needs_review',
  browse_visibility: 'public',
  support_state: 'supported',
  kg_brand: { name: 'Roland', slug: 'roland' },
}

/* ------------------------------------------------------------------ *
 * H2 — the public product DTO
 * ------------------------------------------------------------------ */

test('DTO: the response contains exactly the allow-listed top-level fields', () => {
  const dto = toPublicProduct(FULL_ROW)
  assert.ok(dto)
  assert.deepEqual(Object.keys(dto!).sort(), [...PUBLIC_PRODUCT_FIELDS].sort())
})

test('DTO: no forbidden field survives, even though the input carries all of them', () => {
  const dto = toPublicProduct(FULL_ROW) as unknown as Record<string, unknown>
  const leaked = FORBIDDEN_PRODUCT_FIELDS.filter((f) => f in dto)
  assert.deepEqual(
    leaked,
    [],
    'operator-only or internal fields reached the public response',
  )
})

test('DTO: the serialised payload contains no forbidden VALUE either', () => {
  // Field-name checks miss a value smuggled under a different key.
  const json = JSON.stringify(toPublicProduct(FULL_ROW))
  for (const secret of [
    FULL_ROW.id,
    FULL_ROW.brand_id,
    FULL_ROW.category_id,
    FULL_ROW.subcategory_id,
    FULL_ROW.reverb_csp_id,
    FULL_ROW.reference_url,
    'needs_review',
    'internal-scrape-v3',
    'do-not-publish-note',
    'csp-def-456',
  ]) {
    assert.equal(json.includes(String(secret)), false, `payload leaked "${secret}"`)
  }
  // ...and the state axes must not appear as values anywhere.
  assert.equal(json.includes('"supported"'), false)
  assert.equal(json.includes('"qa_only"'), false)
  assert.equal(json.includes('"needs_review"'), false)
})

test('DTO: attributes are whitelisted by key', () => {
  const attrs = toPublicAttributes(FULL_ROW.attributes)
  assert.ok(attrs)
  for (const key of Object.keys(attrs!)) {
    assert.ok(
      (PUBLIC_ATTRIBUTE_KEYS as readonly string[]).includes(key),
      `attributes leaked "${key}"`,
    )
  }
  for (const forbidden of FORBIDDEN_ATTRIBUTE_KEYS) {
    assert.equal(forbidden in attrs!, false, `attributes leaked "${forbidden}"`)
  }
})

test('DTO: specs._source is dropped from the payload, not merely hidden in the UI', () => {
  const attrs = toPublicAttributes(FULL_ROW.attributes)
  assert.deepEqual(Object.keys(attrs!.specs!), ['voices'])
})

test('DTO: the SELECT is explicit and never a wildcard', () => {
  assert.equal(PUBLIC_PRODUCT_SELECT.includes('*'), false)
  assert.equal(PUBLIC_RELATED_SELECT.includes('*'), false)
  // The eligibility axes must be SELECTED (the gate needs them) ...
  for (const axis of ['status', 'support_state', 'browse_visibility']) {
    assert.ok(PUBLIC_PRODUCT_SELECT.includes(axis), `${axis} must be selected for the gate`)
    assert.ok(PUBLIC_RELATED_SELECT.includes(axis), `${axis} must be selected for the related gate`)
  }
  // ...and must NOT be in the response allow-list.
  for (const axis of ['status', 'support_state', 'browse_visibility']) {
    assert.equal(
      (PUBLIC_PRODUCT_FIELDS as readonly string[]).includes(axis),
      false,
      `${axis} must not be a public field`,
    )
  }
})

test('DTO: the route uses the explicit select, not select(*)', () => {
  const src = readCode('app', 'api', 'product', '[slug]', 'route.ts')
  assert.equal(
    src.includes("select('*"),
    false,
    "the product route must not select('*') — that is how 30 columns went public",
  )
  assert.ok(src.includes('PUBLIC_PRODUCT_SELECT'))
  assert.ok(src.includes('toPublicProduct'))
})

test('DTO: construction is field-by-field — an unknown column cannot ride along', () => {
  const withNewColumn = { ...FULL_ROW, some_column_added_next_month: 'SECRET' }
  const json = JSON.stringify(toPublicProduct(withNewColumn))
  assert.equal(json.includes('SECRET'), false)
  assert.equal(json.includes('some_column_added_next_month'), false)
})

test('DTO: related products use their own minimal shape', () => {
  const related = toPublicRelatedProduct(FULL_ROW)
  assert.deepEqual(Object.keys(related!).sort(), ['image_url', 'name', 'slug'])
  const json = JSON.stringify(related)
  assert.equal(json.includes('supported'), false)
  assert.equal(json.includes('legendary'), false)
  assert.equal(json.includes(FULL_ROW.id), false)
})

test('DTO: a row missing identity is refused rather than half-built', () => {
  assert.equal(toPublicProduct({ canonical_name: 'No slug' }), null)
  assert.equal(toPublicProduct({ slug: 'no-name' }), null)
  assert.equal(toPublicProduct(null), null)
  assert.equal(toPublicRelatedProduct({ slug: 'x' }), null)
})

test('DTO: kg_brand survives as an object or a single-element embed array', () => {
  assert.deepEqual(toPublicProduct(FULL_ROW)!.kg_brand, { name: 'Roland', slug: 'roland' })
  const arrayEmbed = { ...FULL_ROW, kg_brand: [{ name: 'Roland', slug: 'roland' }] }
  assert.deepEqual(toPublicProduct(arrayEmbed)!.kg_brand, { name: 'Roland', slug: 'roland' })
})

/* ------------------------------------------------------------------ *
 * H1 — eligibility freshness: no TTL, no prerender
 * ------------------------------------------------------------------ */

test('freshness: a changed eligibility result is observed on the NEXT call', () => {
  // The regression this locks: a 60-second memo meant a depublish kept being
  // advertised for up to a minute. No waiting, no redeploy, no cache reset.
  return (async () => {
    let generation = 0
    const fetcher = async () => {
      generation += 1
      return generation === 1
        ? {
            data: [
              { slug: 'roland-juno-106', status: 'active', support_state: 'supported', browse_visibility: 'public' },
              { slug: 'roland-tr-808', status: 'active', support_state: 'supported', browse_visibility: 'public' },
            ],
            error: null,
          }
        : {
            // roland-tr-808 has just been depublished through the promotion seam
            data: [
              { slug: 'roland-juno-106', status: 'active', support_state: 'supported', browse_visibility: 'public' },
              { slug: 'roland-tr-808', status: 'active', support_state: 'supported', browse_visibility: 'qa_only' },
            ],
            error: null,
          }
    }

    const before = await loadCanonicalSlugs(fetcher)
    assert.deepEqual([...before].sort(), ['roland-juno-106', 'roland-tr-808'])

    const after = await loadCanonicalSlugs(fetcher)
    assert.deepEqual([...after], ['roland-juno-106'], 'depublish was not observed immediately')
    assert.equal(generation, 2, 'the second call must re-query, not serve a memo')
  })()
})

test('freshness: an unsupport is observed immediately too', async () => {
  let calls = 0
  const fetcher = async () => {
    calls += 1
    return {
      data: [
        {
          slug: 'roland-juno-106',
          status: 'active',
          support_state: calls === 1 ? 'supported' : 'known',
          browse_visibility: 'public',
        },
      ],
      error: null,
    }
  }
  assert.equal((await loadSupportedSlugs(fetcher)).size, 1)
  assert.equal((await loadSupportedSlugs(fetcher)).size, 0)
})

test('freshness: a status change is observed immediately', async () => {
  let calls = 0
  const fetcher = async () => {
    calls += 1
    return {
      data: [
        {
          slug: 'roland-juno-106',
          status: calls === 1 ? 'active' : 'inactive',
          support_state: 'supported',
          browse_visibility: 'public',
        },
      ],
      error: null,
    }
  }
  assert.equal((await loadCanonicalSlugs(fetcher)).size, 1)
  assert.equal((await loadCanonicalSlugs(fetcher)).size, 0)
})

test('freshness: the catalogue module exports no cache-reset seam', async () => {
  // A reset function would imply state worth resetting. There is none.
  const mod = await import('../../frontend/lib/catalogue')
  assert.equal('__resetCatalogueCache' in mod, false)
})

test('freshness: discover and browse routes are force-dynamic and no-store', () => {
  const routes = [
    join(FRONTEND, 'app', 'api', 'discover', 'route.ts'),
    join(FRONTEND, 'app', 'api', 'browse', 'route.ts'),
    join(FRONTEND, 'app', 'api', 'browse', '[root]', 'route.ts'),
  ]
  for (const file of routes) {
    const src = readFileSync(file, 'utf8')
    assert.ok(src.includes("export const dynamic = 'force-dynamic'"), `${file} must be force-dynamic`)
    assert.ok(src.includes('export const revalidate = 0'), `${file} must not revalidate on a timer`)
    assert.equal(
      /s-maxage=\d+/.test(src),
      false,
      `${file} must not hand catalogue eligibility to a shared cache`,
    )
  }
})

/* ------------------------------------------------------------------ *
 * D — absence is not infrastructure failure
 * ------------------------------------------------------------------ */

test('failure: a query error raises CatalogueUnavailableError, not an empty set', async () => {
  await assert.rejects(
    () => loadCanonicalSlugs(async () => ({ data: null, error: { message: 'connection refused' } })),
    (err: unknown) => isCatalogueUnavailable(err),
  )
})

test('failure: a thrown fetcher raises CatalogueUnavailableError', async () => {
  await assert.rejects(
    () =>
      loadSupportedSlugs(async () => {
        throw new Error('ECONNRESET')
      }),
    (err: unknown) => isCatalogueUnavailable(err),
  )
})

test('failure: a malformed payload is unavailability, not an empty catalogue', async () => {
  await assert.rejects(
    () => loadCanonicalSlugs(async () => ({ data: { unexpected: true }, error: null })),
    (err: unknown) => isCatalogueUnavailable(err),
  )
})

test('failure: the error carries no database detail', () => {
  const err = new CatalogueUnavailableError('product_lookup')
  assert.equal(err.message, 'Catalogue eligibility could not be established.')
  assert.equal(err.message.toLowerCase().includes('connection'), false)
  assert.equal(err.message.toLowerCase().includes('postgres'), false)
  assert.equal(err.message.toLowerCase().includes('supabase'), false)
})

test('failure: the API answers 503 for unavailability and 404 only for absence', () => {
  const src = readCode('app', 'api', 'product', '[slug]', 'route.ts')
  assert.ok(src.includes('catalogue_unavailable'))
  assert.ok(src.includes('status: 503'))
  assert.ok(src.includes("throw new CatalogueUnavailableError('product_lookup')"))
  // The 404 path must not be reachable from a query error.
  assert.equal(
    src.includes('if (error || !product)'),
    false,
    'a query error must not collapse into notFound()',
  )
  // No database detail in any public body.
  assert.equal(/error:\s*(err|error)\b/.test(src), false)
})

test('failure: the page gate throws instead of calling notFound()', () => {
  const src = readCode('app', 'product', '[slug]', 'layout.tsx')
  assert.ok(src.includes("throw new CatalogueUnavailableError('product_gate_lookup')"))
  assert.ok(src.includes("throw new CatalogueUnavailableError('projection_gate_lookup')"))
  const gateIdx = src.indexOf('productRes.error')
  const notFoundIdx = src.indexOf('if (!product) notFound()')
  assert.ok(gateIdx > -1 && notFoundIdx > gateIdx, 'the error check must precede the absence check')
})

/* ------------------------------------------------------------------ *
 * E2 — the fourth axis is asserted, not assumed
 * ------------------------------------------------------------------ */

test('music axis: a supported non-music product fails loudly', () => {
  const supported = new Set(['roland-juno-106', 'macbook-pro-m3-max'])
  assert.throws(
    () =>
      assertSupportedCohortIsMusic(supported, [
        { slug: 'roland-juno-106', browse_domain: 'music' },
        { slug: 'macbook-pro-m3-max', browse_domain: 'tech' },
      ]),
    (err: unknown) => isCatalogueUnavailable(err),
  )
})

test('music axis: a null domain on a supported product also fails', () => {
  assert.throws(
    () =>
      assertSupportedCohortIsMusic(new Set(['x']), [{ slug: 'x', browse_domain: null }]),
    (err: unknown) => isCatalogueUnavailable(err),
  )
})

test('music axis: unsupported rows are not the assertion’s business', () => {
  assert.doesNotThrow(() =>
    assertSupportedCohortIsMusic(new Set(['x']), [
      { slug: 'x', browse_domain: 'music' },
      { slug: 'some-chair', browse_domain: 'danish-modern' },
    ]),
  )
})

test('music axis: browse probes the whole cohort UNFILTERED, so it cannot pass vacuously', () => {
  const src = readCode('lib', 'browse.ts')
  const probe = src.indexOf('supported_domain_probe')
  assert.ok(probe > -1, 'the domain probe must exist')
  // The probe query must not itself filter on browse_domain, or a violation
  // would simply be absent from the result instead of reported.
  const window = src.slice(probe - 500, probe + 200)
  assert.equal(
    window.includes("eq('browse_domain'"),
    false,
    'the assertion query must not filter by the axis it is asserting',
  )
})

test('related products are gated on all four axes, including browse_domain', () => {
  const src = readCode('app', 'api', 'product', '[slug]', 'route.ts')
  assert.ok(src.includes('relatedDomainRes'), 'related products must resolve browse_domain')
  assert.equal(
    src.includes('browse_domain: CANONICAL_DOMAIN'),
    false,
    'the related gate must not hardcode the music axis',
  )
  assert.ok(src.includes('relatedDomains.get('))
})

/* ------------------------------------------------------------------ *
 * E1 — audit counters say which number they are
 * ------------------------------------------------------------------ */

test('audit counters distinguish support-blind eligibility from the public catalogue', () => {
  const src = readCode('lib', 'browse.ts')
  assert.ok(src.includes('browse_eligible_support_blind_count'))
  assert.ok(src.includes('canonical_public_count'))
  assert.equal(
    /\bdirect_public_count\b/.test(src),
    false,
    'the ambiguous "public_count" name must be gone — 23 is not the public product count',
  )
})

/* ------------------------------------------------------------------ *
 * H2 (extended) — the public LISTING shape
 * ------------------------------------------------------------------ */

const FULL_LISTING = {
  id: 'l-1', title: 'Roland Juno-106', price: 12000, currency: 'DKK', price_dkk: 12000,
  url: 'https://dba.example/1', image_url: null, location: 'København', country: 'DK',
  source: 'dba.dk', platform: 'dba', condition: 'used', is_active: true,
  scraped_at: '2026-08-27T02:33:00Z', first_seen_at: '2026-08-01T00:00:00Z',
  last_seen_at: '2026-08-27T02:33:00Z',
  // operator-only / ingestion internals that must never be public
  watchlist_id: 'w-secret-123', ingestion_batch_id: 'b-secret-456', ingested_at: '2026-08-26T00:00:00Z',
  coverage_scope_hash: 'hash-secret', source_query: 'juno 106 site:dba.dk',
  last_miss_run_id: 'run-secret', consecutive_misses: 3, normalized_text: 'roland juno 106 internal',
  notified_at: '2026-08-02T00:00:00Z', delisted_at: null, brand_id: 'brand-secret', external_id: 'ext-secret',
}

test('listing DTO: only the allow-listed fields survive', () => {
  const dto = toPublicListing(FULL_LISTING)
  assert.ok(dto)
  assert.deepEqual(Object.keys(dto!).sort(), [...PUBLIC_LISTING_FIELDS].sort())
})

test('listing DTO: no ingestion or watchlist internals leak', () => {
  const dto = toPublicListing(FULL_LISTING) as unknown as Record<string, unknown>
  const leaked = FORBIDDEN_LISTING_FIELDS.filter((f) => f in dto)
  assert.deepEqual(leaked, [], 'ingestion/monitoring internals reached the public response')

  const json = JSON.stringify(dto)
  for (const secret of [
    'w-secret-123', 'b-secret-456', 'hash-secret', 'run-secret',
    'brand-secret', 'ext-secret', 'site:dba.dk', 'roland juno 106 internal',
  ]) {
    assert.equal(json.includes(secret), false, `listing payload leaked "${secret}"`)
  }
})

test('listing DTO: the route uses an explicit embed, not listings(*)', () => {
  const src = readCode('app', 'api', 'product', '[slug]', 'route.ts')
  assert.equal(src.includes('listings(*)'), false, 'listings(*) shipped 28 columns publicly')
  assert.ok(src.includes('PUBLIC_LISTING_SELECT'))
  assert.ok(src.includes('toPublicListing'))
})

test('listing DTO: a row without identity is dropped, not half-built', () => {
  assert.equal(toPublicListing({ title: 'x', url: 'y' }), null)
  assert.equal(toPublicListing({ id: 'x', url: 'y' }), null)
  assert.equal(toPublicListing(null), null)
})

test('eligibility-gated product responses are not shared-cached', () => {
  const src = readCode('app', 'api', 'product', '[slug]', 'route.ts')
  assert.equal(
    /s-maxage=\d+/.test(src),
    false,
    'a depublished product must not survive in a CDN after the origin refuses it',
  )
})
