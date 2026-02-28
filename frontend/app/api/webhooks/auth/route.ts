import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  // Verify webhook secret (set Authorization: Bearer <WEBHOOK_SECRET> in Supabase webhook headers)
  const authHeader = req.headers.get('authorization')
  const secret = process.env.WEBHOOK_SECRET

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()

  // Only handle INSERT events on auth.users
  if (body.type !== 'INSERT' || body.table !== 'users' || body.schema !== 'auth') {
    return NextResponse.json({ ok: true })
  }

  const email = body.record?.email as string | undefined
  const createdAt = body.record?.created_at as string | undefined

  if (!email) {
    return NextResponse.json({ error: 'Missing email' }, { status: 400 })
  }

  const timestamp = createdAt
    ? new Date(createdAt).toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen' })
    : new Date().toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen' })

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: 'owner@panter.media',
    subject: 'Ny bruger på Klup 🎉',
    text: `Ny bruger tilmeldt: ${email}\nTidspunkt: ${timestamp}`,
  })

  return NextResponse.json({ ok: true })
}
