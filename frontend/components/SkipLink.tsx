'use client'

import type { MouseEvent } from 'react'
import { useLocale } from '@/components/LocaleProvider'

/**
 * PAN-142 — WCAG 2.4.1 Bypass Blocks. The first focusable element in the
 * shell, so one Tab and Enter skip the whole sidebar.
 *
 * Invisible until focused, then a raised neutral pill over the top-left
 * corner. Neutral on purpose: violet `--here` is location and green is Klup's
 * judgement, and this is neither. The ring is the global `:focus-visible`
 * floor, like every other control.
 *
 * THE TARGET. Every page under `app/(shell)` renders its own `<main>` (their
 * classes differ, so the layout cannot own it) and gives it
 * `id="main-content"`. That id is the contract with this link, so a new shell
 * page must carry it. It is a literal, not an exported constant, because the
 * family page is a server component and a value imported from a client module
 * arrives there as a reference, not a string.
 *
 * WHY `<main>` IS MADE FOCUSABLE HERE AND NOT IN THE PAGES. Following a
 * fragment only scrolls; to move focus, `<main>` needs a tabindex. A permanent
 * `tabIndex={-1}` was the first cut and was measured wrong: the App Router
 * calls `.focus()` on the page's first element after a client-side
 * navigation, which is a no-op on a plain `<main>` and is not on a focusable
 * one. Loading `/search?q=juno-106` then left focus inside `<main>` before the
 * visitor pressed anything, so the first Tab skipped this link along with the
 * sidebar. So the tabindex exists only for the jump and is dropped on blur.
 */
export function SkipLink() {
  const { t } = useLocale()

  function focusMain(event: MouseEvent<HTMLAnchorElement>) {
    const main = document.getElementById('main-content')
    if (!main) return
    event.preventDefault()
    main.setAttribute('tabindex', '-1')
    main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true })
    main.focus()
  }

  return (
    <a
      href="#main-content"
      onClick={focusMain}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:inline-flex focus:items-center focus:min-h-[44px] focus:px-4 focus:rounded-xl focus:border focus:border-line-strong focus:bg-surface-raised focus:shadow-overlay focus:text-sm focus:font-semibold focus:text-ink"
    >
      {t.skipToContent}
    </a>
  )
}
