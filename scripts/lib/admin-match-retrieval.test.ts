/**
 * /admin/match — candidate retrieval.
 *
 * THE PRODUCTION DEFECT, measured 2026-08-30 against the live catalogue.
 *
 * The sweep built one conjunctive query from the canonical name: every token
 * longer than two characters became a required `title ILIKE '%token%'`. Only
 * hyphens were normalised, so punctuation survived into the tokens —
 *
 *   'Roland RE-201 (Space Echo)'  ->  roland AND 201 AND '(space' AND 'echo)'
 *
 * — and since no marketplace title contains `(space`, the clean, curated,
 * legendary RE-201 retrieved 0 candidates from all five sources.
 *
 * The polluted duplicate retrieved 11, and the reason is NOT that it is longer.
 * Under AND, more tokens can only match less. It retrieved because its name is
 * a verbatim Reverb listing title, so its ten required tokens are the words
 * Reverb writes in its own titles: all 11 hits were Reverb, and it scored 0 on
 * DBA, Finn, Blocket and Kleinanzeigen. Its cross-marketplace recall is worse
 * than the clean product's would be with a working query.
 *
 * Measured recall after the change (unique listings, live data):
 *
 *   roland-re-201          0 -> 81  across 4 sources
 *   roland-sh-101        175 -> 176 across 5 sources   (unchanged: no widening)
 *   chamberlin-rhythmate   2 -> 2                      (no model token)
 *   polluted duplicate    11 -> 11                     (no model token)
 *
 * The planner is import-free, so this runs under the root `tsx --test` harness.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  MAX_VARIANTS,
  buildOrFilter,
  canonicalTerms,
  isAdmissibleAlias,
  isDistinctiveModelToken,
  modelTokenForms,
  planRetrieval,
  sanitizeTerm,
  variantMatches,
  type ProductFacts,
} from '../../frontend/lib/admin-match-query'

const ROOT = join(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')
const CANDIDATES_ROUTE = read('frontend', 'app', 'api', 'admin', 'match', 'candidates', 'route.ts')

/**
 * Assertions about CODE run against the comment-stripped source.
 *
 * The route's comments quote the defect verbatim — including the old
 * `const { data } = await q.limit(...)` line — so matching raw source would let
 * an explanation satisfy or break a test about behaviour.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
const CANDIDATES_CODE = stripComments(CANDIDATES_ROUTE)

/* Real rows, copied from production. */
const RE201: ProductFacts = {
  canonicalName: 'Roland RE-201 (Space Echo)', modelName: 'RE-201', brandName: 'Roland',
}
const POLLUTED: ProductFacts = {
  canonicalName: 'Roland RE-201 Space Echo Tape Delay / Reverb 1974 - 1988 - Black',
  modelName: null, brandName: 'Roland',
}
const SH101: ProductFacts = {
  canonicalName: 'Roland SH-101', modelName: 'SH-101', brandName: 'Roland',
}
const RHYTHMATE: ProductFacts = {
  canonicalName: 'Chamberlin Rhythmate', modelName: null, brandName: 'Chamberlin',
}

const ids = (f: ProductFacts) => planRetrieval(f).variants.map((v) => v.id)
const termsFor = (f: ProductFacts, id: string) =>
  planRetrieval(f).variants.find((v) => v.id === id)?.terms ?? []
const allTerms = (f: ProductFacts) => planRetrieval(f).variants.flatMap((v) => v.terms)

/* ------------------------------------------------------------------ *
 * 1. The clean RE-201 generates useful model-token variants
 * ------------------------------------------------------------------ */

test('the punctuation bug is fixed at its source', () => {
  // This one assertion is the whole outage: '(space' and 'echo)' were required
  // substrings that no listing title can contain.
  const terms = canonicalTerms('Roland RE-201 (Space Echo)')
  assert.deepEqual(terms, ['roland', '201', 'space', 'echo'])
  for (const term of terms) {
    assert.ok(!/[()/.,]/.test(term), `punctuation survived into a required term: ${term}`)
  }
})

test('the clean RE-201 gets model-token variants, not just its canonical name', () => {
  const plan = planRetrieval(RE201)
  assert.ok(plan.variants.length > 1, 'a single conjunction is what produced the zero')
  assert.deepEqual(ids(RE201), ['brand+model', 'model', 'model-form-1', 'model-form-2', 'canonical'])
  assert.equal(plan.diagnostics.modelDistinctive, true)
  assert.equal(plan.diagnostics.modelToken, 're-201')
})

