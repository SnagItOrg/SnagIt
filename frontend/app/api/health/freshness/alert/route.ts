import { NextRequest, NextResponse } from 'next/server'
import { ALERT_SOURCES, missedNight } from '@/lib/scrape-freshness'
import { latestScrapedAt } from '@/lib/scrape-freshness-read'
import { sendMissedNightEmail } from '@/lib/email'

/**
 * PAN-258: one email to the owner when DBA or Reverb missed a night.
 *
 * Called daily by .github/workflows/scrape-freshness.yml, off panter, because
 * a check on panter dies with panter. The body carries the `stale` list the
 * previous call returned, which the workflow keeps between runs; that memory is
 * what makes it one email per incident. Answers with timestamps only.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // As /api/cron/scrape: a missing secret is a misconfiguration, never an
  // authorisation, and the value never reaches a message or a log line.
  const secret = process.env.FRESHNESS_ALERT_SECRET
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The owner's inbox, as the PAN-251 feedback route.
  const to = process.env.FEEDBACK_TO_EMAIL ?? process.env.RESEND_FROM_EMAIL
  if (!to || !process.env.RESEND_API_KEY) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  const body = await req.json().catch(() => null)
  const previouslyStale: string[] = Array.isArray(body?.previouslyStale)
    ? body.previouslyStale.filter((s: unknown): s is string => typeof s === 'string')
    : []

  const latest = await latestScrapedAt(ALERT_SOURCES)
  if (!latest) return NextResponse.json({ error: 'freshness query failed' }, { status: 500 })

  const now = new Date()
  const { stale, alert } = missedNight(latest, now, previouslyStale)
  if (alert) {
    try {
      await sendMissedNightEmail(to, stale, latest, now)
    } catch (e) {
      // The provider's bounded code (email.ts), never the message or the recipient.
      console.error('[missed-night] send failed', e instanceof Error ? e.message : 'unknown')
      return NextResponse.json({ error: 'send_failed' }, { status: 502 })
    }
  }
  return NextResponse.json({ latest, stale, sent: alert })
}
