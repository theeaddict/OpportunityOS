/**
 * Recurring discovery ("watch") schedules. A scheduler tick inside the
 * background worker enqueues a DISCOVERY job whenever a schedule becomes due,
 * so new leads keep turning into opportunities without a manual run.
 */
import { query } from '@/lib/db';

const BASE = `
  SELECT id, account_id, name, provider, filters_json, interval_minutes,
         next_run_at, last_run_at, enabled, created_by, created_at, updated_at
    FROM discover_schedules`;

export async function listSchedules(accountId) {
  return query(`${BASE} WHERE account_id = ? ORDER BY enabled DESC, next_run_at ASC, id DESC`,
    [Number(accountId)]);
}

export async function findSchedule(accountId, id) {
  const rows = await query(`${BASE} WHERE id = ? AND account_id = ?`,
    [Number(id), Number(accountId)]);
  return rows[0] || null;
}

export async function createSchedule({ accountId, userId, name, provider, filters, intervalMinutes }) {
  const interval = Math.max(5, Math.min(Number(intervalMinutes) || 60, 10080));
  const filtersJson = filters && Object.keys(filters).length
    ? JSON.stringify(filters)
    : JSON.stringify({});
  const result = await query(
    `INSERT INTO discover_schedules
       (account_id, name, provider, filters_json, interval_minutes, next_run_at, created_by)
     VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
    [Number(accountId), String(name).slice(0, 160), String(provider || 'manual').slice(0, 40),
      filtersJson, interval, userId != null ? Number(userId) : null]
  );
  return findSchedule(accountId, Number(result.insertId));
}

export async function updateSchedule(accountId, id, patch) {
  const current = await findSchedule(accountId, id);
  if (!current) return null;
  const sets = [];
  const params = [];
  if (patch.name != null) { sets.push('name = ?'); params.push(String(patch.name).slice(0, 160)); }
  if (patch.provider != null) { sets.push('provider = ?'); params.push(String(patch.provider).slice(0, 40)); }
  if (patch.enabled != null) {
    const enabled = patch.enabled ? 1 : 0;
    sets.push('enabled = ?'); params.push(enabled);
    // Re-arming the due window on enable: run on the very next tick.
    if (enabled) { sets.push('next_run_at = NOW()'); }
  }
  if (patch.interval_minutes != null) {
    const interval = Math.max(5, Math.min(Number(patch.interval_minutes) || 60, 10080));
    sets.push('interval_minutes = ?'); params.push(interval);
    sets.push('next_run_at = ?');
    params.push(new Date(Date.now() + interval * 60000));
  }
  if (patch.filters != null && typeof patch.filters === 'object') {
    const f = patch.filters && Object.keys(patch.filters).length ? patch.filters : {};
    sets.push('filters_json = ?'); params.push(JSON.stringify(f));
  }
  if (!sets.length) return current;
  sets.push('updated_at = NOW()');
  params.push(Number(accountId), Number(id));
  await query(`UPDATE discover_schedules SET ${sets.join(', ')} WHERE account_id = ? AND id = ?`, params);
  return findSchedule(accountId, id);
}

export async function deleteSchedule(accountId, id) {
  await query('DELETE FROM discover_schedules WHERE id = ? AND account_id = ?',
    [Number(id), Number(accountId)]);
  return true;
}