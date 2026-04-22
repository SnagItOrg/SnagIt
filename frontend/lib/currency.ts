// Static DKK exchange rates for cross-border price comparison.
// Refresh periodically — a ~5% drift is fine for rough comparison but not for
// settlement. Last updated: 2026-04-21.
const DKK_RATES: Record<string, number> = {
  DKK: 1.0,
  SEK: 0.65,
  NOK: 0.60,
  EUR: 7.45,
  USD: 7.00,
  GBP: 8.80,
}

// Display symbol per currency — Nordic sites all use "kr" locally so we
// disambiguate by putting the ISO code in front of "kr".
const CURRENCY_DISPLAY: Record<string, { prefix?: string; suffix: string }> = {
  DKK: { suffix: 'kr' },
  SEK: { prefix: 'SEK', suffix: 'kr' },
  NOK: { prefix: 'NOK', suffix: 'kr' },
  EUR: { suffix: '€' },
  USD: { prefix: '$', suffix: '' },
  GBP: { prefix: '£', suffix: '' },
}

export function formatOriginalPrice(price: number, currency: string): string {
  const code = currency.toUpperCase()
  const display = CURRENCY_DISPLAY[code] ?? { suffix: code }
  const num = price.toLocaleString('da-DK')
  if (display.prefix && display.suffix) return `${display.prefix} ${num} ${display.suffix}`
  if (display.prefix)                   return `${display.prefix}${num}`
  return `${num} ${display.suffix}`.trim()
}

// Convert to DKK using static rates. Returns null for unknown currencies so
// callers can hide the approx label rather than showing a bogus number.
export function toDkkApprox(price: number, currency: string): number | null {
  const rate = DKK_RATES[currency.toUpperCase()]
  if (!rate) return null
  return Math.round(price * rate)
}

export function formatDkkApprox(price: number, currency: string): string | null {
  const code = currency.toUpperCase()
  if (code === 'DKK') return null
  const dkk = toDkkApprox(price, currency)
  if (dkk == null) return null
  return `≈ ${dkk.toLocaleString('da-DK')} kr`
}
