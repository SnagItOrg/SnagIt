/**
 * scripts/lib/hero-image-guard.ts
 *
 * PAN-135. The decision behind `scripts/set-hero-images.ts`, kept pure so it
 * can be tested without a database: given the value each row holds now and
 * the operator's flags, what gets written, and what is said about it.
 *
 * The rule: an operator's curation outranks a hardcoded literal. A row whose
 * image is already set is left alone unless `--force` is passed, and nothing
 * is written at all unless `--apply` is passed. Blank counts as absent, the
 * same as `resolveProductImage()`.
 *
 * The column is not named here on purpose: this module decides whether to
 * write, never which of the two image columns to show.
 */

export type HeroFlags = { apply: boolean; force: boolean }

/** A row as read before any write: its slug and the image it holds now. */
export type HeroRow = { slug: string; current: string | null }

/**
 * Compare-and-set: write `after` only if the row still holds `before`.
 * Resolves true if a row was changed, false if it had moved on since the read.
 */
export type HeroWrite = (slug: string, before: string | null, after: string) => Promise<boolean>

const USAGE = 'usage: set-hero-images.ts [--dry-run] | --apply [--force]'

export function parseHeroFlags(argv: string[]): HeroFlags {
  const known = new Set(['--dry-run', '--apply', '--force'])
  const unknown = argv.filter((a) => !known.has(a))
  if (unknown.length) throw new Error(`unknown argument(s): ${unknown.join(' ')}\n${USAGE}`)
  const apply = argv.includes('--apply')
  if (apply && argv.includes('--dry-run')) throw new Error(`--dry-run and --apply contradict each other\n${USAGE}`)
  return { apply, force: argv.includes('--force') }
}

const isSet = (v: string | null) => v !== null && v.trim() !== ''

/**
 * Plans every target, performs the writes only when `flags.apply`, and
 * returns one report line per slug. `write` is never called on a dry run.
 */
export async function setHeroImages(
  rows: HeroRow[],
  targets: Record<string, string>,
  flags: HeroFlags,
  write: HeroWrite,
): Promise<string[]> {
  const bySlug = new Map(rows.map((r) => [r.slug, r.current]))
  const verb = flags.apply ? 'wrote' : 'would write'
  const lines: string[] = [flags.apply ? 'APPLY — writing to the database.' : 'DRY RUN — nothing is written. Pass --apply to write.']

  for (const [slug, after] of Object.entries(targets)) {
    if (!bySlug.has(slug)) {
      lines.push(`? ${slug}: not found in kg_product`)
      continue
    }
    const before = bySlug.get(slug) ?? null

    if (before === after) {
      lines.push(`= ${slug}: already holds this image, nothing to do`)
      continue
    }
    if (isSet(before) && !flags.force) {
      lines.push(`- ${slug}: kept, already has a curated image (pass --force to overwrite)\n    current: ${before}`)
      continue
    }

    const label = isSet(before) ? 'OVERWRITE' : 'fill'
    if (flags.apply && !(await write(slug, before, after))) {
      lines.push(`! ${slug}: skipped, the row changed after it was read`)
      continue
    }
    lines.push(`+ ${slug}: ${verb} (${label})\n    before: ${before ?? '(null)'}\n    after:  ${after}`)
  }
  return lines
}
