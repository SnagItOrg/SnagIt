/**
 * A proposed navigation family, checked against live catalogue rows — PAN-159,
 * option M.
 *
 * Families stay reviewed code (PAN-52 D1(a)). An admin proposes one at
 * /admin/families/propose; this module decides whether the proposal would be a
 * valid entry in `lib/family-slugs.ts` + `lib/families.ts` and, when it would,
 * writes the code to paste. Nothing here writes to the database, and nothing
 * here reads a listing or a price: a family never owns one (PAN-94).
 *
 * PURE. The route loads the rows; this module only judges them, so the rules
 * are testable from plain Node with fixture rows.
 *
 * ERRORS BLOCK THE PATCH; WARNINGS DO NOT. An error is a rule the family code
 * itself relies on (a slug that would 308 a priced page away, a product in two
 * families, a member under another browse root). A warning is something a
 * reviewer should look at but that an existing family already does on purpose
 * (a `known` member that renders nothing yet, an unclassified member, a
 * member of another brand, as the Prophet line has).
 */

import { isCanonical } from './catalogue'
import { fill, translations } from './i18n'
import { modelKey } from './model-key'

export interface FamilyProposalInput {
  slug: string
  label: string
  brand: string
  categoryRoot: string
  /** kg_product slugs, in the order the family should list them. */
  members: string[]
}

/** One `kg_product` row, joined to its projection row, as the route loads it. */
export interface ProposalProductRow {
  slug: string
  canonical_name: string | null
  status: string | null
  support_state: string | null
  browse_visibility: string | null
  browse_domain: string | null
  root_category_slug: string | null
  brand: string | null
  reverb_csp_id: number | null
  /** Active matched listings, from the projection. Null when it has no row. */
  active_listing_count: number | null
}

export interface ProposalFacts {
  /**
   * Rows for every member, for the proposed slug and for every existing
   * family's children. A missing slug has no row.
   */
  rows: readonly ProposalProductRow[]
  /** Slugs of the music browse roots (`kg_category`, no parent). */
  musicRoots: readonly string[]
  /** The families already in code. */
  families: readonly { slug: string; label: string; brand: string; children: readonly string[] }[]
}

export type ProposalField = 'slug' | 'label' | 'brand' | 'categoryRoot' | 'members'

/** Issues whose copy lives in `lib/i18n.ts` (`adminFamilyProposal`), so the form can localise them. */
export type ProposalIssueCode = keyof typeof translations.da.adminFamilyProposal

export interface ProposalIssue {
  severity: 'error' | 'warning'
  field: ProposalField
  /** The member the issue is about, when it is about one. */
  member?: string
  /** Danish, for every issue. */
  message: string
  code?: ProposalIssueCode
  params?: Record<string, string>
}

export interface ProposalMember {
  slug: string
  name: string | null
  /** True when the member passes `isCanonical()`: the family page links to it. */
  renders: boolean
  /** `support_state · browse_visibility`, or null when the row does not exist. */
  state: string | null
}

export interface FamilyPatch {
  familySlugs: string
  families: string
  test: string
}

export interface ProposalResult {
  ok: boolean
  issues: ProposalIssue[]
  members: ProposalMember[]
  /** Present only when there is no error. */
  patch: FamilyPatch | null
}

const SLUG_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * The spike's listing-title screen: markers a clean `brand + model` name does
 * not carry. A screen, not a verdict — it misses duplicates and can flag a
 * real name, so it only warns.
 */
function listingTitleMarker(row: ProposalProductRow): string | null {
  const name = row.canonical_name ?? ''
  const brandSlug = (row.brand ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (brandSlug && row.slug.startsWith(`${brandSlug}-${brandSlug}-`)) return 'brandet står to gange i slug'
  if (/\b(19|20)\d\d\b/.test(name)) return 'et årstal i navnet'
  if (/\b(brand new|new|used|mint|refurbished|serviced|restock|deal)\b/i.test(name)) return 'stand- eller forhandlerord'
  if (name.trim().split(/\s+/).length > 7) return 'mere end syv ord'
  return null
}

/**
 * The name keys of a row: its canonical name without the parenthetical, and
 * the parenthetical under the row's brand. `Roland JP-4 (Jupiter 4)` gives
 * `rolandjp4` and `rolandjupiter4`. `lib/search-index.ts` splits names the
 * same way, but is server-only and keeps its helpers private.
 */
function nameKeys(row: ProposalProductRow): { name: string; alias: string } {
  const name = row.canonical_name ?? ''
  const paren = name.match(/\(([^)]+)\)/)?.[1] ?? ''
  return {
    name: modelKey(name.replace(/\([^)]*\)/g, ' ')),
    alias: paren ? modelKey(`${row.brand ?? ''} ${paren}`) : '',
  }
}

/**
 * One product under two names: the names match, or one row's parenthetical is
 * the other's name. Two parentheticals are never compared with each other:
 * `(Space Echo)` names a line, so every tape echo that carries it would collide.
 */
