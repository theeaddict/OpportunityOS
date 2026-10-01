/**
 * Polite public-web fetcher used by the website research provider.
 *
 * COMPLIANCE:
 *  - robots.txt honored for User-agent: * (cached per host, default allow on
 *    unreachable/absent robots.txt)
 *  - per-host minimum interval (default 10s) and a hard timeout
 *  - response size cap (enforced while streaming); only text/html or text/plain accepted
 *  - SSRF-safe: private/loopback/metadata addresses are refused at connect time,
 *    redirects are re-validated hop by hop (see lib/net/safe-fetch.js)
 *  - no auth, no cookies, no CAPTCHA interaction: if a page blocks us, we skip it
 */

import { safeGet } from '@/lib/net/safe-fetch';

const hostLastFetch = new Map();
const robotsCache = new Map();
const MAX_TRACKED_HOSTS = 2000;

// Both maps are keyed by attacker-influenceable hostnames; prune so a stream of
// distinct hosts can't grow them without bound.
function pruneTracking() {
  const cutoff = Date.now() - 3600_000;
  for (const [k, t] of hostLastFetch) if (t < cutoff) hostLastFetch.delete(k);
  for (const [k, v] of robotsCache) if (v.at < cutoff) robotsCache.delete(k);
  for (const m of [hostLastFetch, robotsCache]) {
    while (m.size > MAX_TRACKED_HOSTS) m.delete(m.keys().next().value);
  }
}

function cfg() {
  return {
    userAgent: process.env.RESEARCH_USER_AGENT || 'OpportunityOS-ResearchBot/1.0 (+public research; respects robots.txt)',
    minHostIntervalMs: Number(process.env.RESEARCH_MIN_HOST_INTERVAL_MS || 10_000),
    timeoutMs: Number(process.env.RESEARCH_TIMEOUT_MS || 15_000),
    maxBytes: Number(process.env.RESEARCH_MAX_BYTES || 2_000_000),
    respectRobots: process.env.RESEARCH_RESPECT_ROBOTS !== 'false',
  };
}

/** Parse robots.txt body -> { allowed(path): boolean } for User-agent: *. */
export function parseRobots(text) {
  const rules = [];
  let inStar = false;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      inStar = value === '*';
    } else if (inStar && key === 'disallow') {
      if (value) rules.push({ type: 'disallow', path: value });
      else rules.push({ type: 'allow-all' });
    } else if (inStar && key === 'allow') {
      if (value) rules.push({ type: 'allow', path: value });
    }
  }
  return {
    allowed(path) {
      const p = '/' + String(path || '').replace(/^\//, '');
      let longest = null;
      for (const r of rules) {
        if (r.type === 'allow-all') { if (!longest || longest.type !== 'disallow') longest = longest ? longer(r, longest) : r; continue; }
        if (p.startsWith(r.path)) {
          longest = longest && longest.path.length > r.path.length ? longest : r;
        }
      }
      return !(longest && longest.type === 'disallow');
    },
  };
}

function longer(a, b) {
  return (b?.path?.length || 0) > (a.path?.length || 0) ? b : a;
}

async function getRobots(origin) {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.at < 3600_000) return cached.robots;
  const c = cfg();
  let robots = { allowed: () => true };
  // Unreachable/blocked robots.txt -> default allow (standard practice). The
  // URL still goes through the SSRF guard, so this can't probe internal hosts.
  const res = await safeGet(`${origin}/robots.txt`, {
    headers: { 'User-Agent': c.userAgent },
    timeoutMs: Math.min(c.timeoutMs, 8000),
    maxBytes: 200_000,
  });
  if (res.ok) robots = parseRobots(new TextDecoder('utf-8', { fatal: false }).decode(res.body));
  pruneTracking();
  robotsCache.set(origin, { at: Date.now(), robots });
  return robots;
}

/**
 * Fetch a public page politely.
 * Returns { ok:true, text, finalUrl } or { ok:false, reason } — never throws.
 */
export async function politeFetch(url) {
  const c = cfg();
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, reason: 'only http(s) URLs are fetched' };
  }

  if (c.respectRobots) {
    const robots = await getRobots(parsed.origin);
    if (!robots.allowed(parsed.pathname)) {
      return { ok: false, reason: `robots.txt disallows ${parsed.pathname}` };
    }
  }

  // Per-host rate limiting
  const last = hostLastFetch.get(parsed.host) || 0;
  const wait = last + c.minHostIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  pruneTracking();
  hostLastFetch.set(parsed.host, Date.now());

  const res = await safeGet(url, {
    headers: { 'User-Agent': c.userAgent, Accept: 'text/html,text/plain' },
    timeoutMs: c.timeoutMs,
    maxBytes: c.maxBytes,
    acceptTypes: /text\/html|text\/plain/,
  });
  if (!res.ok) return { ok: false, reason: res.reason };
  const text = new TextDecoder('utf-8', { fatal: false }).decode(res.body);
  return { ok: true, text, finalUrl: res.finalUrl || url };
}

/** Very small HTML → text extraction (no external deps). */
export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
