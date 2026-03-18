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
    {
      name: 'match-listings',
      script: 'npx',
      args: 'tsx scripts/match-listings.ts',
      cron_restart: '30 */1 * * *', // every hour at :30 (after scrapers)
      autorestart: false,
      max_restarts: 0,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
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
    {
      name: 'fetch-thomann-prices',
      script: 'npx',
      args: 'tsx scripts/fetch-thomann-prices.ts',
      cron_restart: '0 4 * * 0', // weekly on Sunday at 04:00
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
