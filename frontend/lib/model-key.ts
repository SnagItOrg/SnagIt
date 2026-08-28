/**
 * Model-number normalisation for the restricted catalogue resolver.
 *
 * Stage 3 WP-4. See docs/stage-3-v1-decision-and-build-plan.md §8.3 and the
 * supported-search contract in docs/klup-launch-catalogue-selection.md §11.
 *
 * WHY A SEPARATE LAYER. `lib/query-normalizer.ts` already lower-cases,
 * ASCII-folds (including ö→oe, ä→ae), strips punctuation and collapses
 * whitespace. What it does NOT do is treat `-`, space and nothing as
 * equivalent inside a model number, so today `juno106`, `juno-106` and
 * `juno 106` are three different strings and the contract requires all three
 * to resolve to the same product.
 *
 * `normalizeQuery` is deliberately NOT modified: `/api/scrape` and the
 * matcher-adjacent paths consume it, and changing the shared normaliser to
 * suit search would change what those paths match. This module composes on
 * top of it instead.
 *
 * WHAT `modelKey` GUARANTEES
 *   TR-808  ≡ TR 808  ≡ TR808   -> "tr808"
 *   Juno-106 ≡ juno 106 ≡ JUNO106 -> "juno106"
 *
 * WHAT IT MUST NOT DO — collapse a generation qualifier away. `Mini`, `Kit`,
 * `FS`, `II`, `Mk2`, `Rev4`, `Boutique`, `Suitcase`, `Stage`, `73`, `88`,
 * `100M` and `727` are significant (selection doc §11), and they survive
 * because they are characters, not separators: `ms20` and `ms20mini` stay
 * distinct keys, as do `rolandsystem100` and `rolandsystem100m`.
 */

import { normalizeQuery } from './query-normalizer'

/**
 * The comparison key: normalised, then with every separator removed.
 *
 * Separator removal is total rather than "inside model numbers only", because
 * deciding where a model number begins is exactly the ambiguity the contract
 * is trying to remove. Removing all separators makes `roland juno 106`,
 * `roland juno-106` and `rolandjuno106` one key, which is the behaviour the
 * contract asks for at the brand+model level too.
 */
export function modelKey(input: string): string {
  return normalizeQuery(input)
    .replace(/[-\s*]/g, '')
}

/** Normalised, separator-preserving form. The value carried in analytics. */
export function queryNorm(input: string): string {
  return normalizeQuery(input)
}

/** Normalised whitespace-delimited tokens. Used for token overlap scoring. */
export function queryTokens(input: string): string[] {
  return normalizeQuery(input)
    .split(' ')
    .filter((token) => token.length > 0)
}

/**
 * True when two strings are the same model identity under the contract's
 * separator rule. Exported so callers never re-implement the comparison.
 */
export function sameModelKey(a: string, b: string): boolean {
  const ka = modelKey(a)
  return ka.length > 0 && ka === modelKey(b)
}
