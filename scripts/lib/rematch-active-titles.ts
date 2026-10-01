/**
 * scripts/lib/rematch-active-titles.ts
 *
 * The unmatched-cohort scan shared by the brand re-match scripts
 * (scripts/pan195-…-rematch.ts through pan204-…).
 *
 * WHY NOT ILIKE IN SQL. The scripts used to ask PostgREST for
 * `is_active = true AND (title ILIKE p1 OR …) ORDER BY id`, OFFSET-paged.
 * `listings.title` has no index, so Postgres may fill each page by walking the
 * primary key in id order with random heap fetches. On a cold cache that ran
 * past the `authenticator` role's 8 s statement_timeout (PAN-199 dry run).
 * The plan, and so the failure, depended on statistics and cache state.
 *
 * Here every request is a short primary-key range: `is_active = true AND
 * id > last ORDER BY id LIMIT 1000` (keyset, no OFFSET, no ILIKE). Its cost
 * does not depend on the plan. Titles are read once per run and the ILIKE
 * patterns are applied in memory with the same semantics.
 */

import type { SupabaseClient } from '../../frontend/node_modules/@supabase/supabase-js'

export type ActiveTitle = { id: string; title: string | null }

const PAGE = 1000

/** Every active listing's id and title, in id order, keyset-paged on the primary key. */
export async function readActiveTitles(db: SupabaseClient): Promise<ActiveTitle[]> {
  const rows: ActiveTitle[] = []
  let last: string | null = null
  for (;;) {
    let q = db.from('listings').select('id, title').eq('is_active', true).order('id').limit(PAGE)
    if (last !== null) q = q.gt('id', last)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const page = (data ?? []) as ActiveTitle[]
    rows.push(...page)
    if (page.length < PAGE) return rows
    last = page[page.length - 1].id
  }
}

/**
 * A Postgres ILIKE pattern as an equivalent RegExp: anchored at both ends,
 * `%` = any run of characters, `_` = exactly one character, `\x` = a literal x
 * (Postgres' default escape), everything else literal and case-insensitive.
 * The `s` flag lets the wildcards cross newlines, as they do in SQL.
 */
export function ilikeToRegExp(pattern: string): RegExp {
  let src = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\' && i + 1 < pattern.length) src += escapeChar(pattern[++i])
    else if (c === '%') src += '.*'
    else if (c === '_') src += '.'
    else src += escapeChar(c)
  }
  return new RegExp(`^${src}$`, 'isu')
}

// Only the RegExp syntax characters: in `u` mode escaping anything else is a SyntaxError.
const escapeChar = (c: string): string => (/[\\^$.*+?()[\]{}|/]/.test(c) ? `\\${c}` : c)

/**
 * The rows `title ILIKE p1 OR title ILIKE p2 …` selects, in their input order.
 * A null title matches nothing, as in SQL.
 */
export function filterByIlike(rows: readonly ActiveTitle[], patterns: readonly string[]): Array<{ id: string; title: string }> {
  const res = patterns.map(ilikeToRegExp)
  return rows.filter((r): r is { id: string; title: string } =>
    r.title !== null && res.some((re) => re.test(r.title as string)))
}
