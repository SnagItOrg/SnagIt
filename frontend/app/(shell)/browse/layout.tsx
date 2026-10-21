import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/site-metadata'

/**
 * PAN-288. /browse is a client page and set no metadata, so it inherited the
 * site's `canonical: '/'` and told a crawler it was a copy of the home page —
 * which would contradict its own sitemap entry. The canonical is all this
 * layout adds; /browse/[root] overrides it with its own.
 */
export const metadata: Metadata = {
  alternates: { canonical: `${SITE_URL}/browse` },
}

export default function BrowseLayout({ children }: { children: React.ReactNode }) {
  return children
}
