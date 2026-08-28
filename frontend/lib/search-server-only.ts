/**
 * The resolver's server-only guard, as a side effect.
 *
 * Stage 3 WP-4a.
 *
 * WHY THIS IS A SEPARATE MODULE AND NOT THREE LINES IN THE RESOLVER.
 * ES modules evaluate every static import BEFORE the importing module's own
 * body, so a guard written at the top of `lib/search-resolver.ts` runs AFTER
 * `lib/search-index.ts` has already been evaluated. In a browser that means
 * the index's guard throws first and the resolver's own guard is unreachable
 * code that reads like protection while providing none. Placing it in a module
 * imported FIRST is the only way to make the resolver refuse on its own terms,
 * before it drags the private artefact into evaluation.
 *
 * `lib/search-index.ts` keeps its own inline guard: it is the module that
 * actually holds the 34 unpublished identities, and it must refuse whether or
 * not anything else does.
 *
 * `globalThis`, not a bare `window`: the root tsconfig compiles this file with
 * `lib: ["ES2020"]` and no DOM, so referencing `window` directly would add an
 * eighth error to a baseline that must stay at seven.
 */

if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
  throw new Error(
    'lib/search-resolver.ts is server-only: it resolves against unpublished catalogue identities. '
    + 'Client code must import lib/search-contract.ts and call /api/search/resolve.',
  )
}

export {}
