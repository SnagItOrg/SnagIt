import { NextRequest, NextResponse } from 'next/server'
import { readFeedback } from '@/lib/feedback'
import { sendFeedbackEmail } from '@/lib/email'

/**
 * PAN-251: one piece of feedback, to the owner by email.
 *
 * Public and unauthenticated, so middleware rate-limits it per IP; a filled
 * honeypot is answered as accepted and sent nowhere. Nothing is stored and the
 * visitor's IP never leaves this request. The PostHog event is the page's,
 * after a 200, and carries neither text nor email.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const read = readFeedback(await req.json().catch(() => null))
  if (!read.ok) return NextResponse.json({ error: 'invalid', field: read.reason }, { status: 400 })
  if (read.honeypot) return NextResponse.json({ ok: true })

  // The owner's inbox; until FEEDBACK_TO_EMAIL is set in Vercel, the sender's own mailbox.
  const to = process.env.FEEDBACK_TO_EMAIL ?? process.env.RESEND_FROM_EMAIL
  if (!to || !process.env.RESEND_API_KEY) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  try {
    await sendFeedbackEmail(to, read.feedback)
  } catch (e) {
    // The reason is the provider's bounded code (email.ts), never the message or the recipient.
    console.error('[feedback] send failed', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'send_failed' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
