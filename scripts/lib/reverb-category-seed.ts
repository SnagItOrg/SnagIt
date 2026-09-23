/**
 * The seeded shape of a `kg_category` row, and the one column a re-run may not
 * touch.
 *
 * `name_da` is hand-maintained Danish — nothing derives it (scripts/CLAUDE.md,
 * "`kg_category` labels are hand-maintained"). The seeder may establish it when
 * it creates a row, and must never overwrite it afterwards.
 *
 * Supabase's `.upsert()` cannot express "update these columns but not that
 * one": PostgREST builds the `ON CONFLICT DO UPDATE SET` list from the keys
 * present in the payload, and the JS client exposes no column list. That
 * limitation is also the lever — a column absent from the payload is absent
 * from the SET list. So the seeder writes each level with two statements:
 *
 *   1. the full row, `ignoreDuplicates: true`   -> ON CONFLICT (slug) DO NOTHING
 *   2. `refreshPayload(rows)`, which omits
 *      `name_da`, `ignoreDuplicates: false`     -> ON CONFLICT (slug) DO UPDATE
 *                                                  SET <every seeded column
 *                                                  except name_da>
 *
 * Statement 1 establishes `name_da` only for a slug that did not exist.
 * Statement 2 refreshes the seeded columns and cannot reach `name_da` at all,
 * because the value is never sent.
 *
 * Neither statement reads a row before writing it, so there is no
 * read-modify-write window in which a concurrent hand-edit to `name_da` could
 * be read stale and written back. Carrying the existing `name_da` through a
 * single upsert would be one statement fewer and would lose exactly that race.
 */
export interface SeededCategory {
  slug: string
  name_en: string
  name_da: string
  domain: 'music'
  parent_id: string | null
}

/** A seeded row minus the hand-maintained column. */
export type CategoryRefresh = Omit<SeededCategory, 'name_da'>

/**
 * The payload for the conflict leg: every seeded column except `name_da`.
 *
 * Rebuilt field by field rather than by deleting a key, so that adding a
 * column to `SeededCategory` fails to compile here rather than silently
 * widening what a re-run overwrites.
 */
export function refreshPayload(rows: SeededCategory[]): CategoryRefresh[] {
  return rows.map((row) => ({
    slug: row.slug,
    name_en: row.name_en,
    domain: row.domain,
    parent_id: row.parent_id,
  }))
}
