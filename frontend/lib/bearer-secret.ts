import { timingSafeEqual } from 'node:crypto'

/**
 * PAN-298, finding 6: a machine secret compared in constant time.
 *
 * `header !== \`Bearer ${secret}\`` returns at the first differing byte, so the
 * response time leaks how much of a guess was right. `timingSafeEqual` does
 * not, but it throws on unequal lengths, so the length is checked first; that
 * reveals only the secret's length.
 *
 * An unset or empty secret never matches. The routes already answer 503 before
 * they get here; this keeps the helper fail-closed on its own.
 */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || header === null) return false
  const got = Buffer.from(header)
  const want = Buffer.from(`Bearer ${secret}`)
  return got.length === want.length && timingSafeEqual(got, want)
}
