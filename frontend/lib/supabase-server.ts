import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Cookie-aware Supabase client for Route Handlers and Server Components.
// Reads the auth session from the request cookies so the current user is available.
export function createSupabaseServerClient() {
  const cookieStore = cookies()
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
