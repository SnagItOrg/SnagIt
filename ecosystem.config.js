module.exports = {
  apps: [
    {
      // DBA.dk — the Danish home market. Highest-value source: local-market
      // price gaps live here. Runs at 00:30, before the other Nordic scrapers,
      // so the most important market is collected first if anything wedges.
      // Also appends asking-price history to market_price_observations.
      // PAN-254: a brand net — one query per brand in
      // data/klup-source-monitoring.json, ~215 requests, ~20 min, done before
      // recheck-demand reads dba.dk ad pages at 01:30.
      name: 'scrape-dba',
      script: 'npx',
      args: 'tsx scripts/scrape-dba.ts',
      cron_restart: '30 0 * * *', // daily at 00:30
      autorestart: false,
      max_restarts: 0,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'scrape-blocket',
      script: 'npx',
      args: 'tsx scripts/scrape-blocket.ts',
      cron_restart: '0 1 * * *', // daily at 01:00
      autorestart: false,
      max_restarts: 0,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'scrape-finn',
      script: 'npx',
      args: 'tsx scripts/scrape-finn.ts',
      cron_restart: '0 1 * * *', // daily at 01:00
      autorestart: false,
      max_restarts: 0,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'scrape-kleinanzeigen',
      script: 'npx',
      args: 'tsx scripts/scrape-kleinanzeigen.ts',
      cron_restart: '0 1 * * *', // daily at 01:00
      autorestart: false,
      max_restarts: 0,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'scrape-reverb',
      script: 'npx',
      args: 'tsx scripts/scrape-reverb.ts',
      cron_restart: '0 2 * * *', // daily at 02:00
      autorestart: false,
      max_restarts: 0,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    // ── `match-listings` REMOVED as a scheduled job ──────────────────────────
    //
    // It selected work by recency across the whole `listings` table
    // (ORDER BY scraped_at DESC, up to 500 rows) with no batch id and no
    // activation boundary, so every hourly run reached into the
    // pre-activation unmatched backlog.
    //
    // New inflow is now matched inside each scraper, bounded to the listing
    // ids that run itself wrote (scripts/lib/match-new-inflow.ts). Keeping the
    // hourly job as well would mean two writers to listing_product_match, one
    // of them unbounded — so the schedule is removed rather than retained.
    //
    // scripts/match-listings.ts still exists but now refuses to run without
    // `--historical-backfill --sources= --max=`, and is dry-run unless
    // `--apply` is passed. That mode is separately authorised and is NOT
    // reachable from any schedule in this file.
    {
      name: 'fetch-reverb-prices',
      script: 'npx',
      args: 'tsx scripts/fetch-reverb-prices.ts',
      cron_restart: '0 3 * * *', // daily at 03:00
      autorestart: false,
      max_restarts: 0,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    // build-thomann-urls: RETIRED — replaced by demand-driven thomann_product table.
    // URLs are now confirmed when users search on klup.dk, not guessed from sitemap.
    // {
    //   name: 'build-thomann-urls',
    //   script: 'npx',
    //   args: 'tsx scripts/build-thomann-urls.ts',
    //   cron_restart: '0 3 * * 0',
    //   autorestart: false,
    //   max_restarts: 0,
    //   max_memory_restart: '512M',
    //   env: { NODE_ENV: 'production' },
    // },
    {
      name: 'fetch-thomann-prices',
      script: 'npx',
      args: 'tsx scripts/fetch-thomann-prices.ts',
      cron_restart: '0 3 * * 0', // weekly on Sunday at 03:00 (bi-weekly staleness: skip if fresh)
      autorestart: false,
      max_restarts: 0,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      // PAN-247: re-read every DBA ad pasted into /tjek-prisen, mark it sold or
      // removed, refresh the identification and queue a Reverb price fetch for a
      // matched active ad. After scrape-dba (00:30), before fetch-reverb-prices
      // (03:00). Writes only price_check_demand and price_fetch_queue.
      name: 'recheck-demand',
      script: 'npx',
      args: 'tsx scripts/recheck-demand.ts --apply',
      cron_restart: '30 1 * * *', // daily at 01:30
      autorestart: false,
      max_restarts: 0,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      // PAN-264 (owner decision 2026-10-15, 6a; "kør på" 2026-10-16): nightly retention. Deletes
      // listings inactive for 30 days that nothing references and
      // listing_staging rows 14 days old whose run was promoted. Exports every
      // row it deletes to ~/klup-purge-exports/<run>/ first, and refuses a night
      // above --max (3,000 listings, 10,000 staged rows). The one-time PAN-264
      // purge ran 2026-10-16.
      name: 'purge-stale',
      script: 'npx',
      args: 'tsx scripts/purge-stale.ts --apply',
      cron_restart: '30 4 * * *', // daily at 04:30, after the scrapers and fetch-reverb-prices
      autorestart: false,
      max_restarts: 0,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      // PAN-266 (owner "kør på" 2026-10-16): the nightly recall canary. Read-only: DBA's own search for 38
      // public products against what the product page shows, with the class of
      // every miss. Exit 1 and a "[recall-canary] FAIL" line below 80 % recall or
      // when a product with real supply shows nothing. After scrape-reverb (02:00)
      // and its matcher, and after process-price-queue has had its hour.
      name: 'recall-canary',
      script: 'npx',
      args: 'tsx scripts/recall-canary.ts --json=/Users/panter/klup-rollbacks/recall-canary-latest.json',
      cron_restart: '0 5 * * *', // daily at 05:00
      autorestart: false,
      max_restarts: 0,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      // PAN-12 (owner "Live nu" 2026-10-19; 066 applied the same day): one email
      // per active watchlist with the night's new hits, each (watchlist, listing)
      // pair at most once (migration 066). Reads listings only. After the whole
      // nightly chain: scrape-reverb (02:00) has ended as late as 04:37,
      // purge-stale is 04:30, recall-canary 05:00.
      name: 'notify-watchlists',
      script: 'npx',
      args: 'tsx scripts/notify-watchlists.ts --apply',
      cron_restart: '0 6 * * *', // daily at 06:00
      autorestart: false,
      max_restarts: 0,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'process-price-queue',
      script: 'npx',
      args: 'tsx scripts/process-price-queue.ts',
      cron_restart: '*/5 * * * *', // every 5 minutes
      autorestart: false,
      max_restarts: 0,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
