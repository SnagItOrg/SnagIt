/**
 * Navigation families — reviewed code configuration, never a database entity.
 *
 * Stage 3 V1. WP-1 shipped the shape; WP-2 fills the six entries and the
 * pure child-selection rule the family route renders from.
 * See docs/stage-3-v1-decision-and-build-plan.md §4.1–§4.2.
 *
 * WHY CODE AND NOT A TABLE. A new table in `public` is born world-readable and
 * world-writable until the schema-wide default-privilege P0 recorded in
 * docs/klup-foundation-handover.md is closed. Families are therefore modelled
 * the way the monitoring boundary is modelled: a reviewed file that no runtime
 * surface may mutate.
 *
 * A family MAY aggregate its children's LISTINGS and NEVER their PRICES
 * (PAN-94, amending CLAUDE.md §7). The two halves of that sentence are enforced
 * differently and deliberately so:
 *
 *   listings — `buildFamilyView` collects them, from the children it already
 *              refused or admitted, de-duplicated across children;
 *   prices   — structural. `NavigationFamily` has no field that could carry a
 *              price, `FamilyListing` has no field that could carry one either,
 *              and the family route selects no price column from any table.
 *
 * Price stays out because a family's children are not one market. Measured on
 * `fender-telecaster`: 74 Reverb observations spanning 3,874–188,885 DKK, a 48x
 * band against MAX_BAND_WIDTH_RATIO = 10. The guard would reject that band
 * anyway; the rule makes it a design property rather than a threshold accident
 * that a wider catalogue could one day slip under
 * (klup-launch-catalogue-selection.md §6.1).
 *
 * `aliases` are NAVIGATION ONLY. They are never matcher aliases and never reach
 * lib/matching/**. `Squier` never navigates to a Fender page and `Epiphone`
 * never to a Gibson page.
 */

import { isCanonical, type CatalogueStateRow } from './catalogue'
import { FAMILY_SLUGS, type FamilySlug } from './family-slugs'

export interface NavigationFamily {
  /** Route segment for /family/<slug>, and the legacy kg_product slug it supersedes. */
  slug: string
  label: string
  brand: string
  /**
   * Browse root slug this family belongs under — the family page's middle
   * crumb (PAN-130). It places the FAMILY; it never classifies a member, and a
   * product page never reads it (PAN-52 §6).
   */
  categoryRoot: string
  /**
   * kg_product slugs, from klup-launch-catalogue-selection.md §6.3.
   * A child is RENDERED only if it passes the canonical predicate in
   * lib/catalogue.ts. Non-canonical children are omitted entirely — never
   * greyed, never named, never listed as "coming soon".
   */
  children: string[]
  /** Navigation-only aliases. Never matcher aliases. */
  aliases: string[]
}

/**
 * The six navigation families of V1 — exactly the six public `kg_product` rows
 * that behave as priced products today — plus `rhodes` (PAN-85), which is the
 * first family that is ONLY a navigation concept: it has no `kg_product` row,
 * and it must never be given one. Children come verbatim from
 * docs/klup-launch-catalogue-selection.md §6.3 and were verified present in
 * `kg_product` (SELECT, 2026-08-28; the four Rhodes children 2026-09-20).
 *
 * MEASURED 2026-09-20 (PAN-85): every child of the six GUITAR families is
 * still `supported` + `qa_only`, so those six render ZERO children and stay
 * `noindex` and unlisted (§4.2). That remains the expected V1 state, not a
 * defect. `rhodes` is the exception, and the reason this paragraph changed:
 * its four children are `supported` + `public` + music, so it is the first
 * family that renders anything at all.
 *
 * RE-MEASURED 2026-09-20 (PAN-94) — THE PARAGRAPH ABOVE IS NO LONGER TRUE, and
 * is kept because it records what PAN-85 saw. Four of the six guitar families
 * now have `public` children and are `index, follow`: `gibson-les-paul` (4 of
 * 5), `fender-telecaster` (2 of 3), `fender-stratocaster` and `gibson-es-335`
 * (1 each). Only `fender-jazz-bass` and `fender-precision-bass` still render
 * nothing, and for them the reason is not visibility — they have NO children
 * configured at all, so no promotion can fill them and only a reviewed edit to
 * this file can.
 *
 * `aliases` are NAVIGATION ONLY. A bare model number is never an alias —
 * migration 054 removed `335` as an identifier for exactly this reason — and
 * neither `Squier` nor `Epiphone` ever appears, because a sub-brand never
 * navigates up to its parent's family (§4.3).
 *
 * Keyed by slug, and the slugs come from `lib/family-slugs.ts` (PAN-146). The
 * `Record` type makes a listed slug with no entry here, or an entry for an
 * unlisted slug, a type error — so this file, `lib/catalogue.ts` and
 * `lib/publication.ts` cannot disagree about which families exist.
 */
