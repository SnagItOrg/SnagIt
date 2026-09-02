'use client'

/**
 * Admin review controls on a public product-page listing card.
 *
 * WHY HERE. Curating matches from /admin/product/[slug] means judging a listing
 * from a table row, away from the product it is being judged against. The
 * product page already shows the product, its price evidence and the listing in
 * context, which is where the decision is actually easy to make. This adds the
 * three controls to that context; it does not add a second way to make them.
 *
 * NOT AN AUTHORISATION BOUNDARY. Rendering is gated on a server-verified admin
 * flag, but that only decides what is drawn. Every route these buttons call
 * enforces `requireAdminInRoute` independently, so a hand-crafted request from
 * a normal user is refused by the server whatever the client believes.
 *
 * NO PERMANENT OPTIMISTIC STATE. The card is only updated after the server
 * confirms; a failure surfaces an error and leaves the previous status intact.
 * The alternative — the bug this replaces on /admin/match — was a cross that
 * removed the row from the list and wrote nothing, so the same wrong listing
 * could be rejected every day forever.
 */

import { useState } from 'react'

import { ReassignPanel } from '@/components/admin/ReassignPanel'

export type MatchReviewStatus = 'reviewed' | 'unresolved' | 'rejected'

const STATUS_LABEL: Readonly<Record<MatchReviewStatus, string>> = {
  reviewed: 'Gennemgået',
  unresolved: 'Uafklaret',
  rejected: 'Afvist',
}

function StatusChip({ status }: { status: MatchReviewStatus }) {
  return (
    <span
      className="inline-flex w-fit items-center rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-secondary"
      data-testid={`match-status-${status}`}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

export function ProductReviewControls({
  slug,
  listingId,
  status,
  onDecided,
  onReassigned,
}: {
  slug: string
  listingId: string
  status: MatchReviewStatus
  onDecided: (listingId: string, next: MatchReviewStatus) => void
  onReassigned: (listingId: string, productName: string) => void
}) {
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null)
  const [error, setError] = useState<string | null>(null)
  const [reassigning, setReassigning] = useState(false)

  async function decide(decision: 'approve' | 'reject') {
    setBusy(decision)
    setError(null)
    try {
      const res = await fetch(`/api/admin/product/${slug}/${decision}-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listingId }),
      })
      if (!res.ok) {
        // The status is NOT advanced on failure. An operator who sees "Afvist"
        // must be able to trust that the row is rejected in the database.
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `Kunne ikke gemme (${res.status})`)
        return
      }
      onDecided(listingId, decision === 'approve' ? 'reviewed' : 'rejected')
    } catch {
      setError('Kunne ikke gemme. Prøv igen.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2" data-testid="review-controls">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={status} />

        <button
          type="button"
          onClick={() => void decide('approve')}
          disabled={busy !== null}
          className="rounded-lg border border-line bg-surface-1 px-2.5 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {busy === 'approve' ? 'Gemmer…' : 'Godkend'}
        </button>

        <button
          type="button"
          onClick={() => void decide('reject')}
          disabled={busy !== null}
          className="rounded-lg border border-destructive-border bg-destructive-subtle px-2.5 py-1 text-[11px] font-semibold text-destructive-text transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {busy === 'reject' ? 'Gemmer…' : 'Afvis'}
        </button>

        <button
          type="button"
          onClick={() => setReassigning((v) => !v)}
          disabled={busy !== null}
          className="rounded-lg border border-line bg-surface-1 px-2.5 py-1 text-[11px] font-semibold text-ink-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          Match med andet produkt
        </button>
      </div>

      {error && (
        <p role="alert" className="text-[11px] text-destructive-text" data-testid="review-error">
          {error}
        </p>
      )}

      {reassigning && (
        <ReassignPanel
          slug={slug}
          listingId={listingId}
          onSuccess={({ productName }) => {
            setReassigning(false)
            onReassigned(listingId, productName)
          }}
          onCancel={() => setReassigning(false)}
        />
      )}
    </div>
  )
}
