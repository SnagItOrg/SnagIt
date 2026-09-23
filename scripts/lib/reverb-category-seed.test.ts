/**
 * PAN-107 — re-running the Reverb category seeder must not destroy a hand-set
 * Danish name.
 *
 * `kg_category.name_da` is hand-maintained Danish; nothing derives it
 * (scripts/CLAUDE.md, "`kg_category` labels are hand-maintained"). The seeder
 * used to write it from the English field and upsert with
 * `ignoreDuplicates: false`, so one re-run silently reverted every correction.
 *
 * Measured against production on 2026-09-23: `kg_category` holds 340 rows, 27
 * of which carry a `name_da` distinct from `name_en`. Exactly 23 of those 27
 * are slugs the seeder writes — 14 music roots and 9 leaves — and the old code
 * overwrote all 23. The remaining 4 (`danish-modern`, `music-gear`,
 * `photography`, `tech`) are out-of-scope verticals absent from
 * `data/reverb-categories.json`, so the seeder never reached them.
 *
 * The failure is silent and expensive: nothing errors, nothing logs, and the
 * regression is visible only to a Danish visitor reading "Keyboards and
 * Synths" on /browse. So the behaviour is asserted here rather than by a run —
 * running an importer needs product-owner authorisation each time.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { refreshPayload, type SeededCategory } from './reverb-category-seed'

/** The columns the seeder touches, as the database holds them. */
type Row = {
  slug: string
  name_en: string | null
  name_da: string | null
  domain: string | null
  parent_id: string | null
}

/**
 * The one part of PostgREST's upsert this fix rests on: the
 * `ON CONFLICT DO UPDATE SET` list is exactly the keys present in the payload.
 * A column that is never sent is not in the SET list, so it survives the
 * write. `ignoreDuplicates: true` is `ON CONFLICT DO NOTHING`.
 */
function upsert(
  table: Map<string, Row>,
  payload: ReadonlyArray<Partial<Row>>,
  opts: { ignoreDuplicates: boolean },
): void {
  for (const incoming of payload) {
    const slug = incoming.slug as string
    const existing = table.get(slug)

    if (!existing) {
      // A column absent from the payload takes its default, which is NULL.
      table.set(slug, {
        slug,
        name_en: incoming.name_en ?? null,
        name_da: incoming.name_da ?? null,
        domain: incoming.domain ?? null,
        parent_id: incoming.parent_id ?? null,
      })
      continue
    }

    if (opts.ignoreDuplicates) continue // DO NOTHING

    // The SET list is the keys that were actually sent, and nothing else.
    const sent = incoming as Record<string, unknown>
    const row = existing as unknown as Record<string, unknown>
    for (const column of Object.keys(sent)) row[column] = sent[column]
  }
}

/** The two legs the seeder runs per level, in order. */
function seed(table: Map<string, Row>, rows: SeededCategory[]): void {
  upsert(table, rows, { ignoreDuplicates: true })
  upsert(table, refreshPayload(rows), { ignoreDuplicates: false })
}

const seeded = (slug: string, name_en: string): SeededCategory => ({
  slug,
  name_en,
  // What the seeder derives: the English string, which is exactly the value
  // that must never reach an existing row.
  name_da: name_en,
  domain: 'music',
  parent_id: null,
})

