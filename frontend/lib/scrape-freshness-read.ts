import { getSupabaseAdmin } from '@/lib/supabase-admin'

// The newest scraped_at per source (null when a source has no listings), or
// null when any read failed. One query for the PAN-158 heartbeat and the
// PAN-258 alert, so the two cannot disagree about what "latest" means.
export async function latestScrapedAt(
  sources: readonly string[],
): Promise<Record<string, string | null> | null> {
  const admin = getSupabaseAdmin()
  const results = await Promise.all(
    sources.map((source) =>
      admin
        .from('listings')
        .select('scraped_at')
        .eq('source', source)
        .not('scraped_at', 'is', null)
        .order('scraped_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  )
  if (results.some((r) => r.error)) return null
  return Object.fromEntries(sources.map((source, i) => [source, results[i].data?.scraped_at ?? null]))
}
