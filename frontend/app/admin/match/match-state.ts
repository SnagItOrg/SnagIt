/**
 * The /admin/match state machine.
 *
 * Extracted from the page because every defect this slice fixes is a *state*
 * defect, not a rendering one, and none of them is visible in a screenshot:
 *
 *   - selecting a product left the previous product's candidates on screen,
 *     so an operator could approve a Juno-106 listing onto a Juno-60;
 *   - a slow response for the previous product could land after a fast one for
 *     the new product and overwrite it;
 *   - approve/reject ticks survived a product change, so the next save could
 *     carry decisions the operator made about a different product.
 *
 * All three are reachable only through an ordering of events. A reducer makes
 * that ordering something a test can produce on demand: dispatch the actions in
 * the hostile order and assert the state that comes out.
 *
 * Deliberately import-free — like `lib/catalogue.ts` and
 * `lib/admin-match-sources.ts` — so the root `tsx --test` harness can exercise
 * it with no React, no Next.js, no DOM and no build step. The source registry is
 * passed in rather than imported for exactly that reason.
 */

import type { Disposition } from './dispositions'
import { IS_VALID_FOR, PERSISTS, requiresTargetProduct } from './dispositions'

/** The only thing the reducer needs from a candidate: a stable identity. */
export type CandidateRef = { id: string }

export type MatchProduct = {
  id:             string
  canonical_name: string
  slug:           string
  kg_brand:       { name: string } | null
}

/**
  * One operator decision held locally, before any save.
  *
  * This used to be the string 'approved' | 'rejected'. A boolean could not carry
  * *which node* the operator meant or *what they observed*, so a Model 45 and a
  * Model 30 were the same decision. The record keeps both, and the disposition
  * is what maps onto `is_valid`.
  */
export type DecisionRecord = {
  disposition: Disposition
  /** Existing kg_product id — only ever set for a move. */
  targetProductId: string | null
}

/** Kept as the undo unit: what a listing looked like before the last change. */
export type UndoEntry = {
  listingId: string
  previous: DecisionRecord | null
  previousSelectedId: string | null
}

export type RequestStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * The identity of the in-flight candidate sweep.
 *
 * `id` is monotonic and is the sole arbiter of freshness: a response carrying
 * anything other than the current id is from a sweep the operator has already
 * moved past. `productId` is checked too, so a response cannot be accepted
 * merely because the counters happen to line up.
 */
export type CandidateRequest = {
  id:        number
  productId: string | null
  status:    RequestStatus
}

export type MatchState<C extends CandidateRef = CandidateRef> = {
  searchInput:      string
  searchResults:    MatchProduct[]
  searching:        boolean
  selectedProduct:  MatchProduct | null
  candidateRequest: CandidateRequest
  candidates:       C[]
  localDecisions:   Record<string, DecisionRecord>
  /**
   * The candidate in the detail column. Auto-advance moves this, never DOM
   * focus, so a keyboard operator is not thrown out of the control they just
   * used.
   */
  selectedCandidateId: string | null
  /**
   * Session-long undo. Holds the decision AND the selection that preceded it,
   * because restoring the verdict without restoring where the operator was
   * leaves them looking at the wrong row.
   */
  undoStack:        UndoEntry[]
  sourceSelection:  string[]
  /**
   * The sources the candidates on screen were actually fetched with.
   *
   * Without this, toggling a chip changes the next request but nothing the
   * operator can see — the list stays as it was and the filter looks broken.
   * That is the same "indistinguishable from nothing left to match" ambiguity
   * the DBA identifier bug produced, so the mismatch is made visible instead.
   */
  appliedSources:   string[]
  error:            string | null
  saving:           boolean
}

export type MatchAction<C extends CandidateRef = CandidateRef> =
  | { type: 'search_input_changed';    value: string }
  | { type: 'search_started' }
  | { type: 'search_results_received'; products: MatchProduct[] }
  | { type: 'search_failed';           message: string }
  | { type: 'search_dismissed' }
  | { type: 'product_selected';        product: MatchProduct }
  | { type: 'product_cleared' }
  | { type: 'candidates_reload_requested' }
  | { type: 'candidates_received';     requestId: number; productId: string; candidates: C[] }
  | { type: 'candidates_failed';       requestId: number; productId: string; message: string }
  | { type: 'candidate_selected';      listingId: string }
  | {
      type: 'disposition_set'
      listingId: string
      disposition: Disposition
      targetProductId?: string | null
    }
  | { type: 'undo' }
  | { type: 'source_toggled';          key: string }
  | { type: 'save_started' }
  | { type: 'save_succeeded';          savedIds: string[] }
  | { type: 'save_failed';             message: string }

