import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const supabase = getSupabaseAdmin()

  const [brandsResult, categoriesResult] = await Promise.all([
    supabase.from('kg_brand').select('id, slug, name, category_id').order('name'),
    supabase.from('kg_category').select('id, slug, name_da, name_en').order('name_da'),
  ])

  if (brandsResult.error) {
    return NextResponse.json({ error: brandsResult.error.message }, { status: 500 })
  }
  if (categoriesResult.error) {
    return NextResponse.json({ error: categoriesResult.error.message }, { status: 500 })
  }

  return NextResponse.json({
    categories: categoriesResult.data ?? [],
    brands: brandsResult.data ?? [],
  })
}
