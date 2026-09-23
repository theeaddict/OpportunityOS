/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

// Security headers applied in production builds (kept off in dev to keep HMR
// working). CSP is deliberately pragmatic: 'unsafe-inline' is needed for
// Next.js-generated inline scripts/styles; frame-ancestors 'none' blocks
// clickjacking, and nosniff/HSTS/referrer/permissions cover the main leaks.
const securityHeaders = [
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

if (isProd) {
  securityHeaders.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  });
}

const nextConfig = {
  // Allow a second `next dev` to run in parallel (e.g. npm test while the
  // interactive server is up) without tripping the per-distDir dev lock.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;