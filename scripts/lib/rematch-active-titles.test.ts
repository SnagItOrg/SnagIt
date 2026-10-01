/**
 * scripts/lib/rematch-active-titles.test.ts
 *
 * The in-memory ILIKE filter that replaced the re-match scripts' SQL ILIKE
 * scan must select exactly what Postgres' ILIKE selected. Expected results
 * below are Postgres ILIKE semantics; the production counts were checked
 * separately against a full read of active titles.
 *
 * Run: npx tsx --test scripts/lib/rematch-active-titles.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { filterByIlike, ilikeToRegExp, readActiveTitles, type ActiveTitle } from './rematch-active-titles'
import { LINES as GIBSON } from '../pan198-gibson-rematch'
import { LINES as WARM } from '../pan203-warm-audio-rematch'

const like = (title: string, pattern: string) => ilikeToRegExp(pattern).test(title)

test('% matches any run, including none, and the pattern is anchored', () => {
  assert.ok(like('Moog', '%moog%'))
  assert.ok(like('Vintage MOOG Minimoog', '%moog%'))
  assert.ok(like('moog', 'moog'))
  assert.ok(!like('Moog Sub 37', 'moog'), 'no % = whole-string match')
  assert.ok(like('Moog Sub 37', 'moog%'))
  assert.ok(!like('A Moog', 'moog%'))
  assert.ok(like('Warm Audio WA-87', '%warm%audio%'))
  assert.ok(like('warmaudio', '%warm%audio%'))
  assert.ok(!like('Audio warm', '%warm%audio%'), 'order matters')
})

test('_ matches exactly one character', () => {
  assert.ok(like('es-335', 'es_335'))
  assert.ok(like('es 335', 'es_335'))
  assert.ok(!like('es335', 'es_335'))
  assert.ok(!like('es--335', 'es_335'))
})

test('hyphens and spaces are literal', () => {
  assert.ok(like('Gibson ES-335 Dot', '%es-3%'))
  assert.ok(!like('Gibson ES 335 Dot', '%es-3%'))
  assert.ok(like('Gibson ES 335 Dot', '%es 3%'))
  assert.ok(!like('Gibson ES335', '%es 3%'))
  assert.ok(like('Fender P Bass', '%p bass%'))
  assert.ok(!like('Fender P  Bass', '%p bass%'))
})

test('RegExp metacharacters are literal', () => {
  for (const meta of ['.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|', '^', '$', '/']) {
    assert.ok(like(`a${meta}b`, `%a${meta}b%`), `literal ${meta}`)
    assert.ok(!like('axb', `%a${meta}b%`), `${meta} is not a wildcard`)
  }
  assert.ok(like('C++ (rev. 2) [v1.0]', '%(rev. 2) [v1.0]%'))
})

test('backslash escapes a wildcard to a literal, as Postgres does', () => {
  assert.ok(like('100% tube', '%100\\% tube%'))
  assert.ok(!like('100x tube', '%100\\% tube%'))
  assert.ok(like('a_b', 'a\\_b'))
  assert.ok(!like('axb', 'a\\_b'))
  assert.ok(like('a\\b', 'a\\\\b'))
})

test('case-insensitive, including non-ASCII, and wildcards cross newlines', () => {
  assert.ok(like('MOOG', '%moog%'))
  assert.ok(like('mOoG', '%MOOG%'))
  assert.ok(like('ÆBLE Moog', '%æble%'))
  assert.ok(like('Moog\nMinimoog', 'moog%minimoog'))
})

test('filterByIlike is an OR over patterns, keeps input order, and skips null titles', () => {
  const rows: ActiveTitle[] = [
    { id: '1', title: 'Gibson Les Paul Standard' },
    { id: '2', title: null },
    { id: '3', title: 'Gibson LesPaul Junior' },
    { id: '4', title: 'Gibson SG Special' },
    { id: '5', title: 'The Paul Firebrand' },
  ]
  assert.deepEqual(filterByIlike(rows, ['%les paul%', '%lespaul%', '%the paul%']).map((r) => r.id), ['1', '3', '5'])
  assert.deepEqual(filterByIlike(rows, []), [])
})

test('the in-memory filter equals SQL ILIKE on the scripts\' real LINES', () => {
  const rows: ActiveTitle[] = [
    { id: 'a', title: 'Gibson ES-335 Figured 2019' },
    { id: 'b', title: 'Gibson ES335 Dot' },
    { id: 'c', title: 'Epiphone ES-Les Paul' },
    { id: 'd', title: 'Gibson J-45 Standard' },
    { id: 'e', title: 'Gibson J45 Studio' },
    { id: 'f', title: 'Gibson Hummingbird' },
    { id: 'g', title: 'Boss DS-1 Distortion' },
    { id: 'h', title: 'Warm Audio WA-47jr' },
    { id: 'i', title: 'WARMAUDIO WA76' },
    { id: 'j', title: 'Audio Warm' },
  ]
  const ids = (line: string) => filterByIlike(rows, GIBSON.find((l) => l.line === line)!.ilike).map((r) => r.id)
  // Postgres: title ILIKE ANY ('%es-3%','%es 3%','%es3%','%es-les%','%es les%')
  assert.deepEqual(ids('es'), ['a', 'b', 'c'])
  // Postgres: '%j-45%' / '%j45%' / '%hummingbird%' among the acoustic patterns
  assert.deepEqual(ids('acoustic'), ['d', 'e', 'f'])
  assert.deepEqual(filterByIlike(rows, WARM[0].ilike).map((r) => r.id), ['h', 'i'])
})

test('readActiveTitles pages by keyset on id, never OFFSET, with no ILIKE in SQL', async () => {
  const all = Array.from({ length: 2345 }, (_, i) => ({ id: String(i).padStart(5, '0'), title: `t${i}` }))
  const calls: string[] = []
  const fakeDb = {
    from(table: string) {
      const st: { gt?: string; limit?: number; calls: string[] } = { calls: [`from:${table}`] }
      const q = {
        select(cols: string) { st.calls.push(`select:${cols}`); return q },
        eq(col: string, v: unknown) { st.calls.push(`eq:${col}=${v}`); return q },
        order(col: string) { st.calls.push(`order:${col}`); return q },
        limit(n: number) { st.limit = n; st.calls.push(`limit:${n}`); return q },
        gt(col: string, v: string) { st.gt = v; st.calls.push(`gt:${col}`); return q },
        range() { throw new Error('OFFSET pagination used') },
        or() { throw new Error('SQL filter on title used') },
        ilike() { throw new Error('SQL ILIKE used') },
        then(resolve: (r: unknown) => void) {
          calls.push(st.calls.join(' '))
          const data = all.filter((r) => st.gt === undefined || r.id > st.gt).slice(0, st.limit)
          resolve({ data, error: null })
        },
      }
      return q
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await readActiveTitles(fakeDb as any)
  assert.deepEqual(rows, all)
  assert.equal(calls.length, 3)
  assert.equal(calls[0], 'from:listings select:id, title eq:is_active=true order:id limit:1000')
  assert.ok(calls[1].endsWith('gt:id'))
})
