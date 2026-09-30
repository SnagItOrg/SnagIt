/**
 * PAN-187 — the `?next=` return path carried through sign-in.
 *
 * Every sign-in surface (the middleware gate, /login, /signup, /auth/confirm,
 * /auth/callback) reads `next` through this one function, so there is one
 * place that decides what counts as a safe destination.
 *
 * Only a same-origin relative path is accepted. Anything that could leave the
 * site — `//evil.com`, `https://evil.com`, `/\evil.com`, their percent-encoded
 * forms, or a path smuggling a tab or newline that a URL parser strips — is
 * rejected, and the caller falls back to its own default. The final check
 * resolves the candidate with the same WHATWG parser the browser will use and
 * requires the origin to be unchanged, so a parser quirk cannot slip past the
 * string checks.
 *
 * NO IMPORTS: this runs in the Edge middleware and in a plain Node test.
 */

const PROBE_ORIGIN = 'http://klup.invalid'

/** Sign-in pages themselves are never a destination: that only loops. */
function isAuthPage(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/auth' ||
    pathname.startsWith('/auth/')
  )
}

/**
 * The validated path (`/admin?x=1`), or `null` when `raw` is missing or unsafe.
 * `raw` is the already-decoded query value, as `URLSearchParams.get` returns it.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  // Browsers treat `\` as `/`, and strip tab/CR/LF before parsing.
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null

  let url: URL
  try {
    url = new URL(raw, PROBE_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== PROBE_ORIGIN) return null
  if (isAuthPage(url.pathname)) return null

  return url.pathname + url.search + url.hash
}
