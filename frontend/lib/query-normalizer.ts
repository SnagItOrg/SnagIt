export function normalizeQuery(input: string): string {
  return input
    .toLowerCase()
    .trim()
    // ASCII fold: Danish
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    // ASCII fold: common accented characters
    .replace(/[àáâã]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõ]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ýÿ]/g, 'y')
    .replace(/ñ/g, 'n')
    .replace(/ç/g, 'c')
    .replace(/ß/g, 'ss')
    // German umlauts (after ø/ä share — ö→oe, ä→ae handled above via ASCII fold fallback)
    .replace(/ö/g, 'oe')
    .replace(/ä/g, 'ae')
    // Remove everything except letters, digits, hyphen, space
    .replace(/[^a-z0-9\- ]/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
}
