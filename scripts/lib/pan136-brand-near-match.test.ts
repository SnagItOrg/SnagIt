/**
 * PAN-136 — a brand that differs from one we hold only by case, whitespace or
 * separator is the same brand, and must be shown rather than created.
 *
 * The fixture rows are real `kg_brand` rows, read from production on
 * 2026-09-24, including two pairs the slug unique index already let through.
 * `Microtech-Gefell` is the one invented row: it stands in for the brand the
 * owner is about to create, so the ticket's own examples are the test.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { findBrandNearMatches, brandSlug, type BrandRow } from '../../frontend/lib/brand-identity'

const EXISTING: BrandRow[] = [
  { id: 'neumann', name: 'Neumann', slug: 'neumann' },
  { id: 'emu', name: 'E-mu', slug: 'emu' },
  { id: 'e-mu', name: 'E Mu', slug: 'e-mu' },
  { id: 'kurzweil-upper', name: 'Kurzweil', slug: 'Kurzweil' },
  { id: 'soma', name: 'SOMA_Laboratory', slug: 'SOMA_Laboratory' },
  { id: 'gefell', name: 'Microtech-Gefell', slug: 'microtech-gefell' },
]

const matchIds = (name: string, slug = brandSlug(name)) =>
  findBrandNearMatches({ name, slug }, EXISTING).map((b) => b.id).sort()

test('case, whitespace and separator variants find the brand we already hold', () => {
  assert.deepEqual(matchIds('Microtech Gefell'), ['gefell'])
  assert.deepEqual(matchIds('MICROTECH GEFELL'), ['gefell'])
  assert.deepEqual(matchIds('  microtech   gefell '), ['gefell'])
  assert.deepEqual(matchIds('Microtech_Gefell'), ['gefell'])
  assert.deepEqual(matchIds('neumann'), ['neumann'])
  assert.deepEqual(matchIds('kurzweil'), ['kurzweil-upper'])
  assert.deepEqual(matchIds('Soma Laboratory'), ['soma'])
  // Both existing E-mu rows come back: the operator sees the duplicate we
  // already have, not an arbitrary one of them.
  assert.deepEqual(matchIds('EMU'), ['e-mu', 'emu'])
  // The slug is checked too — it is the column the database keys on.
  assert.deepEqual(matchIds('Something Else', 'neumann'), ['neumann'])
})

test('a genuinely different brand is not a near-match', () => {
  assert.deepEqual(matchIds('Neumann Berlin'), [])
  assert.deepEqual(matchIds('Schoeps'), [])
  assert.deepEqual(matchIds('Microtech'), [])
})
