/**
 * E2E tests for password reset + email verification against the real app.
 * Outgoing mail is captured as JSON files in E2E_MAIL_DIR (see lib/mail.js,
 * MAIL_CAPTURE_DIR) instead of being sent. Uses 10.77.2.x source IPs so its
 * rate-limit buckets never collide with the other e2e files.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const BASE = process.env.E2E_APP_BASE_URL || 'http://127.0.0.1:3100';
const MAIL_DIR = process.env.E2E_MAIL_DIR || '/tmp/oos-e2e/mail';
const DB_URL = process.env.DATABASE_URL;
const IS_PG = Boolean(DB_URL && DB_URL.startsWith('postgres'));

const stamp = Date.now();
const PASSWORD = 'EmailAuthCorrectHorse42!';
const NEW_PASSWORD = 'BrandNewHorse77!battery';

let pool = null;

function cookieFrom(res) {
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return all.length ? all.map((c) => c.split(';')[0]).filter(Boolean).join('; ') : null;
}
const csrfFrom = (cookie) => (String(cookie || '').match(/(?:^|;\s*)oos_csrf=([^;]+)/) || [])[1] || null;

class Agent {
  constructor(ip) { this.cookie = null; this.ip = ip; }
  async req(method, url, body) {
    const isSafe = method === 'GET';
    const csrf = csrfFrom(this.cookie);
    const res = await fetch(`${BASE}${url}`, {
      method,
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': this.ip,
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(!isSafe && csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = cookieFrom(res);
    if (set) this.cookie = set;
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, data };
  }
}

async function db(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Emails captured for an address, oldest first. */
function mailsTo(address) {
  if (!fs.existsSync(MAIL_DIR)) return [];
  return fs.readdirSync(MAIL_DIR).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(MAIL_DIR, f), 'utf8')))
    .filter((m) => m.to === address);
}

async function waitForMail(address, count = 1, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const m = mailsTo(address);
    if (m.length >= count) return m;
    await new Promise((r) => setTimeout(r, 150));
  }
  return mailsTo(address);
}

const tokenFrom = (mail, route) => (mail.text.match(new RegExp(`${route}\\?token=([0-9a-f]{64})`)) || [])[1];

before(async () => {
  if (IS_PG) {
    const { default: pg } = await import('pg');
    pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
    const p = new pg.Pool({ connectionString: DB_URL });
    const translate = (sql) => {
      let out = '', n = 0, inStr = false;
      for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (ch === "'" && sql[i - 1] !== '\\') inStr = !inStr;
        out += ch === '?' && !inStr ? `$${++n}` : ch;
      }
      return out;
    };
    pool = { execute: async (sql, params = []) => [(await p.query(translate(sql), params)).rows], end: () => p.end() };
    return;
  }
  pool = await mysql.createPool(DB_URL);
});

after(async () => { if (pool) await pool.end(); });

test('EMAILAUTH01 registering sends a verification link that verifies once and only once', { timeout: 60000 }, async () => {
  const email = `verify-${stamp}@example.test`;
  const a = new Agent('10.77.2.1');
  const reg = await a.req('POST', '/api/auth/register', { name: 'Verify Me', email, password: PASSWORD });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));

  const [before] = await db('SELECT email_verified_at FROM users WHERE email = ?', [email]);
  assert.equal(before.email_verified_at, null, 'a self-registered user starts unverified');

  const mails = await waitForMail(email);
  assert.equal(mails.length, 1, 'exactly one verification email on signup');
  assert.match(mails[0].subject, /verify/i);
  const token = tokenFrom(mails[0], '/verify-email');
  assert.ok(token, `the email must contain a verify link: ${mails[0].text}`);

  // The page itself must render without spending the token (mail scanners GET links).
  const page = await fetch(`${BASE}/verify-email?token=${token}`, { headers: { 'X-Forwarded-For': '10.77.2.2' } });
  assert.equal(page.status, 200);
  const still = await db('SELECT used_at FROM auth_tokens WHERE purpose = ? AND user_id = (SELECT id FROM users WHERE email = ?)', ['email_verify', email]);
  assert.equal(still[0].used_at, null, 'opening the page must not consume the token');

  const bad = await new Agent('10.77.2.3').req('POST', '/api/auth/verify-email', { token: 'a'.repeat(64) });
  assert.equal(bad.status, 400, 'a made-up token is refused');

  const ok = await new Agent('10.77.2.4').req('POST', '/api/auth/verify-email', { token });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const [after] = await db('SELECT email_verified_at FROM users WHERE email = ?', [email]);
  assert.ok(after.email_verified_at, 'user must now be verified');

  const reuse = await new Agent('10.77.2.5').req('POST', '/api/auth/verify-email', { token });
  assert.equal(reuse.status, 400, 'a verification link works only once');

  const resend = await a.req('POST', '/api/auth/resend-verification');
  assert.equal(resend.status, 200);
  assert.equal(resend.data.already_verified, true, 'a verified user is not mailed again');
});