const FAMILY_CONFIG: Record<FamilySlug, Omit<NavigationFamily, 'slug'>> = {
  'gibson-les-paul': {
    label: 'Gibson Les Paul',
    brand: 'Gibson',
    categoryRoot: 'electric-guitars',
    children: [
      'gibson-les-paul-custom',
      'gibson-les-paul-standard-50s',
      'gibson-les-paul-standard-60s',
      'gibson-les-paul-studio',
      'gibson-les-paul-special',
      // PAN-198 (manager decision 2026-09-30): the series models, each with a
      // verified Reverb CSP, and the existing Les Paul models that carry one.
      // A child renders only once it is canonical, so this is inert until the
      // promotion.
      'gibson-les-paul-standard-50s-p-90',
      'gibson-les-paul-standard-50s-faded',
      'gibson-les-paul-standard-50s-double-trouble',
      'gibson-les-paul-standard-60s-faded',
      'gibson-les-paul-standard-60s-double-trouble',
      'gibson-les-paul-studio-session',
      'gibson-les-paul-studio-deluxe-ii',
      'gibson-les-paul-studio-double-trouble',
      'gibson-les-paul-special-tribute',
      'gibson-les-paul-double-cut-special',
      'gibson-les-paul-junior',
      'gibson-les-paul-junior-double-cut',
      'gibson-billie-joe-armstrong-les-paul-junior',
      'gibson-les-paul-custom-70s',
      'gibson-les-paul-classic',
      'gibson-les-paul-deluxe',
      'gibson-les-paul-70s-deluxe',
      'gibson-les-paul-modern',
      'gibson-les-paul-supreme',
      'gibson-les-paul-traditional',
      'gibson-les-paul-traditional-pro-ii',
      'gibson-les-paul-tribute',
      'gibson-les-paul-50s-tribute',
      'gibson-les-paul-52-tribute',
      'gibson-les-paul-60s-tribute',
      'gibson-les-paul-70s-tribute',
      'gibson-les-paul-future-tribute',
      'gibson-the-paul',
      'gibson-les-paul-the-paul-ii',
      'gibson-slash-les-paul-standard',
      'gibson-les-paul-paul-kossoff',
      'gibson-les-paul-paul-landers-signature',
      'gibson-custom-shop-les-paul-r0',
      'gibson-custom-shop-les-paul-r4',
      'gibson-custom-shop-les-paul-r6',
      'gibson-custom-shop-les-paul-r7',
      'gibson-custom-shop-les-paul-r8',
      'gibson-custom-shop-les-paul-r9',
      'gibson-custom-shop-1957-les-paul-custom-reissue',
      'gibson-custom-shop-1968-les-paul-custom-reissue',
      'gibson-custom-shop-1957-les-paul-junior-reissue',
      'gibson-custom-shop-1957-les-paul-special-single-cut-reissue',
      'gibson-custom-shop-1960-les-paul-special-double-cut-reissue',
      'gibson-custom-shop-les-paul-special-double-cut-figured',
    ],
    aliases: ['les paul', 'lespaul', 'gibson les paul'],
  },
  'fender-stratocaster': {
    label: 'Fender Stratocaster',
    brand: 'Fender',
    categoryRoot: 'electric-guitars',
    children: [
      'fender-american-professional-ii-stratocaster',
      // PAN-195 (owner decision 2026-09-30): the series models, each with a verified Reverb CSP.
      'fender-player-ii-stratocaster',
      'fender-player-ii-stratocaster-hss',
      'fender-player-ii-modified-stratocaster',
      'fender-player-ii-modified-stratocaster-hss',
      'fender-player-ii-modified-stratocaster-hss-floyd-rose',
      'fender-player-plus-stratocaster',
      'fender-player-plus-stratocaster-hss',
      'fender-vintera-ii-50s-stratocaster',
      'fender-vintera-ii-60s-stratocaster',
      'fender-vintera-ii-70s-stratocaster',
      'fender-vintera-ii-road-worn-60s-stratocaster',
      'fender-vintera-iii-early-60s-stratocaster',
      'fender-vintera-iii-late-60s-stratocaster',
      'fender-vintera-iii-late-50s-stratocaster',
      'fender-american-performer-stratocaster',
      'fender-american-performer-stratocaster-hss',
      'fender-american-performer-timber-stratocaster',
      'fender-american-professional-ii-stratocaster-hss',
      'fender-american-professional-ii-stratocaster-thinline',
      'fender-american-professional-classic-stratocaster',
      'fender-american-professional-classic-stratocaster-hss',
      'fender-american-vintage-ii-1954-stratocaster',
      'fender-american-vintage-ii-1957-stratocaster',
      'fender-american-vintage-ii-1961-stratocaster',
      'fender-american-vintage-ii-1965-stratocaster',
      'fender-american-vintage-ii-1973-stratocaster',
      'fender-american-ultra-stratocaster',
      'fender-american-ultra-stratocaster-hss',
      'fender-american-ultra-ii-stratocaster',
      'fender-american-ultra-ii-stratocaster-hss',
      'fender-standard-stratocaster',
      'fender-standard-stratocaster-hss',
    ],
    aliases: ['stratocaster', 'strat', 'fender stratocaster', 'fender strat'],
  },
  'fender-telecaster': {
    label: 'Fender Telecaster',
    brand: 'Fender',
    categoryRoot: 'electric-guitars',
    /*
     * PAN-159 Tier 0: `fender-american-standard-telecaster` and
     * `fender-american-ultra-ii-telecaster` are supported + public + music
     * (SELECT, 2026-09-28) and were missing, so this family did not list them
     * and their pages had no family crumb. Neither has a same-name duplicate.
     */
    children: [
      'fender-telecaster-thinline',
      'fender-telecaster-custom',
      'fender-american-vintage-52-telecaster',
      'fender-american-standard-telecaster',
      'fender-american-ultra-ii-telecaster',
      // PAN-195 (owner decision 2026-09-30): the series models, each with a verified Reverb CSP.
      'fender-player-ii-telecaster',
      'fender-player-ii-telecaster-hh',
      'fender-player-ii-modified-telecaster',
      'fender-player-ii-modified-telecaster-sh',
      'fender-player-plus-telecaster',
      'fender-player-plus-nashville-telecaster',
      'fender-vintera-ii-60s-telecaster',
      'fender-vintera-ii-60s-telecaster-thinline',
      'fender-vintera-ii-70s-telecaster-deluxe',
      'fender-vintera-ii-road-worn-60s-telecaster',
      'fender-vintera-iii-late-50s-telecaster',
      'fender-vintera-iii-mid-60s-telecaster',
      'fender-american-performer-telecaster',
      'fender-american-performer-telecaster-hum',
      'fender-american-professional-ii-telecaster',
      'fender-american-professional-ii-telecaster-deluxe',
      'fender-american-professional-ii-telecaster-thinline',
      'fender-american-professional-classic-telecaster',
      'fender-american-professional-classic-hotshot-telecaster',
      'fender-american-vintage-ii-1951-telecaster',
      'fender-american-vintage-ii-1963-telecaster',
      'fender-american-vintage-ii-1972-telecaster-thinline',
      'fender-american-vintage-ii-1975-telecaster-deluxe',
      'fender-american-vintage-ii-1977-telecaster-custom',
      'fender-american-ultra-telecaster',
      'fender-standard-telecaster',
    ],
    aliases: ['telecaster', 'tele', 'fender telecaster', 'fender tele'],
  },
  'gibson-es-335': {
    label: 'Gibson ES-335',
    brand: 'Gibson',
    categoryRoot: 'electric-guitars',
    children: [
      'gibson-es-335-dot',
      // PAN-198 (manager decision 2026-09-30): the series models and Custom
      // Shop reissues, each with a verified Reverb CSP.
      'gibson-es-335-block',
      'gibson-es-335-50s',
      'gibson-es-335-60s-block',
      'gibson-es-335-satin',
      'gibson-es-335-studio',
      'gibson-custom-shop-1959-es-335-reissue',
      'gibson-custom-shop-1961-es-335-reissue',
      'gibson-custom-shop-1963-es-335-block-reissue',
      'gibson-custom-shop-1964-es-335-reissue',
    ],
    aliases: ['es-335', 'es335', 'gibson es-335'],
  },
  /*
   * PAN-154 (owner decision 2026-09-26: Precision Bass and Jazz Bass are
   * families) gives these two their first members: the only clean rows the KG
   * holds, SELECT-verified active on 2026-09-26, all `known`, so neither family
   * renders a child yet. Every other P/J row is a listing title
   * ("BASSO ELETTRICO FENDER Player Precision Bass MN Tidepool") and is never a
   * member: merge-not-create.
   */
  'fender-jazz-bass': {
    label: 'Fender Jazz Bass',
    brand: 'Fender',
    categoryRoot: 'bass-guitars',
    children: [
      'fender-american-standard-jazz-bass',
      // PAN-195 (owner decision 2026-09-30): the series models, each with a verified Reverb CSP.
      'fender-player-ii-jazz-bass',
      'fender-player-ii-modified-active-jazz-bass',
      'fender-player-ii-modified-active-jazz-bass-v',
      'fender-player-plus-jazz-bass',
      'fender-player-plus-jazz-bass-v',
      'fender-vintera-ii-60s-jazz-bass',
      'fender-vintera-iii-early-60s-jazz-bass',
      'fender-vintera-iii-early-70s-jazz-bass',
      'fender-american-performer-jazz-bass',
      'fender-american-professional-ii-jazz-bass',
      'fender-american-professional-ii-jazz-bass-v',
      'fender-american-professional-ii-jazz-bass-fretless',
      'fender-american-professional-classic-jazz-bass',
      'fender-american-vintage-ii-1966-jazz-bass',
      'fender-american-ultra-jazz-bass',
      'fender-american-ultra-jazz-bass-v',
      'fender-american-ultra-ii-jazz-bass',
      'fender-american-ultra-ii-jazz-bass-v',
      'fender-standard-jazz-bass',
    ],
    aliases: ['jazz bass', 'j-bass', 'fender jazz bass'],
  },
  'fender-precision-bass': {
    label: 'Fender Precision Bass',
    brand: 'Fender',
    categoryRoot: 'bass-guitars',
    children: [
      'fender-american-standard-precision-bass',
      'fender-precision-bass-57-reissue',
      // PAN-195 (owner decision 2026-09-30): the series models, each with a verified Reverb CSP.
      'fender-player-ii-precision-bass',
      'fender-player-ii-modified-active-precision-bass',
      'fender-player-plus-precision-bass',
      'fender-vintera-ii-50s-precision-bass',
      'fender-vintera-ii-60s-precision-bass',
      'fender-vintera-iii-late-60s-precision-bass',
      'fender-american-performer-precision-bass',
      'fender-american-professional-ii-precision-bass',
      'fender-american-professional-ii-precision-bass-v',
      'fender-american-professional-classic-precision-bass',
      'fender-american-vintage-ii-1954-precision-bass',
      'fender-american-vintage-ii-1960-precision-bass',
      'fender-american-ultra-precision-bass',
      'fender-american-ultra-ii-precision-bass',
      'fender-mexican-standard-precision-bass',
    ],
    aliases: ['precision bass', 'p-bass', 'fender precision bass'],
  },
  rhodes: {
    /*
     * LABEL IS `Rhodes Electric Piano`, NOT bare `Rhodes`, for two measured
     * reasons rather than taste.
     *
     * 1. `rhodes` is a DANGEROUS_TERM_KEY (lib/search-index.ts), so the query
     *    "rhodes" renders a disambiguation SET instead of navigating. This
     *    family is the first whose own slug is a dangerous term, so it is the
     *    first to appear in such a set — beside `Rhodes Mark I Stage 73` and
     *    its siblings. A candidate labelled just "Rhodes" is not choosable
     *    against those; wp4-search.test.ts asserts exactly that property.
     * 2. The route renders `brand` above `label`, which for a bare label would
     *    print "Rhodes" directly above "Rhodes".
     *
     * `Electric Piano` is taken from the catalogue's own taxonomy — all four
     * children are classified `keyboards-and-synths/electric-pianos` — so this
     * is a descriptive family name, not an evocative editorial facet of the
     * kind CLAUDE.md §7 forbids as a taxonomy replacement. The other six
     * families are brand + model; the Rhodes line has no model word to use.
     */
    label: 'Rhodes Electric Piano',
    /*
     * BRAND IS `Rhodes`, NOT `Fender Rhodes` — measured, not chosen by taste.
     * All four children carry `kg_brand.name = 'Rhodes'` (SELECT, 2026-09-20).
     *
     * The line was sold as Fender Rhodes while Fender owned the company and as
     * Rhodes before and after, so NO single brand string is true of the whole
     * production run. The one that is true of the ROWS is the one that keeps
     * this file and `kg_product` from disagreeing — and `brand` here feeds the
     * brand-affinity term in lib/search-resolver.ts, which compares against a
     * single query TOKEN, so `Fender Rhodes` would simply never match one.
     * The Fender era is carried by an alias instead, which is where a
     * historical trading name belongs: navigation, never identity.
     */
    brand: 'Rhodes',
    categoryRoot: 'keyboards-and-synths',
    children: [
      'rhodes-mark-i-stage-73',
      'rhodes-mark-i-suitcase-73',
      'rhodes-mark-ii-stage-73',
      'rhodes-mark-i-stage-88',
    ],
    /*
     * `fender rhodes` is measured, not assumed: 155 of the 395 listing titles
     * containing "Rhodes" say "Fender Rhodes" (SELECT, 2026-09-20).
     *
     * THE COLLISION, AND WHY IT DOES NOT BITE. Ten of those 155 are the
     * `Fender Rhodes Chroma Polaris` — a polyphonic ANALOG SYNTHESIZER, not an
     * electric piano, and it holds its own `kg_product` rows
     * (`fender-rhodes-chroma-polaris`, `rhodes-chroma-polaris`, both qa_only).
     * Navigation auto-resolves on an EXACT alias key only (`exactMatches` in
     * lib/search-resolver.ts; `relatedMatches` is documented there as never
     * used to navigate). `fender rhodes chroma polaris` is not that key, so a
     * Chroma query cannot be captured by this family — it can only surface as
     * a suggestion, which is the right outcome for a term Klup does not
     * support.
     *
     * `rhodes` is deliberately NOT listed: the label and the slug already
     * produce that key. No bare model number appears — `73`, `88` and `mark i`
     * name a CHILD rather than this family, and migration 054 removed `335`
     * for exactly that reason.
     */
    aliases: ['fender rhodes'],
  },
  /*
   * PAN-141 — the two Boss lines, product-owner decision 2026-09-24. Like
   * `rhodes`, both are navigation concepts only: neither slug is a `kg_product`
   * row (SELECT, 2026-09-24) and neither may ever become one, or
   * `familyRedirectTarget` would 308 its product page away.
   *
   * A Waza Craft reissue (`-2w`) is a MEMBER, not a `successor` edge. The `W`
   * is identity-forming (PAN-52 D6), so CE-2W keeps its own row and its own
   * price evidence; this file only groups it for navigation, which is what a
   * family is for. Each reissue sits beside the circuit it reissues.
   *
   * Members are the canonical rows, SELECT-verified active + supported +
   * public + music on 2026-09-24. The two listing-title duplicates
   * (`boss-boss-boss-ce-3-…-1987`, `boss-boss-ceb-3-bass-chorus`) are never
   * members: merge-not-create. `boss-ceb-3` is left out because a bass chorus
   * is a different instrument market.
   *
   * No aliases. The label and slug produce the family's own keys; `boss
   * chorus` or `boss delay` would capture queries for pedals outside the line.
   * The labels are not a child's name, so the family stays choosable in a
   * disambiguation set (see `rhodes` above).
   */
  'boss-ce-chorus': {
    label: 'Boss CE Chorus',
    brand: 'Boss',
    categoryRoot: 'effects-and-pedals',
    children: ['boss-ce-1', 'boss-ce-2', 'boss-ce-2w', 'boss-ce-3', 'boss-ce-5'],
    aliases: [],
  },
  'boss-dm-delay': {
    label: 'Boss DM Delay',
    brand: 'Boss',
    categoryRoot: 'effects-and-pedals',
    children: ['boss-dm-2', 'boss-dm-2w'],
    aliases: [],
  },
  /*
   * PAN-154 — owner decision 2026-09-26: "Minimoog" is the vintage original
   * only, and the name of the line becomes a family whose members are separate
   * products. Navigation only, like `rhodes`: `minimoog` is not a `kg_product`
   * row (SELECT, 2026-09-26) and must never become one. The vintage page keeps
   * its own slug, `moog-minimoog`, and its own price evidence as a member.
   *
   * Members are the existing clean rows, SELECT-verified active on 2026-09-26.
   * Only `moog-minimoog` is canonical today, so it is the one child that
   * renders; `moog-model-d` is supported + qa_only, the rest `known`. Merge,
   * never create: the listing-title rows (`moog-moog-minimoog-voyager-old-…`,
   * `moog-moog-minimoog-model-d-reissue-2016-…`) and the two duplicates
   * `moog-minimoog-model-d` (the vintage CSP again) and
   * `moog-minimoog-model-d-reissue` (the reissue again) are not members.
   *
   * LABEL. `Moog Minimoog` is the vintage member's own name, so the family
   * would not be choosable beside it in the "minimoog" disambiguation set
   * (see `rhodes` above). The qualifier is the members' taxonomy leaf,
   * `keyboards-and-synths/analog-synths`. No aliases: `minimoog` comes from
   * the slug, and it is a DANGEROUS_TERM_KEY, so it never navigates alone.
   */
  minimoog: {
    label: 'Minimoog Analog Synth',
    brand: 'Moog',
    categoryRoot: 'keyboards-and-synths',
    children: [
      'moog-minimoog',
      'moog-model-d',
      // PAN-199 (manager decision 2026-09-30): the 2022– re-run is its own model.
      'moog-minimoog-model-d-2022',
      'moog-minimoog-model-d-geddy-lee',
      'moog-minimoog-voyager',
      'moog-minimoog-voyager-xl',
      'moog-minimoog-voyager-rme',
      // PAN-199: created from Reverb CSP 31380.
      'moog-minimoog-voyager-old-school',
    ],
    aliases: [],
  },
  /*
   * PAN-154 (2/2) — owner decision 2026-09-26: option B for the Mustang Bass,
   * with the 1966–81 original as its base member. As with `minimoog`, the base
   * keeps its own priced page, `fender-mustang-bass`, narrowed to the original
   * by LINE_BOUNDARIES in lib/matching/match-listings.ts; this slug is
   * navigation only and is not a `kg_product` row (SELECT, 2026-09-26).
   *
   * ONE MEMBER, because the KG holds no other clean Mustang row: the Player,
   * Player II PJ, JMJ Road Worn and Vintera II rows are listing titles
   * ("Fender Fender Player II Mustang PJ Bass - Coral Red"), and
   * merge-not-create keeps them out.
   *
   * LABEL AND SLUG avoid "Mustang Bass", which is the member's own model name:
   * a family answering "mustang bass" would stop that query from navigating to
   * the product. "Short-scale" is what makes every Mustang bass one line (the
   * frozen boundary: "Short scale bass"), and "Fender Mustang" alone is also
   * the guitar.
   */
  'mustang-short-scale-bass': {
    label: 'Mustang Short-Scale Bass',
    brand: 'Fender',
    categoryRoot: 'bass-guitars',
    children: [
      'fender-mustang-bass',
      // PAN-195 (owner decision 2026-09-30): the series models, each with a verified Reverb CSP.
      'fender-vintera-ii-70s-competition-mustang-bass',
      'fender-american-performer-mustang-bass',
      'fender-american-professional-classic-mustang-bass',
    ],
    aliases: [],
  },
  /*
   * PAN-159 Tier 1 — owner decision 2026-09-28. Members are existing clean rows
   * only, SELECT-verified active on 2026-09-28 and each under this family's
   * `categoryRoot`, or not yet classified (PAN-52 §6). Merge, never create:
   * duplicates, listing titles, clones and sub-brands are not members, and a
   * variant with no row is a candidate on the ticket, never a row made here.
   *
   * No aliases on any of them. Label and slug give each family its keys, and
   * the bare line names (`juno`, `jupiter`, `prophet`, `space echo`) are
   * DANGEROUS_TERM_KEYS, so they never navigate on their own. No label is a
   * member's name, so each family stays choosable in a disambiguation set.
   *
   * The synth and echo children run oldest first; the guitar children put the
   * canonical member first and make no claim about years (PAN-52 §11). Only
   * canonical children render.
   */
  'roland-juno': {
    label: 'Roland Juno',
    brand: 'Roland',
    categoryRoot: 'keyboards-and-synths',
    // `roland-juno-ds61` duplicates `roland-juno-ds-61` (same CSP, 6679).
    // Behringer JU-06 is a clone, never a member. PAN-200: Roland's own Boutique
    // re-creations (JU-06, JU-06A) join, as the Minimoog reissues and the Korg
    // ARP 2600 do theirs; a family never aggregates price, and each listing is
    // attributed to its own child.
    children: [
      'roland-juno-6',
      'roland-juno-60',
      'roland-juno-106',
      // PAN-200: created from Reverb CSP 34065.
      'roland-juno-106s',
      'roland-alpha-juno-1',
      'roland-alpha-juno-2',
      'roland-juno-d',
      'roland-juno-g',
      'roland-juno-stage',
      'roland-juno-di',
      'roland-juno-ds-61',
      'roland-ju-06',
      // PAN-200: created from Reverb CSPs 108971, 149238, 183070, 183066, 183068.
      'roland-ju-06a',
      'roland-juno-x',
      'roland-juno-d6',
      'roland-juno-d7',
      'roland-juno-d8',
    ],
    aliases: [],
  },
  'roland-jupiter': {
    label: 'Roland Jupiter',
    brand: 'Roland',
    categoryRoot: 'keyboards-and-synths',
    // `roland-jp-4`, `-6` and `-8` duplicate the Jupiter rows. JP-8000 and
    // JP-8080 are not Jupiters.
    children: [
      'roland-jupiter-4',
      'roland-jupiter-8',
      'roland-jupiter-6',
      'roland-jupiter-80',
      // PAN-200: created from Reverb CSPs 27661 and 1917. The JP-08 is Roland's
      // Boutique Jupiter-8, a member as the JU-06 is of `roland-juno`.
      'roland-jupiter-50',
      'roland-jp-08',
      'roland-jupiter-xm',
    ],
    aliases: [],
  },
  /*
   * BRAND IS `Sequential` across three `kg_brand` rows (Sequential Circuits,
   * Dave Smith Instruments, Sequential): one company under three names, the
   * `rhodes` precedent. `Sequential` is the one query token all three share.
   * The Prophet 2000 and 3000 are samplers and the Prophet Remote a
   * controller, so they are not members; nor is any Arturia or Creamware
   * emulation.
   */
  'sequential-prophet': {
    label: 'Sequential Prophet',
    brand: 'Sequential',
    categoryRoot: 'keyboards-and-synths',
    children: [
      'sequential-circuits-prophet-5',
      'sequential-circuits-prophet-10',
      'sequential-circuits-prophet-600',
      'sequential-circuits-prophet-t8',
      'sequential-circuits-prophet-vs',
      'dave-smith-instruments-prophet-08',
      'sequential-prophet-6',
      'sequential-prophet-rev2',
      'sequential-prophet-5',
      'sequential-prophet-10',
    ],
    aliases: [],
  },
  /*
   * Roland's tape echoes only. Boss RE-2, RE-20 and RE-202 carry the name but
   * are a sub-brand's pedals, and a sub-brand never joins its parent's family.
   */
  'roland-space-echo': {
    label: 'Roland Space Echo',
    brand: 'Roland',
    categoryRoot: 'effects-and-pedals',
    // PAN-200: the RE-301 and RE-150 (created from Reverb CSPs 26233, 24231) and
    // the SRE-555 rack Chorus Echo are Roland tape echoes too.
    children: ['roland-re-201', 'roland-re-301', 'roland-re-150', 'roland-re-501', 'roland-sre-555'],
    aliases: [],
  },
  /*
   * The Minimoog pattern: the vintage original and the Korg reissue are
   * separate products (PAN-52 D6), grouped here. The slug is not `arp-2600`,
   * because that is the vintage member's own priced page and a family slug
   * 308s its product URL away. Behringer's 2600 is a clone (`kg_relation`),
   * never a member.
   */
  'arp-2600-semi-modular': {
    label: 'ARP 2600 Semi-Modular',
    brand: 'ARP',
    categoryRoot: 'keyboards-and-synths',
    children: ['arp-2600', 'arp-korg-arp-2600'],
    aliases: [],
  },
  /*
   * These two slugs ARE `kg_product` rows: `known` + `qa_only` line labels,
   * holding 49 and 47 active matches (SELECT, 2026-09-28). Neither renders a
   * page today, so the 308 moves no priced page. Being a family slug is what
   * guards them (PAN-84): they can no longer be published and can never be
   * automatic match targets. Their existing matches are not touched here.
   * The Squier J Mascis Jazzmaster is a sub-brand's, so not a member.
   */
  'fender-jazzmaster': {
    label: 'Fender Jazzmaster',
    brand: 'Fender',
    categoryRoot: 'electric-guitars',
    children: [
      'fender-jim-root-jazzmaster',
      'fender-jim-root-v4-jazzmaster',
      'fender-troy-van-leeuwen-jazzmaster',
      'fender-american-vintage-ii-jazzmaster',
      // PAN-195 (owner decision 2026-09-30): the series models, each with a verified Reverb CSP.
      'fender-player-ii-jazzmaster',
      'fender-vintera-ii-50s-jazzmaster',
      'fender-vintera-iii-mid-60s-jazzmaster',
      'fender-american-performer-jazzmaster',
      'fender-american-professional-ii-jazzmaster',
      'fender-american-professional-classic-jazzmaster',
      'fender-american-ultra-jazzmaster',
    ],
    aliases: [],
  },
  'fender-jaguar': {
    label: 'Fender Jaguar',
    brand: 'Fender',
    categoryRoot: 'electric-guitars',
    children: [
      'fender-johnny-marr-jaguar',
      'fender-kurt-cobain-jaguar',
      // PAN-195 (owner decision 2026-09-30): the series models, each with a verified Reverb CSP.
      'fender-player-ii-jaguar',
      'fender-vintera-ii-70s-jaguar',
      'fender-vintera-iii-mid-60s-jaguar',
      'fender-american-professional-classic-jaguar',
    ],
    aliases: [],
  },
  /*
   * PAN-198 (manager decision 2026-09-30). `gibson-sg` IS a `kg_product` row:
   * a `known` + `qa_only` line label with no Reverb CSP, the Jazzmaster case.
   * Listing it here is the PAN-84 guard, so it can never be published or
   * receive automatic matches. The 2019– SG Standard is `gibson-sg-standard`;
   * the '61 is its own model, and the 1966–71 "Large Guard" the supported row.
   */
  'gibson-sg': {
    label: 'Gibson SG',
    brand: 'Gibson',
    categoryRoot: 'electric-guitars',
    children: [
      'gibson-sg-standard',
      'gibson-sg-standard-61',
      'gibson-sg-standard-61-faded',
      'gibson-sg-standard-large-guard-with-maestro-vibrola',
      'gibson-sg-61-reissue',
      'gibson-custom-shop-1961-les-paul-sg-standard-reissue',
      'gibson-sg-special',
      'gibson-sg-special-faded',
      'gibson-custom-shop-1963-sg-special-reissue',
      'gibson-sg-supreme',
      'gibson-sg-modern',
    ],
    aliases: ['sg', 'gibson sg'],
  },
  /*
   * PAN-199. Moog's pedal line (1998–2018, the 2020s white re-runs): each
   * Moogerfooger is its own product with its own Reverb CSP, and the line name
   * is on nearly every title ("Moog Moogerfooger MF-102 Ring Modulator"). The
   * `moogerfooger` slug is not a `kg_product` row (SELECT, 2026-09-30), so it
   * guards nothing today; like `rhodes`, it is refused as a priced page and as a
   * match target if one is ever created. The CP-251 is the line's control
   * processor, sold as a Moogerfooger. No aliases: the slug gives the key.
   */
  moogerfooger: {
    label: 'Moog Moogerfooger',
    brand: 'Moog',
    categoryRoot: 'effects-and-pedals',
    children: [
      'moog-mf-101-lowpass-filter',
      'moog-mf-102',
      'moog-mf-103',
      'moog-mf-104',
      'moog-mf-104m',
      'moog-mf-104z',
      'moog-mf-105',
      'moog-mf-105m-midi-murf',
      'moog-cp-251',
    ],
    aliases: [],
  },
  /*
   * PAN-230, owner decision 2026-10-03. The U 87 is two priced models, not one:
   * the vintage U 87 (1967–1986) and the U 87 Ai (1986–) sell in different
   * price universes and each keeps its own Reverb CSP. "Neumann U 87" is the
   * navigation concept over both, like `arp-2600-semi-modular` over the ARP
   * 2600 pages: never a `kg_product` row, never a price. The slug is not
   * `neumann-u87` because that is the vintage page's own slug. No aliases:
   * the slug gives the key.
   */
  'neumann-u87-condenser': {
    label: 'Neumann U 87',
    brand: 'Neumann',
    categoryRoot: 'pro-audio',
    children: ['neumann-u87', 'neumann-u87ai'],
    aliases: [],
  },
}

