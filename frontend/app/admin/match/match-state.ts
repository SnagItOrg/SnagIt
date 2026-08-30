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

/** The only thing the reducer needs from a candidate: a stable identity. */
export type CandidateRef = { id: string }

export type MatchProduct = {
  id:             string
  canonical_name: string
  slug:           string
  kg_brand:       { name: string } | null
}

export type Verdict = 'approved' | 'rejected'

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
  localDecisions:   Record<string, Verdict>
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
  | { type: 'decision_toggled';        listingId: string; verdict: Verdict }
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
    candidates:       [],
    localDecisions:   {},
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
  decisions: Record<string, Verdict>,
  candidates: readonly CandidateRef[],
): Record<string, Verdict> {
  const present = new Set(candidates.map((c) => c.id))
  const next: Record<string, Verdict> = {}
  for (const [id, verdict] of Object.entries(decisions)) {
    if (present.has(id)) next[id] = verdict
  }
  return next
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
      return {
        ...state,
        candidates:       action.candidates,
        localDecisions:   pruneDecisions(state.localDecisions, action.candidates),
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

    case 'decision_toggled': {
      // A tick only means something against a candidate currently on screen.
      if (!state.candidates.some((c) => c.id === action.listingId)) return state
      const next = { ...state.localDecisions }
      if (next[action.listingId] === action.verdict) delete next[action.listingId]
      else next[action.listingId] = action.verdict
      return { ...state, localDecisions: next }
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
      return {
        ...state,
        saving:         false,
        candidates,
        localDecisions: pruneDecisions(state.localDecisions, candidates),
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
  total: number
} {
  let approved = 0
  let rejected = 0
  for (const c of state.candidates) {
    const verdict = state.localDecisions[c.id]
    if (verdict === 'approved') approved++
    else if (verdict === 'rejected') rejected++
  }
  return { approved, rejected, total: approved + rejected }
}

export type SavePayload = {
  product_id:           string
  listing_ids:          string[]
  rejected_listing_ids: string[]
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

  const listing_ids: string[] = []
  const rejected_listing_ids: string[] = []
  for (const c of state.candidates) {
    const verdict = state.localDecisions[c.id]
    if (verdict === 'approved') listing_ids.push(c.id)
    else if (verdict === 'rejected') rejected_listing_ids.push(c.id)
  }
  if (listing_ids.length === 0 && rejected_listing_ids.length === 0) return null

  return { product_id: product.id, listing_ids, rejected_listing_ids }
}

export function canSave(state: MatchState<CandidateRef>): boolean {
  return savePayload(state) !== null
}