test('EMAILAUTH02 resend-verification mails an unverified user and is rate limited', { timeout: 60000 }, async () => {
  const email = `resend-${stamp}@example.test`;
  const a = new Agent('10.77.2.6');
  assert.equal((await a.req('POST', '/api/auth/register', { name: 'Resend Me', email, password: PASSWORD })).status, 200);
  await waitForMail(email, 1);

  const r1 = await a.req('POST', '/api/auth/resend-verification');
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  const mails = await waitForMail(email, 2);
  assert.equal(mails.length, 2, 'resend sends a fresh email');
  const first = tokenFrom(mails[0], '/verify-email');
  const latest = tokenFrom(mails[1], '/verify-email');
  assert.notEqual(first, latest);
  const oldTry = await new Agent('10.77.2.7').req('POST', '/api/auth/verify-email', { token: first });
  assert.equal(oldTry.status, 400, 'requesting a new link revokes the older one');

  await a.req('POST', '/api/auth/resend-verification');
  await a.req('POST', '/api/auth/resend-verification');
  const limited = await a.req('POST', '/api/auth/resend-verification');
  assert.equal(limited.status, 429, 'resends are capped per user');
});

test('EMAILAUTH03 forgot-password never reveals whether an address has an account', { timeout: 60000 }, async () => {
  const known = `known-${stamp}@example.test`;
  const unknown = `nobody-${stamp}@example.test`;
  assert.equal((await new Agent('10.77.2.8').req('POST', '/api/auth/register', { name: 'Known', email: known, password: PASSWORD })).status, 200);

  const a = new Agent('10.77.2.9');
  const rKnown = await a.req('POST', '/api/auth/forgot-password', { email: known });
  const rUnknown = await a.req('POST', '/api/auth/forgot-password', { email: unknown });
  const rJunk = await a.req('POST', '/api/auth/forgot-password', { email: 'not-an-email' });
  for (const r of [rKnown, rUnknown, rJunk]) assert.equal(r.status, 200);
  assert.deepEqual(rKnown.data, rUnknown.data, 'identical response body for known and unknown addresses');
  assert.deepEqual(rKnown.data, rJunk.data);

  const mails = await waitForMail(known, 2); // verification + reset
  assert.ok(mails.some((m) => /reset/i.test(m.subject)), 'known address receives a reset email');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(mailsTo(unknown).length, 0, 'an unknown address must receive nothing');
});

test('EMAILAUTH04 reset flow: weak password rejected, link works once, old sessions die, new password works', { timeout: 90000 }, async () => {
  const email = `reset-${stamp}@example.test`;
  const victim = new Agent('10.77.2.10');
  assert.equal((await victim.req('POST', '/api/auth/register', { name: 'Reset Me', email, password: PASSWORD })).status, 200);
  assert.equal((await victim.req('GET', '/api/account')).status, 200, 'signed in before the reset');

  const stranger = new Agent('10.77.2.11');
  assert.equal((await stranger.req('POST', '/api/auth/forgot-password', { email })).status, 200);
  const mails = await waitForMail(email, 2);
  const resetMail = mails.find((m) => /reset/i.test(m.subject));
  assert.ok(resetMail, 'reset email sent');
  const token = tokenFrom(resetMail, '/reset-password');
  assert.ok(token, resetMail.text);

  const weak = await stranger.req('POST', '/api/auth/reset-password', { token, password: 'weak' });
  assert.equal(weak.status, 400, 'password policy applies to resets');
  const fake = await stranger.req('POST', '/api/auth/reset-password', { token: 'f'.repeat(64), password: NEW_PASSWORD });
  assert.equal(fake.status, 400, 'an unknown token is refused');

  const done = await stranger.req('POST', '/api/auth/reset-password', { token, password: NEW_PASSWORD });
  assert.equal(done.status, 200, `a weak attempt must not have burned the token: ${JSON.stringify(done.data)}`);

  const reuse = await stranger.req('POST', '/api/auth/reset-password', { token, password: NEW_PASSWORD + 'x' });
  assert.equal(reuse.status, 400, 'a reset link works only once');

  assert.equal((await victim.req('GET', '/api/account')).status, 401, 'the old session must be revoked by a reset');
  const [row] = await db('SELECT email_verified_at FROM users WHERE email = ?', [email]);
  assert.ok(row.email_verified_at, 'following the emailed link proves the inbox, so the address becomes verified');

  const oldLogin = await new Agent('10.77.2.12').req('POST', '/api/auth/login', { email, password: PASSWORD });
  assert.equal(oldLogin.status, 401, 'the old password no longer works');
  const newLogin = new Agent('10.77.2.13');
  const ok = await newLogin.req('POST', '/api/auth/login', { email, password: NEW_PASSWORD });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await newLogin.req('GET', '/api/account')).status, 200);
});

