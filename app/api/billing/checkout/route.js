import { requireAccount, requireRole, HttpError, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { getAccount, getPlan } from '@/lib/repositories/accounts';
import { createCheckoutSession, isConfigured, StripeError } from '@/lib/billing/stripe';
import { audit } from '@/lib/audit';
import { enforce } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/checkout — start a Stripe Checkout Session to move the
 * caller's account onto a paid plan. OWNER-only: billing is a workspace-wide
 * decision, not something any team member can trigger.
 *
 * The account/plan travel in Checkout + subscription metadata (see
 * lib/billing/stripe.js), so the webhook needs no separate lookup table to
 * know which account a later event belongs to.
 */
export async function POST(request) {
  try {
    enforce(request, { limit: 10, windowMs: 60 * 60_000, key: 'billing-checkout' });
    const user = await requireAccount();
    requireRole(user, 'owner');

    if (!isConfigured()) {
      throw new HttpError(501, 'Billing is not connected yet — ask the platform operator to configure Stripe.');
    }

    const body = await readJson(request);
    const planCode = String(body.plan_code || '').trim();
    if (!planCode) throw new HttpError(400, 'plan_code is required');

    const plan = await getPlan(planCode);
    if (!plan || !plan.is_active) throw new HttpError(404, `Plan ${planCode} not found`);
    if (!plan.stripe_price_id) throw new HttpError(400, `Plan ${planCode} is not available for self-serve checkout`);

    const account = await getAccount(user.account_id);
    if (account?.plan_code === planCode) throw new HttpError(400, `This workspace is already on the ${plan.name} plan`);

    const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    const session = await createCheckoutSession({
      priceId: plan.stripe_price_id,
      accountId: user.account_id,
      planCode,
      customerEmail: user.email,
      existingCustomerId: account?.stripe_customer_id || null,
      successUrl: `${appUrl}/account?billing=success`,
      cancelUrl: `${appUrl}/account?billing=cancelled`,
    });

    await audit('billing.checkout_started', {
      entity_type: 'account', entity_id: user.account_id, metadata: { plan_code: planCode },
    });
    return jsonOk({ url: session.url });
  } catch (err) {
    if (err instanceof StripeError) return handleRouteError(new HttpError(err.status && err.status < 500 ? 400 : 502, err.message));
    return handleRouteError(err);
  }
}