export function createInitialState<C extends CandidateRef = CandidateRef>(
  sourceKeys: readonly string[],
): MatchState<C> {
  return {
    searchInput:      '',
    searchResults:    [],
    searching:        false,
    selectedProduct:  null,
    candidateRequest: { id: 0, productId: null, status: 'idle' },
    candidates:          [],
    localDecisions:      {},
    selectedCandidateId: null,
    undoStack:           [],
    sourceSelection:  [...sourceKeys],
    appliedSources:   [],
    error:            null,
    saving:           false,
  }
}

/**
 * Is this response still the one we are waiting for?
 *
 * Both halves matter. The counter alone would accept a response for the right
 * sweep number but the wrong product after a rapid A -> B -> A selection; the
 * product alone would accept an older sweep for the same product and undo a
 * reload. A response has to agree on both to be allowed to write.
 */
function isCurrentResponse(
  state: MatchState<CandidateRef>,
  requestId: number,
  productId: string,
): boolean {
  return (
    requestId === state.candidateRequest.id &&
    state.selectedProduct != null &&
    productId === state.selectedProduct.id
  )
}

/** Drop any decision whose listing is not in the list actually on screen. */
function pruneDecisions(
  decisions: Record<string, DecisionRecord>,
  candidates: readonly CandidateRef[],
): Record<string, DecisionRecord> {
  const present = new Set(candidates.map((c) => c.id))
  const next: Record<string, DecisionRecord> = {}
  for (const [id, record] of Object.entries(decisions)) {
    if (present.has(id)) next[id] = record
  }
  return next
}

/**
 * The next candidate the operator has not yet ruled on.
 *
 * Searches forward from the decided row and then wraps, so finishing a decision
 * in the middle of the list continues downward rather than jumping to the top.
 * Returns null when every candidate carries a decision — the caller keeps the
 * current selection rather than emptying the detail column.
 */
function nextUndecidedId(
  candidates: readonly CandidateRef[],
  decisions: Record<string, DecisionRecord>,
  fromId: string,
): string | null {
  const start = candidates.findIndex((c) => c.id === fromId)
  if (start < 0) return null
  for (let step = 1; step <= candidates.length; step++) {
    const c = candidates[(start + step) % candidates.length]
    if (!decisions[c.id]) return c.id
  }
  return null
}

