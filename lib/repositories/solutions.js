import { query, insert } from '@/lib/db';
import { normalizeBusinessName } from '@/lib/normalize';

/**
 * Solution repository. Problems and industries live in their own tables
 * (solution_problems / solution_industries) and are joined on read.
 * Multi-tenant: each account owns its OWN solution catalog (account_id).
 */

async function attachRelations(accountId, rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const [problems, industries] = await Promise.all([
    query(`SELECT solution_id, problem_type FROM solution_problems WHERE solution_id IN (${placeholders}) AND account_id = ?`, [...ids, Number(accountId)]),
    query(`SELECT solution_id, industry FROM solution_industries WHERE solution_id IN (${placeholders}) AND account_id = ?`, [...ids, Number(accountId)]),
  ]);
  const pMap = {}, iMap = {};
  for (const p of problems) (pMap[p.solution_id] ||= []).push(p.problem_type);
  for (const i of industries) (iMap[i.solution_id] ||= []).push(i.industry);
  return rows.map((r) => {
    const low = numOrNull(r.project_value_low);
    const base = numOrNull(r.project_value_base);
    const high = numOrNull(r.project_value_high);
    return {
      ...r,
      solves_problem_types: pMap[r.id] || [],
      industries: iMap[r.id] || [],
      // Configurable project-value pricing. Legacy min/max columns are kept as
      // aliases so existing callers (matching + analyzer) keep working.
      project_value: { low, base, high },
      minimum_project_value: low,
      maximum_project_value: high,
      features: parseFeatures(r.features),
    };
  });
}

function numOrNull(v) {
  const n = Number(v);
  return v !== null && v !== undefined && Number.isFinite(n) ? n : null;
}

function parseFeatures(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function list({ accountId, activeOnly = true } = {}) {
  const rows = await query(
    `SELECT * FROM solutions
      WHERE account_id = ? ${activeOnly ? 'AND active = 1' : ''} ORDER BY name`,
    [Number(accountId)]
  );
  return attachRelations(accountId, rows);
}

export async function all(accountId) {
  return list({ accountId, activeOnly: false });
}

export async function findById(accountId, id) {
  const rows = await attachRelations(
    accountId,
    await query('SELECT * FROM solutions WHERE id = ? AND account_id = ?', [Number(id), Number(accountId)])
  );
  return rows[0] || null;
}

export async function findBySlug(accountId, slug) {
  const rows = await attachRelations(
    accountId,
    await query('SELECT * FROM solutions WHERE slug = ? AND account_id = ?', [normalizeBusinessName(slug), Number(accountId)])
  );
  return rows[0] || null;
}

export async function createSolution({
  account_id, name, description, active = 1, currency = 'KES', features = undefined,
  demo_template = null, problem_types = [], industries = [],
  project_value_low = null, project_value_base = null, project_value_high = null,
  minimum_project_value = null, maximum_project_value = null,
}) {
  const slug = normalizeBusinessName(name).replaceAll(' ', '-');
  const low = project_value_low ?? minimum_project_value;
  const high = project_value_high ?? maximum_project_value;
  const base = project_value_base ?? (low != null && high != null ? (low + high) / 2 : null);
  const id = insert(
    `INSERT INTO solutions (account_id, name, slug, description, active, currency, features, demo_template,
       project_value_low, project_value_base, project_value_high,
       minimum_project_value, maximum_project_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description),
       currency = VALUES(currency), active = VALUES(active), features = VALUES(features),
       demo_template = VALUES(demo_template), project_value_low = VALUES(project_value_low),
       project_value_base = VALUES(project_value_base), project_value_high = VALUES(project_value_high),
       minimum_project_value = VALUES(project_value_low), maximum_project_value = VALUES(project_value_high)`,
    [Number(account_id) || null, name, slug, description, active ? 1 : 0, currency, joinFeatures(features),
     demo_template || null, low, base, high, low, high]
  );
  // insert() returns a promise here; resolve before relations
  const resolvedId = await id;
  await setSolutionProblems(account_id, resolvedId, problem_types);
  await setSolutionIndustries(account_id, resolvedId, industries);
  return resolvedId;
}

function joinFeatures(raw) {
  if (Array.isArray(raw)) return raw.map((f) => String(f).trim()).filter(Boolean).join(',');
  if (!raw) return null;
  return String(raw).trim() || null;
}

export async function setSolutionProblems(accountId, solutionId, problemTypes) {
  await query(
    'DELETE FROM solution_problems WHERE solution_id = ? AND account_id = ?',
    [Number(solutionId), Number(accountId)]
  );
  for (const t of problemTypes || []) {
    await query(
      'INSERT IGNORE INTO solution_problems (account_id, solution_id, problem_type) VALUES (?, ?, ?)',
      [Number(accountId), Number(solutionId), t]
    );
  }
}

export async function setSolutionIndustries(accountId, solutionId, industries) {
  await query(
    'DELETE FROM solution_industries WHERE solution_id = ? AND account_id = ?',
    [Number(solutionId), Number(accountId)]
  );
  for (const t of industries || []) {
    await query(
      'INSERT IGNORE INTO solution_industries (account_id, solution_id, industry) VALUES (?, ?, ?)',
      [Number(accountId), Number(solutionId), String(t).slice(0, 120)]
    );
  }
}

export async function updateSolution(accountId, id, {
  description, active, currency, features, demo_template,
  name, problem_types, industries,
  project_value_low, project_value_base, project_value_high,
  minimum_project_value, maximum_project_value,
}) {
  const existing = await findById(accountId, Number(id));
  if (!existing) throw new Error('Solution not found');
  const low = project_value_low ?? minimum_project_value ?? existing.project_value.low;
  const high = project_value_high ?? maximum_project_value ?? existing.project_value.high;
  const base = project_value_base ?? existing.project_value.base
    ?? (low != null && high != null ? (low + high) / 2 : null);
  const finalName = name ? String(name).slice(0, 160) : existing.name;
  await query(
    `UPDATE solutions SET name = ?, slug = ?, description = ?, active = ?, currency = ?,
       features = ?, demo_template = ?,
       project_value_low = ?, project_value_base = ?, project_value_high = ?,
       minimum_project_value = ?, maximum_project_value = ?
     WHERE id = ? AND account_id = ?`,
    [finalName, normalizeBusinessName(finalName).replaceAll(' ', '-'),
     description ?? existing.description, (active === undefined ? Number(existing.active) : (active ? 1 : 0)),
     currency || existing.currency, joinFeatures(features !== undefined ? features : existing.features),
     demo_template === undefined ? (existing.demo_template || null) : (demo_template || null),
     low, base, high, low, high, Number(id), Number(accountId)]
  );
  if (Array.isArray(problem_types)) await setSolutionProblems(accountId, Number(id), problem_types);
  if (Array.isArray(industries)) await setSolutionIndustries(accountId, Number(id), industries);
}

export async function deleteSolution(accountId, id) {
  await query(
    `DELETE FROM solutions WHERE id = ? AND account_id = ?
      AND id NOT IN (SELECT solution_id FROM opportunity_solutions WHERE opportunity_id IN
        (SELECT id FROM opportunities WHERE account_id = ?))`,
    [Number(id), Number(accountId), Number(accountId)]
  );
}