/** Every family, in `FAMILY_SLUGS` order. */
export const NAVIGATION_FAMILIES: readonly NavigationFamily[] = FAMILY_SLUGS.map((slug) => ({
  slug,
  ...FAMILY_CONFIG[slug],
}))

const FAMILY_BY_SLUG = new Map<string, NavigationFamily>(
  NAVIGATION_FAMILIES.map((family) => [family.slug, family]),
)

export function isFamilySlug(slug: string): boolean {
  return FAMILY_BY_SLUG.has(slug)
}

export function getFamily(slug: string): NavigationFamily | null {
  return FAMILY_BY_SLUG.get(slug) ?? null
}

/** Every slug that is a family child, across all families. */
export function allFamilyChildSlugs(): Set<string> {
  const out = new Set<string>()
  for (const family of NAVIGATION_FAMILIES) {
    for (const child of family.children) out.add(child)
  }
  return out
}

const FAMILY_BY_CHILD_SLUG = new Map<string, NavigationFamily>(
  NAVIGATION_FAMILIES.flatMap((family) =>
    family.children.map((child) => [child, family] as [string, NavigationFamily]),
  ),
)

/**
 * The family a product slug belongs to, or null — the reverse of `children[]`.
 *
 * This is the WHOLE of the hierarchy a product can see. PAN-52 ratified D5(a),
 * `Family -> Terminal` with no intermediate level, so there is nothing above
 * the family to walk to and no recursion to write. Category and subcategory are
 * browse taxonomy and are explicitly NOT family ancestry (PAN-52 §6), so they
 * are not consulted here and this never returns a browse root.
 *
 * It returns the CONFIGURATION, never a rendering decision: the family it hands
 * back still lists non-canonical children. Every consumer must put those rows
 * through `buildFamilyView` before a single slug reaches a public surface.
 */
