/**
 * Adapt a search query for a specific platform.
 * Currently a passthrough — add platform-specific rules here as needed.
 */
export function adaptQuery(query: string, platform: 'dba' | 'reverb' | string): string {
  // Default: pass through as-is
  // Add platform-specific rules here as needed
  void platform
  return query
}
