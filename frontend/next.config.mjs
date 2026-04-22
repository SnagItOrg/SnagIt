/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      // Supabase Storage (onboarding assets, etc.)
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
      // Any subdomain of dba.dk (covers billeder.dba.dk, cdn.dba.dk, etc.)
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
    ],
  },
};

export default nextConfig;
