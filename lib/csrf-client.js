// Client-side half of the CSRF double-submit pair (proxy.js).
// Reads the non-httpOnly `oos_csrf` cookie (set alongside the session cookie)
// and echoes it as `X-CSRF-Token` on every same-origin mutating fetch.
// Imported as a side-effect from AppShell so the patch is installed once per
// browser session; guarded so SSR / double-import are no-ops.

const CSRF_COOKIE = 'oos_csrf';
const CSRFF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
let installed = false;

function readCookie(name) {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function isSameOrigin(url) {
  if (typeof url !== 'string') return false;
  if (url.startsWith('/')) return true;
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

function install() {
  if (typeof window === 'undefined' || installed || !window.fetch) return;
  installed = true;

  const original = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const req = init ? { ...init } : {};
    const method = String(
      req.method || (typeof input === 'string' ? 'GET' : input?.method) || 'GET'
    ).toUpperCase();

    if (!SAFE_METHODS.has(method) && isSameOrigin(input)) {
      const token = readCookie(CSRF_COOKIE);
      if (token) {
        const headers = new Headers(req.headers);
        headers.set(CSRFF_HEADER, token);
        req.headers = headers;
      }
    }
    return original(input, req);
  };
}

if (typeof window !== 'undefined') install();