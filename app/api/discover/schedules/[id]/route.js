import * as schedulesRepo from '@/lib/repositories/discover-schedules';
import { parseJson } from '@/lib/db';
import { audit } from '@/lib/audit';
import { requireAccount, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';

function serialized(row) {
  if (!row) return null;
  return { ...row, filters: parseJson(row.filters_json, {}) };
}

export async function GET(_request, { params }) {
  try {
    const user = await requireAccount();
    const { id } = await params;
    const schedule = await schedulesRepo.findSchedule(user.account_id, id);
    if (!schedule) return Response.json({ ok: false, error: 'Watch not found' }, { status: 404 });
    return jsonOk({ schedule: serialized(schedule) });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(request, { params }) {
  try {
    const user = await requireAccount();
    const { id } = await params;
    const body = await readJson(request);
    const schedule = await schedulesRepo.updateSchedule(user.account_id, id, body);
    if (!schedule) return Response.json({ ok: false, error: 'Watch not found' }, { status: 404 });
    return jsonOk({ schedule: serialized(schedule) });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(_request, { params }) {
  try {
    const user = await requireAccount();
    const { id } = await params;
    const existing = await schedulesRepo.findSchedule(user.account_id, id);
    if (!existing) return Response.json({ ok: false, error: 'Watch not found' }, { status: 404 });
    await schedulesRepo.deleteSchedule(user.account_id, id);
    await audit('discover.schedule_deleted', { metadata: { name: existing.name }, user_id: user.id, account_id: user.account_id });
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}