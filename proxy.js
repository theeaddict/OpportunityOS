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
//   * Pre-auth routes (/api/auth/login, /api/auth/register) set the cookie
//     pair but don't depend on it — exempt so a fresh visitor can always get in.
//   * A request with NO `oos_session` cookie has no ambient browser session —
//     no double-submit applies (native clients, curl, e2e token paths).
//   * When a session cookie IS present, the X-CSRF-Token header must equal the
//     `oos_csrf` cookie; otherwise reject with 403.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SESSION_COOKIE = 'oos_session';
const CSRF_COOKIE = 'oos_csrf';
const CSRF_HEADER = 'x-csrf-token';
const EXEMPT_PATHS = new Set(['/api/leads/webhook', '/api/auth/login', '/api/auth/register']);

export function proxy(request) {
  const { pathname } = request.nextUrl;
  const method = request.method;
  if (!MUTATING.has(method)) return NextResponse.next();
  if (EXEMPT_PATHS.has(pathname)) return NextResponse.next();

  // No session cookie → nothing to CSRF (no ambient browser session).
  if (!request.cookies.get(SESSION_COOKIE)) return NextResponse.next();

  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') {
    return NextResponse.json({ ok: false, error: 'Request rejected: cross-site state change' }, { status: 403 });
  }

  const origin = request.headers.get('origin');
  if (origin) {
    const host = request.headers.get('host') || request.nextUrl.hostname || '';
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json({ ok: false, error: 'Request rejected: invalid origin' }, { status: 403 });
    }
    if (originHost !== host) {
      return NextResponse.json({ ok: false, error: 'Request rejected: cross-origin state change' }, { status: 403 });
    }
  }

  // Double-submit cookie check (BiasharaOS CSRFMiddleware parity).
  const csrfCookie = request.cookies.get(CSRF_COOKIE)?.value || '';
  const header = request.headers.get(CSRF_HEADER) || '';
  if (csrfCookie.length === 0 || header.length === 0 || header !== csrfCookie) {
    return NextResponse.json({ ok: false, error: 'Invalid CSRF token' }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};