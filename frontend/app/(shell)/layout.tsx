import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'

/**
 * PAN-131 — the application shell. The sidebar mounts HERE, once.
 *
 * THE DEFECT THIS EXISTS TO REMOVE. `SideNav` was rendered by nine page
 * components and there was no shell layout. In the App Router a page unmounts
 * on every route change and a layout does not, so every single click destroyed
 * the sidebar and built a new one: the expanded branch, the resized width, the
 * scroll position and the `aria-current` mark all went, and the catalogue
 * effect re-fired `fetch('/api/catalogue-tree')` over the network. The tree
 * then rendered *nothing* while that ran. A visitor clicking through the
 * catalogue watched the road signs disappear and reappear at every corner,
 * which is a trust problem long before it is a performance one.
 *
 * WHY A ROUTE GROUP AND NOT THE ROOT LAYOUT. `app/layout.tsx` wraps every
 * route, including `/`, `/login`, `/signup`, `/auth/*`, `/onboarding/*`,
 * `/privatliv`, `/admin/*` and `/intel` — none of which has ever shown this
 * chrome, and the last two must not. A parenthesised segment is the mechanism
 * the framework provides for "a layout over some siblings but not others", and
 * it contributes NO URL segment: every one of the nine routes below is
 * byte-identical before and after.
 *
 * That property is load-bearing enough that the codebase already assumed it in
 * two places, written before any route group existed. `stripNonUrlSegments()`
 * in `lib/route-access.ts` drops `(…)` segments so the runtime posture matcher
 * reads the URL the group produces, and `dirToRoute()` in the §7.7
 * completeness guard drops them so the filesystem inventory agrees. The
 * classification of all nine routes is therefore untouched, and so is
 * `middleware.ts`.
 *
 * `app/(shell)/product/[slug]/layout.tsx` — the server-side eligibility gate —
 * MOVED WITH ITS SEGMENT AND IS OTHERWISE UNCHANGED. It nests inside this one,
 * so it still runs on the server before the client page mounts, and its
 * `notFound()` still resolves to `app/not-found.tsx`, which sits above this
 * layout and so renders without the shell exactly as it did before.
 *
 * WHAT THIS LAYOUT DELIBERATELY DOES NOT OWN. `MobileSearchBar` stays in the
 * six pages that render it. It is page content rather than chrome — it lives
 * inside `<main>` and scrolls away — and the three routes that omit it include
 * `/search`, which omits it because it already *is* a search page. Hoisting it
 * would hand a search field to three routes that never had one, which is a
 * product decision and not this ticket's.
 *
 * The wrapper is `min-h-screen` and nothing else. The nine pages spelled this
 * five different ways — `bg-bg`, `bg-background`, an inline
 * `background: var(--background)`, with and without `text-foreground` — and
 * every one of those was already redundant, because `globals.css` sets both
 * `background-color: var(--background)` and `color: var(--foreground)` on
 * `body`. The `md:flex` that six of them carried was a no-op too: at `md` the
 * `<aside>` is `position: fixed` and the mobile header is `md:hidden`, so the
 * flex container never had more than one in-flow child.
 */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <SideNav />
      {children}
      <BottomNav />
    </div>
  )
}
