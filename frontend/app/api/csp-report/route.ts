import { NextRequest, NextResponse } from 'next/server'

/**
 * PAN-298: where the browser posts a Content-Security-Policy violation
 * (`report-uri` in next.config.mjs). The policy is report-only, so this log
 * line is the only trace a would-be violation leaves; it is what decides when
 * the policy can be enforced.
 *
 * Public and unauthenticated by nature — the browser sends it, not a user —
 * so middleware rate-limits it per IP like /api/feedback. Logs carry the four
 * fields that name the violation and nothing else: no cookies, no IP, no
 * script sample, and every value is cut to a bounded length. Always 204; a
 * reporting endpoint has nothing to say back.
 */
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 8_192
const MAX_FIELD_CHARS = 300

function field(report: Record<string, unknown>, key: string): string | null {
  const v = report[key]
  return typeof v === 'string' ? v.slice(0, MAX_FIELD_CHARS) : null
}

export async function POST(req: NextRequest) {
  const text = await req.text().catch(() => '')
  if (text.length === 0 || text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 204 })

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return new NextResponse(null, { status: 204 })
  }
  // `report-uri` wraps the report in `csp-report`; the Reporting API sends a bare body.
  const outer = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  const inner = outer?.['csp-report']
  const report = inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : outer
  if (!report) return new NextResponse(null, { status: 204 })

  console.warn(
    JSON.stringify({
      channel: 'operational',
      component: 'csp',
      event: 'csp_violation',
      document: field(report, 'document-uri'),
      directive: field(report, 'effective-directive') ?? field(report, 'violated-directive'),
      blocked: field(report, 'blocked-uri'),
      disposition: field(report, 'disposition'),
    }),
  )
  return new NextResponse(null, { status: 204 })
}
