/**
 * The marketplace a listing came from, as a chip.
 *
 * MOVED OUT OF SearchResultCard, NOT RE-DECLARED. The six brand colours are
 * mandated verbatim by frontend/CLAUDE.md, so they have to live in exactly one
 * place; they previously lived in a module-private `PlatformBadge` inside
 * SearchResultCard, which meant a second surface could only have the chip by
 * copying the palette. The values below are that function's, unchanged.
 *
 * WHY IT TAKES A SOURCE STRING AND NOT A LISTING. The old signature was
 * `{ listing: Listing }`, and `Listing` carries `price`, `price_dkk`,
 * `currency` and `url`. /family/[slug] may render provenance and may never
 * render price evidence (PAN-94), so the badge it uses must not be reachable
 * only through a shape that holds one. A string is the whole input the chip
 * ever read: `listing.platform ?? listing.source`.
 *
 * No 'use client' directive: this is a pure function of its props with no
 * hooks, state or handlers, so a server component renders it on the server and
 * a client component still imports it normally.
 *
 * An unknown or missing source falls through to DBA, which is the behaviour
 * SearchResultCard has always had — dba.dk rows reach it by that path, since
 * `listings.source` stores `dba.dk` rather than `dba`.
 */
export function SourceBadge({
  source,
  variant = 'pill',
}: {
  source: string | null
  variant?: 'pill' | 'overlay'
}) {
  if (variant === 'overlay') {
    const base = 'absolute top-2 left-2 text-xs font-semibold px-2 py-0.5 rounded-full'
    if (source === 'reverb')                     return <span className={`${base} text-white`} style={{ backgroundColor: '#EC5A2C' }}>Reverb</span>
    if (source === 'facebook' || source === 'fb') return <span className={`${base} bg-blue-500 text-white`}>FB</span>
    if (source === 'thomann')                    return <span className={`${base} text-white`} style={{ backgroundColor: '#002D4C' }}>Thomann</span>
    if (source === 'finn')                       return <span className={`${base} text-white`} style={{ backgroundColor: '#06bffc' }}>Finn</span>
    if (source === 'blocket')                    return <span className={`${base} text-white`} style={{ backgroundColor: '#F71414' }}>Blocket</span>
    if (source === 'kleinanzeigen')              return <span className={`${base} text-white`} style={{ backgroundColor: '#1D4B00' }}>KA</span>
    return <span className={`${base} text-white`} style={{ backgroundColor: '#00098A' }}>DBA</span>
  }

  const cls = 'text-xs font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border'
  if (source === 'reverb')                     return <span className={cls}>Reverb</span>
  if (source === 'facebook' || source === 'fb') return <span className={cls}>FB</span>
  if (source === 'thomann')                    return <span className={cls}>Thomann</span>
  if (source === 'finn')                       return <span className={cls}>Finn</span>
  if (source === 'blocket')                    return <span className={cls}>Blocket</span>
  if (source === 'kleinanzeigen')              return <span className={cls}>Kleinanzeigen</span>
  return <span className={cls}>DBA</span>
}
