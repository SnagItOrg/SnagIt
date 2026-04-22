export const ACTIVE_PLATFORMS = ['DBA', 'Finn', 'Blocket', 'Reverb'] as const
export type Platform = typeof ACTIVE_PLATFORMS[number]

// Human readable list for copy: "DBA og Reverb" / "DBA, Reverb og Facebook"
export function platformList(locale: 'da' | 'en'): string {
  if ((ACTIVE_PLATFORMS as readonly string[]).length === 1) return ACTIVE_PLATFORMS[0]
  const last = ACTIVE_PLATFORMS[ACTIVE_PLATFORMS.length - 1]
  const rest = ACTIVE_PLATFORMS.slice(0, -1).join(', ')
  const conjunction = locale === 'da' ? 'og' : 'and'
  return `${rest} ${conjunction} ${last}`
}
