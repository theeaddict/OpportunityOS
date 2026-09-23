/**
 * Polite public-web fetcher used by the website research provider.
 *
 * COMPLIANCE:
 *  - robots.txt honored for User-agent: * (cached per host, default allow on
 *    unreachable/absent robots.txt)
 *  - per-host minimum interval (default 10s) and a hard timeout
 *  - response size cap; only text/html or text/plain accepted
 *  - no auth, no cookies, no CAPTCHA interaction: if a page blocks us, we skip it
 */

const hostLastFetch = new Map();
const robotsCache = new Map();

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
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': c.userAgent },
      signal: AbortSignal.timeout(Math.min(c.timeoutMs, 8000)),
      redirect: 'follow',
    });
    if (res.ok) robots = parseRobots(await res.text());
  } catch {
    // unreachable robots.txt -> default allow (standard practice)
  }
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
  hostLastFetch.set(parsed.host, Date.now());

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': c.userAgent, Accept: 'text/html,text/plain' },
      signal: AbortSignal.timeout(c.timeoutMs),
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const type = res.headers.get('content-type') || '';
    if (!/text\/html|text\/plain/.test(type)) {
      return { ok: false, reason: `unsupported content-type ${type.split(';')[0]}` };
    }
    const buf = await res.arrayBuffer();
    const sliced = buf.byteLength > c.maxBytes ? buf.slice(0, c.maxBytes) : buf;
    const text = new TextDecoder('utf-8', { fatal: false }).decode(sliced);
    return { ok: true, text, finalUrl: res.url || url };
  } catch (err) {
    return { ok: false, reason: err.name === 'TimeoutError' ? 'timeout' : String(err.message || err).slice(0, 120) };
  }
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
