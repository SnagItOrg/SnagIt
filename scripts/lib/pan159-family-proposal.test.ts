/**
 * PAN-159, option M — the proposed-family validator.
 *
 * Fixture rows only, never the database. Three tests, one per class of rule:
 * a clean proposal yields the exact code to paste; a slug may not take a
 * supported product's page; a member must be one product, in one family,
 * under the family's root.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  validateFamilyProposal,
  type ProposalFacts,
  type ProposalProductRow,
} from '../../frontend/lib/family-proposal'

function row(slug: string, name: string, over: Partial<ProposalProductRow> = {}): ProposalProductRow {
  return {
    slug,
    canonical_name: name,
    status: 'active',
    support_state: 'supported',
    browse_visibility: 'public',
    browse_domain: 'music',
    root_category_slug: 'effects-and-pedals',
    brand: 'Roland',
    reverb_csp_id: null,
    active_listing_count: 1,
    ...over,
  }
}

const FACTS: ProposalFacts = {
  rows: [
    row('roland-re-201', 'Roland RE-201 (Space Echo)', { reverb_csp_id: 740 }),
    row('roland-re-501', 'Roland RE-501 (Chorus Echo)', { reverb_csp_id: 25027 }),
    row('roland-re-201-space-echo-1974-black', 'Roland RE-201 Space Echo 1974 - Black', {
      support_state: 'known',
      browse_visibility: 'qa_only',
      reverb_csp_id: 740,
    }),
    row('boss-re-20', 'Boss RE-20 (Space Echo)', { support_state: 'known', browse_visibility: 'qa_only', brand: 'Boss' }),
    row('boss-ce-2', 'Boss CE-2', { brand: 'Boss' }),
    row('roland-juno-60', 'Roland Juno-60', { root_category_slug: 'keyboards-and-synths' }),
    row('arp-2600', 'ARP 2600', { root_category_slug: 'keyboards-and-synths', brand: 'Arp' }),
    row('fender-jazzmaster', 'Fender Jazzmaster', {
      support_state: 'known',
      browse_visibility: 'qa_only',
      root_category_slug: 'electric-guitars',
      brand: 'Fender',
    }),
  ],
  musicRoots: ['effects-and-pedals', 'keyboards-and-synths', 'electric-guitars'],
  families: [{ slug: 'boss-ce-chorus', label: 'Boss CE Chorus', brand: 'Boss', children: ['boss-ce-2'] }],
}

const SPACE_ECHO = {
  slug: 'roland-space-echo',
  label: 'Roland Space Echo',
  brand: 'Roland',
  categoryRoot: 'effects-and-pedals',
  members: ['roland-re-201', 'roland-re-501'],
}

const errorsOf = (r: ReturnType<typeof validateFamilyProposal>) =>
  r.issues.filter((i) => i.severity === 'error').map((i) => `${i.field}:${i.member ?? ''}`)

test('a clean proposal passes and yields the exact code to paste', () => {
  const result = validateFamilyProposal(SPACE_ECHO, FACTS)
  assert.deepEqual(errorsOf(result), [])
  assert.deepEqual(result.members.map((m) => m.renders), [true, true])
  assert.ok(result.patch)
  assert.match(result.patch.familySlugs, /^ {2}'roland-space-echo',$/m)
  assert.ok(
    result.patch.families.includes(
      [
        "  'roland-space-echo': {",
        "    label: 'Roland Space Echo',",
        "    brand: 'Roland',",
        "    categoryRoot: 'effects-and-pedals',",
        '    children: [',
        "      'roland-re-201',",
        "      'roland-re-501',",
        '    ],',
        '    aliases: [],',
        '  },',
      ].join('\n'),
    ),
    result.patch.families,
  )
  assert.match(result.patch.test, /EXPECTED_FAMILIES\.length, 1\) to 2/)
})

test('a slug never takes a supported product page, or an existing family', () => {
  // `arp-2600` is a priced page: as a family slug it would 308 away.
  const priced = validateFamilyProposal(
    { ...SPACE_ECHO, slug: 'arp-2600', categoryRoot: 'keyboards-and-synths', members: ['roland-juno-60'] },
    FACTS,
  )
  assert.deepEqual(errorsOf(priced), ['slug:'])
  assert.equal(priced.patch, null)

  assert.deepEqual(errorsOf(validateFamilyProposal({ ...SPACE_ECHO, slug: 'boss-ce-chorus' }, FACTS)), ['slug:'])

  // A `known` line-label row may become a family (the PAN-84 guard): a warning, not an error.
  const label = validateFamilyProposal(
    { ...SPACE_ECHO, slug: 'fender-jazzmaster', label: 'Fender Jazzmaster Line', brand: 'Fender', categoryRoot: 'electric-guitars', members: ['fender-jazzmaster-x'] },
    { ...FACTS, rows: [...FACTS.rows, row('fender-jazzmaster-x', 'Fender X Jazzmaster', { support_state: 'known', root_category_slug: 'electric-guitars', brand: 'Fender' })] },
  )
  assert.deepEqual(errorsOf(label), [])
  assert.ok(label.issues.some((i) => i.severity === 'warning' && i.field === 'slug'))
})

test('a member is one existing product, in one family, under the family root', () => {
  const result = validateFamilyProposal(
    {
      ...SPACE_ECHO,
      label: 'Roland RE-201 (Space Echo)', // a member's own name: not choosable in search
      members: [
        'roland-re-201',
        'roland-re-201-space-echo-1974-black', // same CSP as RE-201: a duplicate
        'boss-ce-2', // already in boss-ce-chorus
        'roland-juno-60', // under keyboards-and-synths
        'roland-re-101', // no row
        'boss-re-20', // a sub-brand: a warning only
      ],
    },
    FACTS,
  )
  assert.deepEqual(errorsOf(result).sort(), [
    'label:',
    'members:boss-ce-2',
    'members:roland-juno-60',
    'members:roland-re-101',
    'members:roland-re-201-space-echo-1974-black',
  ])
  assert.equal(result.patch, null)
  const warned = result.issues.filter((i) => i.severity === 'warning').map((i) => i.member)
  assert.ok(warned.includes('boss-re-20'), 'another brand is flagged')
  assert.ok(warned.includes('roland-re-201-space-echo-1974-black'), 'a listing-title row is flagged')
})

// ── PAN-194: the owner's first click-through ─────────────────────────────
// Rows as production holds them (SELECT, 2026-09-30): the jp rows have no CSP
// and no active matches; the Jupiter rows are the family's members.

const synth = (slug: string, name: string, over: Partial<ProposalProductRow> = {}) =>
  row(slug, name, { root_category_slug: 'keyboards-and-synths', ...over })

const JUPITER_FACTS: ProposalFacts = {
  rows: [
    synth('roland-jupiter-4', 'Roland Jupiter-4', { reverb_csp_id: 13767 }),
    synth('roland-jupiter-6', 'Roland Jupiter-6', { reverb_csp_id: 2722 }),
    synth('roland-jupiter-8', 'Roland Jupiter-8', { reverb_csp_id: 27660 }),
    synth('roland-juno-60', 'Roland Juno-60', { reverb_csp_id: 1677 }),
    ...[4, 6, 8].map((n) =>
      synth(`roland-jp-${n}`, `Roland JP-${n} (Jupiter ${n})`, {
        support_state: 'known',
        browse_visibility: 'qa_only',
        active_listing_count: 0,
      }),
    ),
    synth('roland-jupiter-8-reissue', 'Roland Jupiter 8 Reissue', { reverb_csp_id: 27660 }),
    synth('roland-jx-3p', 'Roland JX-3P', { reverb_csp_id: 1234 }),
  ],
  musicRoots: ['keyboards-and-synths', 'effects-and-pedals'],
  families: [
    {
      slug: 'roland-jupiter',
      label: 'Roland Jupiter',
      brand: 'Roland',
      children: ['roland-jupiter-4', 'roland-jupiter-8', 'roland-jupiter-6'],
    },
    { slug: 'roland-juno', label: 'Roland Juno', brand: 'Roland', children: ['roland-juno-60'] },
  ],
}

const OWNER_CASE = {
  slug: 'jupiter',
  label: 'Jupiter',
  brand: 'Roland',
  categoryRoot: 'keyboards-and-synths',
  members: ['roland-jp-4', 'roland-jp-6', 'roland-jp-8'],
}

const coded = (r: ReturnType<typeof validateFamilyProposal>, code: string) => r.issues.filter((i) => i.code === code)

test('PAN-194 rule 1: a near-duplicate family is refused and names the family to use', () => {
  const result = validateFamilyProposal(OWNER_CASE, JUPITER_FACTS)
  assert.equal(result.ok, false)
  assert.equal(result.patch, null)
  const [near, ...more] = coded(result, 'nearDuplicateFamily')
  assert.deepEqual(more, [])
  assert.equal(near.severity, 'error')
  assert.equal(near.params?.family, 'roland-jupiter')
  assert.match(near.message, /«roland-jupiter»/)

  // Same brand, no shared key: a distinct Roland family is not a near-duplicate.
  const jx = validateFamilyProposal(
    { slug: 'roland-jx', label: 'Roland JX', brand: 'Roland', categoryRoot: 'keyboards-and-synths', members: ['roland-jx-3p'] },
    JUPITER_FACTS,
  )
  assert.deepEqual(errorsOf(jx), [])
  // Another brand never collides: a `Jupiter` family from another maker passes rule 1.
  const other = validateFamilyProposal({ ...OWNER_CASE, brand: 'Behringer', members: ['roland-jx-3p'] }, JUPITER_FACTS)
  assert.deepEqual(coded(other, 'nearDuplicateFamily'), [])
})

test('PAN-194 rule 2: a member that duplicates a family member, by name or by CSP, is refused', () => {
  // `JP-4 (Jupiter 4)` is `Jupiter-4`: the parenthetical under the row's brand is its name.
  const byName = coded(validateFamilyProposal(OWNER_CASE, JUPITER_FACTS), 'memberSameNameAsFamilyMember')
  assert.deepEqual(
    byName.map((i) => [i.severity, i.member, i.params?.row, i.params?.family]),
    [
      ['error', 'roland-jp-4', 'roland-jupiter-4', 'roland-jupiter'],
      ['error', 'roland-jp-6', 'roland-jupiter-6', 'roland-jupiter'],
      ['error', 'roland-jp-8', 'roland-jupiter-8', 'roland-jupiter'],
    ],
  )

  const byCsp = coded(
    validateFamilyProposal(
      { slug: 'roland-jupiter-8-line', label: 'Roland Jupiter 8 Line', brand: 'Roland', categoryRoot: 'keyboards-and-synths', members: ['roland-jupiter-8-reissue'] },
      JUPITER_FACTS,
    ),
    'memberSameCspAsFamilyMember',
  )
  assert.deepEqual(byCsp.map((i) => [i.member, i.params?.row, i.params?.csp]), [['roland-jupiter-8-reissue', 'roland-jupiter-8', '27660']])

  // Two parentheticals are never compared: `(Space Echo)` names a line, not a model.
  const lineMate = validateFamilyProposal(
    { slug: 'roland-tape-echo', label: 'Roland Tape Echo', brand: 'Roland', categoryRoot: 'effects-and-pedals', members: ['roland-re-150'] },
    {
      ...FACTS,
      rows: [...FACTS.rows, row('roland-re-150', 'Roland RE-150 (Space Echo)')],
      families: [{ slug: 'roland-space-echo', label: 'Roland Space Echo', brand: 'Roland', children: ['roland-re-201'] }],
    },
  )
  assert.deepEqual(errorsOf(lineMate), [])
})

test('PAN-194 rule 3: a member with no active match and no CSP is a warning, never a refusal', () => {
  const result = validateFamilyProposal(
    { slug: 'roland-jp', label: 'Roland JP', brand: 'Roland', categoryRoot: 'keyboards-and-synths', members: ['roland-jx-3p', 'roland-jp-4'] },
    { ...JUPITER_FACTS, families: [] },
  )
  assert.deepEqual(errorsOf(result), [])
  assert.ok(result.patch)
  assert.deepEqual(
    coded(result, 'memberNoEvidence').map((i) => [i.severity, i.member]),
    [['warning', 'roland-jp-4']],
  )
})