test('the model token is drawn from the stored model_name, not parsed from the name', () => {
  // model_name is curated. Parsing it back out of 'Roland RE-201 (Space Echo)'
  // is what the old code effectively attempted, and it is why it failed.
  assert.deepEqual(termsFor(RE201, 'model'), ['re-201'])
  assert.deepEqual(termsFor(RE201, 'brand+model'), ['roland', 're-201'])
})

/* ------------------------------------------------------------------ *
 * 2. Hyphenated and unhyphenated forms are equivalent for retrieval
 * ------------------------------------------------------------------ */

test('all three punctuation forms of a model are searched', () => {
  const forms = modelTokenForms('RE-201')
  for (const form of ['re-201', 're 201', 're201']) {
    assert.ok(forms.includes(form), `retrieval must cover the ${form} spelling`)
  }
})

test('the three forms reach the plan as distinct terms', () => {
  // A regression I introduced and caught by measuring: normalising terms folded
  // 're-201' into 're 201', silently discarding the highest-recall variant —
  // 61 live hits against 17. ILIKE is a substring match; they are not the same
  // search.
  const terms = allTerms(RE201)
  for (const form of ['re-201', 're 201', 're201']) {
    assert.ok(terms.includes(form), `the ${form} spelling was folded away`)
  }
})

test('the hyphen survives sanitisation, and filter grammar does not', () => {
  assert.equal(sanitizeTerm('RE-201'), 're-201')
  for (const hostile of ['re,201', 're(201)', 're.201', 're*201']) {
    const clean = sanitizeTerm(hostile)
    for (const ch of [',', '(', ')', '.', '*']) {
      assert.ok(!clean.includes(ch), `${ch} must not survive into a PostgREST filter`)
    }
  }
})

test('a spelling variant is reached whichever way the model is stored', () => {
  for (const stored of ['RE-201', 're 201', 'RE201']) {
    const forms = modelTokenForms(stored)
    assert.ok(forms.includes('re-201') && forms.includes('re201'), `stored as ${stored}`)
  }
})

/* ------------------------------------------------------------------ *
 * 3. Dirty years and colours are not needed for recall
 * ------------------------------------------------------------------ */

test('no year, colour or marketing word is ever a SYNTHESISED required term', () => {
  // Scoped to the variants the planner invents. The canonical variant is the
  // product's own stored name: for the polluted duplicate that name genuinely
  // contains '1974' and 'Black', and rewriting it here would be taxonomy
  // cleanup, which this slice is explicitly not. That case is pinned
  // separately, below.
  for (const facts of [RE201, SH101, RHYTHMATE, POLLUTED]) {
    for (const variant of planRetrieval(facts).variants) {
      if (variant.id === 'canonical') continue
      for (const term of variant.terms) {
        assert.ok(!/^(19|20)\d{2}$/.test(term), `a year became a required term: ${term}`)
        for (const dirty of ['black', 'white', 'mint', 'vintage', 'serviced', 'boxed']) {
          assert.ok(term !== dirty, `a condition/colour word became required: ${term}`)
        }
      }
    }
  }
})

test('a dirty canonical name never contaminates the model-token variants', () => {
  // Even given the polluted name, a model token would be searched clean.
  const withModel = planRetrieval({ ...POLLUTED, modelName: 'RE-201' })
  const synthesised = withModel.variants.filter((v) => v.id !== 'canonical')
  assert.ok(synthesised.length > 0)
  for (const v of synthesised) {
    assert.ok(!v.terms.some((t) => /1974|1988|black|reverb/.test(t)), `contaminated: ${v.terms}`)
  }
})

test('recall for RE-201 comes from the model token alone', () => {
  // The variant that carries the recall requires nothing but the model.
  assert.deepEqual(termsFor(RE201, 'model'), ['re-201'])
})

test('stored aliases that are raw marketplace titles are refused', () => {
  // Measured: all 13 stored aliases for roland-re-201 are Reverb titles.
  // Tokenising them would demand a year and a colour — the polluted duplicate's
  // failure, reintroduced through the back door.
  const realAliases = [
    'Roland RE-201 Space Echo Tape Delay / Reverb 1970s - Black',
    'Roland 1979 Space Echo RE-201. Mint. Boxed.',
    'Roland RE-201 Space Echo, 100% Working Survivor, Analog Tape Delay Echo Effect',
    'Roland RE-201 Space Echo Tape Delay / Reverb 1974 - 1988 - Black - 240v',
  ]
  for (const alias of realAliases) {
    assert.equal(
      isAdmissibleAlias(alias, RE201.canonicalName), false,
      `a raw marketplace title was admitted as a query: ${alias}`,
    )
  }
  const plan = planRetrieval({ ...RE201, aliases: realAliases })
  assert.equal(plan.diagnostics.aliasesConsidered, 4)
  assert.equal(plan.diagnostics.aliasesAdmitted, 0)
  assert.ok(!ids({ ...RE201, aliases: realAliases }).some((i) => i.startsWith('alias')))
})

