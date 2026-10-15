/** @type {import('next').NextConfig} */
const nextConfig = {
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
