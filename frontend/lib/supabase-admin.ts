import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

// Server-only admin client (service role key — bypasses RLS)
// NEVER import this in client components or expose to the browser
export function getSupabaseAdmin(): SupabaseClient {
  if (_client) return _client

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase admin environment variables.')
  }

  _client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  return _client
}
