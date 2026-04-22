import type { Listing } from '../supabase'
import { scrapeSchibsted, FINN_CONFIG } from './schibsted'

type ScrapedListing = Omit<Listing, 'id' | 'scraped_at'>

export async function scrapeFinn(query: string, maxPages = 1): Promise<ScrapedListing[]> {
  return scrapeSchibsted(FINN_CONFIG, query, maxPages)
}