export function familyForChild(slug: string): NavigationFamily | null {
  return FAMILY_BY_CHILD_SLUG.get(slug) ?? null
}

/* ------------------------------------------------------------------ *
 * The legacy 308 map
 * ------------------------------------------------------------------ */

/**
 * `/product/<family-slug>` -> `/family/<family-slug>`, or null.
 *
 * Derived from NAVIGATION_FAMILIES rather than written out as a second literal
 * list, so the redirect map and the family routes cannot drift into two
 * descriptions that disagree. Middleware calls this; so does the test.
 *
 * WHY 308 AND NOT 302. The move is permanent: `gibson-les-paul` is a family
 * label and will never again be a priced product page, so the old URL should
 * transfer its authority rather than borrow it. A 308 also preserves the
 * method, which a 301 does not guarantee.
 *
 * The same decision is enforced a second time, independently, in
 * app/product/[slug]/layout.tsx via `isFamilySlug()`. Both read THIS module, so
 * the duplication is defence in depth with one source of truth, never two
 * opinions (build plan §14.2: the posture is not the only control).
 */
export function familyRedirectTarget(pathname: string): string | null {
  const PREFIX = '/product/'
  if (!pathname.startsWith(PREFIX)) return null
  const slug = pathname.slice(PREFIX.length)
  if (slug.length === 0 || slug.includes('/')) return null
  return FAMILY_BY_SLUG.has(slug) ? `/family/${slug}` : null
}

