/**
 * The market verdict badge — PAN-272 moved it out of SearchResultCard.tsx.
 *
 * No 'use client' directive: it is a pure function of its props, so a server
 * component (the family page's FamilyListingCard) can render it without
 * pulling the whole SearchResultCard client bundle into the page. The
 * provenance and rules below are unchanged from where it lived.
 */

import { fill } from '@/lib/i18n'
import { VERDICT_BASIS_REVERB_FALLBACK } from '@/lib/price-populations'
import { Icon, type IconName } from '@/components/Icon'

/**
 * The deal signal. Replaces the hidden KUP-RATING placeholder.
 *
 * Renders NOTHING when there is no verdict — no empty badge, no reserved gap —
 * because a listing without a comparable population has nothing to say, and a
 * placeholder would imply otherwise.
 *
 * The label is always a word, never colour alone, and it describes position in
 * one asking population. It is deliberately not "Kup", "God handel", "Billig"
 * or any judgement of the deal: Klup is stating where the price sits, not
 * whether to buy.
 *
 * IT OUTRANKS THE SOURCE BADGE — it did not used to. This badge rendered at
 * 11px in the same grey pill as `SourceBadge`, which renders at 12px, so the
 * marketplace name was literally louder than the price judgement on a wall
 * meant to be scanned. Three things separate them now, and NONE of them is
 * colour: size (14px vs 12px), weight (semibold vs medium) and shape (a
 * rectangle vs a pill), plus a direction glyph. The verdict word itself is
 * unchanged and still carries the meaning on its own.
 *
 * `under` CARRIES THE BRAND GREEN, by an explicit product-owner decision
 * (PAN-63). It first shipped neutral, because `frontend/CLAUDE.md` reserved
 * `#13ec6d` for the Kup-rating and the Aktiv badge and nothing else. That rule
 * now reads the other way: green belongs to Klup's OWN judgements, and a
 * price sitting below its own market is exactly that — the same class of
 * statement as the Kup-rating, and the single strongest scanning signal on the
 * wall. The rule moved in the same commit as this line; if you are about to
 * revert one, read the other first.
 *
 * The colour is ADDED to the hierarchy above, not substituted for it: size,
 * weight, shape and the direction glyph are unchanged, so the three states
 * still separate with colour ignored. Known and accepted: when the Kup-rating
 * ships, green will carry two related meanings on this surface.
 *
 * `over` carries the cautionary colour, on the destructive ramp, because it is
 * the only cautionary state; `typical` stays muted because it IS the neutral
 * reading. Both ramps are already defined for light and dark. No new token is
 * introduced, and P2's own PriceAnswer surface remains untinted.
 *
 * A VERDICT BORROWED FROM REVERB SAYS SO IN WORDS (PAN-268 C): "Typisk · målt
 * mod Reverb". Every other basis lives in the tooltip, because it is the
 * listing's own market; this one is not, and a card must never let it pass as
 * a Danish verdict.
 */
const VERDICT_TONE: Readonly<Record<'under' | 'typical' | 'over', {
  bg: string; border: string; fg: string; glyph: IconName
}>> = {
  under:   { bg: 'var(--accent-subtle)',      border: 'var(--accent-border)',      fg: 'var(--accent-text)',      glyph: 'south_east' },
  typical: { bg: 'var(--secondary)',          border: 'var(--border)',             fg: 'var(--muted-foreground)', glyph: 'drag_handle' },
  over:    { bg: 'var(--destructive-subtle)', border: 'var(--destructive-border)', fg: 'var(--destructive-text)', glyph: 'north_east' },
}

export function MarketVerdictBadge({
  verdict,
  basisLabelKey,
  fewN,
  size = 'md',
  t,
}: {
  verdict?: 'under' | 'typical' | 'over' | null
  basisLabelKey?: string | null
  /** PAN-265: set below n = 8. The disclaimer sits directly under the badge, never only in a tooltip. */
  fewN?: number | null
  /**
   * PAN-272: `sm` for the small family card, where a 14px badge would outweigh
   * a 14px title. Same word, same glyph, same tones — only the type size, the
   * glyph and the padding step down, so the hierarchy against `SourceBadge`
   * (12px, medium, pill) still holds on weight, shape and glyph.
   */
  size?: 'md' | 'sm'
  t: Record<string, string>
}) {
  if (!verdict) return null
  const label =
    verdict === 'under' ? t.verdictUnder : verdict === 'over' ? t.verdictOver : t.verdictTypical
  const basis = basisLabelKey ? t[basisLabelKey] : null
  const tone = VERDICT_TONE[verdict]
  const badge = (
    <span
      className={
        size === 'sm'
          ? 'inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold'
          : 'inline-flex w-fit items-center gap-1 rounded-lg px-2.5 py-1 text-sm font-semibold'
      }
      style={{ backgroundColor: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg }}
      title={basis ?? undefined}
      aria-label={basis ? `${label}. ${basis}` : label}
    >
      {/* Direction as a shape, so the three states differ without colour. */}
      <Icon name={tone.glyph} style={{ fontSize: size === 'sm' ? '14px' : '16px' }} />
      {label}
      {basisLabelKey === VERDICT_BASIS_REVERB_FALLBACK && basis && (
        <span className="font-normal">· {basis}</span>
      )}
    </span>
  )
  if (fewN == null) return badge
  return (
    <span className="flex flex-col gap-0.5">
      {badge}
      <span className="text-xs text-muted-foreground">{fill(t.verdictFewData, { n: fewN })}</span>
    </span>
  )
}
