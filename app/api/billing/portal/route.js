import { requireAccount, requireRole, HttpError, jsonOk, handleRouteError } from '@/lib/api-helpers';
import { getAccount } from '@/lib/repositories/accounts';
import { createPortalSession, isConfigured, StripeError } from '@/lib/billing/stripe';
import { enforce } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/portal — hands the account OWNER a link to Stripe's
 * hosted Billing Portal to manage or cancel their own subscription. Requires
 * a stripe_customer_id already on file, which only exists after a completed
 * checkout (see the webhook).
 */
export async function POST(request) {
  try {
    enforce(request, { limit: 20, windowMs: 60 * 60_000, key: 'billing-portal' });
    const user = await requireAccount();
    requireRole(user, 'owner');

    if (!isConfigured()) {
      throw new HttpError(501, 'Billing is not connected yet — ask the platform operator to configure Stripe.');
    }

    const account = await getAccount(user.account_id);
    if (!account?.stripe_customer_id) throw new HttpError(404, 'No billing account on file yet — subscribe to a paid plan first');

    const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    const session = await createPortalSession({
      customerId: account.stripe_customer_id,
      returnUrl: `${appUrl}/account`,
    });
    return jsonOk({ url: session.url });
  } catch (err) {
    if (err instanceof StripeError) return handleRouteError(new HttpError(err.status && err.status < 500 ? 400 : 502, err.message));
    return handleRouteError(err);
  }
}
