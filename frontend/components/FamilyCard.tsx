'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'

import { useLocale } from '@/components/LocaleProvider'
import { Icon } from '@/components/Icon'
import { fill } from '@/lib/i18n'
import type { FamilyGridCard } from '@/lib/family-cards'

/**
 * PAN-192 — one card for a navigation family, in place of its models.
 *
 * THE SAME CARD AS `ProductCard`, ON PURPOSE. Same surface, 4:3 media box,
 * two-line title and meta line, so the grid keeps one rhythm and a family reads
 * as a peer of the products beside it. Astryx's ClickableCard is the pattern:
 * the whole card is one link with its own accessible label, which here says the
 * card is a family, not a product.
 *
 * What differs is only what it may say. Where a product card shows "N til
 * salg", this shows the stack glyph and "N modeller" — the cards it replaced.
 * It shows no price and no listing count, because it has neither (PAN-94,
 * PAN-98; see `FamilyGridCard`). The pill is neutral: a family is not a Klup
 * judgement (no green) and not the visitor's location (no `--here`).
 */
export function FamilyCard({ card }: { card: FamilyGridCard }) {
  const { t } = useLocale()
  const [imgError, setImgError] = useState(false)
  const models = fill(t.familyCardModels, { count: card.modelCount })

  return (
    <Link
      href={`/family/${card.slug}`}
      aria-label={fill(t.familyCardLabel, { label: card.label, count: card.modelCount })}
      className="surface-interactive flex flex-col rounded-xl overflow-hidden"
    >
      <div className="relative w-full aspect-[4/3] overflow-hidden" style={{ background: 'var(--secondary)' }}>
        {card.imageUrl && !imgError ? (
          <Image
            src={card.imageUrl}
            alt=""
            fill
            className="object-cover"
            sizes="(max-width: 768px) 50vw, 25vw"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Icon name="stacks" style={{ fontSize: 36, color: 'var(--muted-foreground)', opacity: 0.4 }} />
          </div>
        )}
        <span
          className="absolute bottom-2 right-2 text-[11px] font-medium pl-1.5 pr-2 py-0.5 rounded-full flex items-center gap-1"
          style={{
            background: 'var(--card)',
            color: 'var(--foreground)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <Icon name="stacks" style={{ fontSize: 13 }} />
          {models}
        </span>
      </div>

      <div className="p-3 flex flex-col gap-0.5">
        <p className="type-card-title line-clamp-2 min-h-[2.48em]">{card.label}</p>
        <p className="type-meta">{card.brand}</p>
      </div>
    </Link>
  )
}
