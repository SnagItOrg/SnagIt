import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { SkipLink } from '@/components/SkipLink'

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
 * THE WRAPPER IS `min-h-screen md:flex`, and the `md:flex` is load-bearing —
 * this was measured, not reasoned. The nine pages spelled the wrapper five
 * different ways: `bg-bg`, `bg-background`, an inline
 * `background: var(--background)`, with and without `text-foreground`, and six
 * of the nine with `md:flex`. The colour halves really were redundant —
 * `globals.css` already sets `background-color: var(--background)` and
 * `color: var(--foreground)` on `body`.
 *
 * `md:flex` is not. The first cut dropped it on the argument that at `md` the
 * `<aside>` is `position: fixed` and the mobile header is `md:hidden`, so the
 * flex container never has more than one in-flow child — true, and beside the
 * point. The child is `flex-1`, and what it was taking from the flex container
 * was HEIGHT: `align-items: stretch` grows it to the full `min-h-screen`, which
 * is what every `flex-1 items-center` inside it centres against. Without it
 * `/saved`'s signed-out teaser collapsed to its own content height and rose
 * from the middle of the page to the top. A before/after screenshot caught it;
 * a width-and-offset measurement did not.
 *
 * So the flex context is declared once, here, and the three pages that did not
 * previously have one — `/browse`, `/browse/[root]` and `/family/[slug]` —
 * carry `flex-1 min-w-0` on their main column to stay unchanged under it.
 */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:flex">
      <SkipLink />
      <SideNav />
      {children}
      <BottomNav />
    </div>
  )
}
