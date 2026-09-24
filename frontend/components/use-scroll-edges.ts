'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** Astryx's own tolerance. A sub-pixel scroll offset is not an overflow. */
const TOLERANCE = 1

export type ScrollEdges = { start: boolean; end: boolean }

/** The `data-fade` state the `.carousel-rail` and `.scroll-fade-y` masks read. */
export function scrollFade(edges: ScrollEdges): 'none' | 'start' | 'end' | 'both' {
  return edges.start && edges.end ? 'both' : edges.start ? 'start' : edges.end ? 'end' : 'none'
}

/**
 * Is there more content before and after the visible part of a scroller?
 *
 * Lifted out of `Carousel` (PAN-116) for the sidebar catalogue (PAN-121), so
 * the two fade edges are one measurement rather than two. It answers the same
 * question on either axis; nothing else about it is axis-specific.
 *
 * `Math.abs` on the offset is not decoration: in a right-to-left writing mode
 * `scrollLeft` counts down from zero, and the absolute value is the same
 * logical distance from the start in both directions.
 *
 * Returning `prev` unchanged when nothing crossed a threshold matters more than
 * it looks — this runs on every scroll event, and a setState per frame would
 * re-render the whole scroller while the user is dragging it.
 *
 * TWO BOXES ARE OBSERVED: the scroller, and its first child. The scroller's own
 * size does not change when its content grows — the sidebar's catalogue tree
 * answering after the page, or a branch opening — so the content box has to be
 * watched too, or the fade would describe the layout at mount.
 */
export function useScrollEdges<T extends HTMLElement>(axis: 'x' | 'y') {
  const ref = useRef<T>(null)
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false })

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const offset = Math.abs(axis === 'x' ? el.scrollLeft : el.scrollTop)
    const max = axis === 'x' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight
    const start = offset > TOLERANCE
    const end = offset < max - TOLERANCE
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [axis])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [measure])

  return { ref, edges }
}
