/**
 * Generate the restricted-search index.
 *
 * Stage 3 WP-4. See docs/stage-3-v1-decision-and-build-plan.md §8.4.
 *
 *   npx tsx frontend/scripts/build-search-index.ts     # from the repository root
 *
 * Invoked directly rather than through an npm script on purpose: §15.7 gives
 * WP-1 ownership of the root `package.json` and allows later packages exactly
 * one bounded edit to it — appending their test file to the `test` script — so
 * WP-4 may not add a second script entry. Adding `"build-search-index"` is a
 * one-line follow-up for whoever next amends that file.
 *
 * Reads live catalogue state, derives the navigation aliases for every
 * canonical product, and writes `frontend/data/klup-search-index.json`. The
 * artefact is committed as reviewed code and the drift test in
 * `scripts/lib/wp4-search.test.ts` fails if it no longer equals live state —
 * so a promotion that is not accompanied by a regeneration is caught rather
 * than silently under-serving search.
 *
 * READ-ONLY. This script performs SELECTs and writes one file inside the
 * repository. It never writes to the database.
 *
 * ALIASES ARE DERIVED, NEVER IMPORTED FROM THE MATCHER. `kg_identifier` and
 * `synonym` exist and are tempting, but `lib/families.ts` is explicit that
 * navigation aliases are never matcher aliases: the matcher's job is to decide
 * whether a marketplace listing IS a product, and its identifier set is tuned
 * for recall against noisy listing titles. Reusing it here would let a
 * score-70 token become a navigation target. Aliases are therefore derived
 * only from reviewed catalogue fields — brand, canonical name, model name and
 * the parenthetical qualifier — plus the hand-reviewed map in
 * `lib/synonyms.ts`.
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { NAVIGATION_FAMILIES } from '../lib/families'
import { modelKey } from '../lib/model-key'

type ProductRow = {
  slug: string
  canonical_name: string
  model_name: string | null
  era: string | null
  year_released: number | null
  kg_brand: { name: string } | { name: string }[] | null
}

const OUT_PATH = join(__dirname, '..', 'data', 'klup-search-index.json')

function brandOf(row: ProductRow): string {
  const b = Array.isArray(row.kg_brand) ? row.kg_brand[0] : row.kg_brand
  return b?.name ?? ''
}

/** `Roland RE-201 (Space Echo)` -> `Space Echo`; no parenthetical -> null. */
function parenthetical(name: string): string | null {
  const m = name.match(/\(([^)]+)\)/)
  return m ? m[1].trim() : null
}

/** `Roland RE-201 (Space Echo)` -> `Roland RE-201`. */
function withoutParenthetical(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The autocomplete label, carrying its disambiguating qualifier (§8.2).
 *
 * A qualifier is only ever taken from reviewed catalogue data — an existing
 * parenthetical, then `era`, then `year_released`. Nothing is invented: a
 * product with no qualifier in the database gets a bare label rather than a
 * plausible-looking one, because a fabricated qualifier at the point of
 * navigation is worse than none.
 */
function labelFor(row: ProductRow): string {
  if (parenthetical(row.canonical_name)) return row.canonical_name
  const qualifier = row.era ?? (row.year_released != null ? String(row.year_released) : null)
  return qualifier ? `${row.canonical_name} (${qualifier})` : row.canonical_name
}

function aliasSourcesFor(row: ProductRow): string[] {
  const brand = brandOf(row)
  const model = row.model_name ?? ''
  const bare = withoutParenthetical(row.canonical_name)
  const paren = parenthetical(row.canonical_name)

  const sources = [
    row.slug.replace(/-/g, ' '),
    row.canonical_name,
    bare,
    model,
    brand && model ? `${brand} ${model}` : '',
    paren ?? '',
    brand && paren ? `${brand} ${paren}` : '',
  ]

  return sources.filter((s) => s.trim().length > 0)
}

function dedupeKeys(values: string[]): string[] {
  const out = new Set<string>()
  for (const value of values) {
    const key = modelKey(value)
    if (key.length > 0) out.add(key)
  }
  return Array.from(out).sort()
}

export function productEntity(row: ProductRow) {
  return {
    kind: 'product' as const,
    slug: row.slug,
    label: labelFor(row),
    brand: brandOf(row),
    aliasKeys: dedupeKeys(aliasSourcesFor(row)),
  }
}

export function familyEntity(family: (typeof NAVIGATION_FAMILIES)[number]) {
  return {
    kind: 'family' as const,
    slug: family.slug,
    label: family.label,
    brand: family.brand,
    aliasKeys: dedupeKeys([family.label, family.slug.replace(/-/g, ' '), ...family.aliases]),
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(1)
  }

  const admin = createClient(url, key, { auth: { persistSession: false } })

  // ALL 48 SUPPORTED IDENTITIES — active + supported, public or private.
  //
  // Visibility is deliberately NOT a filter here and is deliberately NOT stored
  // in the artefact. Baking it in would make this file the visibility
  // authority, and a qa_only -> public promotion would then need a regeneration
  // and a deploy before search noticed. The runtime gate re-reads visibility
  // per request, so indexing the whole supported cohort is what makes a
  // promotion searchable immediately without ever publishing a private row.
  const productsRes = await admin
    .from('kg_product')
    .select('slug, canonical_name, model_name, era, year_released, kg_brand(name)')
    .eq('status', 'active')
    .eq('support_state', 'supported')
    .order('slug')

  if (productsRes.error) throw new Error(`kg_product read failed: ${productsRes.error.message}`)
  const candidates = (productsRes.data ?? []) as unknown as ProductRow[]

  // The music axis lives on the projection, and is read FOR THE CANDIDATE
  // SLUGS ONLY.
  //
  // Not `.eq('browse_domain', 'music')` over the whole view: that is an
  // unbounded select, PostgREST caps it at 1,000 rows, and the projection holds
  // 4,004. The first attempt at this script did exactly that and silently
  // produced 12 products instead of 14 — `roland-jupiter-8` and
  // `roland-re-201` fell outside the truncated prefix. It is the same defect
  // WP-1 corrected in `lib/browse.ts`, and it is worth naming here because a
  // build-time script fails quietly: nobody sees a 12-entry index unless they
  // count. Bounding the query by the candidate slugs makes the result exact.
  const domainRes = await admin
    .from('browse_product_projection')
    .select('slug, browse_domain')
    .in('slug', candidates.map((r) => r.slug))

  if (domainRes.error) throw new Error(`projection read failed: ${domainRes.error.message}`)

  const music = new Set(
    (domainRes.data ?? [])
      .filter((r) => (r as { browse_domain?: string }).browse_domain === 'music')
      .map((r) => (r as { slug: string }).slug),
  )
  const rows = candidates.filter((r) => music.has(r.slug))

  const dropped = candidates.filter((r) => !music.has(r.slug)).map((r) => r.slug)
  if (dropped.length > 0) {
    console.warn(`Excluded ${dropped.length} non-music supported product(s): ${dropped.join(', ')}`)
  }

  const index = {
    generatedFrom:
      'kg_product WHERE status=active AND support_state=supported, intersected with ' +
      'browse_product_projection.browse_domain=music. Visibility is NOT applied here — ' +
      'the runtime four-axis gate decides it per request.',
    products: rows.map(productEntity),
    families: NAVIGATION_FAMILIES.map(familyEntity),
  }

  writeFileSync(OUT_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  console.log(
    `Wrote ${index.products.length} supported identities and ${index.families.length} families to`,
  )
  console.log(`  ${OUT_PATH}`)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
