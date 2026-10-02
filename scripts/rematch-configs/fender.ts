/**
 * scripts/rematch-configs/fender.ts — Fender (PAN-195): the brand's config for scripts/rematch-brand.ts.
 * The seven lines are the ones scripts/pan195-fender-rematch.ts carried, verbatim (PAN-229): each guards
 * a family LABEL row (none for `mustang-short-scale-bass`), and the promoted rows are the families'
 * children, read from the family registry as that script did. Squier listings are kept in scope on
 * purpose: `decideMatch` rejects them against Fender rows, which is the auditable outcome.
 *
 * The runner also skips human-decided and AI-confirmed matches (scripts/lib/rematch-verdicts.ts),
 * the standing rule the Fender script predated.
 */

import { getFamily } from '../../frontend/lib/families'
import type { RematchConfig } from '../rematch-brand'

const LINES = [
  { family: 'fender-stratocaster', label: 'fender-stratocaster', names: /stratocaster|\bstrat\b/i, ilike: ['%strat%'] },
  { family: 'fender-telecaster', label: 'fender-telecaster', names: /telecaster|\btele\b/i, ilike: ['%tele%'] },
  { family: 'fender-jazzmaster', label: 'fender-jazzmaster', names: /jazz ?master/i, ilike: ['%jazzmaster%', '%jazz master%'] },
  { family: 'fender-jaguar', label: 'fender-jaguar', names: /jaguar/i, ilike: ['%jaguar%'] },
  { family: 'fender-precision-bass', label: 'fender-precision-bass', names: /precision|\bp-?bass\b/i, ilike: ['%precision%', '%p-bass%', '%pbass%', '%p bass%'] },
  { family: 'fender-jazz-bass', label: 'fender-jazz-bass', names: /jazz ?bass|\bj-?bass\b/i, ilike: ['%jazzbass%', '%jazz bass%', '%j-bass%', '%jbass%', '%j bass%'] },
  { family: 'mustang-short-scale-bass', label: null, names: /mustang/i, ilike: ['%mustang%'] },
] as const

const config: RematchConfig = {
  ticket: 'PAN-195',
  pan: 'pan195',
  brand: 'Fender',
  labels: LINES.map((l) => l.label).filter((s): s is Exclude<typeof s, null> => s !== null),
  promoted: Array.from(new Set(LINES.flatMap((l) => getFamily(l.family)?.children ?? []))),
  supportedToday: [],
  lines: LINES.map(({ family, names, ilike }) => ({ line: family, names, ilike: [...ilike] })),
}

export default config
