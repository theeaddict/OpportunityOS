import * as schedulesRepo from '@/lib/repositories/discover-schedules';
import { parseJson } from '@/lib/db';
import { audit } from '@/lib/audit';
import { requireAccount, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { defaultProvider } from '@/lib/services/discovery';
import { watchLimitStatus, assertWithinWatchLimit } from '@/lib/accounts/usage';

function serialized(row) {
  if (!row) return null;
  return { ...row, filters: parseJson(row.filters_json, {}) };
}

async function limitView(accountId) {
  const { used, limit } = await watchLimitStatus(accountId);
  return { used, limit };
}

export async function GET() {
  try {
    const user = await requireAccount();
    const schedules = (await schedulesRepo.listSchedules(user.account_id)).map(serialized);
    return jsonOk({ schedules, watch_limit: await limitView(user.account_id), webhook_path: '/api/leads/webhook' });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request) {
  try {
    const user = await requireAccount();
    const body = await readJson(request);
    const name = String(body.name || body.query || body.industry || 'Untitled watch').slice(0, 160);
    if (!name.trim()) {
      return Response.json({ ok: false, error: 'Give the watch a name (or an industry)' }, { status: 400 });
    }
    // Plan caps: an active watch costs recurring DISCOVERY runs, so it is a
    // bounded resource per plan (free watches = 3, pro = 25).
    const { used: watchUsed, limit: watchLimit } = await assertWithinWatchLimit(user.account_id);

    const existing = (await schedulesRepo.listSchedules(user.account_id))
      .find((s) => s.name === name.trim());
    if (existing) {
      return Response.json({
        ok: false,
        error: `A watch named "${existing.name}" already exists.`,
      }, { status: 409 });
    }

    const schedule = await schedulesRepo.createSchedule({
      accountId: user.account_id,
      userId: user.id,
      name: name.trim(),
      provider: body.provider || defaultProvider(),
      filters: body.filters || {},
      intervalMinutes: body.interval_minutes,
    });
    await audit('discover.schedule_created', { metadata: { name }, user_id: user.id, account_id: user.account_id });
    return jsonOk({ schedule: serialized(schedule), watch_limit: { used: watchUsed, limit: watchLimit } });
  } catch (err) {
    return handleRouteError(err);
  }
}