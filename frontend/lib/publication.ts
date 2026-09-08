/**
 * The publication contract: one operator action, one atomic row update.
 *
 * PAN-22. Admin Products previously exposed `support_state` and
 * `browse_visibility` as two independent cycles, so publishing meant two
 * client-orchestrated PATCHes and a partial failure could leave a row
 * `supported` + `qa_only`. The operator also had to know that `public` alone
 * does nothing: 35 rows carry it while 14 have a page (PAN-23 audit).
 *
 * WHY THIS MODULE HAS NO IMPORTS. Like `lib/catalogue.ts`, the rules here are
 * the ones a route must not restate, so they have to be exercisable from a
 * plain Node test with no Next.js or Supabase in scope.
 *
 * `status` is deliberately absent from every transition. It is a separate
 * lifecycle axis (ratified D-rule 4), and inactivating a monitored product can
 * stop a whole source's scraper.
 */

export type PublicationAction = 'public' | 'qa' | 'hidden'

/** The fields each action writes. Nothing else is ever touched. */
export const PUBLICATION_TRANSITION: Record<PublicationAction, Record<string, string>> = {
  // Public and QA both establish support: an unsupported product answers 404
  // whatever its visibility says.
  public: { support_state: 'supported', browse_visibility: 'public' },
  qa:     { support_state: 'supported', browse_visibility: 'qa_only' },
  // Hidden changes visibility ONLY. Support, existing matches and monitoring
  // are preserved (ratified D-rule 3) — unpublishing must not quietly destroy
  // the data behind the product.
  hidden: { browse_visibility: 'hidden' },
}

export function isPublicationAction(value: unknown): value is PublicationAction {
  return value === 'public' || value === 'qa' || value === 'hidden'
}

/** The row facts a precondition needs. `taxonomy_state` is derived by the view. */
export interface PublicationRow {
  status?: string | null
  taxonomy_state?: string | null
  browse_domain?: string | null
}

export interface PublicationRefusal {
  error: string
  message: string
  status: number
}

/**
 * Why this action must be refused, or null when it may proceed.
 *
 * Called BEFORE the write, so a refusal leaves no partial state. Public is the
 * only action with a taxonomy precondition: without a classifying music
 * subcategory the product would get a page it can never be browsed from, which
 * is the `page_only` state the ratified contract rejects as an outcome of the
 * normal Public action.
 *
 * Fail-closed: an unreadable row refuses rather than publishes.
 */
export function publicationRefusal(
  action: PublicationAction,
  row: PublicationRow | null | undefined,
): PublicationRefusal | null {
  // Hidden only removes exposure, so it stays available on any row.
  if (action === 'hidden') return null

  if (!row || row.status !== 'active') {
    return {
      error: 'inactive_product_cannot_be_supported',
      message: 'Identiteten er ikke aktiv. Genaktivér produktet, før det kan publiceres.',
      status: 409,
    }
  }

  if (action === 'public' && (row.taxonomy_state !== 'classified' || row.browse_domain !== 'music')) {
    return {
      error: 'taxonomy_required_for_public',
      message: 'Vælg en underkategori der hører til en music-rod, før produktet kan gøres offentligt.',
      status: 409,
    }
  }

  return null
}

/* ------------------------------------------------------------------ *
 * Which state a row is AT — the read side of the same contract
 * ------------------------------------------------------------------ */

/**
 * The one operator-facing state. Six values, and a row is at exactly one.
 *
 * This lives beside the transition table because it is the same vocabulary
 * read backwards, and keeping it apart is what let the admin list contradict
 * itself: it derived the active button from one set of axes and the status
 * badge from `effectiveExposure()`, so a QA row showed "QA" as the chosen
 * action and "Skjult" as its state at the same time. `effectiveExposure()`
 * answers a PUBLIC question — can a visitor reach this? — and folds `qa_only`
 * and `hidden` into one `hidden` value, which is correct for that question and
 * wrong as an operator status.
 *
 * `blocked_*` states have NO active action on purpose: they are not end states
 * the operator chose, they are the gate to fix next. In particular a row that
 * is supported + public but unclassified is `blocked_taxonomy`, never Public —
 * it does not meet the ratified Public contract (D3) and must not be shown as
 * a completed publication.
 */
export type PublicationState =
  | 'live'
  | 'qa'
  | 'hidden'
  | 'blocked_taxonomy'
  | 'blocked_unsupported'
  | 'blocked_inactive'

/** The facts the admin list already receives from the server. */
export interface PublicationStateRow {
  /** `effectiveExposure()`, computed server-side and passed through. */
  exposure?: string | null
  support_state?: string | null
  browse_visibility?: string | null
}

/** The action a row is at, or null when it is at none. */
export const PUBLICATION_STATE_ACTION: Record<PublicationState, PublicationAction | null> = {
  live:                'public',
  qa:                  'qa',
  hidden:              'hidden',
  blocked_taxonomy:    null,
  blocked_unsupported: null,
  blocked_inactive:    null,
}

/**
 * Order matters, and it is not the same order as `effectiveExposure()`.
 *
 * An inactive identity outranks everything: nothing renders, so no publication
 * state is meaningful. An explicit `hidden` comes next, because the operator
 * chose it — reporting a hidden row as "unsupported" would replace their
 * decision with a gate they did not ask about. QA is recognised BEFORE the
 * public states, because it is the one state `effectiveExposure()` cannot
 * express.
 *
 * Fail-closed: an unreadable row is blocked, never live.
 */
export function publicationState(row: PublicationStateRow | null | undefined): PublicationState {
  if (!row || row.exposure === 'inactive') return 'blocked_inactive'
  if (row.browse_visibility === 'hidden') return 'hidden'
  // Only a SUPPORTED qa_only row is QA. The 3.637 known+qa_only rows measured
  // in the PAN-23 audit are raw KG and must never be offered as QA.
  if (row.support_state === 'supported' && row.browse_visibility === 'qa_only') return 'qa'
  if (row.exposure === 'live_in_browse') return 'live'
  if (row.exposure === 'page_only') return 'blocked_taxonomy'
  return 'blocked_unsupported'
}
