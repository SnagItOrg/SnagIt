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
      // Reverb listing images
      {
        protocol: 'https',
        hostname: 'rvb-img.reverb.com',
      },
      {
        protocol: 'https',
        hostname: 'reverb-res.cloudinary.com',
      },
      {
        protocol: 'https',
        hostname: 'd3ugyf87b0homh.cloudfront.net',
      },
      {
        protocol: 'https',
        hostname: 'images.reverb.com',
      },
    ],
  },
};

export default nextConfig;