function sameProduct(a: ProposalProductRow, b: ProposalProductRow): boolean {
  const ka = nameKeys(a)
  const kb = nameKeys(b)
  const eq = (x: string, y: string) => x !== '' && x === y
  return eq(ka.name, kb.name) || eq(ka.alias, kb.name) || eq(ka.name, kb.alias)
}

/** True when a key of one family contains, or is contained in, a key of the other. */
function keysOverlap(a: readonly string[], b: readonly string[]): boolean {
  const keys = (list: readonly string[]) => list.map(modelKey).filter(Boolean)
  return keys(a).some((x) => keys(b).some((y) => x.includes(y) || y.includes(x)))
}

export function validateFamilyProposal(
  input: FamilyProposalInput,
  facts: ProposalFacts,
): ProposalResult {
  const issues: ProposalIssue[] = []
  const error = (field: ProposalField, message: string, member?: string) =>
    issues.push({ severity: 'error', field, message, ...(member ? { member } : {}) })
  const warn = (field: ProposalField, message: string, member?: string) =>
    issues.push({ severity: 'warning', field, message, ...(member ? { member } : {}) })
  const coded = (
    severity: ProposalIssue['severity'],
    field: ProposalField,
    code: ProposalIssueCode,
    params: Record<string, string>,
    member?: string,
  ) =>
    issues.push({
      severity,
      field,
      message: fill(translations.da.adminFamilyProposal[code], params),
      code,
      params,
      ...(member ? { member } : {}),
    })

  const slug = input.slug.trim()
  const label = input.label.trim()
  const brand = input.brand.trim()
  const members = Array.from(new Set(input.members.map((m) => m.trim()).filter(Boolean)))
  const rowBySlug = new Map(facts.rows.map((row) => [row.slug, row]))
  const familyBySlug = new Map(facts.families.map((f) => [f.slug, f]))

  // ── The family itself ────────────────────────────────────────────────
  if (!SLUG_FORMAT.test(slug)) {
    error('slug', 'Slug må kun have små bogstaver, tal og enkelte bindestreger.')
  } else if (familyBySlug.has(slug)) {
    error('slug', `«${slug}» er allerede en familie.`)
  } else {
    const shadowed = rowBySlug.get(slug)
    if (shadowed?.support_state === 'supported') {
      // /product/<slug> would 308 to the family: a supported page, priced or
      // matchable, would disappear behind a directory.
      error('slug', `«${slug}» er et supported produkt. Familien ville omdirigere dets produktside.`)
    } else if (members.includes(slug)) {
      error('slug', 'En familie kan ikke være sit eget medlem.')
    } else if (shadowed) {
      warn(
        'slug',
        `«${slug}» er en eksisterende ${shadowed.support_state ?? 'ukendt'}-række. Som familie kan den ikke længere publiceres eller få automatiske matches, og dens matches røres ikke.`,
      )
    }
  }

  if (!label) error('label', 'Navn mangler.')
  if (!brand) error('brand', 'Brand mangler.')
  if (!facts.musicRoots.includes(input.categoryRoot)) error('categoryRoot', 'Vælg en hovedkategori.')

  const labelKey = modelKey(label)
  const takenLabel = facts.families.find((f) => f.slug !== slug && modelKey(f.label) === labelKey)
  if (label && takenLabel) error('label', `Navnet bruges allerede af familien «${takenLabel.slug}».`)

  // PAN-194: `jupiter` beside `roland-jupiter` is the same family, so refuse it
  // and name the one to add members to. Same brand only: another maker's
  // `Jupiter` would be another family.
  const nearFamily =
    brand && !familyBySlug.has(slug) && !takenLabel
      ? facts.families.find(
          (f) => modelKey(f.brand) === modelKey(brand) && keysOverlap([slug, label], [f.slug, f.label]),
        )
      : undefined
  if (nearFamily) {
    coded('error', 'slug', 'nearDuplicateFamily', { family: nearFamily.slug, label: nearFamily.label })
  }

  // ── Members ──────────────────────────────────────────────────────────
  if (members.length === 0) error('members', 'Vælg mindst ét medlem.')

  const report: ProposalMember[] = []
  const seenCsp = new Map<number, string>()
  const seenName = new Map<string, string>()

  for (const member of members) {
    const row = rowBySlug.get(member)
    if (!row) {
      error('members', 'Findes ikke i KG.', member)
      report.push({ slug: member, name: null, renders: false, state: null })
      continue
    }
    const renders = isCanonical(row)
    report.push({
      slug: member,
      name: row.canonical_name,
      renders,
      state: `${row.support_state ?? '–'} · ${row.browse_visibility ?? '–'}`,
    })

    if (row.status !== 'active') error('members', 'Rækken er ikke aktiv.', member)
    if (row.browse_domain !== 'music') error('members', 'Rækken er ikke i musik-domænet.', member)
    if (familyBySlug.has(member)) error('members', 'Slug er selv en familie.', member)

    const owner = facts.families.find((f) => f.slug !== slug && f.children.includes(member))
    if (owner) error('members', `Er allerede medlem af «${owner.slug}». Et produkt har én familie.`, member)

    // PAN-194: another row for a product an existing family already holds.
    // Name the row to use instead, so the curator merges rather than creates.
    const sameCsp = (other: ProposalProductRow) =>
      row.reverb_csp_id !== null && other.reverb_csp_id === row.reverb_csp_id
    const twin = owner
      ? undefined
      : facts.families
          .filter((f) => f.slug !== slug)
          .flatMap((f) =>
            f.children.flatMap((child) => {
              const other = rowBySlug.get(child)
              return other && other.slug !== member ? [{ family: f.slug, row: other }] : []
            }),
          )
          .find((c) => sameCsp(c.row) || sameProduct(row, c.row))
    if (twin) {
      const params = { row: twin.row.slug, name: twin.row.canonical_name ?? twin.row.slug, family: twin.family }
      if (sameCsp(twin.row)) {
        coded('error', 'members', 'memberSameCspAsFamilyMember', { ...params, csp: String(row.reverb_csp_id) }, member)
      } else {
        coded('error', 'members', 'memberSameNameAsFamilyMember', params, member)
      }
    }

    // Nothing ties the row to a real product yet: a duplicate is the likely reason.
    if (row.active_listing_count === 0 && row.reverb_csp_id === null) {
      coded('warning', 'members', 'memberNoEvidence', {}, member)
    }

    // PAN-52 §6: the family is placed under a root; it never moves a member.
    if (row.root_category_slug === null) {
      warn('members', 'Har ingen underkategori endnu.', member)
    } else if (row.root_category_slug !== input.categoryRoot) {
      error('members', `Ligger under «${row.root_category_slug}», ikke under familiens hovedkategori.`, member)
    }

    if (labelKey && row.canonical_name && modelKey(row.canonical_name) === labelKey) {
      error('label', `Navnet er medlemmets eget navn («${row.canonical_name}») og kan ikke vælges fra det i søgningen.`)
    }

    // Merge, never create: two rows for one product must not both be members.
    const cspTwin = row.reverb_csp_id !== null ? seenCsp.get(row.reverb_csp_id) : undefined
    const nameKey = row.canonical_name ? modelKey(row.canonical_name) : ''
    const nameTwin = nameKey ? seenName.get(nameKey) : undefined
    if (cspTwin) error('members', `Samme Reverb-CSP (${row.reverb_csp_id}) som «${cspTwin}» — en dublet.`, member)
    else if (nameTwin) error('members', `Samme navn som «${nameTwin}» — en dublet.`, member)
    if (row.reverb_csp_id !== null && !cspTwin) seenCsp.set(row.reverb_csp_id, member)
    if (nameKey && !nameTwin) seenName.set(nameKey, member)

    const marker = listingTitleMarker(row)
    if (marker) warn('members', `Ligner en annoncetitel: ${marker}.`, member)
    if (brand && row.brand && modelKey(row.brand) !== modelKey(brand)) {
      warn('members', `Brand er «${row.brand}», ikke «${brand}». Kontrollér: et underbrand er aldrig medlem.`, member)
    }
  }

  if (members.length > 0 && !report.some((m) => m.renders)) {
    warn('members', 'Intet medlem vises endnu. Familien er tom og noindex, indtil et medlem publiceres.')
  }

  const ok = !issues.some((issue) => issue.severity === 'error')
  return {
    ok,
    issues,
    members: report,
    patch: ok
      ? familyPatch({ slug, label, brand, categoryRoot: input.categoryRoot, members }, facts.families.length)
      : null,
  }
}

