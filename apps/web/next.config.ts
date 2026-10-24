import type { NextConfig } from 'next';

// The browser only ever talks to this origin. /api/v1/* is proxied to the Express API, so the
// httpOnly session cookie is first-party and no token is ever exposed to client-side JavaScript.
const API_URL = (process.env.API_URL || 'http://localhost:4000').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@enterprise-lms/security'],
  devIndicators: false,
  experimental: {
    // Uploads go through the /api/v1 proxy; Next cuts request bodies at 10 MB by default. Keep this above
    // the API's UPLOAD_MAX_MB (100 by default).
    middlewareClientMaxBodySize: '110mb',
  },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_URL}/api/v1/:path*` }];
  },
};

export default nextConfig;
