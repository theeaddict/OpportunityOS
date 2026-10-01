import { HttpError, jsonOk, handleRouteError } from '@/lib/api-helpers';
import { verifyWebhookSignature, isWebhookConfigured } from '@/lib/billing/stripe';
import { updateAccount } from '@/lib/repositories/accounts';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/webhook — the ONLY writer of accounts.plan_code from a
 * billing event. Called by Stripe's servers, never a browser: no session
 * cookie is ever present, so proxy.js's CSRF check naturally passes it
 * through (also explicitly exempted there, matching /api/leads/webhook).
 *
 * Auth is the raw-body HMAC signature (Stripe-Signature header), verified
 * against STRIPE_WEBHOOK_SECRET — this is the only place a webhook payload is
 * trusted as genuinely from Stripe. The body MUST be read as raw text before
 * any JSON parsing, or the signature (computed over the exact bytes Stripe
 * sent) will never match.
 *
 * Handles exactly two events, both carrying account_id in metadata (set at
 * Checkout creation — see lib/billing/stripe.js — and copied by Stripe onto
 * the resulting subscription), so no customer_id -> account lookup is needed:
 *   checkout.session.completed  -> activate the checked-out plan
 *   customer.subscription.deleted -> the subscription ended; fall back to free
 */
export async function POST(request) {
  try {
    if (!isWebhookConfigured()) {
      throw new HttpError(501, 'Stripe webhook is not configured (STRIPE_WEBHOOK_SECRET missing)');
    }

    const rawBody = await request.text();
    const signature = request.headers.get('stripe-signature');
    const valid = await verifyWebhookSignature(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    if (!valid) throw new HttpError(400, 'Invalid webhook signature');

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw new HttpError(400, 'Malformed webhook payload');
    }

    const obj = event?.data?.object;

    if (event.type === 'checkout.session.completed') {
      const accountId = Number(obj?.metadata?.account_id);
      const planCode = obj?.metadata?.plan_code;
      if (accountId && planCode) {
        await updateAccount(accountId, {
          plan_code: planCode,
          stripe_customer_id: obj.customer || undefined,
          stripe_subscription_id: obj.subscription || undefined,
        });
        await audit('billing.subscription_started', {
          entity_type: 'account', entity_id: accountId, metadata: { plan_code: planCode },
        });
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const accountId = Number(obj?.metadata?.account_id);
      if (accountId) {
        await updateAccount(accountId, { plan_code: 'free', stripe_subscription_id: null });
        await audit('billing.subscription_canceled', { entity_type: 'account', entity_id: accountId });
      }
    }
    // Every other event type is acknowledged but ignored — Stripe retries on
    // anything other than 2xx, so unhandled types must still return 200.

    return jsonOk({ received: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
