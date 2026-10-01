/**
 * SSRF guard tests (lib/net/safe-fetch.js) — no external network needed:
 * every case here must be refused before any byte leaves the machine.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isPrivateAddress, safeGet } from '../lib/net/safe-fetch.js';
import { politeFetch } from '../lib/services/research/polite-fetcher.js';

test('isPrivateAddress flags loopback, private, link-local, metadata and reserved IPv4', () => {
  for (const ip of ['127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test('isPrivateAddress allows ordinary public IPv4', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('isPrivateAddress flags IPv6 loopback/ULA/link-local and v4-embedded forms', () => {
  for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
    '::ffff:169.254.169.254', '64:ff9b::a00:1', '2002:c0a8:0101::1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
  assert.equal(isPrivateAddress('::ffff:8.8.8.8'), false);
});

test('isPrivateAddress refuses anything that is not an IP', () => {
  assert.equal(isPrivateAddress('not-an-ip'), true);
  assert.equal(isPrivateAddress(''), true);
});

test('safeGet refuses internal targets before connecting', async () => {
  // A real local server — if the guard failed this would be reached.
  let hit = false;
  const server = http.createServer((_, res) => { hit = true; res.end('secret'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    for (const url of [
      `http://127.0.0.1:${port}/`,        // literal loopback + non-standard port
      'http://127.0.0.1/',                // literal loopback, standard port
      'http://localhost/',                // name resolving to loopback
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://2130706433/',               // decimal form of 127.0.0.1
      'http://0x7f.1/',                   // hex/short form
      'http://user:pass@example.com/',
      'ftp://example.com/',
      'file:///etc/passwd',
      'http://example.com:22/',
    ]) {
      const r = await safeGet(url, { timeoutMs: 3000 });
      assert.equal(r.ok, false, `${url} must be refused`);
    }
    assert.equal(hit, false, 'the local server must never have been contacted');
  } finally {
    server.close();
  }
});

test('safeGet reports invalid URLs without throwing', async () => {
  assert.deepEqual(await safeGet('not a url'), { ok: false, reason: 'invalid URL' });
});

test('politeFetch inherits the guard (robots.txt probe and page fetch both blocked)', async () => {
  const r = await politeFetch('http://169.254.169.254/latest/meta-data/');
  assert.equal(r.ok, false);
  assert.match(r.reason, /blocked|non-public/);
});
