/**
 * Mock Stripe API server used by the local E2E suite — implements just enough
 * of the real API surface for lib/billing/stripe.js to talk to (Checkout
 * Sessions, Billing Portal Sessions) plus control endpoints the test drives
 * to simulate what only a real customer's browser can normally trigger
 * (completing checkout, cancelling a subscription), by POSTing a correctly
 * HMAC-signed webhook event straight at the app — the exact same signature
 * scheme lib/billing/stripe.js's verifyWebhookSignature() checks.
 *
 * Endpoints:
 *   POST /v1/checkout/sessions        (real Stripe API shape, form-encoded)
 *   POST /v1/billing_portal/sessions  (real Stripe API shape, form-encoded)
 *   POST /ctl/complete-checkout  {id}                 -> fires checkout.session.completed
 *   POST /ctl/cancel-subscription  {id}               -> fires customer.subscription.deleted
 *
 * Run: node scripts/mock-stripe.mjs
 * Env: MOCK_STRIPE_PORT, MOCK_STRIPE_WEBHOOK_URL, MOCK_STRIPE_WEBHOOK_SECRET
 */

import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_STRIPE_PORT || 4324);
const WEBHOOK_URL = process.env.MOCK_STRIPE_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.MOCK_STRIPE_WEBHOOK_SECRET;

const sessions = new Map(); // id -> { accountId, planCode, customerId, subscriptionId }
let counter = 0;

function send(res, status, body) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(data);
}

function readRawBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw));
  });
}

async function readForm(req) {
  const raw = await readRawBody(req);
  return new URLSearchParams(raw);
}

async function readJson(req) {
  const raw = await readRawBody(req);
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function signEvent(payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
  return { body, header: `t=${timestamp},v1=${signature}` };
}

async function fireWebhook(type, object) {
  const { body, header } = signEvent({ id: `evt_mock_${++counter}`, type, data: { object } });
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
    body,
  });
  return res.status;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
    const form = await readForm(req);
    const id = `cs_mock_${++counter}`;
    const accountId = form.get('metadata[account_id]');
    const planCode = form.get('metadata[plan_code]');
    const customerId = form.get('customer') || `cus_mock_${counter}`;
    const subscriptionId = `sub_mock_${counter}`;
    sessions.set(id, { accountId, planCode, customerId, subscriptionId });
    return send(res, 200, { id, url: `http://127.0.0.1:${PORT}/mock-checkout/${id}`, customer: customerId });
  }

  if (req.method === 'POST' && url.pathname === '/v1/billing_portal/sessions') {
    const form = await readForm(req);
    return send(res, 200, { id: `bps_mock_${++counter}`, url: `http://127.0.0.1:${PORT}/mock-portal?customer=${form.get('customer')}` });
  }

  if (req.method === 'POST' && url.pathname === '/ctl/complete-checkout') {
    const { id } = await readJson(req);
    const s = sessions.get(id);
    if (!s) return send(res, 404, { error: `unknown session ${id}` });
    const status = await fireWebhook('checkout.session.completed', {
      id,
      customer: s.customerId,
      subscription: s.subscriptionId,
      metadata: { account_id: s.accountId, plan_code: s.planCode },
    });
    return send(res, 200, { webhookStatus: status });
  }

  if (req.method === 'POST' && url.pathname === '/ctl/cancel-subscription') {
    const { id } = await readJson(req);
    const s = sessions.get(id);
    if (!s) return send(res, 404, { error: `unknown session ${id}` });
    const status = await fireWebhook('customer.subscription.deleted', {
      id: s.subscriptionId,
      customer: s.customerId,
      metadata: { account_id: s.accountId },
    });
    return send(res, 200, { webhookStatus: status });
  }

  if (req.method === 'GET' && (url.pathname.startsWith('/mock-checkout/') || url.pathname === '/mock-portal')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('mock stripe-hosted page (not used by the automated suite)');
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[mock-stripe] listening on :${PORT}`);
});
