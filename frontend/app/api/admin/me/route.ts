import { NextResponse } from 'next/server'
import { getCurrentAdminState } from '@/lib/admin-auth'

export async function GET() {
  const { isAdmin } = await getCurrentAdminState()
  return NextResponse.json({ isAdmin })
}
