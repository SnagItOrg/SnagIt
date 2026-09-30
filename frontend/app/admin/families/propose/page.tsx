import { getSupabaseAdmin } from '@/lib/supabase-admin'
import ProposeFamilyForm, { type RootOption } from './ProposeFamilyForm'

/**
 * /admin/families/propose — PAN-159, option M.
 *
 * An admin proposes a navigation family and gets the code to land as a PR.
 * Nothing on this page writes: families stay reviewed code (PAN-52 D1(a)).
 * Gated as an admin page by middleware; its one API route gates itself.
 */
export const dynamic = 'force-dynamic'

export default async function ProposeFamilyPage() {
  const { data } = await getSupabaseAdmin()
    .from('kg_category')
    .select('slug, name_da')
    .eq('domain', 'music')
    .is('parent_id', null)
    .order('name_da')

  const roots: RootOption[] = ((data ?? []) as Array<{ slug: string; name_da: string | null }>).map(
    (r) => ({ slug: r.slug, name: r.name_da ?? r.slug }),
  )

  return <ProposeFamilyForm roots={roots} />
}
