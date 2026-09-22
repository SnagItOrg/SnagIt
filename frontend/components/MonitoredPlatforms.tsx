'use client'

/**
 * Every marketplace Klup watches for this product, whether or not it has
 * anything to show (PAN-113).
 *
 * WHY A PLATFORM WITH NOTHING STILL RENDERS. Klup is a monitoring service, so
 * silence from a watched source is a result. Rendering only the sources that
 * happen to have listings left the visitor unable to tell "Klup does not watch
 * DBA" from "Klup watches DBA and there is nothing right now" — and the second
 * is the whole product. An empty platform is the answer, not the absence of
 * one.
 *
 * THE LIST IS NOT DECLARED HERE. `monitoredSources` is resolved server-side
 * from data/klup-source-monitoring.json, the reviewed registry the scrapers
 * themselves obey. A hardcoded platform list in this file would be a second
 * declaration of monitoring, free to drift from the one that is real, and
 * widening monitoring is a product-owner action (CLAUDE.md §2). This component
 * renders what it is handed and decides nothing.
 *
 * ACTIVE AND INACTIVE SEPARATE WITHOUT COLOUR, the precedent MarketVerdictBadge
 * set (PAN-63): a glyph the other state does not have, a heavier ink on the
 * count, a filled chip against an unfilled dashed one, and different words.
 * Every one of those survives colour being ignored. Green is not among them —
 * the sparse-accent rule is exhaustive (Kup-rating, "Aktiv", `under typisk`)
 * and "we are watching" is not on it.
 *
 * COUNTS KEY ON `source`, NEVER `platform`. `listings.source` holds the
 * registry key (`dba.dk`); `listings.platform` holds `dba` or null. Counting
 * the latter would report zero for every DBA listing on the page and advertise
 * a number the wall below contradicts, which is the PAN-98 failure.
 */
import { SourceBadge } from '@/components/SourceBadge'
import { useLocale } from '@/components/LocaleProvider'
import { fill } from '@/lib/i18n'

export function MonitoredPlatforms({
  monitoredSources,
  listings,
}: {
  monitoredSources: string[]
  listings: { source?: string | null }[]
}) {
  const { t } = useLocale()

  if (monitoredSources.length === 0) return null

  const counts = new Map<string, number>()
  for (const listing of listings) {
    if (listing.source) counts.set(listing.source, (counts.get(listing.source) ?? 0) + 1)
  }

  return (
    <section className="mt-5">
      <h2 className="type-meta">{t.monitoredPlatforms.heading}</h2>
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        {monitoredSources.map((source) => {
          const count = counts.get(source) ?? 0
          return (
            <li key={source} className="flex items-center gap-1.5">
              {/* The badge itself reads as inactive, per the owner's wording —
                  by losing its fill, not by being faded. Opacity was measured
                  first and rejected: at 0.6 the chip composited to 2.61:1
                  against the dark canvas, because dimming pulls ink and fill
                  toward the background together. Emptying the fill instead
                  leaves the label at full strength and lifts it clear of the
                  canvas, so the quieter state is also the more legible one. */}
              <span
                className={
                  count > 0 ? undefined : '[&>span]:bg-transparent [&>span]:border-dashed'
                }
              >
                <SourceBadge source={source} />
              </span>
              {count > 0 ? (
                <span className="type-meta font-semibold text-foreground">
                  {count === 1
                    ? t.monitoredPlatforms.listingCountOne
                    : fill(t.monitoredPlatforms.listingCount, { count })}
                </span>
              ) : (
                <span className="flex items-center gap-1 type-meta">
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined"
                    style={{ fontSize: '16px', color: 'var(--text-muted)' }}
                  >
                    visibility
                  </span>
                  {t.monitoredPlatforms.none}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="mt-2 type-meta">{t.monitoredPlatforms.note}</p>
    </section>
  )
}