test('PAN-107: a re-run leaves a hand-set Danish name untouched', () => {
  // Four of the 23 rows the owner corrected on 2026-09-22, as production holds
  // them today: a root, and three leaves under two different parents.
  const table = new Map<string, Row>([
    ['keyboards-and-synths', {
      slug: 'keyboards-and-synths',
      name_en: 'Keyboards and Synths',
      name_da: 'Synthesizere & keyboards',
      domain: 'music',
      parent_id: null,
    }],
    ['keyboards-and-synths/drum-machines', {
      slug: 'keyboards-and-synths/drum-machines',
      name_en: 'Drum Machines',
      name_da: 'Trommemaskiner',
      domain: 'music',
      parent_id: 'root-uuid',
    }],
    ['pro-audio/microphones', {
      slug: 'pro-audio/microphones',
      name_en: 'Microphones',
      name_da: 'Mikrofoner',
      domain: 'music',
      parent_id: 'root-uuid',
    }],
    ['bass-guitars/4-string', {
      slug: 'bass-guitars/4-string',
      name_en: '4-String',
      name_da: '4-strengede',
      domain: 'music',
      parent_id: 'root-uuid',
    }],
  ])

  seed(table, [
    seeded('keyboards-and-synths', 'Keyboards and Synths'),
    seeded('keyboards-and-synths/drum-machines', 'Drum Machines'),
    seeded('pro-audio/microphones', 'Microphones'),
    seeded('bass-guitars/4-string', '4-String'),
  ])

  // The whole point. Before the fix every one of these read back as the
  // English string, and nothing anywhere reported it.
  assert.deepEqual(
    [...table.values()].map((r) => r.name_da),
    ['Synthesizere & keyboards', 'Trommemaskiner', 'Mikrofoner', '4-strengede'],
    'a re-run overwrote a hand-maintained Danish name',
  )

  // Idempotent: a second and third run must not erode it either.
  seed(table, [seeded('keyboards-and-synths', 'Keyboards and Synths')])
  seed(table, [seeded('keyboards-and-synths', 'Keyboards and Synths')])
  assert.equal(table.get('keyboards-and-synths')?.name_da, 'Synthesizere & keyboards')
})

test('PAN-107: a genuinely new slug is still seeded, name_da included', () => {
  const table = new Map<string, Row>([
    ['keyboards-and-synths', {
      slug: 'keyboards-and-synths',
      name_en: 'Keyboards and Synths',
      name_da: 'Synthesizere & keyboards',
      domain: 'music',
      parent_id: null,
    }],
  ])

  // Reverb adds a leaf. The seeder must still create it in full, otherwise the
  // fix has simply broken seeding.
  seed(table, [
    seeded('keyboards-and-synths', 'Keyboards and Synths'),
    seeded('keyboards-and-synths/eurorack', 'Eurorack'),
  ])

  assert.deepEqual(table.get('keyboards-and-synths/eurorack'), {
    slug: 'keyboards-and-synths/eurorack',
    name_en: 'Eurorack',
    // Seeded from English on creation only. A Danish label is hand-set later;
    // the point of the fix is that the later edit is what survives.
    name_da: 'Eurorack',
    domain: 'music',
    parent_id: null,
  })

  // The existing neighbour was still refreshed on its seeded columns.
  assert.equal(table.get('keyboards-and-synths')?.name_en, 'Keyboards and Synths')
  assert.equal(table.get('keyboards-and-synths')?.name_da, 'Synthesizere & keyboards')
})

test('PAN-107: the refresh payload cannot carry name_da at all', () => {
  const payload = refreshPayload([
    seeded('pro-audio', 'Pro Audio'),
    seeded('pro-audio/recording', 'Recording'),
  ])

  for (const row of payload) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(row, 'name_da'),
      false,
      'name_da in the payload puts it back in the ON CONFLICT SET list',
    )
  }
  // The seeded columns do travel — this leg still has work to do.
  assert.deepEqual(Object.keys(payload[0]).sort(), ['domain', 'name_en', 'parent_id', 'slug'])
})

test('PAN-107: the seeder sends no DO UPDATE payload that bypasses refreshPayload', () => {
  // The module can be correct while the script still upserts the raw rows, and
  // that is the regression worth catching: it reintroduces the exact defect.
  const src = readFileSync(join(__dirname, '..', 'seed-reverb-categories.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  const updates = [...src.matchAll(/\.upsert\(\s*([A-Za-z0-9_]+\(?)[\s\S]*?ignoreDuplicates:\s*(true|false)/g)]

  assert.equal(updates.length, 4, 'the seeder should write two levels with two legs each')

  for (const [, arg, ignoreDuplicates] of updates) {
    if (ignoreDuplicates === 'false') {
      assert.equal(arg, 'refreshPayload(', `a DO UPDATE leg sends "${arg}" rather than refreshPayload()`)
    }
  }

  assert.equal(
    updates.filter(([, , ignore]) => ignore === 'false').length,
    2,
    'both levels must refresh their seeded columns',
  )
  assert.equal(
    updates.filter(([, , ignore]) => ignore === 'true').length,
    2,
    'both levels must create missing rows via DO NOTHING',
  )
})
