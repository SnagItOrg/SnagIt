import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

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

  // Logged-in users are bounced out of the onboarding flow → watchlists
  if (user && isOnboardingPath(pathname)) {
    return NextResponse.redirect(new URL('/watchlists', request.url))
  }

  // Unauthenticated users on protected routes → /
  if (!user && !isPublicPath(pathname)) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Run on all routes except Next.js internals and static assets
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
