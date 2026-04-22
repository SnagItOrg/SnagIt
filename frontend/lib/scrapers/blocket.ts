import type { Listing } from '../supabase'
import { scrapeSchibsted, BLOCKET_CONFIG } from './schibsted'

type ScrapedListing = Omit<Listing, 'id' | 'scraped_at'>

export async function scrapeBlocket(query: string, maxPages = 1): Promise<ScrapedListing[]> {
  return scrapeSchibsted(BLOCKET_CONFIG, query, maxPages)
}
