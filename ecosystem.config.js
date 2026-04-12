module.exports = {
  apps: [
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
    // match-listings: PAUSED — listing_product_match has 17M rows (mostly duplicates).
    // Re-enable after table is cleaned up and a unique index on (listing_id, product_id) is added.
    // {
    //   name: 'match-listings',
    //   script: 'npx',
    //   args: 'tsx scripts/match-listings.ts',
    //   cron_restart: '30 */1 * * *', // every hour at :30 (after scrapers)
    //   autorestart: false,
    //   max_restarts: 0,
    //   max_memory_restart: '512M',
    //   env: { NODE_ENV: 'production' },
    // },
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
