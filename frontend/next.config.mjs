// PAN-298. The Content Security Policy, REPORT-ONLY for now: nothing is
// blocked, violations are posted to /api/csp-report and land in the Vercel
// log as `csp_violation` lines. Enforcing it (Content-Security-Policy, and
// dropping 'unsafe-inline' for a nonce) is a later, separate change, taken
// once the report-only log has been quiet for a while.
//
// The sources are the hosts the page actually talks to: PostHog EU (the
// client in components/PostHogProvider.tsx, plus the assets host posthog-js
// lazy-loads from), Supabase (REST, auth and storage images), Vercel Speed
// Insights (components/AnalyticsRoot.tsx; the script is served from the site's
// own origin on Vercel, from va.vercel-scripts.com in dev) and the listing
// image hosts, which `img-src https:` covers as a class — the exact list is
// `images.remotePatterns` below. `next dev` needs eval for HMR.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''} https://eu.i.posthog.com https://eu-assets.i.posthog.com https://va.vercel-scripts.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://eu.i.posthog.com https://eu-assets.i.posthog.com https://*.supabase.co wss://*.supabase.co https://vitals.vercel-insights.com https://api.frankfurter.app",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'report-uri /api/csp-report',
].join('; ')

// HSTS is deliberately absent: Cloudflare already answers
// `strict-transport-security: max-age=63072000` in front of Vercel, and a
// second copy here would only add a header to reconcile.
const securityHeaders = [
  { key: 'Content-Security-Policy-Report-Only', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // `x-powered-by: Next.js` names the framework to every caller for no benefit.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
  images: {
    // Next.js 16 raised the default from 60 s to 4 h; PAN-167 pinned the Next
    // 15 value (60) so the upgrade changed no caching behaviour, and called
    // raising it a separate, deliberate decision. PAN-263 is that decision.
    // Supabase Storage answers `cache-control: no-cache`, so at 60 s the
    // optimiser re-fetched and re-encoded every product image after a minute
    // idle: measured MISS, 420 ms TTFB for an 18 kB hero. One day. The cost
    // is the one PAN-167 named: a product image re-uploaded under the SAME
    // storage key shows the old file for up to a day — upload under a new
    // key instead.
    minimumCacheTTL: 86400,
    remotePatterns: [
      // Supabase Storage (onboarding assets, etc.)
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
      // Any subdomain of dba.dk (covers billeder.dba.dk, cdn.dba.dk, etc.)
      {
        // Kleinanzeigen listing photos. An existing production source, not a new
        // CDN: 14 of the 50 images on roland-juno-106 come from here and were
        // silently falling back to the placeholder because the host was never
        // declared. Narrow on purpose — exact host, exact protocol, and the one
        // path prefix every live URL uses.
        protocol: 'https',
        hostname: 'img.kleinanzeigen.de',
        pathname: '/api/v1/prod-ads/images/**',
      },
      {
        protocol: 'https',
        hostname: '**.dba.dk',
      },
      // Any subdomain of dbastatic.dk (covers images.dbastatic.dk, etc.)
      {
        protocol: 'https',
        hostname: '**.dbastatic.dk',
      },
      // Root dbastatic.dk without subdomain
      {
        protocol: 'https',
        hostname: 'dbastatic.dk',
      },
      // autobild.dk CDN (sometimes used for dba listings)
      {
        protocol: 'https',
        hostname: '**.autobild.dk',
      },
      // Finn.no listing images
      {
        protocol: 'https',
        hostname: '**.finncdn.no',
      },
      // Blocket.se listing images
      {
        protocol: 'https',
        hostname: '**.blocketcdn.se',
      },
      // Reverb listing images (wildcard covers rvb-img, images, etc.)
      {
        protocol: 'https',
        hostname: '**.reverb.com',
      },
      {
        protocol: 'https',
        hostname: 'reverb-res.cloudinary.com',
      },
      {
        protocol: 'https',
        hostname: 'd3ugyf87b0homh.cloudfront.net',
      },
      // Thomann product images (thomann.de CDN + thomannmusic.com search)
      {
        protocol: 'https',
        hostname: '**.thomann.de',
      },
      {
        protocol: 'https',
        hostname: 'fast-images.static-thomann.de',
      },
      // Thomann thumbnail CDN (`**.thomann.de` does NOT match static-thomann.de)
      {
        protocol: 'https',
        hostname: '**.static-thomann.de',
      },
      {
        protocol: 'https',
        hostname: '**.thomannmusic.com',
      },
      // Unsplash (product + category stock photos)
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      // Pexels (editorial hero photos). Only roland-tr-909's hero today; without
      // it the optimiser answered 400 on /browse/keyboards-and-synths.
      {
        protocol: 'https',
        hostname: 'images.pexels.com',
        pathname: '/photos/**',
      },
    ],
  },
};

export default nextConfig;
