import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Cookie-aware Supabase client for Route Handlers and Server Components.
// Reads the auth session from the request cookies so the current user is available.
//
// ASYNC SINCE NEXT 15, where `cookies()` returns a Promise. This function awaits
// it and is therefore async itself, so every caller must await the client.
// Next also offers an `UnsafeUnwrappedCookies` cast that would keep this
// signature synchronous. It is deliberately not used: it preserves a sync API
// over a request store the framework already resolves asynchronously, which
// turns a compile-time migration into a runtime failure later.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // setAll throws in Server Components; safe to ignore in Route Handlers
          }
        },
      },
    },
  )
}
