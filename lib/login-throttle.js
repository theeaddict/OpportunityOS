/**
 * Failed-login lockout shared by the tenant and admin sign-in routes.
 *
 * Two layers, so one stranger can't lock someone else out of their account:
 *   - per (account, source IP): `perIpMax` failures lock only that pair. An
 *     attacker guessing from their own address only ever locks themselves out.
 *   - per account across ALL IPs: `perAccountMax` failures (a much higher bar,
 *     only reachable by a distributed guessing campaign) lock the account.
 * Successful login clears the caller's own pair only.
 *
 * In-memory (per process) like lib/rate-limit.js.
 */

const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const EXPIRE_MS = 60 * 60 * 1000;

export function createLoginThrottle({ perIpMax = 5, perAccountMax = 30 } = {}) {
  const pairs = new Map();
  const accounts = new Map();

  const norm = (v) => String(v || '').trim().toLowerCase();

  function sweep(now) {
    for (const m of [pairs, accounts]) {
      for (const [k, t] of m) if (now - t.updatedAt > EXPIRE_MS) m.delete(k);
    }
  }

  function state(map, key, now) {
    const t = map.get(key);
    if (!t) return { locked: false, attempts: 0, remainingMs: 0 };
    if (now - t.updatedAt > WINDOW_MS && !(t.lockedUntil > now)) {
      map.delete(key);
      return { locked: false, attempts: 0, remainingMs: 0 };
    }
    if (t.lockedUntil > now) return { locked: true, attempts: t.attempts, remainingMs: t.lockedUntil - now };
    return { locked: false, attempts: t.attempts, remainingMs: 0 };
  }

  function bump(map, key, max, now) {
    const t = map.get(key);
    const active = t && now - t.updatedAt <= WINDOW_MS;
    const attempts = (active ? t.attempts : 0) + 1;
    let lockedUntil = t && t.lockedUntil > now ? t.lockedUntil : 0;
    if (attempts >= max) lockedUntil = now + LOCKOUT_MS;
    map.set(key, { attempts, updatedAt: now, lockedUntil });
  }

  return {
    status(email, ip) {
      const e = norm(email);
      const now = Date.now();
      const a = state(accounts, e, now);
      if (a.locked) return a;
      return state(pairs, `${e}|${norm(ip)}`, now);
    },
    recordFailure(email, ip) {
      const e = norm(email);
      if (!e) return { locked: false };
      const now = Date.now();
      sweep(now);
      bump(pairs, `${e}|${norm(ip)}`, perIpMax, now);
      bump(accounts, e, perAccountMax, now);
      return this.status(e, ip);
    },
    reset(email, ip) {
      const e = norm(email);
      if (e) pairs.delete(`${e}|${norm(ip)}`);
    },
  };
}