/* ------------------------------------------------------------------ *
 * Child selection — the binding rule of §4.2
 * ------------------------------------------------------------------ */

/**
 * A child row as the family route loads it: the four axes, a display name, and
 * the `kg_product.id` that `listing_product_match.product_id` joins on.
 *
 * `id` is a JOIN KEY and never a rendered field. It exists on the loader shape
 * only; `RenderableChild` and `FamilyListing` below carry no identifier the
 * database would recognise, so it cannot travel into a response.
 */
export interface FamilyChildRow extends CatalogueStateRow {
  slug: string
  canonical_name?: string | null
  id?: string | null
}

/** A child the family route is allowed to render. Never carries a price. */
export interface RenderableChild {
  slug: string
  label: string
}

/**
 * A match row as the family route loads it — PAN-94.
 *
 * Identity and activity ONLY. `listings` is the explicit embed, and it selects
 * neither `price`, `price_dkk` nor `currency`: the price columns are not
 * filtered out downstream, they are never read. A route that cannot see a price
 * cannot publish one.
 */
export interface FamilyListingRow {
  product_id?: string | null
  is_valid?: boolean | null
  listings?: {
    id?: string | null
    title?: string | null
    source?: string | null
    /** The seller's photo. Provenance, not evidence — see `FamilyListing`. */
    image_url?: string | null
    is_active?: boolean | null
  } | null
}

