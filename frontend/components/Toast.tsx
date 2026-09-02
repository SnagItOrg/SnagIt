'use client'

interface Props {
  message: string
}

export function Toast({ message }: Props) {
  return (
    /*
      `whitespace-nowrap` was removed and a width cap added: the review
      messages name a listing AND a product, which at 360px was wider than the
      viewport and pushed the page into horizontal scroll. Short messages are
      unaffected, so the existing callers look the same.
    */
    <div
      role="status"
      className="surface-overlay fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[92vw] px-4 py-3 rounded-xl text-sm font-semibold text-center"
    >
      {message}
    </div>
  )
}
