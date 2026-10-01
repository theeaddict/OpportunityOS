import { requireSuperadmin, HttpError, handleRouteError, jsonOk, readJson } from '@/lib/api-helpers';
import { getPlan, updatePlan, deletePlan } from '@/lib/repositories/accounts';
import { query } from '@/lib/db';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const INT_LIMITS = [
  'limit_researches',
  'limit_opportunities',
  'limit_ai_analyses',
  'limit_demo_generations',
  'limit_users',
  'limit_watches',
  'price_cents',
];

// Update limits / name / description / price / visibility of one plan.
export async function PATCH(request, { params }) {
  try {
    const admin = await requireSuperadmin();
    const { code } = await params;
    const plan = await getPlan(code);
    if (!plan) throw new HttpError(404, `Plan ${code} not found`);
    if (plan.is_active === 0) throw new HttpError(404, `Plan ${code} not found`);

    const body = await readJson(request);
    const fields = {};
    const lims = {};
    let changed = false;

    if (body.name !== undefined) {
      fields.name = String(body.name).trim().slice(0, 120);
      if (!fields.name) throw new HttpError(400, 'name cannot be empty');
      changed = true;
    }
    if (body.description !== undefined) {
      fields.description = body.description == null ? null : String(body.description).slice(0, 300);
      changed = true;
    }
    for (const key of INT_LIMITS) {
      if (body[key] === undefined) continue;
      const n = body[key] == null ? null : Number(body[key]);
      if (n !== null && (!Number.isInteger(n) || n < 0)) {
        throw new HttpError(400, `${key} must be a non-negative integer or null`);
      }
      fields[key] = n;
      lims[key] = n;
      changed = true;
    }
    if (body.currency !== undefined) {
      const currency = String(body.currency || 'USD').toUpperCase().slice(0, 3);
      if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'currency must be a 3-letter code');
      fields.currency = currency;
      changed = true;
    }
    if (body.is_active !== undefined) {
      fields.is_active = body.is_active === true || body.is_active === 1;
      changed = true;
    }
    if (body.stripe_price_id !== undefined) {
      fields.stripe_price_id = body.stripe_price_id ? String(body.stripe_price_id).trim().slice(0, 120) : null;
      changed = true;
    }

    if (!changed) return jsonOk({ plan });
    await updatePlan(code, fields);
    await audit('admin.plan_updated', {
      entity_type: 'billing_plan',
      admin_user_id: admin.id,
      metadata: { code, ...Object.keys(fields) },
    });
    const updated = await getPlan(code);
    return jsonOk({ plan: updated });
  } catch (err) {
    return handleRouteError(err);
  }
}

// Remove a plan. Refuses when any account still uses it, or the internal plan.
export async function DELETE(request, { params }) {
  try {
    const admin = await requireSuperadmin();
    const { code } = await params;
    const plan = await getPlan(code);
    if (!plan) throw new HttpError(404, `Plan ${code} not found`);
    if (plan.is_active === 0) throw new HttpError(404, `Plan ${code} not found`);
    if (code === 'internal') throw new HttpError(400, 'The internal plan cannot be removed');
    if (code === 'free') throw new HttpError(400, 'The default free plan cannot be removed');

    const rows = await query('SELECT COUNT(*) AS n FROM accounts WHERE plan_code = ?', [code]);
    if (Number(rows[0]?.n || 0) > 0) {
      throw new HttpError(409, `Cannot remove ${code}: ${rows[0].n} account(s) still use it`);
    }

    const affected = await deletePlan(code);
    if (!affected) throw new HttpError(404, `Plan ${code} not found`);
    await audit('admin.plan_deleted', {
      entity_type: 'billing_plan',
      admin_user_id: admin.id,
      metadata: { code, name: plan.name },
    });
    return jsonOk({ deleted: code });
  } catch (err) {
    return handleRouteError(err);
  }
}