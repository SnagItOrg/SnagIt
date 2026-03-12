'use client'

interface Props {
  message: string
}

export function Toast({ message }: Props) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-xl text-sm font-semibold shadow-xl bg-card border border-border whitespace-nowrap">
      {message}
    </div>
  )
}