/**
 * A listing the family route is allowed to render.
 *
 * AN EXACT KEY SET, AND NOTHING PRICE-SHAPED IN IT. There is no field here a
 * price, a band, a median, a verdict or a sold population could travel in —
 * the same structural guarantee PAN-56 gives `RenderableChild`, extended to
 * the listings PAN-94 admits. `childSlug` is what makes the row a NAVIGATION
 * row rather than a marketplace row: it is the link target, and the price
 * question is answered on the variant page it leads to, where the market is
 * one market.
 *
 * `imageUrl` IS THE SIXTH KEY, AND IT IS PROVENANCE RATHER THAN EVIDENCE. The
 * shape used to say "five keys and no sixth", which counted fields when the
 * rule is about what a field can MEAN: a photo the seller uploaded states no
 * price, implies no band and settles no verdict, and it is already published
 * on /product/[slug] and /search for these same rows. The guard in
 * scripts/lib/wp2-families.test.ts therefore now pins the exact key set AND
 * asserts no key is price-shaped, so the count can move for a legible reason
 * while the rule it was standing in for is checked directly.
 *
 * What still may NEVER appear: price, price_dkk, currency, msrp, a band, a
 * median, a verdict, a sold population — or `url`, which would turn a
 * navigation row into an exit to a marketplace price with no verdict attached.
 */
