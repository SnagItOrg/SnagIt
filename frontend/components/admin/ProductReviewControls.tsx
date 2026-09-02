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
import { useLocale } from '@/components/LocaleProvider'
import { ACTIONS_FOR, type MatchReviewStatus } from '@/lib/match-review-state'

// Re-exported so existing importers of this component keep working.
export { ACTIONS_FOR }
export type { MatchReviewStatus }

function StatusChip({ status }: { status: MatchReviewStatus }) {
  const { t } = useLocale()
  const label = {
    reviewed: t.adminReview.statusReviewed,
    unresolved: t.adminReview.statusUnresolved,
    rejected: t.adminReview.statusRejected,
  }[status]

  return (
    <span
      className="inline-flex w-fit items-center rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-secondary"
      data-testid={`match-status-${status}`}
    >
      {label}
    </span>
  )
}

const BTN = 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

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
  const { t } = useLocale()
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null)
  const [error, setError] = useState<string | null>(null)
  const [reassigning, setReassigning] = useState(false)

  const actions = ACTIONS_FOR[status]

  async function decide(decision: 'approve' | 'reject') {
    // Nielsen #1 plus double-submit protection: one in-flight decision at a
    // time, and the button says which one is running.
    if (busy) return
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
        setError(body.error ?? t.adminReview.saveFailed)
        return
      }
      onDecided(listingId, decision === 'approve' ? 'reviewed' : 'rejected')
    } catch {
      setError(t.adminReview.saveFailed)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2" data-testid="review-controls">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={status} />

        {actions.approve && (
          <button
            type="button"
            onClick={() => void decide('approve')}
            disabled={busy !== null}
            data-testid="review-approve"
            className={`${BTN} border-line bg-surface-1 text-ink hover:bg-surface-2`}
          >
            {busy === 'approve' ? t.adminReview.saving : t.adminReview.approve}
          </button>
        )}

        {actions.reject && (
          <button
            type="button"
            onClick={() => void decide('reject')}
            disabled={busy !== null}
            data-testid="review-reject"
            className={`${BTN} border-destructive-border bg-destructive-subtle text-destructive-text hover:bg-surface-2`}
          >
            {busy === 'reject' ? t.adminReview.saving : t.adminReview.reject}
          </button>
        )}

        {actions.move && (
          <button
            type="button"
            onClick={() => setReassigning((v) => !v)}
            disabled={busy !== null}
            data-testid="review-move"
            className={`${BTN} border-line bg-surface-1 text-ink-secondary hover:bg-surface-2`}
          >
            {t.adminReview.move}
          </button>
        )}
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
