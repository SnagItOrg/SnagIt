'use client'

import { useEffect, useState } from 'react'

import { createViewTracker, type KlupEventMap, type KlupEventName } from '@/lib/analytics'

/**
 * Emit one view event for the page it is rendered on.
 *
 * Renders nothing. A server page renders it to get a client-side view event;
 * a client page renders it once its data has landed. The tracker in
 * `lib/analytics.ts` holds the once-per-`viewKey` rule, so strict mode's double
 * effect, a re-render and a refetch all stay one event.
 */
export function TrackView<E extends KlupEventName>({
  viewKey,
  event,
  properties,
}: {
  viewKey: string
  event: E
  properties: KlupEventMap[E]
}) {
  const [trackView] = useState(createViewTracker)

  useEffect(() => {
    trackView(viewKey, event, properties)
  }, [trackView, viewKey, event, properties])

  return null
}
