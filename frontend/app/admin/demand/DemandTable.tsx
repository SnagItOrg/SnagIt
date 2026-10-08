'use client'

import Link from 'next/link'
import { useLocale } from '@/components/LocaleProvider'
import { fill } from '@/lib/i18n'
import type { DemandRow } from '@/lib/price-check-demand'

/**
 * Semantic `<table>`: the header cells label the columns for a screen reader,
 * and the ad is the row header. It scrolls inside its own container, so a
 * narrow viewport scrolls the table rather than the document.
 */
const TH = 'border-b border-line px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted'
const TD = 'px-3 py-3 align-top text-sm'
const LINK = 'underline underline-offset-2'

export default function DemandTable({ rows, failed }: { rows: DemandRow[]; failed: boolean }) {
  const { t, locale } = useLocale()
  const copy = t.adminDemand
  const unrecognised = rows.filter((r) => !r.matched_slug).length
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale === 'da' ? 'da-DK' : 'en-GB')

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.intro}</p>
      </div>

      {failed && <p className="text-sm text-destructive-text">{copy.loadFailed}</p>}
      {!failed && rows.length === 0 && <p className="text-sm text-muted-foreground">{copy.empty}</p>}

      {rows.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">{fill(copy.summary, { rows: rows.length, unrecognised })}</p>
          <div className="w-full max-w-full overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse">
              <caption className="sr-only">{copy.intro}</caption>
              <thead>
                <tr className="bg-canvas">
                  <th scope="col" className={`${TH} text-right`}>{copy.colChecks}</th>
                  <th scope="col" className={TH}>{copy.colAd}</th>
                  <th scope="col" className={TH}>{copy.colAnswer}</th>
                  <th scope="col" className={TH}>{copy.colGuesses}</th>
                  <th scope="col" className={TH}>{copy.colLastSeen}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.url}>
                    <td className={`${TD} text-right font-mono tabular-nums`}>{row.check_count}</td>
                    <th scope="row" className={`${TD} text-left font-normal`}>
                      <a href={row.url} target="_blank" rel="noopener noreferrer" className={LINK}>
                        {row.title ?? copy.noTitle}
                      </a>
                      <span className="block text-xs text-muted-foreground">
                        {row.price != null ? `${row.price.toLocaleString(locale === 'da' ? 'da-DK' : 'en-GB')} ${row.currency ?? ''}`.trim() : null}
                        {row.ad_state !== 'active' ? ` · ${copy.adState[row.ad_state]}` : null}
                      </span>
                    </th>
                    <td className={TD}>
                      <span className="block">{copy.state[row.state]}</span>
                      {row.matched_slug && (
                        <Link href={`/admin/product/${row.matched_slug}`} className={`${LINK} text-xs`}>{row.matched_slug}</Link>
                      )}
                      {row.picked_slug && (
                        <span className="block text-xs text-muted-foreground">
                          {copy.picked}: <Link href={`/admin/product/${row.picked_slug}`} className={LINK}>{row.picked_slug}</Link>
                        </span>
                      )}
                    </td>
                    <td className={TD}>
                      {row.guesses.map((g) => (
                        <Link key={g.slug} href={g.kind === 'family' ? g.href : `/admin/product/${g.slug}`} className={`${LINK} block text-xs`}>{g.name}</Link>
                      ))}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-muted-foreground`}>{date(row.last_seen_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
