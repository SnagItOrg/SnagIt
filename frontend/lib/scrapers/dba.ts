import type { Listing } from '../supabase'
import { scrapeSchibsted, scrapeSchibstedWithCoverage, DBA_CONFIG, type SchibstedSearchOptions } from './schibsted'

type ScrapedListing = Omit<Listing, 'id' | 'scraped_at'>

/** dba.dk `sub_category` Musikinstrumenter (under Underholdning og hobby). */
export const DBA_MUSIKINSTRUMENTER = '1.86.92'
/** dba.dk top-level `category` Elektronik og hvidevarer. */
export const DBA_ELEKTRONIK = '0.93'

export async function scrapeDba(query: string, maxPages = 1): Promise<ScrapedListing[]> {
  return scrapeSchibsted(DBA_CONFIG, query, maxPages)
}

export async function scrapeDbaWithCoverage(query: string, maxPages = 1, options: SchibstedSearchOptions = {}) {
  return scrapeSchibstedWithCoverage(DBA_CONFIG, query, maxPages, options)
}
