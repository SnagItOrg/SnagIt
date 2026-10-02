/**
 * scripts/rematch-configs/martin.ts — Martin (PAN-204): the brand's config for scripts/rematch-brand.ts.
 * The lists are the ones scripts/pan204-martin-rematch.ts carried, verbatim (PAN-229).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-204',
  pan: 'pan204',
  brand: 'Martin',

  /** Martin has no family label rows, so no held cohort. */
  labels: [],

  /**
   * The rows the PAN-204 promote SQL moves from `known` to `supported`: the same reviewed list,
   * verbatim. The 8 owner-curated base rows and the 11 step-2 models. Not here: martin-d-28, which is
   * supported already (SUPPORTED_TODAY).
   */
  promoted: [
    'martin-0-18', 'martin-00-18', 'martin-000-18', 'martin-000-18-modern-deluxe',
    'martin-000-28', 'martin-000-28-modern-deluxe', 'martin-000-28-shawn-mendes',
    'martin-d-18', 'martin-d-18-authentic-1937', 'martin-d-18-molly-tuttle', 'martin-d-18-satin',
    'martin-d-28-authentic-1937', 'martin-d-28-billy-strings', 'martin-d-28-modern-deluxe', 'martin-d-28-satin',
    'martin-d-42-modern-deluxe', 'martin-hd-28', 'martin-om-28', 'martin-om-28-modern-deluxe',
  ],

  /** Rows supported TODAY whose live matches the PAN-204 boundaries can change: the D-28. */
  supportedToday: ['martin-d-28'],


  /**
   * The unmatched cohort: active titles that name Martin. Other companies and people named Martin
   * (MartinLogan, the Committee trumpet, Martin Sound, Martin Barre) stay in scope on purpose:
   * `decideMatch` refuses or defers them, which is the auditable outcome.
   */
  lines: [
    { line: 'martin', names: /martin/i, ilike: ['%martin%'] },
  ],
}

export default config