export function matchReducer<C extends CandidateRef>(
  state: MatchState<C>,
  action: MatchAction<C>,
): MatchState<C> {
  switch (action.type) {
    case 'search_input_changed':
      // Typing does not disturb the selection: an operator who edits the box and
      // then thinks better of it still has the product they were working on.
      return { ...state, searchInput: action.value, searchResults: [] }

    case 'search_started':
      return { ...state, searching: true }

    case 'search_results_received':
      return { ...state, searching: false, searchResults: action.products }

    case 'search_failed':
      return { ...state, searching: false, searchResults: [], error: action.message }

    case 'search_dismissed':
      return { ...state, searchResults: [] }

    case 'product_selected': {
      // Re-selecting the product already loaded is a no-op on the request
      // counter. This is what stops the URL restore and the click that caused
      // it from firing two sweeps for the same product.
      if (state.selectedProduct?.id === action.product.id) {
        return { ...state, searchResults: [], searchInput: action.product.canonical_name }
      }
      return {
        ...state,
        searchInput:     action.product.canonical_name,
        searchResults:   [],
        selectedProduct: action.product,
        // Cleared in the SAME transition that sets the product. There is no
        // intermediate state in which the new product is selected and the old
        // product's candidates or ticks are still readable.
        candidates:      [],
        localDecisions:  {},
        // The undo stack and the detail selection belong to the product that is
        // going away. Carrying either across would let an undo restore a
        // decision about a listing the operator can no longer see.
        selectedCandidateId: null,
        undoStack:           [],
        error:           null,
        candidateRequest: {
          id:        state.candidateRequest.id + 1,
          productId: action.product.id,
          status:    'loading',
        },
        // sourceSelection is deliberately untouched: it is an operator
        // preference about marketplaces, not a fact about the product.
      }
    }

    case 'product_cleared':
      return {
        ...state,
        selectedProduct:  null,
        candidates:       [],
        localDecisions:   {},
        selectedCandidateId: null,
        undoStack:           [],
        error:            null,
        searchResults:    [],
        candidateRequest: { id: state.candidateRequest.id + 1, productId: null, status: 'idle' },
      }

    case 'candidates_reload_requested': {
      if (!state.selectedProduct) return state
      return {
        ...state,
        candidates: [],
        error:      null,
        // Decisions survive a reload of the SAME product and are pruned against
        // whatever comes back — re-fetching is not a reason to discard the
        // operator's unsaved work.
        candidateRequest: {
          id:        state.candidateRequest.id + 1,
          productId: state.selectedProduct.id,
          status:    'loading',
        },
      }
    }

    case 'candidates_received': {
      if (!isCurrentResponse(state, action.requestId, action.productId)) return state
      const localDecisions = pruneDecisions(state.localDecisions, action.candidates)
      // Keep the operator where they were if that row survived the refetch;
      // otherwise fall to the first candidate rather than an empty detail pane.
      const stillPresent = action.candidates.some((c) => c.id === state.selectedCandidateId)
      return {
        ...state,
        candidates:       action.candidates,
        localDecisions,
        selectedCandidateId: stillPresent
          ? state.selectedCandidateId
          : (action.candidates[0]?.id ?? null),
        appliedSources:   [...state.sourceSelection],
        error:            null,
        candidateRequest: { ...state.candidateRequest, status: 'ready' },
      }
    }

    case 'candidates_failed': {
      if (!isCurrentResponse(state, action.requestId, action.productId)) return state
      return {
        ...state,
        candidates:       [],
        error:            action.message,
        candidateRequest: { ...state.candidateRequest, status: 'error' },
      }
    }

    case 'candidate_selected': {
      if (!state.candidates.some((c) => c.id === action.listingId)) return state
      return { ...state, selectedCandidateId: action.listingId }
    }

    case 'disposition_set': {
      // A disposition only means something against a candidate on screen.
      if (!state.candidates.some((c) => c.id === action.listingId)) return state

      // A move without a target would silently degrade into an approval on the
      // reviewed product — the opposite of what the operator asked for. A move
      // ONTO the reviewed product is the same mistake wearing a target.
      if (requiresTargetProduct(action.disposition)) {
        if (!action.targetProductId) return state
        if (action.targetProductId === state.selectedProduct?.id) return state
      }

      const previous = state.localDecisions[action.listingId] ?? null
      const next = { ...state.localDecisions }

      // Re-applying the disposition already on a row takes it back, so the
      // primary buttons stay their own undo for the common single-click mistake.
      const repeats =
        previous != null &&
        previous.disposition === action.disposition &&
        previous.targetProductId === (action.targetProductId ?? null)

      if (repeats) {
        delete next[action.listingId]
        return {
          ...state,
          localDecisions: next,
          undoStack: [
            ...state.undoStack,
            { listingId: action.listingId, previous, previousSelectedId: state.selectedCandidateId },
          ],
        }
      }

      next[action.listingId] = {
        disposition: action.disposition,
        targetProductId: action.targetProductId ?? null,
      }

      // Auto-advance is computed against the decisions AFTER this one lands, so
      // the row just decided is never offered again as the next undecided one.
      const advanceTo = nextUndecidedId(state.candidates, next, action.listingId)

      return {
        ...state,
        localDecisions: next,
        selectedCandidateId: advanceTo ?? state.selectedCandidateId,
        undoStack: [
          ...state.undoStack,
          { listingId: action.listingId, previous, previousSelectedId: state.selectedCandidateId },
        ],
      }
    }

    case 'undo': {
      const entry = state.undoStack[state.undoStack.length - 1]
      if (!entry) return state
      const next = { ...state.localDecisions }
      if (entry.previous) next[entry.listingId] = entry.previous
      else delete next[entry.listingId]
      return {
        ...state,
        localDecisions: next,
        // Restoring the verdict without the selection would leave the operator
        // reading a different row than the one that just changed.
        selectedCandidateId: entry.previousSelectedId ?? state.selectedCandidateId,
        undoStack: state.undoStack.slice(0, -1),
      }
    }

    case 'source_toggled': {
      const has = state.sourceSelection.includes(action.key)
      // The last remaining source cannot be switched off — an empty selection
      // returns an empty list that reads as "nothing left to match".
      if (has && state.sourceSelection.length === 1) return state
      const sourceSelection = has
        ? state.sourceSelection.filter((k) => k !== action.key)
        : [...state.sourceSelection, action.key]
      return { ...state, sourceSelection }
    }

    case 'save_started':
      return { ...state, saving: true, error: null }

    case 'save_succeeded': {
      const saved = new Set(action.savedIds)
      const candidates = state.candidates.filter((c) => !saved.has(c.id))
      const keptSelection = candidates.some((c) => c.id === state.selectedCandidateId)
      return {
        ...state,
        saving:         false,
        candidates,
        localDecisions: pruneDecisions(state.localDecisions, candidates),
        selectedCandidateId: keptSelection
          ? state.selectedCandidateId
          : (candidates[0]?.id ?? null),
        // Undo cannot reach across a successful save: those rows are written.
        undoStack: [],
      }
    }

    case 'save_failed':
      return { ...state, saving: false, error: action.message }

    default:
      return state
  }
}

