import * as solutionsRepo from '@/lib/repositories/solutions';
import { audit } from '@/lib/audit';
import { requireAccount, requireRole, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { isNonEmptyString } from '@/lib/validation';
import { PROBLEM_TYPE_KEYS } from '@/lib/constants';

export async function GET() {
  try {
    const user = await requireAccount();
    requireRole(user, 'admin');
    return jsonOk({ solutions: await solutionsRepo.list({ accountId: user.account_id, activeOnly: false }) });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request) {
  try {
    const user = await requireAccount();
    requireRole(user, 'admin');
    const body = await readJson(request);
    if (!isNonEmptyString(body.name, 160)) return Response.json({ ok: false, error: 'Name required' }, { status: 400 });
    if (!isNonEmptyString(body.description)) return Response.json({ ok: false, error: 'Description required' }, { status: 400 });
    const types = Array.isArray(body.solves_problem_types) ? body.solves_problem_types.filter((t) => PROBLEM_TYPE_KEYS.includes(t)) : [];
    const id = await solutionsRepo.createSolution({
      account_id: user.account_id,
      name: body.name.trim(),
      description: String(body.description).slice(0, 2000),
      active: body.active === undefined ? true : Boolean(body.active),
      currency: isNonEmptyString(body.currency, 3) ? body.currency : 'KES',
      features: Array.isArray(body.features) ? body.features : (body.features ? undefined : []),
      demo_template: isNonEmptyString(body.demo_template, 255) ? body.demo_template : null,
      project_value_low: body.project_value_low === undefined ? (Number(body.minimum_project_value) || null) : (Number(body.project_value_low) || null),
      project_value_base: body.project_value_base === undefined ? null : (Number(body.project_value_base) || null),
      project_value_high: body.project_value_high === undefined ? (Number(body.maximum_project_value) || null) : (Number(body.project_value_high) || null),
      problem_types: types,
      industries: Array.isArray(body.industries) ? body.industries : [],
    });
    await audit('solution.created', { entity_type: 'solution', entity_id: id, user_id: user.id, account_id: user.account_id });
    return jsonOk({ id }, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
