/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

// Security headers. The CSP and the other headers apply in dev AND prod
// (only HSTS is production-only); the dev CSP additionally allows
// 'unsafe-eval' so HMR keeps working. CSP is deliberately pragmatic:
// 'unsafe-inline' is needed for Next.js-generated inline scripts/styles;
// frame-ancestors 'none' blocks clickjacking, and
// nosniff/HSTS/referrer/permissions cover the main leaks.
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
      // 'unsafe-eval' is only needed by the dev server's HMR/React refresh;
      // production builds don't use eval, so leaving it out closes the
      // easiest XSS escalation path. ('unsafe-inline' stays: Next's inline
      // hydration scripts need it without a nonce setup.)
      isProd ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "object-src 'none'",
      "style-src 'self' 'unsafe-inline'",
      // *.tile.openstreetmap.org: map tiles for the Discover page's area
      // picker (components/MapAreaPicker.js, Leaflet) — loaded as plain
      // <img> tags, so img-src is the only directive that needs it.
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
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