/**
 * PAN-140 — product attribute facets: the closed vocabulary, and the only
 * readers and validator of `kg_product.attributes.facets`.
 *
 * Import-free, like `catalogue.ts` and `catalogue-tree.ts`: the rules here have
 * to be exercisable from plain Node, and the browse page (a client component)
 * reads them.
 *
 * TWO FACET MECHANISMS, ONE VISITOR CONCEPT. `FACET_SUBCATEGORIES` in
 * `catalogue-tree.ts` turns a Reverb LEAF into a filter (body shape has
 * leaves). This module is for axes Reverb has no leaf for — a microphone's
 * capsule, electronics and polar pattern live under the single
 * `pro-audio/microphones` leaf. Named differently on purpose so the two are
 * never confused.
 *
 * WHERE THE VALUES LIVE (owner decision, 2026-09-24, option A). Under
 * `attributes.facets`, one entry per axis:
 *
 *   { "polar_pattern": { "values": ["omni", "cardioid", "figure-8"],
 *                        "set_by": "<admin user id>", "set_at": "<iso>" } }
 *
 * A facet value is a product claim, so it carries who made it and when. A
 * missing key means "not curated", never "no". The one writer is
 * `PUT /api/admin/product/[slug]/facets`, which calls `validateFacetWrite` —
 * no script path, so "never inferred by AI in bulk" is structural.
 *
 * FAIL-CLOSED READS. `readFacets` drops an unknown axis, an unknown value, an
 * axis that does not apply to the product's own leaf, a single-valued axis
 * holding several values, and an entry without provenance. What reaches the
 * public is the values only — never `set_by` / `set_at`.
 *
 * "CAN DO" FILTERING. A U 87 Ai offers omni, cardioid and figure-8, so it
 * matches each of those chips. A product can therefore sit under several chips
 * of one axis, and chip counts must never be summed (the PAN-98 lesson).
 */

const MICROPHONES = 'pro-audio/microphones'

/**
 * The vocabulary. Axis order is display order; value order is display order.
 *
 * Labels are studio English in both locales — catalogue vocabulary, the way the
 * gear is sold. The axis HEADINGS are UI chrome and live in `lib/i18n.ts`
 * under `productFacets.<key>`.
 */
export const PRODUCT_ATTRIBUTE_FACETS = {
  capsule: {
    multi: false,
    appliesTo: [MICROPHONES],
    values: [
      ['condenser', 'Condenser'],
      ['dynamic', 'Dynamic'],
      ['ribbon', 'Ribbon'],
    ],
  },
  circuit: {
    multi: false,
    appliesTo: [MICROPHONES],
    values: [
      ['tube', 'Tube'],
      ['solid-state', 'Solid-state'],
      ['passive', 'Passive'],
    ],
  },
  polar_pattern: {
    multi: true,
    appliesTo: [MICROPHONES],
    values: [
      ['omni', 'Omni'],
      ['wide-cardioid', 'Wide cardioid'],
      ['cardioid', 'Cardioid'],
      ['supercardioid', 'Supercardioid'],
      ['hypercardioid', 'Hypercardioid'],
      ['figure-8', 'Figure-8'],
    ],
  },
} as const satisfies Record<
  string,
  { multi: boolean; appliesTo: readonly string[]; values: readonly (readonly [string, string])[] }
>

export type FacetKey = keyof typeof PRODUCT_ATTRIBUTE_FACETS

const FACET_KEYS = Object.keys(PRODUCT_ATTRIBUTE_FACETS) as FacetKey[]

/** The public shape: values only, vocabulary order. */
export type ProductFacetValues = Partial<Record<FacetKey, string[]>>

/** The stored shape of one axis — admin only. */
export type FacetEntry = { values: string[]; set_by: string; set_at: string }

export type StoredFacets = Partial<Record<FacetKey, FacetEntry>>

export function isFacetKey(key: unknown): key is FacetKey {
  return typeof key === 'string' && (FACET_KEYS as string[]).includes(key)
}

/** The axes that apply to a full leaf slug (`pro-audio/microphones`). */
export function facetKeysFor(leafSlug: string | null | undefined): FacetKey[] {
  if (!leafSlug) return []
  return FACET_KEYS.filter((key) =>
    (PRODUCT_ATTRIBUTE_FACETS[key].appliesTo as readonly string[]).includes(leafSlug),
  )
}

