/**
 * Append-only audit trail for the superadmin control room (STAGE 6).
 *
 * System-wide read across every tenant — no account_id scoping, only reachable
 * behind requireSuperadmin() at the API layer. Complements lib/audit.js's
 * listAudit() with filtering, action/entity rollups and richer joins.
 */

import { query, parseJson } from '@/lib/db';

const MAX_LIMIT = 500;

function mapRow(row) {
  return {
    id: Number(row.id),
    action: row.action,
    entity_type: row.entity_type || null,
    entity_id: row.entity_id != null ? Number(row.entity_id) : null,
    user_id: row.user_id != null ? Number(row.user_id) : null,
    user_name: row.user_name || null,
    account_id: row.account_id != null ? Number(row.account_id) : null,
    account_name: row.account_name || null,
    metadata: parseJson(row.metadata_json, {}),
    created_at: row.created_at,
  };
}

export async function emptyAuditOverview() {
  return { rows: [], total: 0, actions: [], entity_types: [] };
}

/**
 * Recent audit entries (optionally filtered) + the all-time rollups the
 * control room renders as filters. `action` and `entity_type` filter the ROWS;
 * the rollups always reflect the full table so filters stay explorable.
 */
export async function auditOverview({ action = null, entity_type = null, limit = 200 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 20, 1), MAX_LIMIT);

  const wheres = [];
  const params = [];
  if (action) {
    params.push(String(action));
    wheres.push(`a.action = ?`);
  }
  if (entity_type) {
    params.push(String(entity_type));
    wheres.push(`a.entity_type = ?`);
  }
  const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

  const rows = await query(
    `SELECT a.*, u.name AS user_name, ac.name AS account_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN accounts ac ON ac.id = a.account_id
       ${whereSql}
      ORDER BY a.id DESC
      LIMIT ${n}`,
    params
  );

  const [counts, actions, entityTypes] = await Promise.all([
    query('SELECT COUNT(*) AS n FROM audit_logs'),
    query('SELECT action, COUNT(*) AS n FROM audit_logs GROUP BY action ORDER BY n DESC, action'),
    query('SELECT entity_type, COUNT(*) AS n FROM audit_logs WHERE entity_type IS NOT NULL GROUP BY entity_type ORDER BY n DESC, entity_type'),
  ]);

  return {
    rows: rows.map(mapRow),
    total: Number(counts[0]?.n || 0),
    actions: actions.map((r) => ({ action: r.action, count: Number(r.n) })),
    entity_types: entityTypes.map((r) => ({ entity_type: r.entity_type, count: Number(r.n) })),
  };
}