test('EMAILAUTH05 only the newest reset link works, and an expired one is refused', { timeout: 60000 }, async () => {
  const email = `expire-${stamp}@example.test`;
  assert.equal((await new Agent('10.77.2.14').req('POST', '/api/auth/register', { name: 'Expire', email, password: PASSWORD })).status, 200);
  const a = new Agent('10.77.2.15');
  await a.req('POST', '/api/auth/forgot-password', { email });
  const first = tokenFrom((await waitForMail(email, 2)).find((m) => /reset/i.test(m.subject)), '/reset-password');
  await a.req('POST', '/api/auth/forgot-password', { email });
  const all = await waitForMail(email, 3);
  const second = tokenFrom(all.filter((m) => /reset/i.test(m.subject)).pop(), '/reset-password');
  assert.notEqual(first, second);

  const old = await a.req('POST', '/api/auth/reset-password', { token: first, password: NEW_PASSWORD });
  assert.equal(old.status, 400, 'requesting a new link revokes the previous one');

  await db("UPDATE auth_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE purpose = 'password_reset' AND used_at IS NULL AND user_id = (SELECT id FROM users WHERE email = ?)", [email]);
  const expired = await a.req('POST', '/api/auth/reset-password', { token: second, password: NEW_PASSWORD });
  assert.equal(expired.status, 400, 'an expired link is refused');
});

test('EMAILAUTH06 only a hash of each token is stored, never the usable link', { timeout: 30000 }, async () => {
  const email = `hash-${stamp}@example.test`;
  assert.equal((await new Agent('10.77.2.16').req('POST', '/api/auth/register', { name: 'Hash', email, password: PASSWORD })).status, 200);
  const token = tokenFrom((await waitForMail(email, 1))[0], '/verify-email');
  const rows = await db('SELECT token_hash FROM auth_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)', [email]);
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((r) => r.token_hash !== token), 'the raw token must not be stored');
  assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash)));
});

test('EMAILAUTH07 teammates added by an owner count as verified; forgot-password is rate limited per address', { timeout: 60000 }, async () => {
  const owner = new Agent('10.77.2.17');
  const ownerEmail = `owner-${stamp}@example.test`;
  assert.equal((await owner.req('POST', '/api/auth/register', { name: 'Owner', email: ownerEmail, password: PASSWORD })).status, 200);
  const memberEmail = `member-${stamp}@example.test`;
  const add = await owner.req('POST', '/api/account', { name: 'Teammate', email: memberEmail, password: PASSWORD, role: 'member' });
  assert.ok(add.status === 200 || add.status === 201, JSON.stringify(add.data));
  const [m] = await db('SELECT email_verified_at FROM users WHERE email = ?', [memberEmail]);
  assert.ok(m.email_verified_at, 'an owner vouches for a teammate they add');

  // Per-address cap: 3 reset emails/hour, the 4th request silently sends nothing.
  const flood = new Agent('10.77.2.18');
  for (let i = 0; i < 4; i++) {
    const r = await flood.req('POST', '/api/auth/forgot-password', { email: memberEmail });
    assert.equal(r.status, 200, 'the response never changes, even when capped');
  }
  await new Promise((r) => setTimeout(r, 800));
  const resets = mailsTo(memberEmail).filter((x) => /reset/i.test(x.subject));
  assert.equal(resets.length, 3, `at most 3 reset emails per address per hour (got ${resets.length})`);
});
