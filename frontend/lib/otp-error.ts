/**
 * What to tell someone whose magic-link send just failed.
 *
 * WHY THIS EXISTS AT ALL. `supabase.auth.signInWithOtp()` does not throw when
 * the send fails. Its own `catch` ends with:
 *
 *     if (isAuthError(error)) return this._returnResult({ data: …, error })
 *     throw error
 *
 * and every failure inside it is already an `AuthError` by then — a rejected
 * address and a rate limit arrive as `AuthApiError`, and even a network or
 * CORS failure is wrapped as `AuthRetryableFetchError`, which extends
 * `AuthError` too. So the failure is RETURNED, essentially always, and a call
 * site that discards the return value or relies on `try/catch` sees a
 * successful send. Both public call sites did exactly that.
 *
 * THE COPY IS THE POINT. "Noget gik galt" tells a person nothing they can act
 * on, and being rate-limited is a completely different situation from
 * mistyping your address: one says wait and look in your spam folder, the
 * other says fix the third character. Supabase distinguishes them, so the copy
 * does too.
 *
 * Three buckets, not more. A bucket only earns its place if it changes what
 * the reader should DO, and everything past these three resolves to "try
 * again, and tell us if it persists".
 *
 * Import-free on purpose, like `catalogue.ts` and `publication.ts`, so the
 * decision stays testable from plain Node. The parameter is structural rather
 * than `AuthError` for the same reason.
 */

/** The i18n key to render. Every value is a key in both `da` and `en`. */
export type OtpErrorKey =
  | 'otpErrorRateLimited'
  | 'otpErrorInvalidAddress'
  | 'otpErrorGeneric'

export function classifyOtpError(
  error: { status?: number; code?: string } | null | undefined,
): OtpErrorKey | null {
  if (!error) return null

  // 429 is the rate limit regardless of which code rides along, and the two
  // codes are checked as well because a proxy can rewrite the status.
  if (
    error.status === 429 ||
    error.code === 'over_email_send_rate_limit' ||
    error.code === 'over_request_rate_limit'
  ) {
    return 'otpErrorRateLimited'
  }

  // The address itself is unusable — misspelt, or a domain GoTrue refuses.
  // Retrying unchanged cannot work, so the copy must say so.
  if (
    error.code === 'email_address_invalid' ||
    error.code === 'email_address_not_authorized' ||
    error.code === 'validation_failed'
  ) {
    return 'otpErrorInvalidAddress'
  }

  return 'otpErrorGeneric'
}
