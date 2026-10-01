/**
 * Low-level Stripe transport — the ONLY place that talks to Stripe.
 *
 * Deliberately raw fetch + form-encoding (no `stripe` SDK dependency), mirroring
 * lib/ai/client.js and the discovery providers: a thin, inspectable wrapper
 * around a REST API, feature-detected via env so the rest of the app degrades
 * gracefully (clear "not configured" errors, never a fabricated success) when
 * no Stripe account is wired up yet.
 *
 * Environment:
 *   STRIPE_SECRET_KEY     required — server-side secret key (sk_...)
 *   STRIPE_WEBHOOK_SECRET required for /api/billing/webhook to accept events (whsec_...)
 *   STRIPE_API_BASE_URL   default https://api.stripe.com/v1 (overridable for tests)
 */

const DEFAULT_BASE_URL = 'https://api.stripe.com/v1';
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const WEBHOOK_TOLERANCE_SECONDS = 300;

export function isConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function isWebhookConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

function baseUrl() {
  return (process.env.STRIPE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

export class StripeError extends Error {
  constructor(message, { status = null, transient = false } = {}) {
    super(message);
    this.name = 'StripeError';
    this.status = status;
    this.transient = transient;
  }
}

/** Flatten a nested object into Stripe's bracket-notation form fields. */
function flatten(params, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => out.push(...flatten({ [i]: v }, name)));
    } else if (typeof value === 'object') {
      out.push(...flatten(value, name));
    } else {
      out.push([name, String(value)]);
    }
  }
  return out;
}

async function request(method, path, params) {
  if (!isConfigured()) throw new StripeError('Stripe is not configured (STRIPE_SECRET_KEY missing)');

  const key = process.env.STRIPE_SECRET_KEY;
  const auth = `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
  const init = {
    method,
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(20_000),
  };
  if (params) init.body = new URLSearchParams(flatten(params)).toString();

  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(`${baseUrl()}${path}`, init);
    } catch (err) {
      lastErr = new StripeError(`Stripe request failed: ${err.message}`, { transient: true });
      if (attempt >= maxAttempts) throw lastErr;
      await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    // Never surface the secret key; Stripe error bodies don't echo it either.
    const message = data?.error?.message || `Stripe API error (${res.status})`;
    if (TRANSIENT_STATUS.has(res.status) && attempt < maxAttempts) {
      lastErr = new StripeError(message, { status: res.status, transient: true });
      await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
      continue;
    }
    throw new StripeError(message, { status: res.status });
  }
  throw lastErr || new StripeError('Stripe request failed');
}

/**
 * Create a Checkout Session that, on success, becomes a subscription. Account
 * and target plan travel in metadata on BOTH the session and the resulting
 * subscription (subscription_data.metadata is copied onto the created
 * subscription by Stripe) so every later webhook event is self-contained —
 * no separate customer_id -> account_id lookup table needed.
 */
export async function createCheckoutSession({
  priceId, accountId, planCode, customerEmail, existingCustomerId, successUrl, cancelUrl,
}) {
  return request('POST', '/checkout/sessions', {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: String(accountId),
    ...(existingCustomerId ? { customer: existingCustomerId } : { customer_email: customerEmail }),
    metadata: { account_id: String(accountId), plan_code: planCode },
    subscription_data: { metadata: { account_id: String(accountId), plan_code: planCode } },
  });
}

/** Billing Portal session — lets the account owner manage/cancel their own subscription. */
export async function createPortalSession({ customerId, returnUrl }) {
  return request('POST', '/billing_portal/sessions', {
    customer: customerId,
    return_url: returnUrl,
  });
}

/**
 * Verify the `Stripe-Signature` header against the RAW request body.
 * Implements Stripe's documented scheme directly (HMAC-SHA256 of
 * `${timestamp}.${rawBody}`) — no SDK needed, and this is intentionally the
 * only place that trusts a webhook payload as genuinely from Stripe.
 */
export async function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  const { createHmac, timingSafeEqual } = await import('node:crypto');
  if (!signatureHeader || !secret) return false;

  const parts = Object.fromEntries(
    String(signatureHeader).split(',').map((kv) => {
      const idx = kv.indexOf('=');
      return idx === -1 ? [kv, ''] : [kv.slice(0, idx), kv.slice(idx + 1)];
    })
  );
  const timestamp = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(timestamp) || !v1) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
