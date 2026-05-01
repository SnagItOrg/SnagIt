import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getCurrentAdminState } from '@/lib/admin-auth'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { userId, isAdmin } = await getCurrentAdminState()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const update: Record<string, unknown> = {}
  if (body.tier !== undefined) update.tier = body.tier
  if (body.browse_visibility !== undefined) update.browse_visibility = body.browse_visibility
  if (body.year_released !== undefined) update.year_released = body.year_released
  if (body.tags !== undefined) update.tags = body.tags

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('kg_product')
    .update(update)
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
