import type { NextConfig } from 'next';

// The browser only ever talks to this origin. /api/v1/* is proxied to the Express API, so the
// httpOnly session cookie is first-party and no token is ever exposed to client-side JavaScript.
const API_URL = (process.env.API_URL || 'http://localhost:4000').replace(/\/+$/, '');

function optionalOrigin(raw?: string): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function buildContentSecurityPolicy(): string {
  const isDev = process.env.NODE_ENV !== 'production';
  const apiOrigin = optionalOrigin(process.env.NEXT_PUBLIC_API_URL);
  const scormOrigin = optionalOrigin(process.env.SCORM_CONTENT_ORIGIN);

  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    ...(isDev ? ["'unsafe-eval'"] : []),
    'https://challenges.cloudflare.com',
  ];
  const connectSrc = ["'self'", 'https:', 'wss:', ...(isDev ? ['http:', 'ws:'] : []), ...(apiOrigin ? [apiOrigin] : [])];
  const frameSrc = [
    "'self'",
    'https://challenges.cloudflare.com',
    'https://www.youtube-nocookie.com',
    'https://www.youtube.com',
    'https://player.vimeo.com',
    'https:',
    ...(isDev ? ['http:'] : []),
    ...(scormOrigin ? [scormOrigin] : []),
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https:${isDev ? ' http:' : ''}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(' ')}`,
    `media-src 'self' blob: https:${isDev ? ' http:' : ''}`,
    "worker-src 'self' blob:",
    `frame-src ${frameSrc.join(' ')}`,
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@enterprise-lms/security'],
  devIndicators: false,
  experimental: {
    // Uploads go through the /api/v1 proxy; Next cuts request bodies at 10 MB by default. Keep this above
    // the API's UPLOAD_MAX_MB (100 by default).
    middlewareClientMaxBodySize: '110mb',
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: buildContentSecurityPolicy() },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), display-capture=(self)' },
        ],
      },
    ];
  },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_URL}/api/v1/:path*` }];
  },
};

export default nextConfig;
