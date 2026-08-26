/**
 * scripts/lib/match-new-inflow.ts
 *
 * The scripts-side entry point to the ONE bounded writer→matcher handoff.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `scripts/match-listings.ts` selected work by recency across the whole
 * `listings` table (`ORDER BY scraped_at DESC`, up to 500 rows). It had no
 * batch id and no activation boundary, so every hourly run reached arbitrarily
 * far back into the pre-activation unmatched backlog. Meanwhile the PM2
 * marketplace scrapers never called the matcher at all, so real new inflow was
 * only ever matched as a side effect of that backlog scan.
 *
 * This module inverts that: each scraper hands the matcher EXACTLY the listings
 * the DATABASE confirms its own run inserted. Nothing else is eligible.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHERE THE IMPLEMENTATION LIVES
 *
 * `frontend/lib/matching/ingestion-batch.ts`. It moved there when
 * `/api/cron/scrape` — the sixth listing writer, and the only one on Vercel —
 * was brought under the same contract: Next cannot import from `scripts/`,
 * while both sides of the repo already consume `frontend/lib/matching/*`
 * (scripts by relative path, the app by `@/`). One definition now binds every
 * writer. This file re-exports it verbatim, so all five PM2 scrapers keep
 * importing `./lib/match-new-inflow` unchanged.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FAIL-CLOSED. Absent, malformed, mismatched, incomplete, oversized or failed
 * boundary evidence performs ZERO writes and returns `skipped`. There is
 * deliberately no fallback path that selects rows by time, recency or
 * "unmatched" status — the absence of such a fallback is the safety property.
 *
 * NEVER THROWS. A matcher failure must not falsify scraper success or cause a
 * promotion to partially re-run, so every error is caught, logged and
 * reported. The caller's exit code stays owned by the scrape/promotion result.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A NOTE ON "NEW" vs "REFRESHED"
 *
 * Before migration 055, `listings` had NO immutable creation column.
 * `scraped_at` is overwritten by every scraper on every upsert, and
 * `first_seen_at` was bulk backfilled (34,859 rows share one week), so neither
 * can distinguish a first-ever insert from a refresh of an old row — and an
 * upsert's returned ids cannot either, because `ON CONFLICT DO UPDATE` returns
 * refreshed historical rows too.
 *
 * Migration 055 supplies the missing fact: `ingestion_batch_id` is written only
 * by a real INSERT and is carried over verbatim by every UPDATE. Eligibility is
 * therefore EXACT EQUALITY on that stored, trigger-protected value — a legacy
 * NULL row can never acquire one, and a row inserted by an earlier run keeps
 * that earlier run's id and is never handed off again.
 */

export {
  newIngestionBatchId,
  isIngestionBatchId,
  fetchBatchListingIds,
  matchScrapedBatch,
  matchRunInflow,
  reportBatchMatch,
  MAX_BATCH_IDS,
} from '../../frontend/lib/matching/ingestion-batch'

export type {
  BatchMatchResult,
  RunHandoffResult,
} from '../../frontend/lib/matching/ingestion-batch'
