module.exports = {
  apps: [
    {
      // DBA.dk — the Danish home market. Highest-value source: local-market
      // price gaps live here. Runs at 00:30, before the other Nordic scrapers,
      // so the most important market is collected first if anything wedges.
      // Also appends asking-price history to market_price_observations.
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
