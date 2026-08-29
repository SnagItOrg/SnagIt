import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { CatalogueUnavailableError } from '@/lib/catalogue'
import {
  buildFamilyView,
  getFamily,
  type FamilyChildRow,
  type FamilyView,
} from '@/lib/families'
import { translations } from '@/lib/i18n'
import { SITE_URL } from '@/lib/site-metadata'

/**
 * Navigation-family route.
 *
 * Stage 3 V1, WP-2. See docs/stage-3-v1-decision-and-build-plan.md §4.1–§4.2.
 *
 * WHAT THIS PAGE IS. A directory, and nothing else. A family groups products
 * whose markets differ by more than 3x (klup-launch-catalogue-selection.md
 * §6.1), so it must never present one price for all of them. That is enforced
 * structurally, not by a flag: this file imports no price module, computes no
 * band, loads no listing, and lib/families.ts has no field that could carry a
 * price, a listing or a count. There is no code path here that could aggregate.
 *
 * WHY IT IS A SERVER COMPONENT. `robots` and the canonical URL have to be part
 * of the document a crawler receives, and the indexability rule below is data,
 * not configuration — it has to be resolved per request. `force-dynamic` plus
 * `revalidate = 0` is what makes §4.2 rule 4 true: publishing a child lifts
 * `noindex` on the next request, with no code change and no deploy.
 *
 * WHY IT RENDERS DANISH FROM `translations.da` RATHER THAN `useLocale()`.
 * useLocale() is a client hook backed by localStorage; using it would make this
 * a client component and put the robots directive out of reach of the initial
 * response. `da` is the SSR default and what a crawler sees. lib/i18n.ts is
 * WP-1-owned and read-only here (§15.7).
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

const t = translations.da

/**
 * Load the family and decide which children may be rendered.
 *
 * `cache()` dedupes the lookup between generateMetadata and the component, so
 * one request makes one query and the robots directive and the rendered body
 * can never be computed from two different reads.
 *
 * FAILURE MODEL (§7.2). Absence is 404: an unknown slug is not a family and
 * never will be. Unavailability is a throw: if the database cannot answer, we
 * must not render "this family has no public variants" — that sentence would be
 * a lie a crawler could cache. The throw reaches app/family/[slug]/error.tsx.
 */
const loadFamilyView = cache(async (slug: string): Promise<FamilyView | null> => {
  const family = getFamily(slug)
  if (!family) return null

  // A family with no configured children needs no query at all. Two of the six
  // are in this state (fender-jazz-bass, fender-precision-bass): the reviewed
  // config already says there is nothing to resolve.
  if (family.children.length === 0) return buildFamilyView(family, [])

  const admin = getSupabaseAdmin()

  const [productsRes, projectionRes] = await Promise.all([
    admin
      .from('kg_product')
      .select('slug, canonical_name, status, support_state, browse_visibility')
      .in('slug', family.children),
    admin
      .from('browse_product_projection')
      .select('slug, browse_domain')
      .in('slug', family.children),
  ]).catch(() => {
    throw new CatalogueUnavailableError('family_children_transport')
  })

  if (productsRes.error) throw new CatalogueUnavailableError('family_children_lookup')
  if (projectionRes.error) throw new CatalogueUnavailableError('family_projection_lookup')

  const domainBySlug = new Map<string, string | null>()
  for (const raw of (projectionRes.data ?? []) as Array<Record<string, unknown>>) {
    if (typeof raw.slug === 'string') {
      domainBySlug.set(raw.slug, (raw.browse_domain as string | null) ?? null)
    }
  }

  const rows: FamilyChildRow[] = ((productsRes.data ?? []) as Array<Record<string, unknown>>)
    .filter((raw): raw is Record<string, unknown> => typeof raw?.slug === 'string')
    .map((raw) => ({
      slug: raw.slug as string,
      canonical_name: (raw.canonical_name as string | null) ?? null,
      status: (raw.status as string | null) ?? null,
      support_state: (raw.support_state as string | null) ?? null,
      browse_visibility: (raw.browse_visibility as string | null) ?? null,
      browse_domain: domainBySlug.get(raw.slug as string) ?? null,
    }))

  return buildFamilyView(family, rows)
})

