/**
 * PAN-190 — `browse_product_projection` and `market_price_observations_trusted`
 * stay SECURITY INVOKER.
 *
 * Migration 062 sets `security_invoker = on` on both views. PostgreSQL's
 * `CREATE OR REPLACE VIEW` REPLACES a view's reloptions with whatever its WITH
 * clause lists, so the next migration that restates either body without
 * `WITH (security_invoker = on)` silently turns the view back into a definer
 * view — the state the Supabase advisor reports as ERROR, and for the trusted
 * view an anonymous write path past RLS. Older files (036, 058, 061, and the
 * 058/061 rollbacks) are the likeliest source to copy, and none carries the
 * option. These tests make that regression fail here rather than in the
 * advisor. Behaviour is rehearsed in `scripts/verify-migrations-isolated.sh`
 * section 17.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(__dirname, '..', 'migrations')
const VIEWS = ['browse_product_projection', 'market_price_observations_trusted']
const FIX = '062'

/** SQL with `--` comment lines removed, so prose cannot satisfy an assertion. */
function code(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
}

const files = readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()

test('062 makes both views security_invoker and narrows their grants', () => {
  const file = files.find((f) => f.startsWith(`${FIX}_`) && !f.includes('rollback'))
  assert.ok(file, `migration ${FIX} not found`)
  const sql = code(readFileSync(join(MIGRATIONS, file), 'utf8'))
  for (const v of VIEWS) {
    assert.match(sql, new RegExp(`ALTER VIEW public\\.${v} SET \\(security_invoker = on\\)`), `${file}: ${v} is not made security_invoker`)
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${v} FROM anon, authenticated`), `${file}: ${v} keeps anon/authenticated privileges`)
  }
  // The trusted view keeps only migration 039's public read; the projection keeps nothing.
  assert.match(sql, /GRANT SELECT ON public\.market_price_observations_trusted TO anon, authenticated;/)
  assert.doesNotMatch(sql, /GRANT [A-Z, ]+ ON public\.browse_product_projection TO anon/)
})

test('no migration after 062 restates either view without security_invoker', () => {
  for (const f of files.filter((f) => f.slice(0, 3) > FIX)) {
    const sql = code(readFileSync(join(MIGRATIONS, f), 'utf8'))
    for (const v of VIEWS) {
      const restated = new RegExp(`CREATE (OR REPLACE )?VIEW (public\\.)?${v}\\b([^;]*?)\\bAS\\b`, 'i').exec(sql)
      if (!restated) continue
      assert.match(restated[3], /security_invoker\s*=\s*(on|true)/i,
        `${f}: restates ${v} without WITH (security_invoker = on); CREATE OR REPLACE VIEW would reset it to SECURITY DEFINER`)
    }
  }
})
