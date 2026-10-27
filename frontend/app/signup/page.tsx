import { redirect } from 'next/navigation'
import { safeNextPath } from '@/lib/safe-next'

/**
 * PAN-300 — retired: signing up and signing in are one flow on `/login`
 * (e-mail, then a 6-digit code), so there is no second door to keep in step.
 * The route stays so old links and bookmarks land somewhere; `next` rides
 * along through the same validator every sign-in surface uses (PAN-187).
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const { next: rawNext } = await searchParams
  const next = safeNextPath(Array.isArray(rawNext) ? rawNext[0] : rawNext)
  redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
}
