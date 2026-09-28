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
  families: [{ slug: 'boss-ce-chorus', label: 'Boss CE Chorus', children: ['boss-ce-2'] }],
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