test('a clean alias is still usable', () => {
  // The filter rejects dirt, not aliases as a concept.
  assert.equal(isAdmissibleAlias('Roland Space Echo', RE201.canonicalName), true)
  const plan = planRetrieval({ ...RE201, aliases: ['Roland Space Echo'] })
  assert.equal(plan.diagnostics.aliasesAdmitted, 1)
})

/* ------------------------------------------------------------------ *
 * 4. Duplicates across variants are evaluated once
 * ------------------------------------------------------------------ */

test('the route deduplicates on the stable marketplace identity before scoring', () => {
  // Measured: RE-201 returns 200 rows across its variants and 81 distinct
  // listings; SH-101 393 and 176. Without this, one listing would consume
  // several of the 50 classifier slots.
  assert.ok(/if \(seen\.has\(row\.id\)\)/.test(CANDIDATES_ROUTE), 'dedup must key on listings.id')
  assert.ok(/droppedAsDuplicate\+\+/.test(CANDIDATES_ROUTE))
  const dedupAt = CANDIDATES_ROUTE.indexOf('seen.has(row.id)')
  const scoreAt = CANDIDATES_ROUTE.indexOf('anthropic.messages.create')
  assert.ok(dedupAt > -1 && scoreAt > dedupAt, 'dedup must happen before Haiku is asked')
})

