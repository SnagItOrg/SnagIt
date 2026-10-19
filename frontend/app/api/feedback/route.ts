import { NextRequest, NextResponse } from 'next/server'
import { readFeedback, type Feedback } from '@/lib/feedback'
import { sendFeedbackEmail } from '@/lib/email'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

/**
 * PAN-251: one piece of feedback — a row in `user_feedback` (migration 068)
 * for the manager, and an email to the owner.
 *
 * Public and unauthenticated, so middleware rate-limits it per IP; a filled
 * honeypot is answered as accepted and written nowhere. The visitor's IP never
 * leaves this request. The answer is ok when the row or the email got through:
 * until 068 is applied the insert fails and the email alone carries it. Logs
 * carry bounded codes only — never the text or the address. The PostHog event
 * is the page's, after a 200, and carries neither text nor email.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const read = readFeedback(await req.json().catch(() => null))
  if (!read.ok) return NextResponse.json({ error: 'invalid', field: read.reason }, { status: 400 })
  if (read.honeypot) return NextResponse.json({ ok: true })
  const feedback = read.feedback

  const stored = await storeFeedback(feedback)

  // The owner's inbox; until FEEDBACK_TO_EMAIL is set in Vercel, the sender's own mailbox.
  const to = process.env.FEEDBACK_TO_EMAIL ?? process.env.RESEND_FROM_EMAIL
  const emailConfigured = Boolean(to && process.env.RESEND_API_KEY)
  let sent = false
  if (to && emailConfigured) {
    try {
      await sendFeedbackEmail(to, feedback)
      sent = true
    } catch (e) {
      // The reason is the provider's bounded code (email.ts), never the message or the recipient.
      console.error('[feedback] send failed', e instanceof Error ? e.message : 'unknown')
    }
  }
  if (!stored && !sent) {
    return emailConfigured
      ? NextResponse.json({ error: 'send_failed' }, { status: 502 })
      : NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}

/** True when the row was written; false when it could not be — 068 not yet applied, or no service client. */
async function storeFeedback(f: Feedback): Promise<boolean> {
  try {
    const { error } = await getSupabaseAdmin().from('user_feedback').insert({
      kind: f.kind,
      surface: f.surface,
      path: f.path,
      text: f.text,
      email: f.email,
      product_slug: f.productSlug,
      state: f.state,
      tip_price_dkk: f.tipPriceDkk,
      tip_name: f.tipName,
      listing_url: f.listingUrl,
    })
    if (error) {
      console.error('[feedback] store failed', error.code)
      return false
    }
    return true
  } catch {
    console.error('[feedback] store failed', 'no_client')
    return false
  }
}