/* ── selectors ───────────────────────────────────────────────────────────── */

export function isLoadingCandidates(state: MatchState<CandidateRef>): boolean {
  return state.candidateRequest.status === 'loading'
}

/**
 * True while the selection is moving — the request belongs to a product that is
 * not (yet) the selected one, or a sweep is in flight. Save is disabled here.
 */
export function isSelectionSettling(state: MatchState<CandidateRef>): boolean {
  return (
    state.candidateRequest.status !== 'ready' ||
    state.candidateRequest.productId !== (state.selectedProduct?.id ?? null)
  )
}

/**
 * Does the chip selection differ from what produced the visible list?
 *
 * A source toggle deliberately does NOT re-sweep on its own: every sweep costs
 * a Haiku call, and an operator adjusting five chips would spend five of them.
 * The reload action stays the trigger — this selector is what stops that choice
 * from looking like a dead control.
 */
export function sourcesDiffer(state: MatchState<CandidateRef>): boolean {
  if (state.candidateRequest.status !== 'ready') return false
  const applied = [...state.appliedSources].sort().join(',')
  const selected = [...state.sourceSelection].sort().join(',')
  return applied !== selected
}

export function decisionCounts(state: MatchState<CandidateRef>): {
  approved: number
  rejected: number
  /** Passed over — carries a disposition but writes nothing. */
  skipped: number
  /** Decisions that will reach the database. */
  total: number
  /** Candidates carrying no disposition at all. */
  pending: number
} {
  let approved = 0
  let rejected = 0
  let skipped = 0
  let pending = 0
  for (const c of state.candidates) {
    const record = state.localDecisions[c.id]
    if (!record) { pending++; continue }
    const eligibility = IS_VALID_FOR[record.disposition]
    if (!PERSISTS[record.disposition]) skipped++
    else if (eligibility === true) approved++
    else if (eligibility === false) rejected++
  }
  return { approved, rejected, skipped, total: approved + rejected, pending }
}

/** The disposition currently held against a listing, if any. */
export function dispositionOf(
  state: MatchState<CandidateRef>,
  listingId: string,
): Disposition | null {
  return state.localDecisions[listingId]?.disposition ?? null
}

export function canUndo(state: MatchState<CandidateRef>): boolean {
  return state.undoStack.length > 0
}

/** One decision as it crosses the wire. Mirrors `DecisionInput` on the route. */
export type SaveDecision = {
  listing_id:        string
  disposition:       Disposition
  /** Explicit in the payload — a move never relies on a server-side default. */
  target_product_id: string | null
}

export type SavePayload = {
  product_id: string
  decisions:  SaveDecision[]
}

/**
 * The one authority for what a save submits.
 *
 * Built from `selectedProduct` and the candidates currently on screen, never
 * from the accumulated decision map alone. That is what makes it impossible for
 * a decision about a previous product to ride along on the next save: an id
 * that is not in the current list cannot appear in the payload, whatever the
 * map still holds.
 */
export function savePayload(state: MatchState<CandidateRef>): SavePayload | null {
  const product = state.selectedProduct
  if (!product) return null
  if (isSelectionSettling(state) || state.saving) return null

  const decisions: SaveDecision[] = []
  for (const c of state.candidates) {
    const record = state.localDecisions[c.id]
    if (!record) continue
    // A skip is the absence of a decision, and the schema already encodes that
    // as the absence of a row. See PERSISTS in ./dispositions.
    if (!PERSISTS[record.disposition]) continue
    decisions.push({
      listing_id:        c.id,
      disposition:       record.disposition,
      target_product_id: record.targetProductId,
    })
  }
  if (decisions.length === 0) return null

  return { product_id: product.id, decisions }
}

export function canSave(state: MatchState<CandidateRef>): boolean {
  return savePayload(state) !== null
}
