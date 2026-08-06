import type { Listing } from '../supabase'
import { scrapeSchibsted, scrapeSchibstedWithCoverage, DBA_CONFIG } from './schibsted'

type ScrapedListing = Omit<Listing, 'id' | 'scraped_at'>

export async function scrapeDba(query: string, maxPages = 1): Promise<ScrapedListing[]> {
  return scrapeSchibsted(DBA_CONFIG, query, maxPages)
}

export async function scrapeDbaWithCoverage(query: string, maxPages = 1) {
  return scrapeSchibstedWithCoverage(DBA_CONFIG, query, maxPages)
}
