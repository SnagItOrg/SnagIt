'use client'

import { Component, type ReactNode } from 'react'

interface Props {
  listingId?: string
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ListingErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.error(`[ListingErrorBoundary] listing=${this.props.listingId ?? 'unknown'}`, error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex gap-3 p-3 rounded-2xl bg-card border border-border"
          style={{ height: '104px' }}
        >
          <div className="flex-shrink-0 w-20 h-20 rounded-lg bg-muted" />
          <div className="flex-1 flex flex-col gap-2 py-1">
            <div className="h-3 w-3/4 rounded bg-muted" />
            <div className="h-4 w-1/3 rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted" />
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
