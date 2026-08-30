/**
 * /admin/suggestions/bulk — the grouping model, and the failure it produced.
 *
 * THE PRODUCTION DEFECT. The route hardcoded `claude-sonnet-4-20250514`. That
 * model was retired, so every grouping request came back `404 not_found_error`
 * and the surface was dead. Two things made it worse than a wrong constant:
 *
 *   - the handler returned `AI grouping failed: ${String(e)}`, putting the raw
 *     provider payload — including the model id — into an admin toast;
 *   - the Anthropic client was a module-level constant, so it was constructed
 *     on import, before any caller had been authorized.
 *
 * A hardcoded model id is invisible until the provider withdraws it, and there
 * was no central place an operator could look to find out which id was in use.
 * These tests pin the resolver, the failure boundary, and the fact that this
 * route reads and never writes — so a provider outage cannot leave half a
 * merge behind.
 *
 * The resolver is import-free, so it runs under the root `tsx --test` harness.
 * The route assertions read source text, following the convention set by
 * scripts/lib/admin-match-kleinanzeigen.test.ts: the defect was a constant and
 * an error path, not logic inside a function, so there is no unit seam that
 * would have caught it.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  DEFAULT_GROUPING_MODEL,
  GROUPING_FAILURE_EVENT,
  GROUPING_FAILURE_MESSAGE,
  GROUPING_MODEL_ENV,
  describeProviderFailure,
  groupingFailureLogLine,
  resolveGroupingModel,
} from '../../frontend/lib/anthropic-model'

const ROOT = join(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')

const GROUP_ROUTE = read('frontend', 'app', 'api', 'admin', 'suggestions', 'bulk', 'group', 'route.ts')
const BULK_PAGE   = read('frontend', 'app', 'admin', 'suggestions', 'bulk', 'page.tsx')
const MODEL_LIB   = read('frontend', 'lib', 'anthropic-model.ts')

/** Strip comments so "runtime code" means code, not prose about the outage. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const DEAD_MODEL = ['claude', 'sonnet', '4', '20250514'].join('-')

/**
 * Assertions about CODE run against the comment-stripped source.
 *
 * The comments in the route and the resolver quote the defect verbatim — the
 * retired id, the old `AI grouping failed` string, the words "no retry". Those
 * are the explanation, and matching them would let prose satisfy or break a
 * test about behaviour.
 */
const GROUP_CODE = stripComments(GROUP_ROUTE)
const MODEL_CODE = stripComments(MODEL_LIB)

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full)
  }
  return acc
}

/* ------------------------------------------------------------------ *
 * 1. The dead identifier is gone from runtime code
 * ------------------------------------------------------------------ */

test('the retired model id occurs zero times in runtime code', () => {
  const offenders: string[] = []
  for (const dir of [join(ROOT, 'frontend'), join(ROOT, 'scripts')]) {
    for (const file of sourceFiles(dir)) {
      if (file.endsWith('admin-grouping-model.test.ts')) continue
      if (stripComments(readFileSync(file, 'utf8')).includes(DEAD_MODEL)) {
        offenders.push(file.replace(ROOT + '/', ''))
      }
    }
  }
  assert.deepEqual(offenders, [], `a retired model id is still reachable at runtime: ${offenders}`)
})

