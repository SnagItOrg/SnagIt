import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { CatalogueUnavailableError } from '@/lib/catalogue'
import { fetchAllPages } from '@/lib/exhaustive-fetch'
import {
  buildFamilyView,
  getFamily,
  type FamilyChildRow,
  type FamilyListingRow,
  type FamilyView,
} from '@/lib/families'
import { translations, fill } from '@/lib/i18n'
import { SITE_URL } from '@/lib/site-metadata'

/**
 * Navigation-family route.
 *
 * Stage 3 V1, WP-2. See docs/stage-3-v1-decision-and-build-plan.md §4.1–§4.2.
 *
 * WHAT THIS PAGE IS. A directory of models, and — since PAN-94 — of what is on
 * the market under them. A family groups products whose markets differ by more
 * than 3x (klup-launch-catalogue-selection.md §6.1), so it must never present
 * one price for all of them.
 *
 * THE LISTING HALF AND THE PRICE HALF ARE ENFORCED DIFFERENTLY. Listings are a
 * feature: one query, and the count is the length of its result. Price is
 * structural: this file imports no price module, computes no band, and the
 * `listings` embed below selects `id, title, source, is_active` — no `price`,
 * no `price_dkk`, no `currency`. A price is not filtered out here, it is never
 * read, and `FamilyListing` has no field one could be written into.
 *
 * IT DOES NOT READ THE BROWSE PROJECTION'S PRE-AGGREGATED ACTIVE-LISTING COUNT
 * — the column is named in the test that forbids it, not here, so the guard
 * stays a substring scan. That is the defect PAN-94 closes rather than an
 * omission: the column counts every
 * `listing_product_match` row against an active listing, INCLUDING matches an
 * operator or the AI pass has adjudicated wrong (`is_valid = false`), which no
 * page renders. Measured on the four `rhodes` children, 2026-09-20: the
 * projection says 40, the four product pages render 39, and the family holds 37
 * distinct listings because two are matched to two children each. Three numbers
 * for one question. The page now publishes only the third, and it publishes it
 * by counting the rows it is about to render.
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
      // `id` is the join key for the listing read below and is never rendered:
      // `RenderableChild` and `FamilyListing` carry no database identifier.
      .select('id, slug, canonical_name, status, support_state, browse_visibility')
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
      id: (raw.id as string | null) ?? null,
      slug: raw.slug as string,
      canonical_name: (raw.canonical_name as string | null) ?? null,
      status: (raw.status as string | null) ?? null,
      support_state: (raw.support_state as string | null) ?? null,
      browse_visibility: (raw.browse_visibility as string | null) ?? null,
      browse_domain: domainBySlug.get(raw.slug as string) ?? null,
    }))

  /*
    ELIGIBILITY FIRST, LISTINGS SECOND — and only for children this view has
    already admitted. The listing read is scoped to the ids of the canonical
    children, so a `qa_only` child's matches are never loaded at all: private
    catalogue state does not enter the process merely to be filtered out of the
    response. `fender-jazz-bass` and `fender-precision-bass` have no children
    configured at all, so for those this returns here and costs no third query.
  */
  const eligibility = buildFamilyView(family, rows)
  const idBySlug = new Map(rows.map((row) => [row.slug, row.id]))
  const childIds = eligibility.children
    .map((child) => idBySlug.get(child.slug))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  if (childIds.length === 0) return eligibility

  /*
    ONE QUERY IS THE WHOLE FIX. The count the page prints is the length of this
    result, so there is no second read for it to disagree with — and no
    `.limit()`, because a capped list under an uncapped count is the same defect
    wearing a different number. `fetchAllPages` reads to exhaustion on the
    unique `id` order; the widest family today is `gibson-les-paul` at 261 rows,
    still one page. If a family ever grows past a readable page, the answer is
    paging that moves the COUNT with the rows — never a silent cap.

    `.not('is_valid','is',false)` keeps NULL and true and drops only the
    explicit rejection, exactly as /api/product does — so a match adjudicated
    wrong cannot be counted here while the product page declines to render it.
  */
  const listingRows = await fetchAllPages(
    async (from, to) => {
      // A transport-level rejection never reaches the `{ data, error }` shape,
      // so the await itself is wrapped — same failure model as the two reads
      // above: unavailability is a throw, never an empty family.
      const res = await admin
        .from('listing_product_match')
        .select('id, product_id, is_valid, listings(id, title, source, is_active)')
        .in('product_id', childIds)
        .not('is_valid', 'is', false)
        .order('id', { ascending: true })
        .range(from, to)
        .then(
          (r) => r,
          () => {
            throw new CatalogueUnavailableError('family_listings_transport')
          },
        )
      if (res.error) throw new CatalogueUnavailableError('family_listings_lookup')
      return (res.data ?? []) as unknown as Array<{ id: string } & FamilyListingRow>
    },
    (row) => row.id,
  )

  // Re-derived from the SAME rows, so the children cannot differ between the two
  // calls; the second call only adds the listings those children own.
  return buildFamilyView(family, rows, listingRows.rows)
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
  ctx: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const params = await ctx.params
  const view = await loadFamilyView(params.slug)
  if (!view) return { title: t.notFoundHeading, robots: { index: false, follow: false } }

  return {
    title: view.family.label,
    description: `${view.family.label} — ${t.familyWhyNotOnePrice}`,
    alternates: { canonical: `${SITE_URL}/family/${view.family.slug}` },
    robots: { index: view.published, follow: true },
  }
}

export default async function FamilyPage(ctx: { params: Promise<{ slug: string }> }) {
  const params = await ctx.params
  const view = await loadFamilyView(params.slug)
  if (!view) notFound()

  const { family, children, listings } = view

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
          ── The market under this family (PAN-94) ──────────────
          The count is `listings.length`: the number printed and the rows
          printed under it are the same array, so no read can disagree with
          another. Rendered only where there is a model to attribute a listing
          to — a family with no canonical child shows the demand form instead.

          EACH ROW IS A NAVIGATION ROW, NOT A MARKETPLACE ROW. It carries the
          seller's title, the source it came from, and the model it is matched
          to — and the only link is INTO that model's page, where the market is
          one market and Klup can answer the price question. There is no price
          on this surface and no link that leaves for a marketplace carrying
          none, because either would turn "too broad to combine" into a price
          list the visitor combines themselves.
        */}
        {children.length > 0 && (
          <section className="mt-10 flex flex-col gap-2">
            <p className="type-label" style={{ color: 'var(--muted-foreground)' }}>
              {listings.length > 0
                ? fill(t.familyListingsCount, { count: listings.length })
                : t.familyNoListings}
            </p>

            {listings.map((listing) => (
              <Link
                key={listing.id}
                href={`/product/${listing.childSlug}`}
                className="flex flex-col gap-1 rounded-2xl px-5 py-4 transition-opacity hover:opacity-80"
                style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
              >
                <span className="text-base wrap-anywhere">{listing.title}</span>
                <span className="type-meta" style={{ color: 'var(--muted-foreground)' }}>
                  {listing.source ? `${listing.childLabel} · ${listing.source}` : listing.childLabel}
                </span>
              </Link>
            ))}
          </section>
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
