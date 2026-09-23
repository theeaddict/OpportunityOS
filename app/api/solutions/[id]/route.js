import * as solutionsRepo from '@/lib/repositories/solutions';
import { audit } from '@/lib/audit';
import { requireAccount, requireRole, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { isNonEmptyString } from '@/lib/validation';
import { PROBLEM_TYPE_KEYS } from '@/lib/constants';

export async function PATCH(request, { params }) {
  try {
    const user = await requireAccount();
    requireRole(user, 'admin');
    const { id } = await params;
    const existing = await solutionsRepo.findById(user.account_id, Number(id));
    if (!existing) return Response.json({ ok: false, error: 'Solution not found' }, { status: 404 });

    const body = await readJson(request);
    await solutionsRepo.updateSolution(user.account_id, existing.id, {
      name: isNonEmptyString(body.name, 160) ? body.name.trim() : undefined,
      description: isNonEmptyString(body.description) ? String(body.description).slice(0, 2000) : existing.description,
      active: body.active === undefined ? undefined : Boolean(body.active),
      currency: isNonEmptyString(body.currency, 3) ? body.currency : existing.currency,
      features: Array.isArray(body.features) ? body.features : undefined,
      demo_template: body.demo_template === undefined
        ? undefined
        : (isNonEmptyString(body.demo_template, 255) ? body.demo_template : null),
      project_value_low: body.project_value_low === undefined
        ? (body.minimum_project_value === undefined ? undefined : (Number(body.minimum_project_value) || null))
        : (Number(body.project_value_low) || null),
      project_value_base: body.project_value_base === undefined ? undefined : (Number(body.project_value_base) || null),
      project_value_high: body.project_value_high === undefined
        ? (body.maximum_project_value === undefined ? undefined : (Number(body.maximum_project_value) || null))
        : (Number(body.project_value_high) || null),
    });
    if (Array.isArray(body.solves_problem_types)) {
      await solutionsRepo.setSolutionProblems(user.account_id, existing.id, body.solves_problem_types.filter((t) => PROBLEM_TYPE_KEYS.includes(t)));
    }
    if (Array.isArray(body.industries)) {
      await solutionsRepo.setSolutionIndustries(user.account_id, existing.id, body.industries);
    }
    await audit('solution.updated', { entity_type: 'solutions', entity_id: existing.id, user_id: user.id, account_id: user.account_id });
    return jsonOk({ id: existing.id });
  } catch (err) {
    return handleRouteError(err);
  }
}
