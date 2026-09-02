/**
 * The admin match-review state machine.
 *
 * NO IMPORTS, DELIBERATELY — the same discipline `lib/catalogue.ts` follows.
 * The root `tsx --test` harness resolves modules directly and does not read the
 * frontend tsconfig path aliases, so a module that imports `@/...` cannot be
 * tested from plain Node. Keeping this file dependency-free is what makes the
 * state machine assertable as data rather than as rendered markup.
 */

export type MatchReviewStatus = 'reviewed' | 'unresolved' | 'rejected'

export interface ReviewActions {
  approve: boolean
  reject: boolean
  move: boolean
}

/**
 * WHICH ACTIONS A STATUS OFFERS.
 *
 * Previously every card rendered all three buttons regardless of status, so an
 * already-approved listing still offered "Godkend" — an action whose only
 * possible effect was to rewrite the row it had just written. Nielsen #6
 * (recognition rather than recall): what is offered should tell the operator
 * where the listing already stands, without them having to remember.
 *
 * `rejected` keeps its row for totality. The card is removed from the wall as
 * soon as the server confirms, so it is not normally drawn; leaving the entry
 * out would turn an unreachable state into a crash instead of a no-op.
 */
export const ACTIONS_FOR: Readonly<Record<MatchReviewStatus, Readonly<ReviewActions>>> = {
  unresolved: { approve: true, reject: true, move: true },
  // Approving twice is a no-op the operator should not be invited to perform.
  reviewed: { approve: false, reject: true, move: true },
  // Terminal: the card is gone. Nothing further can be decided about it here.
  rejected: { approve: false, reject: false, move: false },
}
