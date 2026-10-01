import { HttpError } from '@/lib/api-helpers';

/**
 * Lightweight in-memory fixed-window rate limiter.
 *
 * Sufficient for a single-instance deployment (per-process counters). For
 * multi-instance HA this would need a shared store (Redis etc.). It only gates
 * request volume — it never reveals auth internals.
 *
 * Usage (route handler):
 *   enforce(request, { limit: 10, windowMs: 15 * 60_000, key: 'login' });
 * Throws HttpError(429) when the limit is exceeded.
 */

const buckets = new Map();
let lastSweep = Date.now();

function now() {
  return Date.now();
}

/** Fixed window: bucket expires wholesale after windowMs. */
export function rateLimit(key, { limit, windowMs }) {
  const t = now();
  let b = buckets.get(key);
  if (!b || t - b.resetAt >= windowMs) {
    b = { resetAt: t + windowMs, count: 0 };
    buckets.set(key, b);
  }
  b.count += 1;

  // Opportunistic sweep so the map never grows without bound.
  if (t - lastSweep > 60_000) {
    lastSweep = t;
    for (const [k, v] of buckets) {
      if (t - v.resetAt >= windowMs) buckets.delete(k);
    }
  }

  return {
    ok: b.count <= limit,
    remaining: Math.max(0, limit - b.count),
    retryAfterMs: Math.max(0, b.resetAt - t),
  };
}

/**
 * Best-effort client IP from standard proxy/dev headers.
 *
 * SECURITY: X-Forwarded-For is attacker-controlled input unless something in
 * front of this process overwrites it. Deploying this app with Node directly
 * exposed to the internet (no reverse proxy) makes every enforce() call
 * trivially bypassable — an attacker sends a fresh X-Forwarded-For value on
 * every request and gets a fresh rate-limit bucket every time, defeating the
 * login/admin-login brute-force throttle entirely.
 *
 * Mitigation: only the entry appended by YOUR OWN proxy is trusted — the
 * RIGHTMOST one (anything to its left was supplied by the client and is
 * ignored). TRUSTED_PROXY_HOPS says how many proxies you run in front of the
 * app (default 1, e.g. nginx, or a platform load balancer; use 2 for
 * CDN + nginx). Both nginx styles are correct with 1 hop
 * (`$remote_addr` or `$proxy_add_x_forwarded_for`).
 *
 * TRUSTED_PROXY_HOPS=0 means "no proxy": headers are ignored entirely and all
 * callers share one bucket per route — safe against spoofing, but one noisy
 * client can exhaust it. Prefer running behind a proxy. Never expose
 * `next start` directly to the internet with the default of 1, since then the
 * whole header is client-controlled.
 */
function trustedHops() {
  const n = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

export function clientIp(request) {
  const hops = trustedHops();
  if (hops === 0) return 'direct';
  const parts = String(request.headers.get('x-forwarded-for') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = parts.length
    ? parts[Math.max(0, parts.length - hops)]
    : request.headers.get('x-real-ip') || 'local';
  return String(ip).slice(0, 64);
}

/** Enforce a per-IP fixed-window limit; throws HttpError(429) when exceeded. */
export function enforce(request, { limit, windowMs, key }) {
  const r = rateLimit(`${key}:${clientIp(request)}`, { limit, windowMs });
  if (!r.ok) {
    const retry = new HttpError(429, 'Too many requests — please try again shortly.');
    retry.retryAfterMs = r.retryAfterMs;
    throw retry;
  }
  return r;
}