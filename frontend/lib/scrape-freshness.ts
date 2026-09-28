// PAN-158. The daily marketplace scrapers run under PM2 on the Mac Mini
// (ecosystem.config.js). When that machine loses its network a run cannot
// record its own failure, so the only reliable signal is absence: a source
// whose newest listing has gone a night without being refreshed.
//
// Import-free, like catalogue.ts, so it is testable from plain Node.

export const DAILY_SOURCES = ['dba.dk', 'finn', 'blocket', 'kleinanzeigen', 'reverb'] as const

// One missed nightly run, plus slack for a run that finishes late.
export const MAX_AGE_HOURS = 26

// Fail-closed: a source with no listings at all is stale.
export function staleSources(latest: Record<string, string | null>, now: Date): string[] {
  const cutoff = now.getTime() - MAX_AGE_HOURS * 3_600_000
  return DAILY_SOURCES.filter((source) => {
    const at = latest[source]
    return !at || Date.parse(at) < cutoff
  })
}
