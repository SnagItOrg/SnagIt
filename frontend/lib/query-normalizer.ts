export function normalizeQuery(input: string): string {
  return input
    .toLowerCase()
    .trim()
    // ASCII fold: common accented characters (non-Danish)
    .replace(/[àáâã]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõ]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ýÿ]/g, 'y')
    .replace(/ñ/g, 'n')
    .replace(/ç/g, 'c')
    .replace(/ß/g, 'ss')
    // German umlauts — fold to ASCII equivalents
    .replace(/ö/g, 'oe')
    .replace(/ä/g, 'ae')
    // Remove everything except letters, digits, Danish chars (æøå), hyphen, space, wildcard
    .replace(/[^a-z0-9æøå\-* ]/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
}
