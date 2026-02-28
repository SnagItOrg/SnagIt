import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const token_hash = searchParams.get('token_hash')
  const type       = searchParams.get('type') as EmailOtpType | null
  const code       = searchParams.get('code')

  const successUrl = new URL('/watchlists?create_pending=1', request.url)
  const errorUrl   = new URL('/login?error=auth', request.url)

  // Helper to build a supabase client that writes session cookies onto `response`
  function makeClient(response: NextResponse) {
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value)
              response.cookies.set(name, value, options)
            })
          },
        },
      },
    )
  }

  // PKCE code flow (default Supabase magic-link with emailRedirectTo)
  if (code) {
    const response = NextResponse.redirect(successUrl)
    const { error } = await makeClient(response).auth.exchangeCodeForSession(code)
    if (!error) return response
  }

  // token_hash flow (custom email template with {{ .TokenHash }})
  if (token_hash && type) {
    const response = NextResponse.redirect(successUrl)
    const { error } = await makeClient(response).auth.verifyOtp({ type, token_hash })
    if (!error) return response
  }

  return NextResponse.redirect(errorUrl)
}
