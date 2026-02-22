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
    ],
  },
};

export default nextConfig;
