import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';

/**
 * SSRF-safe HTTP GET for user-influenced URLs (business websites).
 *
 * Every hop is protected at three layers:
 *   1. scheme/port allow-list (http/https on 80/443 only)
 *   2. literal-IP hosts are checked before connecting
 *   3. hostnames are resolved by OUR lookup hook, which rejects any private,
 *      loopback, link-local, metadata or reserved address — the address that is
 *      validated is the exact address the socket connects to, so DNS rebinding
 *      cannot swap it afterwards.
 * Redirects are followed manually (each hop re-validated) and the body is
 * streamed under a hard byte cap measured AFTER decompression.
 */

const blocked = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv4'));
[
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['2001:db8::', 32], ['100::', 64],
].forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv6'));

/** True when an IP must never be fetched from a server-side request. */
export function isPrivateAddress(ip) {
  const family = net.isIP(ip);
  if (!family) return true; // not an IP at all -> refuse
  if (family === 4) return blocked.check(ip, 'ipv4');
  const lower = ip.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:aabb:ccdd) and NAT64 (64:ff9b::/96)
  // embed an IPv4 address — judge that address instead.
  const dotted = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return blocked.check(dotted[1], 'ipv4');
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return blocked.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, 'ipv4');
  }
  // 6to4 (2002::/16) embeds an IPv4 in bits 16..48.
  if (lower.startsWith('2002:')) return true;
  return blocked.check(ip, 'ipv6');
}

function guardedLookup(hostname, options, callback) {
  const opts = typeof options === 'function' ? {} : { ...options };
  const cb = typeof options === 'function' ? options : callback;
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return cb(Object.assign(new Error('blocked: host resolves to a non-public address'), { code: 'EBLOCKED' }));
    }
    if (opts.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}

function checkUrl(url) {
  if (!['http:', 'https:'].includes(url.protocol)) return 'only http(s) URLs are fetched';
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (port !== '80' && port !== '443') return 'only standard web ports (80/443) are fetched';
  if (url.username || url.password) return 'URLs with embedded credentials are not fetched';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateAddress(host)) return 'blocked: non-public address';
  return null;
}

const DECODERS = {
  gzip: () => zlib.createGunzip(),
  deflate: () => zlib.createInflate(),
  br: () => zlib.createBrotliDecompress(),
};

function once(url, { headers, timeoutMs, maxBytes, acceptTypes }) {
  return new Promise((resolve) => {
    const lib = url.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const req = lib.request(
      url,
      { method: 'GET', headers: { 'Accept-Encoding': 'gzip, deflate, br', ...headers }, lookup: guardedLookup },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return done({ redirect: new URL(res.headers.location, url) });
        }
        const contentType = String(res.headers['content-type'] || '');
        if (status < 200 || status >= 300) {
          res.resume();
          return done({ ok: false, reason: `HTTP ${status}` });
        }
        if (acceptTypes && !acceptTypes.test(contentType)) {
          res.destroy();
          return done({ ok: false, reason: `unsupported content-type ${contentType.split(';')[0]}` });
        }
        const enc = String(res.headers['content-encoding'] || '').toLowerCase().trim();
        let stream = res;
        if (enc && enc !== 'identity') {
          if (!DECODERS[enc]) {
            res.destroy();
            return done({ ok: false, reason: `unsupported content-encoding ${enc.slice(0, 20)}` });
          }
          stream = res.pipe(DECODERS[enc]());
          stream.on('error', () => done({ ok: false, reason: 'could not decode response' }));
        }
        const chunks = [];
        let total = 0;
        stream.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            chunks.push(chunk.subarray(0, chunk.length - (total - maxBytes)));
            res.destroy();
            done({ ok: true, status, contentType, body: Buffer.concat(chunks), truncated: true });
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => done({ ok: true, status, contentType, body: Buffer.concat(chunks) }));
        stream.on('error', () => done({ ok: false, reason: 'read error' }));
        res.on('error', () => done({ ok: false, reason: 'read error' }));
      }
    );
    const timer = setTimeout(() => {
      req.destroy();
      done({ ok: false, reason: 'timeout' });
    }, timeoutMs);
    req.on('error', (err) => {
      done({
        ok: false,
        reason: err.code === 'EBLOCKED' ? 'blocked: host resolves to a non-public address' : String(err.message || err).slice(0, 120),
      });
    });
    req.end();
  });
}

/**
 * GET a public URL. Returns { ok:true, status, contentType, body:Buffer,
 * finalUrl, truncated? } or { ok:false, reason }. Never throws.
 */
export async function safeGet(rawUrl, { headers = {}, timeoutMs = 15_000, maxBytes = 2_000_000, acceptTypes = null, maxRedirects = 5 } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const problem = checkUrl(url);
    if (problem) return { ok: false, reason: problem };
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, reason: 'timeout' };
    const r = await once(url, { headers, timeoutMs: remaining, maxBytes, acceptTypes });
    if (r.redirect) {
      url = r.redirect;
      continue;
    }
    return r.ok ? { ...r, finalUrl: url.href } : r;
  }
  return { ok: false, reason: 'too many redirects' };
}