export interface FamilyListing {
  id: string
  title: string
  source: string | null
  /** The seller's photo, or null. Never a price, and never a link off-site. */
  imageUrl: string | null
  /** The canonical child this listing is attributed to. */
  childSlug: string
  childLabel: string
}

export interface FamilyView {
  family: NavigationFamily
  /** Canonical-eligible children only, in reviewed order. Possibly empty. */
  children: readonly RenderableChild[]
  /**
   * The children's active listings, de-duplicated and attributed.
   *
   * THE DISPLAYED COUNT IS `listings.length` AND NOTHING ELSE. There is no
   * separate count field, because a count that is stored beside the rows it
   * describes is a count that can disagree with them — which is exactly the
   * defect PAN-94 was opened on.
   */
  listings: readonly FamilyListing[]
  /** True once at least one child is canonical: indexable AND navigable. */
  published: boolean
}

/**
 * A family becomes indexable and navigable at one canonical child.
 *
 * ONE THRESHOLD, NOT TWO. `noindex`, sitemap membership, navigation listing and
 * search-index membership all turn on the same number, so they can never
 * disagree — a family cannot be crawlable while unlisted, or listed while
 * uncrawlable. Q-D5 may raise this value; it may never split it in two.
 */
export const FAMILY_MIN_CANONICAL_CHILDREN = 1

