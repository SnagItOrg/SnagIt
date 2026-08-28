import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requiresAdmin, requiresAuth } from '@/lib/route-access'
import { familyRedirectTarget } from '@/lib/families'

// Per-IP rate limit for /api/scrape only. The route is unauthenticated and
// performs DB writes, so any caller can otherwise drive scraper + DB load by
// varying ?q= (which bypasses Vercel's edge cache). In-memory map per Edge
// instance is intentional — at our traffic an external store is overkill.
const SCRAPE_RATE_WINDOW_MS = 60_000
const SCRAPE_RATE_MAX       = 20
const scrapeRateLimit = new Map<string, { count: number; resetAt: number }>()

function clientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}

function scrapeRateAllowed(ip: string): boolean {
  const now = Date.now()
  // Opportunistic GC so the map can't grow unbounded on a long-lived Edge instance.
  if (scrapeRateLimit.size > 10_000) {
    scrapeRateLimit.forEach((v, k) => {
      if (now > v.resetAt) scrapeRateLimit.delete(k)
    })
  }
  const entry = scrapeRateLimit.get(ip)
  if (!entry || now > entry.resetAt) {
    scrapeRateLimit.set(ip, { count: 1, resetAt: now + SCRAPE_RATE_WINDOW_MS })
    return true
  }
  if (entry.count >= SCRAPE_RATE_MAX) return false
  entry.count++
  return true
}

// Route posture is derived from ONE authority, lib/route-access.ts, which is
// consumed by this file AND by scripts/lib/wp1-route-access.test.ts. The prefix
// arrays that used to live here are gone: two lists is how a runtime posture
// and its test drift apart.
//
// Denial is an explicit classification; everything else passes through to
// Next.js routing, so an unknown path reaches app/not-found.tsx and returns a
// real 404 instead of 307 -> /login. The hazard that creates — a new route is
// public unless classified — is caught by the completeness guard, which fails
// on any routable file with no entry. See the build plan §7.7.

function isOnboardingPath(pathname: string): boolean {
  return pathname === '/onboarding' || pathname.startsWith('/onboarding/')
}

export async function middleware(request: NextRequest) {
  // Rate-limit gate runs before Supabase auth so abusive callers don't load
  // the auth client. Scoped to /api/scrape — every other route is unaffected.
  if (request.nextUrl.pathname === '/api/scrape') {
    if (!scrapeRateAllowed(clientIp(request))) {
      return NextResponse.json(
        { error: 'rate_limit', retry_after: 60 },
        { status: 429, headers: { 'Retry-After': '60' } },
      )
    }
  }

  // Stage 3 WP-2 (bounded edit): the six legacy family-label rows 308 to their
  // navigation route. They are public kg_product rows that behave as priced
  // products today, aggregating listings across variants whose markets differ
  // by more than 3x. They are not canonical products, so without this they
  // would 404 at the eligibility gate.
  //
  // Ahead of the auth client on purpose: a permanent redirect is not a
  // permissions decision and must not depend on a session lookup.
  //
  // The map is derived from lib/families.ts, never restated here, so it cannot
  // drift from the routes it points at. app/product/[slug]/layout.tsx applies
  // the same rule from the same module as defence in depth.
  const familyTarget = familyRedirectTarget(request.nextUrl.pathname)
  if (familyTarget) {
    return NextResponse.redirect(new URL(familyTarget, request.url), 308)
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // IMPORTANT: do not add any logic between createServerClient and getUser()
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Stage 3 WP-1: the logged-in / -> /watchlists redirect is REMOVED. It meant a
  // returning user never saw product-centred discovery — the catalogue is the
  // product, and the homepage is where it starts. See §6 of the build plan.

  // Logged-in users on /login or /signup → search
  if (user && (pathname === '/login' || pathname === '/signup')) {
    return NextResponse.redirect(new URL('/search', request.url))
  }

  // Logged-in users are bounced out of the retired onboarding flow → the
  // catalogue. Steps 1-3 also redirect at the page level, for every visitor.
  if (user && isOnboardingPath(pathname)) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Admin and /intel surfaces: a session AND user_preferences.is_admin.
  //
  // Driven by the route-access authority, not by pathname.startsWith('/admin').
  // The prefix form also caught paths like /admin-not-really, which is not a
  // route at all — it answered 307 where the honest answer is 404, and it was
  // the last place the middleware kept an opinion the authority did not share.
  if (requiresAdmin(pathname)) {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    )
    const { data: prefs } = await admin
      .from('user_preferences')
      .select('is_admin')
      .eq('user_id', user.id)
      .single()
    if (!prefs?.is_admin) {
      // /admin sent non-admins to /, /intel sent them to /login. Both now go
      // to /, which is a real destination for a signed-in non-admin.
      return NextResponse.redirect(new URL('/', request.url))
    }
    return supabaseResponse
  }

  // Unauthenticated users on a route classified as requiring a session.
  // Everything else falls through to Next.js routing.
  if (!user && requiresAuth(pathname)) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Run on all routes except Next.js internals, static assets and the
    // crawler-facing files, which must never be auth-gated.
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