test('the route no longer carries any hardcoded model literal', () => {
  // Whatever model runs, it comes from the resolver — there is no second place
  // for an id to rot.
  assert.ok(
    !/model:\s*['"]claude-/.test(GROUP_CODE),
    'the model must not be written inline in the route',
  )
  assert.ok(/model:\s*resolveGroupingModel\(\)|const model = resolveGroupingModel\(\)/.test(GROUP_CODE))
  assert.ok(/model,/.test(GROUP_CODE), 'the resolved model must be what the request sends')
})

/* ------------------------------------------------------------------ *
 * 2-4. Model resolution
 * ------------------------------------------------------------------ */

test('the default is claude-haiku-4-5', () => {
  assert.equal(DEFAULT_GROUPING_MODEL, 'claude-haiku-4-5')
  assert.equal(resolveGroupingModel({}), 'claude-haiku-4-5')
  assert.equal(resolveGroupingModel({ [GROUPING_MODEL_ENV]: undefined }), 'claude-haiku-4-5')
})

test('the default carries no date suffix', () => {
  // A dated snapshot is exactly what broke: it pins to a build that is
  // eventually withdrawn, while the undated id keeps resolving.
  assert.ok(
    !/-\d{8}$/.test(DEFAULT_GROUPING_MODEL),
    `${DEFAULT_GROUPING_MODEL} pins a dated snapshot`,
  )
})

test('a non-empty override wins', () => {
  assert.equal(
    resolveGroupingModel({ [GROUPING_MODEL_ENV]: 'claude-sonnet-5' }),
    'claude-sonnet-5',
    'an operator must be able to move models without a deploy',
  )
})

test('an override is trimmed, so a stray newline does not become part of the id', () => {
  assert.equal(resolveGroupingModel({ [GROUPING_MODEL_ENV]: '  claude-opus-5\n' }), 'claude-opus-5')
})

test('empty and whitespace overrides fall back to the default', () => {
  // A dashboard field cleared to "" or " " is an operator removing the
  // override, not asking for a model named "". Forwarding it would produce a
  // second 404, less obvious than the one this change fixes.
  for (const blank of ['', ' ', '   ', '\t', '\n', ' \t\n ']) {
    assert.equal(
      resolveGroupingModel({ [GROUPING_MODEL_ENV]: blank }),
      DEFAULT_GROUPING_MODEL,
      `a blank override (${JSON.stringify(blank)}) must fall back`,
    )
  }
})

test('resolution reads one variable and never the API key', () => {
  assert.equal(GROUPING_MODEL_ENV, 'ANTHROPIC_GROUPING_MODEL')
  assert.ok(
    !/ANTHROPIC_API_KEY/.test(MODEL_CODE),
    'the resolver has no business touching the credential',
  )
  assert.ok(
    !/NEXT_PUBLIC_/.test(MODEL_CODE),
    'a NEXT_PUBLIC_ name would inline the model id into the browser bundle',
  )
})

test('the resolver is server-only — no client component imports it', () => {
  const importers: string[] = []
  for (const file of sourceFiles(join(ROOT, 'frontend'))) {
    const src = readFileSync(file, 'utf8')
    if (!/from '@\/lib\/anthropic-model'/.test(src)) continue
    if (/^\s*['"]use client['"]/m.test(src)) importers.push(file.replace(ROOT + '/', ''))
  }
  assert.deepEqual(importers, [], `a client component would ship the model id: ${importers}`)
})

/* ------------------------------------------------------------------ *
 * 5. A successful response preserves the grouping contract
 * ------------------------------------------------------------------ */

test('the prompt is unchanged', () => {
  for (const fragment of [
    'You are a music gear expert helping clean up a product knowledge graph.',
    'Group these product listing titles by their canonical model.',
    'For each group suggest a clean canonical name (brand + model only, no years, colors or descriptions).',
    'Return JSON only — no markdown, no explanation.',
  ]) {
    assert.ok(GROUP_CODE.includes(fragment), `the system prompt lost: ${fragment}`)
  }
  assert.ok(GROUP_CODE.includes('max_tokens: 4096'), 'the token ceiling must not move')
})

test('the requested response schema is unchanged', () => {
  assert.ok(
    GROUP_CODE.includes('{"groups":[{"canonical_name":"Roland TR-909","model_name":"TR-909","suggestions":["..."]}]}'),
    'the schema shown to the model is the contract — it must not drift',
  )
  assert.ok(/```json/.test(GROUP_CODE), 'the markdown-fence strip must survive')
})

test('the enriched group shape the UI consumes is unchanged', () => {
  for (const field of [
    'canonical_name', 'model_name', 'suggestions', 'brand_id',
    'category_id', 'exists_in_kg', 'kg_product_id', 'kg_product_slug',
  ]) {
    assert.ok(new RegExp(`${field}:`).test(GROUP_CODE), `the enriched group lost ${field}`)
  }
  assert.ok(/groups: enriched, total: suggestions\.length/.test(GROUP_CODE), 'the envelope moved')
})

test('suggestions the model omits are still returned as singletons', () => {
  // Losing this would silently drop pending suggestions from the queue.
  assert.ok(/if \(usedIds\.has\(s\.id\)\) continue/.test(GROUP_CODE))
  assert.ok(/model_name: ''/.test(GROUP_CODE), 'an ungrouped suggestion still needs a row')
})

test('retrieval breadth and ordering are unchanged', () => {
  assert.ok(/\.eq\('status', 'pending'\)/.test(GROUP_CODE))
  assert.ok(/\.order\('listing_count', \{ ascending: false \}\)/.test(GROUP_CODE))
  assert.ok(/\.limit\(50\)/.test(GROUP_CODE), 'the sweep size must not move in a hotfix')
})

/* ------------------------------------------------------------------ *
 * 6. A provider failure is contained, and writes nothing
 * ------------------------------------------------------------------ */

test('a provider 404 becomes one static, actionable message', () => {
  assert.ok(
    !/AI grouping failed: \$\{String\(e\)\}/.test(GROUP_CODE),
    'the raw provider payload must not reach the browser',
  )
  assert.ok(GROUP_CODE.includes('GROUPING_FAILURE_MESSAGE'), 'the client gets the static message')
  assert.ok(/status: 502/.test(GROUP_CODE), 'an upstream failure is not our 500')
  // The message must be actionable and must not name the model or the provider.
  assert.ok(GROUPING_FAILURE_MESSAGE.length > 20)
  for (const leak of ['claude', 'anthropic', 'model', '404', 'sonnet', 'haiku']) {
    assert.ok(
      !GROUPING_FAILURE_MESSAGE.toLowerCase().includes(leak),
      `the operator-facing message must not contain "${leak}"`,
    )
  }
})

test('the UI renders that message and nothing else', () => {
  assert.ok(/showToast\(data\.error \?\? 'Fejl ved AI-gruppering'\)/.test(BULK_PAGE))
  assert.ok(!/String\(e\)/.test(BULK_PAGE))
})

test('the failure log carries a static code, the status and the request id', () => {
  const failure = describeProviderFailure({
    status: 404,
    requestID: 'req_abc123',
    error: { type: 'error', error: { type: 'not_found_error', message: 'model: x' } },
  })
  assert.deepEqual(failure, { status: 404, requestId: 'req_abc123' })

  const line = JSON.parse(groupingFailureLogLine(failure, 'claude-haiku-4-5'))
  assert.equal(line.event, GROUPING_FAILURE_EVENT)
  assert.equal(line.event, 'admin_grouping_provider_failed')
  assert.equal(line.status, 404)
  assert.equal(line.request_id, 'req_abc123')
  assert.equal(line.channel, 'operational')
})

test('the failure log never carries a key, a prompt or a provider body', () => {
  const line = groupingFailureLogLine(
    describeProviderFailure({
      status: 404,
      requestID: 'req_x',
      // Everything below is what an SDK error can actually hold.
      error: { error: { message: 'model: retired' } },
      headers: { 'x-api-key': 'sk-ant-secret' },
      message: 'Roland TR-909\nRoland Juno-106',
    }),
    'claude-haiku-4-5',
  )
  for (const forbidden of ['sk-ant', 'x-api-key', 'Roland', 'not_found_error', 'retired']) {
    assert.ok(!line.includes(forbidden), `the log line leaked ${forbidden}`)
  }
  assert.deepEqual(
    Object.keys(JSON.parse(line)).sort(),
    ['channel', 'component', 'event', 'model', 'request_id', 'status'],
    'the log key set is fixed — a new key is a new leak surface',
  )
})

test('a transport failure with no status still produces a well-formed line', () => {
  // An APIConnectionError has neither status nor requestID. Throwing inside the
  // catch block would turn a provider outage into an unhandled 500.
  for (const thrown of [new Error('socket hang up'), null, undefined, 'string error', {}]) {
    const failure = describeProviderFailure(thrown)
    assert.deepEqual(failure, { status: null, requestId: null })
    const line = JSON.parse(groupingFailureLogLine(failure, 'claude-haiku-4-5'))
    assert.equal(line.status, null)
    assert.equal(line.request_id, null)
  }
})

test('there is no retry and no substitute model', () => {
  // Silently succeeding on a pricier model would hide a misconfigured id for
  // exactly as long as it took someone to read the bill.
  assert.ok(!/for \(const m of|FALLBACK_MODELS|retry/i.test(GROUP_CODE))
  const modelMentions = GROUP_CODE.match(/model:/g) ?? []
  assert.ok(modelMentions.length <= 1, 'only one model may be requested per call')
})

test('the Models API is not consulted per request', () => {
  assert.ok(!/models\.(list|retrieve)/.test(GROUP_CODE), 'model discovery per request is a cost')
  assert.ok(!/models\./.test(MODEL_CODE), 'resolution must be local')
})

test('a provider failure cannot write anything — this route only reads', () => {
  // The reason a 404 here is safe: grouping is a read that proposes groups.
  // Every mutation lives behind a separate endpoint the operator invokes after
  // reviewing them.
  assert.ok(
    !/\.(insert|update|upsert|delete)\(/.test(GROUP_CODE),
    'the grouping route must not mutate anything',
  )
  assert.ok(!/rpc\(/.test(GROUP_CODE), 'nor reach a writer through rpc')
  // …and the error path returns before the enrichment that builds the response.
  const catchAt = GROUP_CODE.indexOf('GROUPING_FAILURE_MESSAGE }, { status: 502 }')
  const enrichAt = GROUP_CODE.indexOf('const enriched')
  assert.ok(catchAt > -1 && enrichAt > catchAt, 'the failure must return before enrichment')
})

test('the sibling writer endpoints are untouched by this fix', () => {
  for (const endpoint of ['approve', 'merge', 'reject']) {
    const src = read('frontend', 'app', 'api', 'admin', 'suggestions', 'bulk', endpoint, 'route.ts')
    assert.ok(!/anthropic-model/.test(src), `${endpoint} must not have been drawn into this change`)
    assert.ok(!src.includes(DEAD_MODEL))
  }
})

/* ------------------------------------------------------------------ *
 * 7. Authorization runs first
 * ------------------------------------------------------------------ */

test('anonymous and non-admin are rejected before input is parsed', () => {
  const guard = GROUP_CODE.indexOf('await verifyAdmin()')
  const parse = GROUP_CODE.indexOf('await req.json()')
  assert.ok(guard > -1 && parse > -1, 'both steps must exist')
  assert.ok(guard < parse, 'a request body must not be parsed for an unauthorized caller')
  assert.ok(/if \(!user\) return false/.test(GROUP_CODE), 'no session is denied')
  assert.ok(/is_admin/.test(GROUP_CODE), 'a non-admin session is denied')
})

test('the Anthropic client is constructed only after authorization', () => {
  // It used to be a module-level constant, so merely importing the route built
  // a client and read the key before any caller was checked.
  const guard  = GROUP_CODE.indexOf('await verifyAdmin()')
  const client = GROUP_CODE.indexOf('new Anthropic(')
  assert.ok(client > guard, 'the provider client must be built inside the handler, after the check')
  const beforeHandler = GROUP_CODE.slice(0, GROUP_CODE.indexOf('export async function POST'))
  assert.ok(
    !/new Anthropic\(/.test(beforeHandler),
    'no module-level client — importing the route must not construct one',
  )
})

test('the route stays classified admin-only', () => {
  const access = read('frontend', 'lib', 'route-access.ts')
  const line = access.split('\n').find((l) => l.includes("'/api/admin/suggestions/bulk/group'"))
  assert.ok(line, 'the endpoint must be classified')
  assert.ok(line.includes('admin_api'), 'it must remain admin_api')
})

test('the admin check itself is unchanged', () => {
  // Preserved exactly: this hotfix has no business altering who may call it.
  assert.ok(/async function verifyAdmin\(\): Promise<boolean>/.test(GROUP_CODE))
  assert.ok(/\{ error: 'Forbidden' \}, \{ status: 403 \}/.test(GROUP_CODE))
})
