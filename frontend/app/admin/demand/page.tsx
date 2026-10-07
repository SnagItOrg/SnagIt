import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { DemandRow } from '@/lib/price-check-demand'
import DemandTable from './DemandTable'

/**
 * PAN-247 — the demand list: every DBA link pasted into /tjek-prisen, with what
 * Klup answered, most-checked first. The owner or a worker turns rows into KG
 * products or publications from here; the page itself writes nothing.
 *
 * Admin only: `admin_page` in lib/route-access.ts, enforced in middleware.
 */
export const dynamic = 'force-dynamic'

export default async function AdminDemandPage() {
  const { data, error } = await getSupabaseAdmin()
    .from('price_check_demand')
    .select('*')
    .order('check_count', { ascending: false })
    .order('last_seen_at', { ascending: false })
    .limit(500)

  return <DemandTable rows={(data ?? []) as DemandRow[]} failed={!!error} />
}
