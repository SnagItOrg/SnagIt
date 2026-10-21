/**
 * scripts/lib/catalogue-audit.ts — the pure half of the nightly catalogue audit (PAN-284).
 *
 * Every rule the owner keeps checking by hand is one named check here: an id, a one-line
 * description, a severity, the predicate, and an allow-list of decided exceptions with the ticket
 * that decided each one. The checks read the authorities and never restate them: `isCanonical()`
 * for "is this public", `publicationRefusal()` for "could this be published", `resolveProductImage()`
 * for "which picture shows", `buildFamilyView()` for "what a family renders", `isMatchableProduct()`
 * for "may this receive matches", `LINE_BOUNDARIES` for "is this line drawn".
 *
 * The I/O (the database, the state file, the mail) is in scripts/catalogue-audit.ts; everything
 * that decides is here, so it is testable from a plain Node test with no network.
 *
 * A finding is a `key` (the slug, the category, the group) and a `detail` (what is wrong). The diff
 * against the previous run is by key, so a lapse is reported the night it appears and the night it
 * is gone, and is silent in between. A `trend` check is reported every run and never diffed.
 */

import { isCanonical, type CatalogueStateRow } from '../../frontend/lib/catalogue'
import { publicationRefusal } from '../../frontend/lib/publication'
import { resolveProductImage } from '../../frontend/lib/product-image-source'
import { NAVIGATION_FAMILIES, buildFamilyView, familyForChild, type FamilyChildRow } from '../../frontend/lib/families'
import { LINE_BOUNDARIES, isMatchableProduct } from '../../frontend/lib/matching/match-listings'
import { currentSlug } from '../../frontend/lib/slug-renames'

/** One supported + active `kg_product` row, joined with its projection row and its brand. */
export interface AuditProduct extends CatalogueStateRow {
  id: string
  slug: string
  canonical_name: string | null
  model_name: string | null
  brand_id: string | null
  brand_slug: string | null
  brand_name: string | null
  status: string | null
  support_state: string | null
  browse_visibility: string | null
  /** From `browse_product_projection`; null when the row has no projection row. */
  browse_domain: string | null
  taxonomy_state: string | null
  root_category_slug: string | null
  subcategory_slug: string | null
  hero_image_url: string | null
  image_url: string | null
  /** `browse_product_projection.active_listing_count`: what the browse surface shows. */
  active_listing_count: number | null
}

export interface AuditCategory {
  slug: string
  name_da: string | null
  name_en: string | null
  domain: string | null
}

/** A not-rejected match on an ACTIVE listing, with the listing's brand and country. */
export interface AuditMatch {
  listing_id: string
  product_id: string
  listing_brand_id: string | null
  listing_country: string | null
}

export interface AuditSnapshot {
  products: AuditProduct[]
  categories: AuditCategory[]
  matches: AuditMatch[]
}

export type Severity = 'error' | 'warn' | 'info' | 'trend'

export interface Finding {
  key: string
  detail: string
}

export interface AllowEntry {
  key: string
  /** The ticket that decided the exception, or the reason when no ticket did. */
  by: string
  /** What was decided, when the ticket alone does not say ("decided: no family"). */
  reason?: string
}

export interface Check {
  id: string
  /** One line, Danish or English: what the owner reads. */
  title: string
  severity: Severity
  allow: readonly AllowEntry[]
  run(snapshot: AuditSnapshot): Finding[]
}

export interface CheckResult {
  id: string
  title: string
  severity: Severity
  findings: Finding[]
  /** Findings the allow-list removed, with the entry that removed each. */
  allowed: Array<Finding & { by: string }>
}

export interface AuditRun {
  ran_at: string
  checks: CheckResult[]
}

/** What the state file holds: enough to diff the next run, nothing else. */
export interface AuditState {
  ran_at: string
  findings: Record<string, Record<string, string>>
}

/** The Supabase Storage path every curated or uploaded product image lives under. */
export const STORAGE_PATH = '/storage/v1/object/public/'

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