test('variants are OR alternatives, never extra AND requirements', () => {
  const filter = buildOrFilter(planRetrieval(RE201).variants)
  // Each conjunction is its own and(...) group; the groups are comma-joined,
  // which is PostgREST's OR.
  assert.ok(filter.includes('and(title.ilike.%roland%,title.ilike.%re-201%)'))
  assert.ok(filter.includes('title.ilike.%re201%'))
  assert.ok(!/^and\(/.test(filter) || filter.split('),').length > 1)
  assert.ok(/\.or\(orFilter\)/.test(CANDIDATES_ROUTE), 'the route must OR the variants')
  assert.ok(
    !/for \(const w of words\)/.test(CANDIDATES_ROUTE),
    'the old AND-every-token loop must be gone',
  )
})

/* ------------------------------------------------------------------ *
 * 5. Source balancing survives
 * ------------------------------------------------------------------ */

test('retrieval is still one bounded query per source', () => {
  assert.ok(/requestedKeys\.map\(async \(key\)/.test(CANDIDATES_ROUTE), 'per-source query retained')
  assert.ok(/perSourceQuota\(limit, requestedKeys\.length\)/.test(CANDIDATES_ROUTE))
  assert.ok(/\.limit\(quota \* 3\)/.test(CANDIDATES_ROUTE), 'the per-source ceiling must remain')
  assert.ok(/storedSourcesFor\(\[key\]\)/.test(CANDIDATES_ROUTE), 'Kleinanzeigen/DBA keys intact')
})

test('the interleave that keeps a truncated batch representative is untouched', () => {
  assert.ok(/const interleaved: RawListing\[\] = \[\]/.test(CANDIDATES_ROUTE))
  assert.ok(/SCORING_BATCH/.test(CANDIDATES_ROUTE))
})

test('the plan is per product, not per source, so no source gets a wider query', () => {
  const filter = buildOrFilter(planRetrieval(SH101).variants)
  assert.ok(filter.length > 0)
  assert.equal(
    (CANDIDATES_ROUTE.match(/planRetrieval\(/g) ?? []).length, 1,
    'one plan per request — a per-source plan would unbalance the sweep',
  )
})

/* ------------------------------------------------------------------ *
 * 6. SH-101 does not admit junk merely because retrieval widened
 * ------------------------------------------------------------------ */

test('SH-101 retrieval is not widened — its canonical variant is unchanged', () => {
  // Measured 175 -> 176 unique. The extra variants are model-token queries,
  // which are strictly NARROWER than the old `roland AND 101`.
  assert.deepEqual(termsFor(SH101, 'canonical'), ['roland', '101'])
  for (const id of ['model', 'model-form-1', 'model-form-2']) {
    const terms = termsFor(SH101, id)
    assert.ok(terms.every((t) => t.includes('sh')), `${id} must carry the model letters`)
  }
})

test('a bare brand can never become a query', () => {
  // Measured: '%roland%' alone matches 4,367 active listings. That is not
  // retrieval, it is the entire marketplace.
  for (const facts of [RE201, SH101, POLLUTED]) {
    for (const variant of planRetrieval(facts).variants) {
      assert.notDeepEqual(variant.terms, ['roland'], 'Roland RE-201 was broadened to bare Roland')
      assert.ok(
        variant.terms.length > 1 || isDistinctiveModelToken(variant.terms[0]),
        `a single non-distinctive term became a query: ${variant.terms}`,
      )
    }
  }
})

test('a non-distinctive token is never searched alone', () => {
  for (const word of ['roland', 'space', 'echo', 'chamberlin', 'tape', 'delay', 'black']) {
    assert.equal(isDistinctiveModelToken(word), false, `${word} must not be a standalone query`)
  }
  for (const model of ['re-201', 'sh101', 'tr-808', 'juno 106']) {
    assert.equal(isDistinctiveModelToken(model), true, `${model} should be searchable alone`)
  }
})

test('a digitless or too-short model name yields no standalone variant', () => {
  const plan = planRetrieval({ canonicalName: 'Moog Minimoog', modelName: 'Minimoog', brandName: 'Moog' })
  assert.equal(plan.diagnostics.modelDistinctive, false)
  assert.deepEqual(plan.variants.map((v) => v.id), ['canonical'])
})

/* ------------------------------------------------------------------ *
 * 7. Chamberlin is retrievable without becoming the family
 * ------------------------------------------------------------------ */

test('Chamberlin Rhythmate keeps a two-term conjunction, not a brand sweep', () => {
  assert.deepEqual(ids(RHYTHMATE), ['canonical'])
  assert.deepEqual(termsFor(RHYTHMATE, 'canonical'), ['chamberlin', 'rhythmate'])
  assert.ok(!allTerms(RHYTHMATE).includes('chamberlin') || termsFor(RHYTHMATE, 'canonical').length > 1)
})

test('no family variant is emitted, because retrieval is not where a family lives', () => {
  // Families group children for navigation and never aggregate listings
  // (root CLAUDE.md §7). A family retrieval query would put sibling models in
  // front of the classifier as if they were this product.
  for (const facts of [RE201, SH101, RHYTHMATE, POLLUTED]) {
    assert.ok(
      !planRetrieval(facts).variants.some((v) => v.id.startsWith('family')),
      'no stored family retrieval data exists to justify this variant',
    )
  }
})

/* ------------------------------------------------------------------ *
 * 8. Products without a model token keep the previous bounded behaviour
 * ------------------------------------------------------------------ */

test('a product with no model_name retrieves exactly as before, minus the bug', () => {
  for (const facts of [RHYTHMATE, POLLUTED]) {
    const plan = planRetrieval(facts)
    assert.deepEqual(plan.variants.map((v) => v.id), ['canonical'])
    assert.equal(plan.diagnostics.modelDistinctive, false)
  }
})

test('the polluted duplicate is not repaired by this change, and must not be', () => {
  // It has no model_name, so it keeps its ten-term conjunction. Cleaning it up
  // is a taxonomy job — explicitly out of scope for a retrieval fix.
  const terms = termsFor(POLLUTED, 'canonical')
  assert.equal(terms.length, 10)
  assert.ok(terms.includes('1974') && terms.includes('black'))
})

/* ------------------------------------------------------------------ *
 * 9. Caps, and the diagnostics an operator needs
 * ------------------------------------------------------------------ */

test('the variant count is capped', () => {
  // Distinct terms per alias: a one-character suffix is filtered as too short
  // and every alias would collapse to the same variant under dedup.
  const many = Array.from({ length: 20 }, (_, i) => `Roland Echo Unit ${String(i).padStart(3, 'x')}`)
  const plan = planRetrieval({ ...RE201, aliases: many })
  assert.ok(plan.variants.length <= MAX_VARIANTS, 'an unbounded plan is an unbounded sweep')
  assert.ok(plan.diagnostics.variantsCapped > 0, 'the cap must be reported, not silent')
})

test('the most specific variants survive the cap', () => {
  const plan = planRetrieval({ ...RE201, aliases: Array.from({ length: 20 }, (_, i) => `Roland Echo ${String(i).padStart(3, 'x')}`) })
  assert.equal(plan.variants[0].id, 'brand+model', 'the cap must drop the broadest, not the sharpest')
})

test('the four distinguishable retrieval outcomes are all logged, with counts only', () => {
  for (const field of [
    'per_source_raw', 'unique_after_dedup', 'dropped_duplicate', 'scored_out',
    'variants', 'variant_count', 'variants_capped', 'aliases_admitted',
  ]) {
    assert.ok(CANDIDATES_ROUTE.includes(field), `diagnostics missing ${field}`)
  }
  // Counts and identifiers only — never listing payloads.
  for (const leak of ['title:', 'l.title', 'listing_titles', 'price:']) {
    assert.ok(
      !new RegExp(`retrievalLog[\\s\\S]{0,400}${leak.replace('.', '\\.')}`).test(CANDIDATES_ROUTE),
      `the retrieval log must not carry ${leak}`,
    )
  }
})

test('the strict classifier and approval semantics are untouched', () => {
  assert.ok(/claude-haiku/.test(CANDIDATES_ROUTE), 'same classifier')
  assert.ok(/\.filter\(\(c\) => c\.score !== 'no'\)/.test(CANDIDATES_ROUTE), 'same strict filter')
  assert.ok(/decided\.has\(row\.id\)/.test(CANDIDATES_ROUTE), 'durable decisions still exclude')
  assert.ok(/matchState\(decided\.get\(l\.id\), decided\.has\(l\.id\)\)/.test(CANDIDATES_ROUTE))
})

test('the public product page still refuses rejected matches', () => {
  const publicRoute = read('frontend', 'app', 'api', 'product', '[slug]', 'route.ts')
  assert.ok(/\.not\('is_valid', 'is', false\)/.test(publicRoute))
})

/* ------------------------------------------------------------------ *
 * 10. Preview-gate requirements: a failed query is a failure
 * ------------------------------------------------------------------ */

test('a rejected source query surfaces as an error, never as zero candidates', () => {
  // The gate case. `const { data } = await q.limit(...)` discarded the error,
  // so a malformed filter became `null` -> `[]` -> "no candidates", which is
  // indistinguishable from an empty queue. That is precisely how an untested
  // PostgREST filter grammar would hide.
  assert.ok(
    !/const \{ data \} = await q\.limit/.test(CANDIDATES_CODE),
    'the per-source query error must not be discarded',
  )
  assert.ok(/const \{ data, error: queryError \} = await q\.limit/.test(CANDIDATES_CODE))
  assert.ok(/candidate_retrieval_query_failed/.test(CANDIDATES_CODE))
  assert.ok(/status: 502/.test(CANDIDATES_CODE), 'a failed sweep must not return 200 with []')
  const failAt = CANDIDATES_CODE.indexOf('failedSources.length > 0')
  const poolAt = CANDIDATES_CODE.indexOf('const pool: RawListing[] = []')
  assert.ok(failAt > -1 && poolAt > failAt, 'the failure must return before any pooling')
})

test('per-variant recall is observable per source, without extra queries', () => {
  assert.ok(/per_variant_raw/.test(CANDIDATES_CODE))
  assert.ok(/variantMatches\(variant, row\.title/.test(CANDIDATES_CODE))
  // Attribution is local: one query per source stays one query per source.
  assert.equal((CANDIDATES_CODE.match(/await q\.limit/g) ?? []).length, 1)
})

test('variant attribution uses the same conjunction semantics as the query', () => {
  const [brandModel] = planRetrieval(RE201).variants
  assert.equal(variantMatches(brandModel, 'Roland RE-201 Space Echo'), true)
  assert.equal(variantMatches(brandModel, 'RE-201 Space Echo'), false, 'every term must be present')
  assert.equal(variantMatches(brandModel, 'roland re-201'), true, 'matching is case-insensitive')
})

test('the classifier verdict split is logged', () => {
  for (const field of ['scored_yes', 'scored_maybe', 'scored_no', 'sent_to_classifier']) {
    assert.ok(CANDIDATES_CODE.includes(field), `the gate needs ${field}`)
  }
})

test('no listing title or provider payload reaches any log line', () => {
  // The logs carry counts, ids and variant identifiers. Titles are read for
  // attribution and immediately discarded.
  const logs = CANDIDATES_CODE.match(/JSON\.stringify\(\{[\s\S]*?\}\)/g) ?? []
  assert.ok(logs.length >= 2, 'expected the retrieval and failure log lines')
  for (const log of logs) {
    for (const leak of ['row.title', 'l.title', '.url', 'price', 'listing_title']) {
      assert.ok(!log.includes(leak), `a log line leaked ${leak}`)
    }
  }
})