/**
 * ONE THRESHOLD DRIVES INDEXABILITY (§4.2 rules 2 and 4).
 *
 * While a family has zero canonical children it is `noindex,follow`: the six
 * legacy /product URLs 308 here, so the URL must remain a valid redirect target,
 * but an empty directory must not be offered to a crawler as catalogue depth.
 * `follow` is deliberate — the only outbound link is /browse, which is exactly
 * where a crawler should go next.
 */
export async function generateMetadata(
  { params }: { params: { slug: string } },
): Promise<Metadata> {
  const view = await loadFamilyView(params.slug)
  if (!view) return { title: t.notFoundHeading, robots: { index: false, follow: false } }

  return {
    title: view.family.label,
    description: `${view.family.label} — ${t.familyWhyNotOnePrice}`,
    alternates: { canonical: `${SITE_URL}/family/${view.family.slug}` },
    robots: { index: view.published, follow: true },
  }
}

export default async function FamilyPage({ params }: { params: { slug: string } }) {
  const view = await loadFamilyView(params.slug)
  if (!view) notFound()

  const { family, children } = view

  return (
    <main
      className="min-h-screen px-6 py-16 md:px-10"
      style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col">
        <p className="type-label">
          {family.brand}
        </p>

        <h1 className="type-title mt-2">
          {family.label}
        </h1>

        {/*
          The sentence that IS the product thesis. A family page exists to say
          that these are separate markets — not to soften the fact that Klup
          declines to average them.
        */}
        <p className="mt-6 text-base leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
          {t.familyWhyNotOnePrice}
        </p>

        {children.length > 0 ? (
          <section className="mt-10 flex flex-col gap-2">
            {/*
              Canonical-eligible children only. A child that is not canonical is
              absent — no greyed card, no name, no "coming soon". Anything else
              would advertise a URL that returns 404 and would put private
              catalogue state on a public page.
            */}
            {children.map((child) => (
              <Link
                key={child.slug}
                href={`/product/${child.slug}`}
                className="rounded-2xl px-5 py-4 text-base font-semibold transition-opacity hover:opacity-80"
                style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
              >
                {child.label}
              </Link>
            ))}
          </section>
        ) : (
          <p className="mt-4 text-base leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
            {family.children.length > 0 ? t.familyNoPublicChildren : t.familyNoSupportedChildren}
          </p>
        )}

        {/*
          Demand capture (§8.5), on the empty state only — once a family has a
          public child, the useful action is to read that child's page.

          It is a GET form to the resolver, pre-filled with the family term and
          carrying `demand=family:<slug>`. WP-4 must honour that marker: a query
          arriving WITH it is a demand submission and emits `search_unsupported`
          + `demand_signal_submitted`; without it, the same term resolves to this
          family and 302s back here. Submitting demand must never bounce the
          visitor to the page they submitted it from. Recorded as a bounded
          integration requirement in the WP-2 hand-off.

          No email field, no analytics call: lib/analytics.ts is WP-5-owned and
          the consent boundary deploys at R2. WP-2 emits nothing.
        */}
        {children.length === 0 && (
          <form action="/search" method="get" className="mt-8 flex flex-col gap-3" data-demand-control="family">
            <input type="hidden" name="demand" value={`family:${family.slug}`} />
            <label className="flex flex-col gap-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
              {t.searchNotFollowedBody}
              <input
                type="text"
                name="q"
                defaultValue={family.label}
                className="rounded-2xl px-4 py-3 text-base outline-none"
                style={{
                  backgroundColor: 'var(--input-background)',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                }}
              />
            </label>
            <button
              type="submit"
              className="self-start rounded-2xl px-6 py-3 text-base font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {t.demandCta}
            </button>
          </form>
        )}

        <Link
          href="/browse"
          className="mt-12 self-start text-base underline underline-offset-4"
          style={{ color: 'var(--foreground)' }}
        >
          {t.familyBackToCatalogue}
        </Link>
      </div>
    </main>
  )
}
