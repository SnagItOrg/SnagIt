import { Resend } from 'resend'
import { NextRequest, NextResponse } from 'next/server'

// Lazy-init so build-time page-data collection doesn't need RESEND_API_KEY
export async function POST(request: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('Webhook error: RESEND_API_KEY not set')
    return NextResponse.json({ error: 'resend_not_configured' }, { status: 500 })
  }
  const resend = new Resend(apiKey)

  try {
    const body = await request.json()

    // Log the incoming payload for debugging
    console.log('Auth webhook received:', JSON.stringify(body))

    const email = body?.record?.email ?? body?.email ?? 'ukendt'

    await resend.emails.send({
      from: 'notifications@klup.dk',
      to: 'owner@panter.media',
      subject: 'Ny bruger på Klup 🎉',
      html: `
        <h2>Ny bruger tilmeldt</h2>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Tidspunkt:</strong> ${new Date().toISOString()}</p>
      `,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