const canonical = (p: AuditProduct) => isCanonical(p)

function modelStartsWithBrand(p: AuditProduct): boolean {
  const brand = lower(p.brand_name)
  const model = lower(p.model_name)
  if (!brand || !model) return false
  return model === brand || model.startsWith(`${brand} `)
}

function slugRepeatsBrand(p: AuditProduct): boolean {
  if (p.slug.includes('--')) return true
  const brand = p.brand_slug
  return !!brand && p.slug.startsWith(`${brand}-${brand}`)
}

function sharedModelNames(products: AuditProduct[]): Finding[] {
  const groups = new Map<string, AuditProduct[]>()
  for (const p of products) {
    const model = lower(p.model_name)
    if (!model) continue
    const key = `${p.brand_slug ?? '?'}:${model}`
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  const out: Finding[] = []
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue
    // Through `currentSlug`: the boundaries are keyed by the renamed slugs (PAN-289).
    const unbounded = rows.filter((p) => !(currentSlug(p.slug) in LINE_BOUNDARIES)).map((p) => p.slug).sort()
    if (unbounded.length === 0) continue
    out.push({ key, detail: `${rows.length} rows, no line boundary on ${unbounded.join(', ')}` })
  }
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

/** `subcategory_slug` -> number of canonical products a visitor finds under it. */
function publicCountBySubcategory(products: AuditProduct[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of products) {
    if (!canonical(p) || !p.subcategory_slug) continue
    out.set(p.subcategory_slug, (out.get(p.subcategory_slug) ?? 0) + 1)
  }
  return out
}

function familyFindings(products: AuditProduct[]): { labelEqualsChild: Finding[]; noCanonicalChild: Finding[] } {
  const rows: FamilyChildRow[] = products.map((p) => ({
    slug: p.slug, id: p.id, canonical_name: p.canonical_name,
    status: p.status, support_state: p.support_state, browse_visibility: p.browse_visibility, browse_domain: p.browse_domain,
  }))
  const labelEqualsChild: Finding[] = []
  const noCanonicalChild: Finding[] = []
  for (const family of NAVIGATION_FAMILIES) {
    const view = buildFamilyView(family, rows)
    const twins = view.children.filter((c) => lower(c.label) === lower(family.label))
    if (twins.length > 0) {
      labelEqualsChild.push({ key: family.slug, detail: `label "${family.label}" is also the name of ${twins.map((c) => c.slug).join(', ')}` })
    }
    if (!view.published) {
      noCanonicalChild.push({
        key: family.slug,
        detail: family.children.length === 0 ? 'no children configured' : `${family.children.length} children configured, none canonical`,
      })
    }
  }
  return { labelEqualsChild, noCanonicalChild }
}

/** The letter run before the first hyphen of a model name: DS-1 / DS-1X / DS-2 → "DS"; "Model D" → null. */
export function modelPrefix(modelName: string | null | undefined): string | null {
  const m = /^([A-Za-z]+)-/.exec((modelName ?? '').trim())
  return m ? m[1].toUpperCase() : null
}

/**
 * Owner, 2026-10-21: "hvis de har samme model prefix, så er de nok i familie." Public rows of one
 * brand that share a prefix and are not all in a family — a group with no family, or the members
 * a family leaves out. Membership is `familyForChild()`, the reviewed configuration itself.
 */
function sharedPrefixCandidates(products: AuditProduct[], allow: readonly AllowEntry[]): Finding[] {
  // A per-slug exception (`brand:PREFIX/slug`) takes that row out of its group: a single model that
  // shares a prefix with a family without being of it. A whole-group key is matched by runAudit.
  const excepted = new Set(allow.map((a) => a.key.split('/')[1]).filter((slug): slug is string => !!slug))
  const groups = new Map<string, AuditProduct[]>()
  for (const p of products) {
    const prefix = modelPrefix(p.model_name)
    if (!canonical(p) || !prefix) continue
    const key = `${p.brand_slug ?? '?'}:${prefix}`
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  const out: Finding[] = []
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue
    const uncovered = rows.filter((p) => familyForChild(p.slug) === null && !excepted.has(p.slug)).map((p) => p.slug).sort()
    if (uncovered.length === 0) continue
    const where = uncovered.length === rows.length ? 'none in a family' : `${uncovered.length} outside a family`
    out.push({ key, detail: `${rows.length} public rows, ${where}: ${uncovered.join(', ')}` })
  }
  return out
}

function brandMismatches(s: AuditSnapshot): Finding[] {
  const byId = new Map(s.products.filter(isMatchableProduct).map((p) => [p.id, p]))
  const out: Finding[] = []
  for (const m of s.matches) {
    const p = byId.get(m.product_id)
    if (!p || !p.brand_id || !m.listing_brand_id) continue
    if (m.listing_brand_id === p.brand_id) continue
    out.push({ key: `${p.slug}:${m.listing_id}`, detail: `listing brand ${m.listing_brand_id} ≠ product brand ${p.brand_slug ?? p.brand_id}` })
  }
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

function dkShareByRoot(s: AuditSnapshot): Finding[] {
  const withDk = new Set(s.matches.filter((m) => m.listing_country === 'DK').map((m) => m.product_id))
  const roots = new Map<string, { n: number; noDk: number }>()
  for (const p of s.products) {
    if (!canonical(p)) continue
    const root = p.root_category_slug ?? '?'
    const r = roots.get(root) ?? { n: 0, noDk: 0 }
    r.n++
    if (!withDk.has(p.id)) r.noDk++
    roots.set(root, r)
  }
  return [...roots.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .map(([root, r]) => ({ key: root, detail: `${r.noDk}/${r.n} public products with no Danish listing (${Math.round((100 * r.noDk) / r.n)} %)` }))
}

const SHARED_PREFIX_ALLOW: readonly AllowEntry[] = [
  { key: 'ampex:ATR', by: 'PAN-284', reason: 'the ATR-102 and ATR-700 are different machines' },
  { key: 'ua:LA', by: 'PAN-284', reason: 'the LA-2A, LA-4 and LA-610 are different devices' },
  { key: 'warm-audio:WA', by: 'PAN-284', reason: 'brand-wide numbering, not a line' },
  { key: 'yamaha:YTR', by: 'PAN-285', reason: 'the Xeno family is under discussion' },
  { key: 'gibson:ES/gibson-es-les-paul', by: 'PAN-284', reason: 'not an ES-335' },
  { key: 'gibson:L/gibson-l-4c', by: 'PAN-284', reason: 'an archtop, not an L-00' },
  { key: 'gibson:L/gibson-l-7c', by: 'PAN-284', reason: 'an archtop, not an L-00' },
  { key: 'gibson:G/gibson-g-200-ec', by: 'PAN-284', reason: 'its own model beside the G-45' },
  { key: 'martin:D/martin-d-42-modern-deluxe', by: 'PAN-284', reason: 'its own model beside the D-18 and D-28' },
  { key: 'heritage:H/heritage-h-150', by: 'PAN-284', reason: 'a solid body, not an H-535' },
  { key: 'roland:JP/roland-jp-8080', by: 'PAN-284', reason: 'the JP-8000 line, not a Jupiter' },
  { key: 'roland:SH/roland-sh-01-gaia', by: 'PAN-284', reason: 'owner: decades from the SH-101, stays its own page' },
]

/**
 * The registry. Order is report order within a severity. Every allow entry names the ticket that
 * decided it, or the reason when the exception is a fact rather than a decision.
 */
export const CHECKS: readonly Check[] = [
  {
    id: 'public_without_image',
    title: 'Offentligt produkt uden billede — the resolved image (curated, then ingested) is null',
    severity: 'error',
    allow: [],
    run: (s) => s.products.filter((p) => canonical(p) && resolveProductImage(p).url === null)
      .map((p) => ({ key: p.slug, detail: 'no hero_image_url and no image_url' })),
  },
  {
    id: 'matched_listing_brand_mismatch',
    title: 'Aktiv annonce matchet til et produkt af et andet mærke (brand-guard escape)',
    severity: 'error',
    allow: [],
    run: brandMismatches,
  },
  {
    id: 'family_label_equals_child_name',
    title: 'Familie hvis label er identisk med et barns navn',
    severity: 'error',
    allow: [],
    run: (s) => familyFindings(s.products).labelEqualsChild,
  },
  {
    id: 'public_image_off_storage',
    title: 'Offentligt produkt hvis billede ikke ligger i Supabase Storage (hotlink that can rot)',
    severity: 'warn',
    allow: [],
    run: (s) => s.products
      .filter((p) => canonical(p))
      .map((p) => ({ p, url: resolveProductImage(p).url }))
      .filter(({ url }) => url !== null && !url.includes(STORAGE_PATH))
      .map(({ p, url }) => ({ key: p.slug, detail: new URL(url!).host })),
  },
  {
    id: 'model_name_starts_with_brand',
    title: 'model_name begynder med mærket ("EHX Deluxe Memory Man", PAN-282)',
    severity: 'warn',
    allow: [
      // The maker's name is part of the model as sellers and the maker write it; the matcher keys on it
      // (arp-korg-arp-2600 took "ARP 2600" in PAN-266 to avoid a tie). Owner, 2026-10-21.
      ...['arp-2600', 'arp-korg-arp-2600', 'ssl-12', 'ssl-18', 'ssl-2', 'ssl-2-mkii', 'ssl-2-plus', 'ssl-2-plus-mkii']
        .map((key) => ({ key, by: 'PAN-284' })),
    ],
    run: (s) => s.products.filter(modelStartsWithBrand).map((p) => ({ key: p.slug, detail: `"${p.model_name}" under brand "${p.brand_name}"` })),
  },
  {
    id: 'slug_repeats_brand',
    title: 'Slug med "--" eller gentaget mærke (roland--505, warm-audio-warm-audio-…)',
    severity: 'warn',
    allow: [],
    run: (s) => s.products.filter(slugRepeatsBrand).map((p) => ({ key: p.slug, detail: `brand ${p.brand_slug}` })),
  },
  {
    id: 'supported_blocked_from_public',
    title: 'Supported række der ikke kan publiceres (ingen underkategori / music-rod)',
    severity: 'warn',
    allow: [],
    run: (s) => s.products
      .map((p) => ({ p, refusal: publicationRefusal('public', p) }))
      .filter(({ refusal }) => refusal !== null)
      .map(({ p, refusal }) => ({ key: p.slug, detail: `${refusal!.error} (${p.browse_visibility}, taxonomy ${p.taxonomy_state ?? 'none'})` })),
  },
  {
    id: 'shared_model_name_without_boundary',
    title: 'To rækker af ét mærke deler model_name uden en line boundary',
    severity: 'warn',
    allow: [
      // Four Deluxe Memory Man rows share the name; the era is read by LINE_BOUNDARIES, not the name.
      { key: 'electro-harmonix:deluxe memory man', by: 'PAN-282' },
      // The 2016 reissue and the 2022 run both carry "Model D"; the year is the boundary.
      { key: 'moog:model d', by: 'PAN-199' },
    ],
    run: (s) => sharedModelNames(s.products),
  },
  {
    id: 'category_name_da_is_english',
    title: 'Kategori med offentlige produkter hvis name_da stadig er den engelske tekst (PAN-107, PAN-271)',
    severity: 'warn',
    allow: [
      // Loanwords the Danish trade writes exactly as the English does.
      { key: 'effects-and-pedals/reverb', by: 'same word in Danish' },
      { key: 'pro-audio/reverb', by: 'same word in Danish' },
      { key: 'effects-and-pedals/delay', by: 'same word in Danish' },
      { key: 'effects-and-pedals/fuzz', by: 'same word in Danish' },
      { key: 'effects-and-pedals/flanger', by: 'same word in Danish' },
      { key: 'effects-and-pedals/distortion', by: 'same word in Danish' },
      { key: 'effects-and-pedals/eq', by: 'same word in Danish' },
      { key: 'acoustic-guitars/dreadnought', by: 'same word in Danish' },
      { key: 'acoustic-guitars/jumbo', by: 'same word in Danish' },
      { key: 'acoustic-guitars/archtop', by: 'same word in Danish' },
      { key: 'acoustic-guitars/parlor', by: 'same word in Danish' },
      { key: 'bass-guitars/fretless', by: 'same word in Danish' },
    ],
    run: (s) => {
      const publicN = publicCountBySubcategory(s.products)
      return s.categories
        .filter((c) => c.domain === 'music' && !!c.name_en && c.name_da === c.name_en && (publicN.get(c.slug) ?? 0) > 0)
        .sort((a, b) => (publicN.get(b.slug) ?? 0) - (publicN.get(a.slug) ?? 0) || a.slug.localeCompare(b.slug))
        .map((c) => ({ key: c.slug, detail: `"${c.name_en}", ${publicN.get(c.slug)} public product${publicN.get(c.slug) === 1 ? '' : 's'}` }))
    },
  },
  {
    id: 'family_candidate_shared_prefix',
    title: 'Offentlige rækker af ét mærke med samme model-prefix (DS-1, DS-2 …) uden en familie',
    severity: 'warn',
    // An entry here is "decided: no family" — `by` the ticket, `reason` what was decided. A whole group
    // is `brand:PREFIX`; a single row that shares a prefix with a family without being of it is
    // `brand:PREFIX/slug`. Owner's triage of the first run, 2026-10-21.
    allow: SHARED_PREFIX_ALLOW,
    run: (s) => sharedPrefixCandidates(s.products, SHARED_PREFIX_ALLOW),
  },
  {
    id: 'family_without_canonical_child',
    title: 'Familie uden et eneste kanonisk barn (renders nothing, noindex)',
    severity: 'info',
    allow: [],
    run: (s) => familyFindings(s.products).noCanonicalChild,
  },
  {
    id: 'public_without_listings',
    title: 'Offentligt produkt med 0 aktive annoncer',
    severity: 'info',
    allow: [],
    run: (s) => s.products.filter((p) => canonical(p) && (p.active_listing_count ?? 0) === 0)
      .map((p) => ({ key: p.slug, detail: `${p.root_category_slug ?? '?'}` })),
  },
  {
    id: 'public_without_dk_listing_by_root',
    title: 'Andel af offentlige produkter uden dansk annonce, per rod (a trend, not an error)',
    severity: 'trend',
    allow: [],
    run: dkShareByRoot,
  },
]

/** Run every check, apply its allow-list, and keep what each one removed. */
export function runAudit(snapshot: AuditSnapshot, checks: readonly Check[] = CHECKS, ranAt = new Date()): AuditRun {
  const ids = new Set<string>()
  const results: CheckResult[] = []
  for (const check of checks) {
    if (ids.has(check.id)) throw new Error(`duplicate check id: ${check.id}`)
    ids.add(check.id)
    const allowBy = new Map(check.allow.map((a) => [a.key, a.by]))
    const findings: Finding[] = []
    const allowed: CheckResult['allowed'] = []
    for (const f of check.run(snapshot)) {
      const by = allowBy.get(f.key)
      if (by === undefined) findings.push(f)
      else allowed.push({ ...f, by })
    }
    // A trend orders itself; everything else is by key, so the report never moves with the database's order.
    if (check.severity !== 'trend') findings.sort((a, b) => a.key.localeCompare(b.key))
    results.push({ id: check.id, title: check.title, severity: check.severity, findings, allowed })
  }
  return { ran_at: ranAt.toISOString(), checks: results }
}

/** The state file for the next run: diffable checks only — a trend is reported, never diffed. */
export function toState(run: AuditRun): AuditState {
  const findings: AuditState['findings'] = {}
  for (const c of run.checks) {
    if (c.severity === 'trend') continue
    findings[c.id] = Object.fromEntries(c.findings.map((f) => [f.key, f.detail]))
  }
  return { ran_at: run.ran_at, findings }
}

export interface DiffEntry extends Finding { id: string; severity: Severity }

export interface AuditDiff {
  /** Null on the first run: everything is new then. */
  previous_ran_at: string | null
  added: DiffEntry[]
  /** Same key, different detail. */
  changed: Array<DiffEntry & { was: string }>
  fixed: DiffEntry[]
}

export function diffRuns(previous: AuditState | null, run: AuditRun): AuditDiff {
  const diff: AuditDiff = { previous_ran_at: previous?.ran_at ?? null, added: [], changed: [], fixed: [] }
  for (const c of run.checks) {
    if (c.severity === 'trend') continue
    const before = previous?.findings[c.id] ?? {}
    const now = new Map(c.findings.map((f) => [f.key, f.detail]))
    for (const f of c.findings) {
      const was = before[f.key]
      if (was === undefined) diff.added.push({ id: c.id, severity: c.severity, ...f })
      else if (was !== f.detail) diff.changed.push({ id: c.id, severity: c.severity, ...f, was })
    }
    for (const [key, detail] of Object.entries(before)) {
      if (!now.has(key)) diff.fixed.push({ id: c.id, severity: c.severity, key, detail })
    }
  }
  return diff
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2, trend: 3 }
const bySeverity = (a: { severity: Severity }, b: { severity: Severity }) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]

/**
 * The short report: new or changed first, then what was fixed since the last run, then one line per
 * check that is unchanged, then the trends. "[catalogue-audit] OK" when nothing moved.
 */
export function formatReport(run: AuditRun, diff: AuditDiff): string {
  const lines: string[] = []
  const since = diff.previous_ran_at ? `since ${diff.previous_ran_at.slice(0, 16).replace('T', ' ')} UTC` : 'first run'
  const open = run.checks.filter((c) => c.severity !== 'trend').reduce((n, c) => n + c.findings.length, 0)
  const moved = diff.added.length + diff.changed.length + diff.fixed.length
  lines.push(`[catalogue-audit] ${moved === 0 ? 'OK' : `${diff.added.length} new, ${diff.changed.length} changed, ${diff.fixed.length} fixed`} — ${open} open findings, ${since}`)

  const entry = (e: DiffEntry) => `  ${e.severity.padEnd(5)} ${e.id}  ${e.key} — ${e.detail}`
  if (diff.added.length > 0) {
    lines.push('', 'NEW')
    for (const e of [...diff.added].sort(bySeverity)) lines.push(entry(e))
  }
  if (diff.changed.length > 0) {
    lines.push('', 'CHANGED')
    for (const e of [...diff.changed].sort(bySeverity)) lines.push(`${entry(e)} (was: ${e.was})`)
  }
  if (diff.fixed.length > 0) {
    lines.push('', 'FIXED')
    for (const e of [...diff.fixed].sort(bySeverity)) lines.push(entry(e))
  }

  const moving = new Set([...diff.added, ...diff.changed].map((e) => `${e.id}\n${e.key}`))
  const unchanged = run.checks
    .filter((c) => c.severity !== 'trend')
    .map((c) => ({ c, n: c.findings.filter((f) => !moving.has(`${c.id}\n${f.key}`)).length }))
  lines.push('', 'UNCHANGED')
  for (const { c, n } of [...unchanged].sort((a, b) => bySeverity(a.c, b.c))) {
    const allowed = c.allowed.length > 0 ? `, ${c.allowed.length} allowed` : ''
    lines.push(`  ${c.severity.padEnd(5)} ${c.id}  ${n}${allowed}`)
  }

  const trends = run.checks.filter((c) => c.severity === 'trend')
  if (trends.length > 0) {
    lines.push('', 'TREND')
    for (const c of trends) for (const f of c.findings) lines.push(`  ${c.id}  ${f.key} — ${f.detail}`)
  }
  return lines.join('\n')
}
