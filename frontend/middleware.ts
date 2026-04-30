import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

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
    for (const [k, v] of scrapeRateLimit) {
      if (now > v.resetAt) scrapeRateLimit.delete(k)
    }
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

// Paths that do not require authentication.
const PUBLIC_PREFIXES = [
  '/login',
  '/signup',
  '/search',        // public SERP
  '/auth/',         // OAuth + email confirmation callbacks
  '/onboarding/',   // anonymous-first onboarding flow
  '/api/brands',    // public lookup used by onboarding
  '/api/scrape',    // needed by public SERP
  '/api/price-observations', // price stats shown on public SERP cards
  '/api/cron/',     // cron jobs use their own CRON_SECRET header
  '/api/webhooks/', // Supabase webhooks — no user session available
]

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true
  if (pathname === '/watchlists') return true  // shows teaser for unauthenticated
  if (pathname === '/saved') return true        // shows teaser for unauthenticated
  if (pathname === '/onboarding') return true
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

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

  // Logged-in users on / → watchlists
  if (user && pathname === '/') {
    return NextResponse.redirect(new URL('/watchlists', request.url))
  }

  // Logged-in users on /login or /signup → search
  if (user && (pathname === '/login' || pathname === '/signup')) {
    return NextResponse.redirect(new URL('/search', request.url))
  }

  // Logged-in users are bounced out of the onboarding flow → watchlists
  if (user && isOnboardingPath(pathname)) {
    return NextResponse.redirect(new URL('/watchlists', request.url))
  }

  // Admin routes: must be authenticated + is_admin on user_preferences
  if (pathname.startsWith('/admin')) {
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
      return NextResponse.redirect(new URL('/', request.url))
    }
    return supabaseResponse
  }

  // Unauthenticated users on protected routes → /login
  if (!user && !isPublicPath(pathname)) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Run on all routes except Next.js internals and static assets
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
