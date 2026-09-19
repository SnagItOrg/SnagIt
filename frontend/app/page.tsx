import { Suspense } from 'react'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { buildDiscoverResponse } from '@/lib/browse'
import { isCatalogueUnavailable } from '@/lib/catalogue'
import { LandingShell } from '@/components/LandingShell'
import { DiscoverShelves } from '@/components/DiscoverShelves'

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
    return { legendary: [], popular: [] }
  }
}

async function Shelves() {
  const { legendary, popular } = await readShelves()
  return <DiscoverShelves legendary={legendary} popular={popular} />
}

/**
 * The placeholder that holds the shelf's space while it streams. Deliberately
 * not a client component and deliberately text-free: it needs no locale, and a
 * grey row makes no claim about what is arriving.
 */
function ShelvesFallback() {
  return (
    <section className="mb-10" aria-hidden="true">
      <div className="px-6 mb-4 flex items-baseline gap-3">
        <div className="h-6 w-48 rounded-md" style={{ backgroundColor: 'var(--secondary)' }} />
      </div>
      <div className="flex gap-3 overflow-x-hidden px-6 pb-2">
        {Array.from({ length: 6 }).map((_, i) => (
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

export default function LandingPage() {
  return (
    <LandingShell>
      <Suspense fallback={<ShelvesFallback />}>
        <Shelves />
      </Suspense>
    </LandingShell>
  )
}
