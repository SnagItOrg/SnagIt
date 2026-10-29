/**
 * PAN-300 — the one way into an account: an e-mail address, then a 6-digit
 * code from the mail.
 *
 * Every sign-in surface goes through `sendEmailCode` and `verifyEmailCode`
 * (rendered by `components/EmailCodeSignIn.tsx`). There is no password, no
 * separate signup and no second call site of `signInWithOtp`: a new address
 * and a returning one take the same two steps, and Supabase creates the user
 * on the first send (`shouldCreateUser: true`).
 *
 * A CODE, NOT A LINK. The mail leads with the code. A code survives Outlook
 * Safe Links pre-clicking the mail, and it works when the mail is read on a
 * phone and the form is on a laptop. The link the template may still carry
 * is a fallback through `/auth/confirm`, which keeps serving PKCE and
 * `token_hash` for mails already in inboxes.
 *
 * NO IMPORTS beyond types and `analytics.ts`, which has no runtime dependency
 * on posthog-js or React. The Supabase client is structural, so the decisions
 * here run from a plain Node test with a fake.
 */

import { classifyOtpError, classifyVerifyError, type OtpErrorKey, type VerifyErrorKey } from './otp-error'
import { isNewAccountConfirmation } from './analytics'

/** Digits in a code. Supabase's "Email OTP Length" must be set to the same. */
export const CODE_LENGTH = 6

/**
 * Seconds before "Send ny kode" is offered again. Supabase refuses a second
 * send to one address inside 60 s anyway (`over_email_send_rate_limit`), so a
 * shorter cooldown would only produce the rate-limit message.
 */
export const RESEND_COOLDOWN_S = 60

type AuthErrorLike = { status?: number; code?: string } | null

/** The two calls this module makes, as structural types. */
export type EmailCodeAuth = {
  signInWithOtp(args: {
    email: string
    options: { shouldCreateUser: boolean; emailRedirectTo?: string }
  }): Promise<{ error: AuthErrorLike }>
  verifyOtp(args: { email: string; token: string; type: 'email' }): Promise<{
    data: { user: { email_confirmed_at?: string | null; last_sign_in_at?: string | null } | null }
    error: AuthErrorLike
  }>
}

/**
 * Send a code to `email`. `null` is success; otherwise the i18n key to show.
 *
 * `signInWithOtp` RETURNS its failures (lib/otp-error.ts); the catch is for
 * the residue that throws, such as blocked storage during the PKCE challenge,
 * so a caller's button never spins for good.
 */
export async function sendEmailCode(
  auth: EmailCodeAuth,
  email: string,
  emailRedirectTo?: string,
): Promise<OtpErrorKey | null> {
  try {
    const { error } = await auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, ...(emailRedirectTo ? { emailRedirectTo } : {}) },
    })
    return classifyOtpError(error)
  } catch {
    return 'otpErrorGeneric'
  }
}

export type VerifyResult =
  | { error: null; isNewUser: boolean }
  | { error: VerifyErrorKey }

/**
 * Exchange the code for a session. On success the browser client has already
 * written the session cookie, and `isNewUser` says whether this code is the
 * one that confirmed the account — the same test `signup_completed` used for
 * the e-mail link.
 */
export async function verifyEmailCode(
  auth: EmailCodeAuth,
  email: string,
  code: string,
): Promise<VerifyResult> {
  if (!isCompleteCode(code)) return { error: 'otpErrorCodeWrong' }
  try {
    const { data, error } = await auth.verifyOtp({ email, token: code, type: 'email' })
    const failure = classifyVerifyError(error)
    if (failure) return { error: failure }
    if (!data.user) return { error: 'otpErrorGeneric' }
    return { error: null, isNewUser: isNewAccountConfirmation(data.user) }
  } catch {
    return { error: 'otpErrorGeneric' }
  }
}

export function isCompleteCode(code: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code)
}

/**
 * The boxes after `input` arrives in box `index`.
 *
 * One handler for typing, pasting and autofill: a typed digit fills its box,
 * and several digits — a paste, or iOS dropping the whole code into the box
 * that has `autocomplete="one-time-code"` — fill forward from `index`. A paste
 * of the full code fills from the first box wherever it lands, because that is
 * the only thing it can mean. Non-digits are dropped ("123 456", "123-456").
 * `focus` is the box to move to next.
 */
export function fillCode(
  digits: readonly string[],
  index: number,
  input: string,
): { digits: string[]; focus: number } {
  const next = Array.from({ length: CODE_LENGTH }, (_, i) => digits[i] ?? '')
  const incoming = input.replace(/\D/g, '')

  if (incoming.length === 0) {
    next[index] = ''
    return { digits: next, focus: index }
  }

  const start = incoming.length >= CODE_LENGTH ? 0 : index
  const chars = incoming.slice(0, CODE_LENGTH - start).split('')
  chars.forEach((c, i) => { next[start + i] = c })
  return { digits: next, focus: Math.min(start + chars.length, CODE_LENGTH - 1) }
}

/** Whole seconds left of the resend cooldown; 0 when it may be sent again. */
export function resendSecondsLeft(sentAtMs: number, nowMs: number): number {
  const left = RESEND_COOLDOWN_S - Math.floor((nowMs - sentAtMs) / 1000)
  return Math.max(0, Math.min(RESEND_COOLDOWN_S, left))
}

/**
 * PAN-308: ask the server for welcome mail #1. Called once a new account is
 * confirmed and its sign-in handler has run, so a watch created at signup
 * already counts when the route picks the mail's call to action. Fire and
 * forget: `keepalive` lets it outlive the navigation that usually follows,
 * and a failure costs a welcome mail, never the sign-in.
 */
export function requestWelcomeMail(): void {
  void fetch('/api/welcome', { method: 'POST', keepalive: true }).catch(() => {})
}
