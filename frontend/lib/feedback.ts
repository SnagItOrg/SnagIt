/**
 * PAN-251: what a feedback form may send, read fail-closed.
 *
 * Pure, so the route's validation is testable from plain Node. The route
 * sends one email and stores nothing; this module decides what reaches it.
 * The visitor's IP is never part of the shape.
 */

export const FEEDBACK_KINDS = ['wrong_product', 'wrong_price', 'missing', 'other'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]
export type FeedbackSurface = 'product' | 'tjek-prisen'

export interface Feedback {
  kind: FeedbackKind
  surface: FeedbackSurface
  /** The page path the form was on. */
  path: string
  text: string | null
  /** Only when the visitor typed it: "may we answer you?". */
  email: string | null
  productSlug: string | null
  /** The tjek-prisen state the answer was in, if any. */
  state: string | null
}

export type FeedbackRead =
  | { ok: true; feedback: Feedback; honeypot: boolean }
  | { ok: false; reason: 'kind' | 'surface' | 'path' | 'text' | 'email' | 'slug' | 'state' }

const MAX_TEXT = 2000
const MAX_EMAIL = 200
const MAX_PATH = 200
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/
const STATES = new Set(['verdict', 'not_enough_data', 'not_recognised', 'cant_read'])

export function readFeedback(body: unknown): FeedbackRead {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

  const kind = str(b.kind)
  if (!(FEEDBACK_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: 'kind' }
  const surface = str(b.surface)
  if (surface !== 'product' && surface !== 'tjek-prisen') return { ok: false, reason: 'surface' }
  const path = str(b.path)
  if (!path.startsWith('/') || path.length > MAX_PATH || /[\s<>]/.test(path)) return { ok: false, reason: 'path' }
  const text = str(b.text)
  if (text.length > MAX_TEXT) return { ok: false, reason: 'text' }
  const email = str(b.email)
  if (email && (email.length > MAX_EMAIL || !EMAIL.test(email))) return { ok: false, reason: 'email' }
  const productSlug = str(b.productSlug)
  if (productSlug && !SLUG.test(productSlug)) return { ok: false, reason: 'slug' }
  const state = str(b.state)
  if (state && !STATES.has(state)) return { ok: false, reason: 'state' }

  // The honeypot: a field no person sees or fills. A filled one is a bot, answered as if accepted and sent nowhere.
  const honeypot = str(b.website).length > 0

  return {
    ok: true,
    honeypot,
    feedback: {
      kind: kind as FeedbackKind,
      surface,
      path,
      text: text || null,
      email: email || null,
      productSlug: productSlug || null,
      state: state || null,
    },
  }
}
