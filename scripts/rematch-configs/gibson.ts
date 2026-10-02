/**
 * scripts/rematch-configs/gibson.ts — Gibson (PAN-198): the brand's config for scripts/rematch-brand.ts.
 * The lists are the ones scripts/pan198-gibson-rematch.ts carried, verbatim (PAN-229).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-198',
  pan: 'pan198',
  brand: 'Gibson',

  /** The Gibson family label rows. Never match targets; their held matches move. */
  labels: ['gibson-les-paul', 'gibson-es-335', 'gibson-sg'],

  /**
   * The rows the PAN-198 promote SQL moves from `known` to `supported`: the same
   * reviewed list, verbatim. `gibson-es-355` is not here (its CSP is the Custom
   * Shop '59 reissue while its name is the bare model; owner decision), nor are
   * the three owner-held "clean" rows.
   */
  promoted: [
    'gibson-50s-j-45-original', 'gibson-50s-lg-2-original', 'gibson-60s-j-45-original',
    'gibson-70s-explorer', 'gibson-70s-flying-v', 'gibson-80s-explorer', 'gibson-advanced-jumbo',
    'gibson-b-25-12', 'gibson-billie-joe-armstrong-les-paul-junior',
    'gibson-custom-shop-1936-advanced-jumbo', 'gibson-custom-shop-1936-j-35',
    'gibson-custom-shop-1939-j-55', 'gibson-custom-shop-1939-sj-100',
    'gibson-custom-shop-1942-banner-j-45', 'gibson-custom-shop-1952-j-185',
    'gibson-custom-shop-1955-j-45-reissue', 'gibson-custom-shop-1957-les-paul-custom-reissue',
    'gibson-custom-shop-1957-les-paul-junior-reissue',
    'gibson-custom-shop-1957-les-paul-special-single-cut-reissue', 'gibson-custom-shop-1957-sj-200',
    'gibson-custom-shop-1958-korina-explorer-reissue',
    'gibson-custom-shop-1958-korina-flying-v-reissue', 'gibson-custom-shop-1959-es-335-reissue',
    'gibson-custom-shop-1960-hummingbird',
    'gibson-custom-shop-1960-les-paul-special-double-cut-reissue',
    'gibson-custom-shop-1961-es-335-reissue', 'gibson-custom-shop-1961-les-paul-sg-standard-reissue',
    'gibson-custom-shop-1963-es-335-block-reissue', 'gibson-custom-shop-1963-firebird-v-reissue',
    'gibson-custom-shop-1963-sg-special-reissue', 'gibson-custom-shop-1964-es-335-reissue',
    'gibson-custom-shop-1968-les-paul-custom-reissue', 'gibson-custom-shop-les-paul-r0',
    'gibson-custom-shop-les-paul-r4', 'gibson-custom-shop-les-paul-r6',
    'gibson-custom-shop-les-paul-r7', 'gibson-custom-shop-les-paul-r8',
    'gibson-custom-shop-les-paul-r9', 'gibson-custom-shop-les-paul-special-double-cut-figured',
    'gibson-dave-mustaine-flying-v-exp', 'gibson-dove', 'gibson-dove-original',
    'gibson-elvis-presley-sj-200', 'gibson-es-330', 'gibson-es-335-50s', 'gibson-es-335-60s-block',
    'gibson-es-335-block', 'gibson-es-335-satin', 'gibson-es-335-studio', 'gibson-es-345',
    'gibson-es-346-paul-jackson-jr', 'gibson-es-les-paul', 'gibson-explorer', 'gibson-explorer-b-2',
    'gibson-explorer-custom', 'gibson-explorer-e2', 'gibson-explorer-iii', 'gibson-firebird',
    'gibson-firebird-platypus', 'gibson-firebird-studio', 'gibson-firebird-vii', 'gibson-flying-v',
    'gibson-flying-v-67', 'gibson-flying-v-custom', 'gibson-flying-v2', 'gibson-g-200-ec',
    'gibson-g-45', 'gibson-g-45-studio', 'gibson-gary-clark-jr-es-355',
    'gibson-gibson-j-45-standard-12-string', 'gibson-gibson-l-00-original', 'gibson-hp-665',
    'gibson-hummingbird-original', 'gibson-hummingbird-special',
    'gibson-hummingbird-standard-rosewood', 'gibson-hummingbird-studio-ec',
    'gibson-hummingbird-studio-rosewood', 'gibson-j-185', 'gibson-j-185-century-12-fret',
    'gibson-j-185-original', 'gibson-j-35', 'gibson-j-35-30s-faded', 'gibson-j-45-century-12-fret',
    'gibson-j-45-special', 'gibson-j-45-standard-rosewood', 'gibson-j-45-studio-rosewood',
    'gibson-j-45-studio-walnut', 'gibson-j-55', 'gibson-jumbo', 'gibson-l-00-century-12-fret',
    'gibson-l-00-standard', 'gibson-l-4c', 'gibson-l-7c', 'gibson-les-paul-50s-tribute',
    'gibson-les-paul-52-tribute', 'gibson-les-paul-60s-tribute', 'gibson-les-paul-70s-deluxe',
    'gibson-les-paul-70s-tribute', 'gibson-les-paul-classic', 'gibson-les-paul-custom-70s',
    'gibson-les-paul-deluxe', 'gibson-les-paul-double-cut-special', 'gibson-les-paul-future-tribute',
    'gibson-les-paul-junior', 'gibson-les-paul-junior-double-cut', 'gibson-les-paul-modern',
    'gibson-les-paul-paul-kossoff', 'gibson-les-paul-paul-landers-signature',
    'gibson-les-paul-special-tribute', 'gibson-les-paul-standard-50s-double-trouble',
    'gibson-les-paul-standard-50s-faded', 'gibson-les-paul-standard-50s-p-90',
    'gibson-les-paul-standard-60s-double-trouble', 'gibson-les-paul-standard-60s-faded',
    'gibson-les-paul-studio-deluxe-ii', 'gibson-les-paul-studio-double-trouble',
    'gibson-les-paul-studio-session', 'gibson-les-paul-supreme', 'gibson-les-paul-the-paul-ii',
    'gibson-les-paul-traditional', 'gibson-les-paul-traditional-pro-ii', 'gibson-les-paul-tribute',
    'gibson-lg-2', 'gibson-lg-2-3-4', 'gibson-lg-2-all-mahogany-faded', 'gibson-lg-2-american-eagle',
    'gibson-marcus-king-es-345', 'gibson-margo-price-j-45', 'gibson-non-reverse-thunderbird',
    'gibson-pre-war-sj-200', 'gibson-rosanne-cash-j-185', 'gibson-sg-61-reissue', 'gibson-sg-modern',
    'gibson-sg-special', 'gibson-sg-special-faded', 'gibson-sg-standard', 'gibson-sg-standard-61',
    'gibson-sg-standard-61-faded', 'gibson-sg-supreme', 'gibson-sj-200-60s-original',
    'gibson-sj-200-orianthi-signature', 'gibson-sj-200-standard', 'gibson-sj-200-standard-rosewood',
    'gibson-sj-200-studio-rosewood', 'gibson-sj-200-studio-walnut', 'gibson-sj-200-western-classic',
    'gibson-slash-j-45', 'gibson-slash-les-paul-standard', 'gibson-southern-jumbo-original',
    'gibson-the-paul', 'gibson-thunderbird', 'gibson-thunderbird-bicentennial',
  ],

  /**
   * The Gibson lines a title can name, for the unmatched cohort. Epiphone and
   * other makers' listings stay in scope on purpose: `decideMatch` rejects or
   * defers them, which is the auditable outcome, and filtering them here would
   * hide that.
   */
  /** Every supported row was promoted by this ticket. */
  supportedToday: [],

  lines: [
    { line: 'les-paul', names: /les ?paul|\bthe paul\b/i, ilike: ['%les paul%', '%lespaul%', '%the paul%'] },
    { line: 'sg', names: /\bsg\b/i, ilike: ['%sg%'] },
    { line: 'es', names: /\bes[- ]?3[3-5]\d|\bes[- ]les ?paul/i, ilike: ['%es-3%', '%es 3%', '%es3%', '%es-les%', '%es les%'] },
    { line: 'explorer', names: /explorer/i, ilike: ['%explorer%'] },
    { line: 'flying-v', names: /flying ?v/i, ilike: ['%flying v%', '%flyingv%'] },
    { line: 'firebird', names: /firebird/i, ilike: ['%firebird%'] },
    { line: 'thunderbird', names: /thunderbird/i, ilike: ['%thunderbird%'] },
    {
      line: 'acoustic',
      names: /\bj-?(?:35|45|55|185)\b|hummingbird|\bs?j-?200\b|\bsj-?100\b|\bl-?00\b|\blg-?2\b|advanced jumbo|\bdove\b|\bg-?45\b|\bg-?200\b|\bjumbo\b|\bb-?25\b|\bhp ?665\b|\bl-?[47]c\b/i,
      ilike: [
        '%j-35%', '%j-45%', '%j45%', '%j-55%', '%j-185%', '%hummingbird%', '%j-200%', '%j200%', '%sj-100%',
        '%l-00%', '%lg-2%', '%dove%', '%g-45%', '%g-200%', '%jumbo%', '%b-25%', '%hp 665%', '%l-4c%', '%l-7c%',
      ],
    },
  ],
}

export default config
