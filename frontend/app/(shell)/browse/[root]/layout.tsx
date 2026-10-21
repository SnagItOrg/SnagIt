import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/site-metadata'

/**
 * PAN-288. The root's own canonical, for the same reason as browse/layout.tsx.
 * `?sub=` and the facet chips are filters of this page, so they share it.
 */
export async function generateMetadata(
  ctx: { params: Promise<{ root: string }> },
): Promise<Metadata> {
  const { root } = await ctx.params
  return { alternates: { canonical: `${SITE_URL}/browse/${root}` } }
}

export default function BrowseRootLayout({ children }: { children: React.ReactNode }) {
  return children
}
