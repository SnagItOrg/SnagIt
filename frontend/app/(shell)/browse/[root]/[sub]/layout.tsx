import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { cachedCatalogueTree } from '@/lib/browse-cache'
import { displaySubcategorySlug, subcategoryHref } from '@/lib/catalogue-tree'
import { SITE_URL } from '@/lib/site-metadata'

/**
 * PAN-289 — a kind's own page. Under `?sub=` a kind shared the root's
 * canonical and could not rank; as a path it carries its own, and the sitemap
 * lists it.
 *
 * The kind must be a node of the catalogue tree — the tree the sidebar and the
 * sitemap are built from, so a URL this route answers 200 for is one they
 * link. Anything else is a real 404 (the page is a client component, so only
 * this server layout can give the status). A grouped leaf's own slug
 * (`analog-synths`) redirects to its group's path, so one kind has one URL.
 * Unavailability throws from `cachedCatalogueTree`: a 5xx, never a 404.
 */
type Params = { root: string; sub: string }

async function kindNode({ root, sub }: Params) {
  const tree = await cachedCatalogueTree()
  const category = tree.categories.find((c) => c.slug === root)
  const display = displaySubcategorySlug(root, sub)
  const node = category?.subcategories.find((s) => s.slug === display)
  return node ? { display } : null
}

export async function generateMetadata(ctx: { params: Promise<Params> }): Promise<Metadata> {
  const params = await ctx.params
  const node = await kindNode(params)
  if (!node) return {}
  return { alternates: { canonical: `${SITE_URL}${subcategoryHref(params.root, node.display)}` } }
}

export default async function BrowseKindLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<Params>
}) {
  const p = await params
  const node = await kindNode(p)
  if (!node) notFound()
  if (node.display !== p.sub) permanentRedirect(subcategoryHref(p.root, node.display))
  return children
}
