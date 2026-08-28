/**
 * Family display labels — the client-safe slice of `lib/families.ts`.
 *
 * INTEGRATION-OWNED. Created while integrating WP-2 and WP-4, for a defect
 * that neither package could have had on its own.
 *
 * WHAT WENT WRONG. `app/search/page.tsx` is a client component and imported
 * `getFamily` from `lib/families.ts` to display a family's label in demand
 * mode. On WP-4's branch that was free: WP-1 had shipped `families.ts` as an
 * empty export and WP-2 had not landed yet. On WP-2's branch it was also free:
 * the family route is a server component. Put the two together and
 * `NAVIGATION_FAMILIES` — including every family's `children` array — is
 * pulled into the client bundle, and ten `qa_only` product slugs Klup monitors
 * but has not published ship to every anonymous visitor of `/search`.
 *
 * Nothing became reachable: each of those slugs still returns 404 through the
 * four-axis gate. But the private half of the catalogue should not be readable
 * from a JavaScript file either, and "no private slug in a client bundle" is a
 * release-gate line rather than a preference.
 *
 * WHY A SEPARATE MODULE RATHER THAN A NARROWER IMPORT. Tree-shaking a const
 * that a still-imported function closes over is a bundler judgement, not a
 * guarantee, and it would silently re-link the moment someone imported one
 * more helper. A module that does not contain the private data cannot leak it
 * however it is imported. The bundle scan in
 * `scripts/lib/integration-boundary.test.ts` fails if a private slug reappears
 * in any client chunk, so the property is enforced rather than assumed.
 *
 * NOT A SECOND SOURCE OF TRUTH. These six labels must equal the labels in
 * `NAVIGATION_FAMILIES` exactly; the same test asserts it against the array
 * itself, which it can do because Node has no bundle boundary.
 */

export const FAMILY_LABELS: Readonly<Record<string, string>> = {
  'gibson-les-paul': 'Gibson Les Paul',
  'fender-stratocaster': 'Fender Stratocaster',
  'fender-telecaster': 'Fender Telecaster',
  'gibson-es-335': 'Gibson ES-335',
  'fender-jazz-bass': 'Fender Jazz Bass',
  'fender-precision-bass': 'Fender Precision Bass',
}

/** The display label for a family slug, or null when the slug is not a family. */
export function familyLabel(slug: string): string | null {
  return FAMILY_LABELS[slug] ?? null
}
