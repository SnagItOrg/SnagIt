import type { Listing } from '../supabase'
import { scrapeSchibsted, DBA_CONFIG } from './schibsted'

type ScrapedListing = Omit<Listing, 'id' | 'scraped_at'>

export async function scrapeDba(query: string, maxPages = 1): Promise<ScrapedListing[]> {
  return scrapeSchibsted(DBA_CONFIG, query, maxPages)
}
