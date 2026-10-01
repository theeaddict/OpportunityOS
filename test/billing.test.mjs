/**
 * E2E test for the Stripe billing loop (checkout -> webhook -> plan_code),
 * run against the real app + mock-stripe (scripts/mock-stripe.mjs) started by
 * scripts/run-e2e.mjs. This is the single most consequential new code path —
 * it's the only writer of accounts.plan_code from an external event — so it
 * gets its own end-to-end exercise rather than trusting the unit tests alone.
 *
 * Environment (set by the orchestrator): E2E_APP_BASE_URL, E2E_STRIPE_URL,
 * DATABASE_URL (postgres:// or mysql://, the suite adapts automatically).
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const BASE = process.env.E2E_APP_BASE_URL || 'http://127.0.0.1:3100';
const STRIPE_URL = process.env.E2E_STRIPE_URL || 'http://127.0.0.1:4324';
const DB_URL = process.env.DATABASE_URL;
const IS_PG = Boolean(DB_URL && DB_URL.startsWith('postgres'));

const stamp = Date.now();
const OWNER_EMAIL = `billing-owner-${stamp}@example.test`;
const MEMBER_EMAIL = `billing-member-${stamp}@example.test`;
const PASSWORD = 'BillingE2eCorrectHorse42!';

let pool = null;

function cookieFrom(res) {
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (all.length) return all.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(';')[0] : null;
}

function csrfFrom(cookie) {
  const m = String(cookie || '').match(/(?:^|;\s*)oos_csrf=([^;]+)/);
  return m ? m[1] : null;
}

class Agent {
  // Distinct X-Forwarded-For per agent so this file's auth calls don't share
  // a per-IP rate-limit bucket with test/e2e.test.mjs's own (both files hit
  // the same live app) — same convention e2e.test.mjs itself uses (10.77.0.x)
  // for any test making more than a couple of auth calls; this file uses the
  // 10.77.1.x range so the two files' buckets can never collide.
  constructor({ ip } = {}) { this.cookie = null; this.ip = ip || null; }
  async req(method, path, body) {
    const isSafe = ['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase());
    const csrf = csrfFrom(this.cookie);
    const res = await fetch(`${BASE}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        ...(this.ip ? { 'X-Forwarded-For': this.ip } : {}),
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
    const run = async (sql, params = []) => [( await p.query(translate(sql), params) ).rows];
    pool = { execute: run, end: () => p.end() };
    return;
  }
  pool = await mysql.createPool(DB_URL);
});

after(async () => {
  if (pool) await pool.end();
});

test('PDFMSBILL01 checkout is refused when the target plan has no stripe_price_id', async () => {
  const owner = new Agent({ ip: '10.77.1.1' });
  const reg = await owner.req('POST', '/api/auth/register', { email: OWNER_EMAIL, password: PASSWORD, name: 'Billing Owner' });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));

  const res = await owner.req('POST', '/api/billing/checkout', { plan_code: 'pro' });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /not available for self-serve checkout/i);
});

test('PDFMSBILL02 checkout is OWNER-only — a member gets 403', async () => {
  const owner = new Agent({ ip: '10.77.1.2' });
  await owner.req('POST', '/api/auth/login', { email: OWNER_EMAIL, password: PASSWORD });
  const created = await owner.req('POST', '/api/account', { name: 'Member', email: MEMBER_EMAIL, password: PASSWORD, role: 'admin' });
  assert.equal(created.status, 200, JSON.stringify(created.data));

  const member = new Agent({ ip: '10.77.1.3' });
  const login = await member.req('POST', '/api/auth/login', { email: MEMBER_EMAIL, password: PASSWORD });
  assert.equal(login.status, 200);

  const res = await member.req('POST', '/api/billing/checkout', { plan_code: 'pro' });
  assert.equal(res.status, 403, 'an ADMIN (not OWNER) must not be able to change billing');
});

test('PDFMSBILL03 full loop: checkout -> webhook -> plan_code flips, cancellation reverts it', async () => {
  // Wire the 'pro' plan up for self-serve checkout, exactly what an operator
  // does once in the admin Plans page.
  await db(`UPDATE billing_plans SET stripe_price_id = 'price_e2e_pro' WHERE code = 'pro'`);

  const owner = new Agent({ ip: '10.77.1.4' });
  await owner.req('POST', '/api/auth/login', { email: OWNER_EMAIL, password: PASSWORD });

  const checkout = await owner.req('POST', '/api/billing/checkout', { plan_code: 'pro' });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.data));
  const sessionId = new URL(checkout.data.url).pathname.split('/').pop();

  const account = await owner.req('GET', '/api/account');
  const accountId = account.data.user.account_id;
  const before = await db('SELECT plan_code FROM accounts WHERE id = ?', [accountId]);
  assert.equal(before[0].plan_code, 'free');

  // Only a real customer's browser can "complete" a Checkout Session; the mock
  // server's control endpoint simulates that by firing a correctly-signed
  // checkout.session.completed straight at the app's real webhook route.
  const complete = await fetch(`${STRIPE_URL}/ctl/complete-checkout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sessionId }),
  }).then((r) => r.json());
  assert.equal(complete.webhookStatus, 200, JSON.stringify(complete));

  const afterPurchase = await db('SELECT plan_code, stripe_customer_id, stripe_subscription_id FROM accounts WHERE id = ?', [accountId]);
  assert.equal(afterPurchase[0].plan_code, 'pro');
  assert.ok(afterPurchase[0].stripe_customer_id);
  assert.ok(afterPurchase[0].stripe_subscription_id);

  const cancel = await fetch(`${STRIPE_URL}/ctl/cancel-subscription`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sessionId }),
  }).then((r) => r.json());
  assert.equal(cancel.webhookStatus, 200, JSON.stringify(cancel));

  const afterCancel = await db('SELECT plan_code, stripe_subscription_id FROM accounts WHERE id = ?', [accountId]);
  assert.equal(afterCancel[0].plan_code, 'free');
  assert.equal(afterCancel[0].stripe_subscription_id, null);
});

test('PDFMSBILL04 webhook rejects a request with an invalid signature', async () => {
  const res = await fetch(`${BASE}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=deadbeef' },
    body: JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } }),
  });
  assert.equal(res.status, 400);
});