/**
 * THE BINDING RULE. A family renders links to canonical-eligible children only,
 * and renders NOTHING AT ALL for any other child — not a greyed card, not a
 * disabled card, not a name in a list presented as catalogue depth.
 *
 * Rendering an unpublished product would advertise a URL that 404s (the gate in
 * lib/catalogue.ts refuses it) and would leak private catalogue state onto a
 * public page. Filtering happens HERE, on the four-axis predicate imported from
 * lib/catalogue.ts, so the family route cannot express a weaker rule than the
 * product route enforces.
 *
 * Rows may arrive in any order and may be missing entirely; a child with no row
 * is simply not canonical. Fail-closed throughout.
 *
 * LISTINGS RIDE THE SAME PREDICATE — PAN-94. `listingRows` are attributed via
 * the `kg_product.id` of a child that has ALREADY been admitted above, so a
 * listing matched to a child this function refused is discarded with it. The
 * family can therefore never render more catalogue than it names.
 *
 * `listingRows` defaults to empty so the callers that want eligibility only —
 * `generateMetadata`, and the family-sibling block in /api/product — keep
 * calling with two arguments and keep getting no listings.
 */
export function buildFamilyView(
  family: NavigationFamily,
  rows: readonly FamilyChildRow[],
  listingRows: readonly FamilyListingRow[] = [],
): FamilyView {
  const bySlug = new Map<string, FamilyChildRow>()
  for (const row of rows) {
    if (row && typeof row.slug === 'string' && row.slug.length > 0) bySlug.set(row.slug, row)
  }

  const children: RenderableChild[] = []
  /** product_id -> the admitted child, plus its position in the reviewed order. */
  const childByProductId = new Map<string, { child: RenderableChild; order: number }>()

  for (const slug of family.children) {
    const row = bySlug.get(slug)
    if (!row) continue
    if (!isCanonical(row)) continue
    const name = typeof row.canonical_name === 'string' ? row.canonical_name.trim() : ''
    const child: RenderableChild = { slug, label: name.length > 0 ? name : slug }
    children.push(child)
    if (typeof row.id === 'string' && row.id.length > 0) {
      childByProductId.set(row.id, { child, order: children.length - 1 })
    }
  }

  return {
    family,
    children,
    listings: collectFamilyListings(listingRows, childByProductId),
    published: children.length >= FAMILY_MIN_CANONICAL_CHILDREN,
  }
}

/**
 * Attribute, order and DE-DUPLICATE the admitted children's listings.
 *
 * DE-DUPLICATION IS THE POINT, not housekeeping. A listing may be matched to
 * more than one child — measured on `rhodes`, 2026-09-20: two of the 39 match
 * rows are a second match for a listing already counted under another Mark,
 * so the four children sum to 39 while the family holds 37 DISTINCT listings.
 * Summing per-child counts would therefore publish a number two higher than
 * the rows beneath it. A listing is attributed to the FIRST child in reviewed
 * order that claims it, which is deterministic and independent of the order
 * the database returned the rows in.
 *
 * A match explicitly adjudicated wrong (`is_valid === false`) is not a listing
 * for this product, for the same reason the product route drops it: it carries
 * a written rejection. NULL stays — that is the normal state of an automatic
 * match. The route applies this filter in SQL as well; stating it here too
 * keeps the rule readable from a plain Node test with no database.
 */
function collectFamilyListings(
  listingRows: readonly FamilyListingRow[],
  childByProductId: ReadonlyMap<string, { child: RenderableChild; order: number }>,
): FamilyListing[] {
  const attributed: Array<{ order: number; listing: FamilyListing }> = []

  for (const raw of listingRows) {
    if (!raw || typeof raw !== 'object') continue
    if (raw.is_valid === false) continue

    const productId = typeof raw.product_id === 'string' ? raw.product_id : ''
    const owner = childByProductId.get(productId)
    if (!owner) continue

    const listing = raw.listings
    if (!listing || typeof listing !== 'object') continue
    if (listing.is_active === false) continue

    const id = typeof listing.id === 'string' ? listing.id.trim() : ''
    const title = typeof listing.title === 'string' ? listing.title.trim() : ''
    if (id.length === 0 || title.length === 0) continue

    // An empty string is not an image. Normalising here rather than at render
    // keeps the route from deciding what counts as a photo.
    const imageUrl = typeof listing.image_url === 'string' ? listing.image_url.trim() : ''

    attributed.push({
      order: owner.order,
      listing: {
        id,
        title,
        source: typeof listing.source === 'string' ? listing.source : null,
        imageUrl: imageUrl.length > 0 ? imageUrl : null,
        childSlug: owner.child.slug,
        childLabel: owner.child.label,
      },
    })
  }

  // Sort BEFORE de-duplicating, so which child keeps a shared listing is decided
  // by the reviewed order rather than by the order the rows arrived in.
  attributed.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    if (a.listing.title !== b.listing.title) {
      return a.listing.title.localeCompare(b.listing.title, 'da')
    }
    return a.listing.id.localeCompare(b.listing.id)
  })

  const seen = new Set<string>()
  const listings: FamilyListing[] = []
  for (const { listing } of attributed) {
    if (seen.has(listing.id)) continue
    seen.add(listing.id)
    listings.push(listing)
  }

  return listings
}
