import { NextResponse } from 'next/server';

// CSRF protection — a defense-in-depth stack mirroring BiasharaOS:
//
//   1. Double-submit cookie (the BiasharaOS CSRFMiddleware pattern): the app
//      sets a paired `oos_csrf` cookie (non-httpOnly, alongside the httpOnly
//      `oos_session` cookie) at login/register. Every mutating /api request
//      that carries a session cookie MUST echo that value in the
//      X-CSRF-Token header; a cross-site attacker cannot read the cookie, so
//      it cannot send a matching header.
//   2. Sec-Fetch-Site + Origin checks (browser-issued, unspoofable signals)
//      as extra layers on top.
//
// Rules:
//   * GET/HEAD/OPTIONS are side-effect-free — always pass.
//   * Only /api requests are screened (matcher below); pages/static untouched.
//   * Server-to-server, token-authenticated endpoints (the ingest webhook)
//     carry no browser session and are never CSRF-able — exempt.
//   * Pre-auth routes (/api/auth/login, /api/auth/register, /api/admin/login)
//     set the cookie pair but can't double-submit it yet, so they skip that
//     check — but still get the Sec-Fetch-Site/Origin checks, which stops
//     login CSRF (a third-party page signing a victim into the attacker's
//     account). Native clients send neither header and are unaffected.
//   * A request with NO `oos_session` cookie has no ambient browser session —
//     no double-submit applies (native clients, curl, e2e token paths).
//   * When a session cookie IS present, the X-CSRF-Token header must equal the
//     `oos_csrf` cookie; otherwise reject with 403.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SESSION_COOKIE = 'oos_session';
const CSRF_COOKIE = 'oos_csrf';
const ADMIN_SESSION_COOKIE = 'oos_admin_session';
const ADMIN_CSRF_COOKIE = 'oos_admin_csrf';
const CSRF_HEADER = 'x-csrf-token';
// Server-to-server endpoints: no browser session, never CSRF-able.
const EXEMPT_PATHS = new Set(['/api/leads/webhook', '/api/billing/webhook']);
// Pre-auth routes: no session/CSRF cookie to double-submit yet, but they still
// get the browser-issued cross-site checks so a third-party page can't sign a
// victim into an attacker's account (login CSRF).
const PRE_AUTH_PATHS = new Set([
  '/api/auth/login', '/api/auth/register', '/api/admin/login',
  '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/verify-email',
]);

function crossSiteRejection(request) {
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') {
    return NextResponse.json({ ok: false, error: 'Request rejected: cross-site state change' }, { status: 403 });
  }
  const origin = request.headers.get('origin');
  if (origin) {
    const hosts = [request.headers.get('host'), request.headers.get('x-forwarded-host'), request.nextUrl.hostname]
      .filter(Boolean)
      .map((h) => String(h).split(',')[0].trim());
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json({ ok: false, error: 'Request rejected: invalid origin' }, { status: 403 });
    }
    if (!hosts.includes(originHost)) {
      return NextResponse.json({ ok: false, error: 'Request rejected: cross-origin state change' }, { status: 403 });
    }
  }
  return null;
}

export function proxy(request) {
  const { pathname } = request.nextUrl;
  const method = request.method;
  if (!MUTATING.has(method)) return NextResponse.next();
  if (EXEMPT_PATHS.has(pathname)) return NextResponse.next();
  if (PRE_AUTH_PATHS.has(pathname)) return crossSiteRejection(request) || NextResponse.next();

  // Which cookie pair applies: an admin session (oos_admin_session + its own
  // csrf) is screened the same way as a tenant user session (oos_session).
  const isAdmin = Boolean(request.cookies.get(ADMIN_SESSION_COOKIE));
  const sessionCookie = isAdmin ? ADMIN_SESSION_COOKIE : SESSION_COOKIE;
  const csrfCookieName = isAdmin ? ADMIN_CSRF_COOKIE : CSRF_COOKIE;

  // No session cookie → nothing to CSRF (no ambient browser session).
  if (!request.cookies.get(sessionCookie)) return NextResponse.next();

  const rejected = crossSiteRejection(request);
  if (rejected) return rejected;

  // Double-submit cookie check (BiasharaOS CSRFMiddleware parity).
  const csrfCookie = request.cookies.get(csrfCookieName)?.value || '';
  const header = request.headers.get(CSRF_HEADER) || '';
  if (csrfCookie.length === 0 || header.length === 0 || header !== csrfCookie) {
    return NextResponse.json({ ok: false, error: 'Invalid CSRF token' }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};