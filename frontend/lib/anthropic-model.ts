/**
 * Which Claude model the admin grouping call uses, and how its failures are
 * reported.
 *
 * WHY THIS MODULE EXISTS. /admin/suggestions/bulk hardcoded
 * `claude-sonnet-4-20250514`. That model was retired, so every grouping request
 * returned `404 not_found_error` and the surface has been dead in production.
 * A model id written inline in a route is invisible until the day the provider
 * stops serving it, and nothing in the repository could have told an operator
 * which id was in use — there was no central place to look.
 *
 * The default is `claude-haiku-4-5`: grouping listing titles by canonical model
 * is a classification task, and Haiku is the cheapest current model that does it
 * well. `ANTHROPIC_GROUPING_MODEL` overrides it without a deploy, which is what
 * turns the next retirement into a dashboard edit instead of an outage.
 *
 * SERVER ONLY. `ANTHROPIC_GROUPING_MODEL` carries no `NEXT_PUBLIC_` prefix, so
 * Next.js never inlines it into a client bundle; in a browser the override reads
 * as undefined and the default applies. A test asserts no client component
 * imports this module, because that boundary is the only thing keeping the id
 * off the wire.
 *
 * Deliberately import-free so the root `tsx --test` harness can exercise the
 * resolver with no Next.js, no SDK and no network.
 */

/**
 * The model used when nothing overrides it.
 *
 * Exact id, no date suffix. A dated snapshot is what created this outage: it
 * pins to a build that will eventually be withdrawn, while the undated id keeps
 * resolving.
 */
export const DEFAULT_GROUPING_MODEL = 'claude-haiku-4-5'

/** The environment variable an operator can set to move off the default. */
export const GROUPING_MODEL_ENV = 'ANTHROPIC_GROUPING_MODEL'

type EnvLike = Record<string, string | undefined>

/**
 * Resolve the grouping model.
 *
 * A whitespace-only override is treated as absent rather than passed through:
 * an env var set to `""` or `" "` in a dashboard is an operator clearing the
 * field, and forwarding it would produce a second, less obvious 404 than the
 * one this change exists to fix.
 */
export function resolveGroupingModel(env: EnvLike = process.env): string {
  const override = env[GROUPING_MODEL_ENV]
  if (typeof override === 'string' && override.trim().length > 0) {
    return override.trim()
  }
  return DEFAULT_GROUPING_MODEL
}

/* ── failure reporting ───────────────────────────────────────────────────── */

/** Static event code for the operational log. Never interpolated. */
export const GROUPING_FAILURE_EVENT = 'admin_grouping_provider_failed'

/**
 * What the operator sees. Static, actionable, and free of provider detail.
 *
 * The old handler returned `AI grouping failed: ${String(e)}`, which put the
 * raw provider payload — including the model id — into a toast on the admin
 * page. The id is configuration, not something a browser needs; the log below
 * is where it belongs.
 */
export const GROUPING_FAILURE_MESSAGE =
  'AI-gruppering er ikke tilgængelig lige nu. Prøv igen, eller kontakt drift hvis det bliver ved.'

export type ProviderFailure = {
  /** HTTP status when the provider answered; null for a transport failure. */
  status: number | null
  /** Provider request id when the SDK captured one. */
  requestId: string | null
}

/**
 * Pull the two operationally useful fields off an SDK error.
 *
 * Structural rather than `instanceof`, so it is testable without constructing a
 * real `Anthropic.APIError`, and so a transport error with neither field still
 * produces a well-formed log line instead of throwing inside the handler.
 *
 * Nothing else is read. The provider's response body can echo the prompt, and
 * the prompt carries pending product suggestions, so it never reaches a log.
 */
export function describeProviderFailure(error: unknown): ProviderFailure {
  const e = error as { status?: unknown; requestID?: unknown } | null | undefined
  const status = typeof e?.status === 'number' ? e.status : null
  const requestId = typeof e?.requestID === 'string' && e.requestID.length > 0 ? e.requestID : null
  return { status, requestId }
}

/**
 * The operational log line for a failed grouping call.
 *
 * Fixed key set: a static event code, the HTTP status, and the request id when
 * the SDK captured one. No API key, no prompt, no provider body.
 */
export function groupingFailureLogLine(failure: ProviderFailure, model: string): string {
  return JSON.stringify({
    channel: 'operational',
    component: 'admin-suggestions-bulk',
    event: GROUPING_FAILURE_EVENT,
    status: failure.status,
    request_id: failure.requestId,
    model,
  })
}
