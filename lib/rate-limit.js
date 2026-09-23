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

/** Best-effort client IP from standard proxy/dev headers. */
export function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return String(fwd).split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'local';
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