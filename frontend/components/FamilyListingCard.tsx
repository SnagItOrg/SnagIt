import Image from 'next/image'
import Link from 'next/link'
import type { FamilyListing } from '@/lib/families'
import type { CardVerdict } from '@/lib/listing-verdicts'
import { Icon } from '@/components/Icon'
import { MarketVerdictBadge } from '@/components/MarketVerdictBadge'
import { SourceBadge } from '@/components/SourceBadge'

/**
 * The small listing card on a family page — PAN-272 lifted it out of
 * app/(shell)/family/[slug]/page.tsx so brand browsing (PAN-271) mounts the
 * same card rather than a copy of it.
 *
 * No 'use client' directive: a pure function of its props, rendered on the
 * server with the page. `t` is passed in for the same reason the family page
 * reads `translations.da` directly — `useLocale()` is a client hook.
 *
 * A ROW IS A NAVIGATION ROW. It links to the MODEL the listing is matched to
 * (`childSlug`), never off-site, and carries no price. `SourceBadge` is the
 * shared chip /product/[slug] renders through SearchResultCard.
 *
 * WHAT THE ROW CARRIES: a photo, the seller's title, the verdict of the model
 * it is matched to (PAN-272), the model's name and the marketplace it came
 * from. No price, no band, no median, and no link that leaves Klup.
 *
 * THE VERDICT HAS ITS OWN LINE, between the title and the meta row, for the
 * reason the wall card gave it one (PAN-63): it is Klup's judgement and must
 * sit in the same place on every card, not fight the model name and the
 * source chip for one truncating line. It renders nothing — no reserved gap —
 * when the model has no band, so a card without a verdict is the card
 * PAN-94 shipped. `size="sm"` steps the badge down to the card's scale; the
 * direction glyph and the word still tell the three states apart without
 * colour, and the small-sample disclaimer (PAN-265) still sits under it.
 *
 * PAN-271: the body is `ListingCardBody`, shared with the brand wall's card.
 * The family card is that body inside a link to the model and nothing more;
 * the brand card adds the seller's price and, for a listing with no model, a
 * link to the listing itself. The body never decides where a card leads.
 */
export function FamilyListingCard({ listing, t }: { listing: FamilyListing; t: Record<string, string> }) {
  return (
    <Link
      href={`/product/${listing.childSlug}`}
      className="surface-card flex w-full gap-3 rounded-2xl p-3 transition-colors hover:border-line-strong"
    >
      <ListingCardBody
        imageUrl={listing.imageUrl}
        title={listing.title}
        verdict={listing.verdict}
        meta={listing.childLabel}
        source={listing.source}
        t={t}
      />
    </Link>
  )
}

/**
 * The card's content: photo, title, optional price line, optional verdict,
 * and the one meta line. `price` is the SELLER'S number as the brand wall
 * shows it (PAN-271), neutral weight and never green — it is not Klup's
 * judgement; the family page never passes it.
 */
export function ListingCardBody({
  imageUrl,
  title,
  price,
  verdict,
  meta,
  source,
  t,
}: {
  imageUrl: string | null
  title: string
  price?: string | null
  verdict: CardVerdict | null
  meta: string
  source: string | null
  t: Record<string, string>
}) {
  return (
    <>
      <div className="size-16 flex-shrink-0 overflow-hidden rounded-xl bg-muted">
        {imageUrl ? (
          <Image
            src={imageUrl}
            /* The title is read out on the next line, so the photo is
               decorative and an alt would repeat it. */
            alt=""
            width={128}
            height={128}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Icon
              name="image"
              style={{ fontSize: '20px', color: 'var(--text-muted)' }}
            />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <span className="line-clamp-2 text-sm font-medium leading-snug wrap-anywhere">
          {title}
        </span>
        {price !== undefined && (
          <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {price ?? t.priceNotListed}
          </span>
        )}
        {verdict && (
          <MarketVerdictBadge
            verdict={verdict.verdict}
            basisLabelKey={verdict.basisLabelKey}
            fewN={verdict.fewN}
            size="sm"
            t={t}
          />
        )}
        {/* One line, never two. The model name truncates and the chip keeps
            its width, so a long child label cannot silently add a 24px line
            to a row — measured on fender-telecaster, 22 of 71 rows were doing
            exactly that at 390px. */}
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="type-meta truncate">{meta}</span>
          <span className="flex-shrink-0">
            <SourceBadge source={source} />
          </span>
        </span>
      </div>
    </>
  )
}
