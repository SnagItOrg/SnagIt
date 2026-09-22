import { Suspense } from 'react'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  buildDiscoverResponse,
  DISCOVER_LEGENDARY_LIMIT,
  DISCOVER_POPULAR_LIMIT,
} from '@/lib/browse'
import { isCatalogueUnavailable } from '@/lib/catalogue'
import { LandingShell } from '@/components/LandingShell'
import { DiscoverShelves } from '@/components/DiscoverShelves'
import { CategoryShelf } from '@/components/CategoryShelf'

/**
 * NEVER PRERENDERED, NEVER CACHED — for the same reason /api/discover is not.
 *
 * PAN-68 moved the shelf data from a browser fetch onto the server, which moves
 * the depublication hazard with it. This page has no dynamic inputs of its own,
 * so Next would otherwise prerender it at build time and bake a catalogue into
 * .next/server/app/index.html — and that HTML would then survive every
 * depublish until the next deploy. That is exactly the failure the route
 * handler's own header describes.
 *
 * Eligibility is a correctness boundary, so it is resolved per request:
 *   - `force-dynamic` stops build-time prerendering;
 *   - `revalidate = 0` stops the full-route data cache;
 *   - `fetchCache` stops the Supabase client's fetches being cached underneath;
 *   - lib/catalogue.ts holds no memo, so the supported set is re-read too.
 * A withdrawal is visible on the NEXT request — no revalidation window exists
 * for one to linger in.
 *
 * THE COST, STATED PLAINLY: `/` was a static prerender and therefore a CDN HIT
 * (measured 96 ms TTFB). A per-request page cannot be. Next 14.2 has no
 * partial prerendering, so there is no way to keep a cached shell AND a
 * per-request catalogue; the shell is instead flushed ahead of the data by the
 * <Suspense> boundary below. Correctness was the tiebreak: a stale shelf is
 * wrong for as long as it is cached, and a depublished product is the one thing
 * the homepage must never show.
 *
 * PAN-86 ASKED WHETHER THE CATEGORY CARDS COULD ESCAPE THAT. They cannot, and
 * the reason is the count rather than the category. A category carries no
 * depublication hazard — its name, slug and image change about never — but the
 * card prints `product_count`, and that number is the size of the public
 * supported row set. Depublish a product and the count is wrong by one, which
 * is the same failure as a stale shelf wearing a smaller hat. Caching the
 * taxonomy read ALONE is sound, and is also not worth doing: measured against
 * production it is 6.9 ms over 340 rows with every buffer already resident,
 * and it runs inside the same Promise.all as the row set it accompanies, so it
 * costs nothing that a cache could give back. The route stays per-request.
 *
 * Measured on production before this change: TTFB 0.24-0.51 s over five warm
 * requests, `x-vercel-cache: MISS` every time, 104 KB of HTML that gzips to
 * 8.3 KB on the wire.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

/**
 * Mirrors /api/discover's failure contract. The homepage degrades to no
 * shelves rather than failing outright — which is what the browser fetch did
 * too, since it read `d.legendary ?? []` off a 500 or a 503 body. An
 * unreadable catalogue stays an operational fact, so it keeps the one log line
 * the route emitted; nothing about a visitor is logged.
 */
async function readShelves() {
  try {
    return await buildDiscoverResponse(getSupabaseAdmin())
  } catch (error) {
    if (isCatalogueUnavailable(error)) {
      console.error('[operational] discover eligibility unavailable', {
        route: '/',
        stage: error.stage,
      })
    }
    return { legendary: [], popular: [], categories: [] }
  }
}

async function Shelves() {
  const { legendary, popular, categories } = await readShelves()
  return (
    <>
      <DiscoverShelves legendary={legendary} popular={popular} />
      <CategoryShelf categories={categories} />
    </>
  )
}

/**
 * One shelf's worth of placeholder. Deliberately not a client component and
 * deliberately text-free: it needs no locale, and a grey row makes no claim
 * about what is arriving.
 *
 * PAN-104 — A SHORT STRIP STAYS LEFT-ALIGNED, AND THEREFORE HAS TO BE LONG.
 * A horizontal shelf reads from its left edge and scrolls from it, so centring
 * the strip would move the first card off the reading origin and trade a gap on
 * the right for one on the left, and growing the cards to fill would abandon
 * the single card width `DiscoverShelves` and this placeholder share. Left is
 * the deliberate answer; what the strip owes the viewport is simply to run past
 * its right edge, so that the affordance at the margin is a cut-off card rather
 * than empty canvas.
 *
 * `cards` is therefore the shelf's own cap and never a guess. At six — measured
 * at 1440px, light and dark — the strip ended 204px short and the loading state
 * showed a band of bare background down its right-hand side that the loaded
 * shelf never has. The cap makes the placeholder at least as wide as whatever
 * replaces it, at every viewport.
 *
 * `overflow-x-auto` matches the live shelf too. It used to be `hidden`, so the
 * two boxes clipped and scrolled differently across the swap.
 */
function ShelfFallback({ cards }: { cards: number }) {
  return (
    <section className="mb-10" aria-hidden="true">
      <div className="px-6 mb-4 flex items-baseline gap-3">
        <div className="h-6 w-48 rounded-md" style={{ backgroundColor: 'var(--secondary)' }} />
      </div>
      <div className="flex gap-3 overflow-x-auto px-6 pb-2 scrollbar-none">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-[clamp(9.5rem,38vw,12rem)]">
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--card)' }}>
              <div className="w-full aspect-[4/3]" style={{ backgroundColor: 'var(--secondary)' }} />
              <div className="p-3 flex flex-col gap-1.5">
                <div className="h-3.5 w-3/4 rounded" style={{ backgroundColor: 'var(--secondary)' }} />
                <div className="h-3 w-1/2 rounded" style={{ backgroundColor: 'var(--secondary)' }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * TWO SHELVES, BECAUSE TWO SHELVES ARRIVE. One placeholder section stood in for
 * both, so the footer sat at y=848 in a 900px viewport and then dropped to
 * y=2100 when the shelves resolved — a measured layout shift of 0.050 at 1440px
 * and 0.058 at 768px and 360px, all of it that one jump.
 *
 * The category shelf below them is deliberately NOT mirrored. Its height is a
 * row count over the taxonomy rather than a constant, so a placeholder for it
 * would be exactly the guess this change removes; two shelves already carry the
 * footer past the fold, which is what the shift was made of.
 */
function ShelvesFallback() {
  return (
    <>
      <ShelfFallback cards={DISCOVER_LEGENDARY_LIMIT} />
      <ShelfFallback cards={DISCOVER_POPULAR_LIMIT} />
    </>
  )
}

export default function LandingPage() {
  return (
    <LandingShell>
      <Suspense fallback={<ShelvesFallback />}>
        <Shelves />
      </Suspense>
    </LandingShell>
  )
}
