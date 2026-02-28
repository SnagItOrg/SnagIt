import { Resend } from 'resend'
import { NextRequest, NextResponse } from 'next/server'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request: NextRequest) {
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