/** A TypeScript single-quoted string literal. */
function literal(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** An object key as the family files write it: bare when it can be. */
function key(slug: string): string {
  return /^[a-z_$][a-z0-9_$]*$/.test(slug) ? slug : literal(slug)
}

/**
 * The code to paste. It follows the existing files' shape exactly, so the PR
 * that lands it is a paste plus a ticket comment.
 */
export function familyPatch(proposal: FamilyProposalInput, existingFamilyCount: number): FamilyPatch {
  const children = proposal.members.map((m) => `      ${literal(m)},`).join('\n')
  const familySlugs = [
    '// frontend/lib/family-slugs.ts — add as the last entry of FAMILY_SLUGS, before `] as const`',
    `  ${literal(proposal.slug)},`,
  ].join('\n')
  const families = [
    '// frontend/lib/families.ts — add as the last entry of FAMILY_CONFIG, before its closing `}`',
    `  ${key(proposal.slug)}: {`,
    `    label: ${literal(proposal.label)},`,
    `    brand: ${literal(proposal.brand)},`,
    `    categoryRoot: ${literal(proposal.categoryRoot)},`,
    '    children: [',
    children,
    '    ],',
    '    aliases: [],',
    '  },',
  ].join('\n')
  const test = [
    '// scripts/lib/wp2-families.test.ts',
    `// 1. Add ${literal(proposal.slug)} to EXPECTED_FAMILIES, and change`,
    `//    assert.equal(EXPECTED_FAMILIES.length, ${existingFamilyCount}) to ${existingFamilyCount + 1}.`,
    '// 2. Add to the map in "children match the reviewed §6.3 map":',
    `    ${key(proposal.slug)}: [${proposal.members.map(literal).join(', ')}],`,
  ].join('\n')
  return { familySlugs, families, test }
}
