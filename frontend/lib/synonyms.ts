// Maps normalized query → canonical search term.
// Keys must already be normalized (lowercase, ASCII-folded).
// Add entries here as new patterns emerge — no code changes needed elsewhere.
const SYNONYMS: Record<string, string> = {
  'space echo': 'roland re-201',
  're201': 're-201',
  'macmini': 'mac mini',
  'apple mac mini': 'mac mini',
  'imac': 'imac',
  'macbook pro': 'macbook pro',
  'airpods pro': 'airpods pro',
}

/**
 * Returns the canonical synonym for a normalized query, or null if none exists.
 * The caller is responsible for also scraping the original query.
 */
export function lookupSynonym(normalizedQuery: string): string | null {
  return SYNONYMS[normalizedQuery] ?? null
}
