import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/site-metadata'

/**
 * PAN-288. The root's own canonical, for the same reason as browse/layout.tsx.
 * The attribute facet chips are filters of this page, so they share it; a kind
 * is a page of its own since PAN-289 (`[sub]/layout.tsx`).
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