export function facetValueLabel(key: FacetKey, value: string): string {
  const hit = PRODUCT_ATTRIBUTE_FACETS[key].values.find(([slug]) => slug === value)
  return hit ? hit[1] : value
}

function vocabulary(key: FacetKey): string[] {
  return PRODUCT_ATTRIBUTE_FACETS[key].values.map(([slug]) => slug)
}

/** Deduplicated and in vocabulary order, or null if any value is unknown. */
function normaliseValues(key: FacetKey, raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const known = vocabulary(key)
  if (!raw.every((v) => typeof v === 'string' && known.includes(v))) return null
  return known.filter((v) => raw.includes(v))
}

/** Every valid, applicable, provenanced entry. Admin surfaces read this. */
export function readFacetEntries(attributes: unknown, leafSlug: string | null | undefined): StoredFacets {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return {}
  const facets = (attributes as Record<string, unknown>).facets
  if (!facets || typeof facets !== 'object' || Array.isArray(facets)) return {}

  const out: StoredFacets = {}
  for (const key of facetKeysFor(leafSlug)) {
    const entry = (facets as Record<string, unknown>)[key]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const { values, set_by, set_at } = entry as Record<string, unknown>
    const normalised = normaliseValues(key, values)
    if (!normalised || normalised.length === 0) continue
    if (!PRODUCT_ATTRIBUTE_FACETS[key].multi && normalised.length > 1) continue
    if (typeof set_by !== 'string' || !set_by || typeof set_at !== 'string' || !set_at) continue
    out[key] = { values: normalised, set_by, set_at }
  }
  return out
}

/** Values only, for the public payload. Constructed, never copied. */
export function readFacets(attributes: unknown, leafSlug: string | null | undefined): ProductFacetValues {
  const out: ProductFacetValues = {}
  for (const [key, entry] of Object.entries(readFacetEntries(attributes, leafSlug))) {
    out[key as FacetKey] = [...entry.values]
  }
  return out
}

export type FacetWriteError =
  | 'invalid_body'
  | 'unknown_facet'
  | 'not_applicable'
  | 'unknown_value'
  | 'too_many_values'

export type FacetWrite =
  | { ok: true; key: FacetKey; values: string[] }
  | { ok: false; error: FacetWriteError }

/**
 * Validate one axis write: `{ key, values }`. An empty `values` unsets the
 * axis ("not curated"). `leafSlug` is the product's OWN leaf, read by the
 * route from the database — a mic axis cannot be written onto a synth.
 */
export function validateFacetWrite(body: unknown, leafSlug: string | null | undefined): FacetWrite {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid_body' }
  const { key, values } = body as Record<string, unknown>
  if (!isFacetKey(key)) return { ok: false, error: 'unknown_facet' }
  if (!facetKeysFor(leafSlug).includes(key)) return { ok: false, error: 'not_applicable' }
  if (!Array.isArray(values)) return { ok: false, error: 'invalid_body' }
  const normalised = normaliseValues(key, values)
  if (!normalised) return { ok: false, error: 'unknown_value' }
  if (!PRODUCT_ATTRIBUTE_FACETS[key].multi && normalised.length > 1) {
    return { ok: false, error: 'too_many_values' }
  }
  return { ok: true, key, values: normalised }
}

/**
 * The next `attributes` object after one validated write. Every other key in
 * `attributes` and every other axis is carried over untouched; an empty write
 * removes the axis rather than storing an empty claim.
 */
export function applyFacetWrite(
  attributes: unknown,
  write: { key: FacetKey; values: string[] },
  provenance: { set_by: string; set_at: string },
): Record<string, unknown> {
  const base =
    attributes && typeof attributes === 'object' && !Array.isArray(attributes)
      ? { ...(attributes as Record<string, unknown>) }
      : {}
  const current = base.facets
  const facets: Record<string, unknown> =
    current && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {}

  if (write.values.length === 0) delete facets[write.key]
  else facets[write.key] = { values: write.values, ...provenance }

  if (Object.keys(facets).length === 0) delete base.facets
  else base.facets = facets
  return base
}
