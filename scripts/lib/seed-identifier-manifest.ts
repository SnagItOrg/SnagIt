/**
 * scripts/lib/seed-identifier-manifest.ts
 *
 * Derives the CURATED identifier set that a clean importer rebuild will
 * produce from `data/knowledge-graph.json`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PURE. No database access, no I/O beyond reading the seed file. Nothing here
 * is executed by a migration.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * WHY THIS EXISTS: `scripts/import-knowledge-graph.ts` does
 * `deleteAll('kg_identifier')` and rebuilds the whole table from the seed. So
 * the seed — not the database — is AUTHORITATIVE for identifier MEMBERSHIP,
 * and any identifier a migration adds directly to the database is erased by
 * the next clean import. Migration 054 adds Gibson `Les Paul` and `ES-335`;
 * without the matching seed change those additions would not survive, and the
 * asymmetric cross-brand data would be recreated.
 *
 * This module reproduces the importer's derivation exactly, so a test can
 * assert three things agree:
 *   1. the seed-derived manifest
 *   2. migration 054's POST contract
 *   3. the state of a disposable database after a real rebuild
 */

import * as fs from 'fs'
import * as path from 'path'
import { filterIdentifiers } from './identifier-safety'

export interface SeedIdentifier {
  /** Product slug — the importer's upsert conflict key and stable identity. */
  slug: string
  type: string
  /** Verbatim seed value. */
  value: string
  /** lower(trim(value)) — the form every uniqueness rule compares on. */
  normalised: string
}

interface SeedProduct {
  name?: string
  model?: string | null
  sku?: string[]
  ean?: string[]
}

export interface SeedGraph {
  categories: Record<string, { brands: Record<string, { products: Record<string, SeedProduct> }> }>
}

export function loadSeed(seedPath?: string): SeedGraph {
  const p = seedPath ?? path.resolve(__dirname, '../../data/knowledge-graph.json')
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as SeedGraph
}

/** slug -> seed product, flattened across categories and brands. */
export function seedProducts(kg: SeedGraph): Map<string, SeedProduct> {
  const out = new Map<string, SeedProduct>()
  for (const cat of Object.values(kg.categories)) {
    for (const brand of Object.values(cat.brands)) {
      for (const [slug, product] of Object.entries(brand.products)) out.set(slug, product)
    }
  }
  return out
}

/**
 * The identifier rows a clean import will insert.
 *
 * Mirrors `scripts/import-knowledge-graph.ts` exactly:
 *   SKU   for every `sku[]` entry
 *   EAN   for every `ean[]` entry
 *   MODEL for `model`, but ONLY when `sku` does not already contain it
 * ...then applies the same `filterIdentifiers` safety pass.
 *
 * The MODEL derivation is the one place a legitimate `model` value can still
 * yield an unsafe identifier — Sequential Circuits TOM has model "TOM", which
 * is a correct model_name (score-70 tier) but must never be a score-95
 * identifier. The safety filter is the guard there, and that is a deliberate
 * defence-in-depth boundary, not a substitute for fixing the seed.
 */
export function deriveSeedIdentifiers(kg: SeedGraph): SeedIdentifier[] {
  const rows: SeedIdentifier[] = []
  for (const [slug, p] of seedProducts(kg)) {
    const candidates: Array<{ type: string; value: string }> = []
    for (const v of p.sku ?? []) candidates.push({ type: 'SKU', value: v })
    for (const v of p.ean ?? []) candidates.push({ type: 'EAN', value: v })
    if (p.model && !(p.sku ?? []).includes(p.model)) candidates.push({ type: 'MODEL', value: p.model })

    const { safe } = filterIdentifiers(candidates)
    for (const c of safe) {
      rows.push({ slug, type: c.type, value: c.value, normalised: c.value.trim().toLowerCase() })
    }
  }
  return rows
}

/** Stable, order-independent key for one identifier row. */
export function identifierKey(r: SeedIdentifier): string {
  return `${r.slug}|${r.type}|${r.normalised}`
}

/** Canonical checksum of the whole derived set — order-independent. */
export function manifestChecksum(rows: SeedIdentifier[]): string {
  return rows.map(identifierKey).sort().join('\n')
}

/** Normalised tuples appearing more than once. Must always be empty. */
export function duplicateNormalisedTuples(rows: SeedIdentifier[]): string[] {
  const seen = new Map<string, number>()
  for (const r of rows) {
    const k = identifierKey(r)
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  return Array.from(seen.entries()).filter(([, n]) => n > 1).map(([k]) => k).sort()
}

/**
 * Migration 054's POST contract, expressed against seed slugs.
 * Kept here so a test can assert the SQL and the seed cannot drift apart.
 */
export const CURATION_054_CONTRACT = {
  /** Values that must NOT appear as identifiers anywhere after curation. */
  removedValues: ['paul', 'tom', '335'] as const,
  /** Family terms that must be symmetric across exactly these slugs. */
  symmetric: [
    { normalised: 'les paul', slugs: ['gibson-les-paul', 'epiphone-les-paul'] },
    { normalised: 'es-335',   slugs: ['gibson-es-335',   'epiphone-es-335'] },
  ],
} as const

/**
 * Product slugs migration 053 retires. A clean import must not give any of them
 * an identifier row, or the duplicate-product conflict returns.
 *
 * `manley-ref-gold` is absent: its seed entry was re-keyed to the SURVIVOR slug
 * `manley-reference-gold`, so its "Reference Gold" identifier rebuilds onto the
 * surviving product. Every other retired slug simply carries no identifiers.
 */
export const RETIRED_053_SLUGS: readonly string[] = [
  'elektron-elektron-analog-rytm-mkii',
  'elektron-machinedrum',
  'jomox-jomox-airbase-99',
  'manley-manley-core',
  'manley-reference-cardioid',
  'manley-manley-reference-cardioid',
  'manley-ref-gold',
  'moog-moog-slim-phatty',
  'moog-subsequent-37',
  'novation-bass_station2',
  'propellerhead-rebirth',
  'roland-re-201-space-echo',
  'teenage-engineering-ep-133-ko-ii',
  'teisco-synthesizer-110f-0',
  'hp-z8',
  'hp-z8-workstation',
]
