import { requireSuperadmin, HttpError, handleRouteError, jsonOk, readJson } from '@/lib/api-helpers';
import { listPlans, createPlan } from '@/lib/repositories/accounts';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const CODE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const INT_LIMITS = [
  'limit_researches',
  'limit_opportunities',
  'limit_ai_analyses',
  'limit_demo_generations',
  'limit_users',
  'limit_watches',
  'price_cents',
];

function normalizeLimits(body) {
  const out = {};
  for (const key of INT_LIMITS) {
    if (body[key] === undefined || body[key] === null) { out[key] = null; continue; }
    const n = Number(body[key]);
    if (!Number.isInteger(n) || n < 0) {
      throw new HttpError(400, `${key} must be a non-negative integer`);
    }
    out[key] = n;
  }
  return out;
}

// List all billing plans (usable by the account admin drop-downs too).
export async function GET() {
  try {
    await requireSuperadmin();
    const plans = await listPlans();
    return jsonOk({ plans });
  } catch (err) {
    return handleRouteError(err);
  }
}

// Create a new plan.
export async function POST(request) {
  try {
    const admin = await requireSuperadmin();
    const body = await readJson(request);

    const code = String(body.code || '').trim();
    const name = String(body.name || '').trim();
    if (!code) throw new HttpError(400, 'code is required');
    if (!CODE_RE.test(code)) {
      throw new HttpError(400, 'code must start with a lowercase letter/digit and use only a-z0-9, _ and -');
    }
    if (!name) throw new HttpError(400, 'name is required');

    const existing = await listPlans();
    if (existing.some((p) => p.code === code)) throw new HttpError(409, `Plan ${code} already exists`);

    const limits = normalizeLimits(body);
    const currency = String(body.currency || 'USD').toUpperCase().slice(0, 3);
    const plan = {
      code,
      name,
      description: String(body.description || '').slice(0, 300) || null,
      ...limits,
      currency,
      stripe_price_id: body.stripe_price_id ? String(body.stripe_price_id).trim().slice(0, 120) : null,
      is_active: body.is_active !== false,
    };
    await createPlan(plan);
    await audit('admin.plan_created', {
      entity_type: 'billing_plan',
      admin_user_id: admin.id,
      metadata: { code, name, ...limits, currency },
    });
    return jsonOk({ plan }, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}