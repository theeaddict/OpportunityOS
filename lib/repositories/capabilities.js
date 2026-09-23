import { query } from '@/lib/db';
import { CLIENT_SIZES } from '@/lib/constants';

/**
 * Capabilities repository — the user's own business profile ("My Capabilities").
 * The opportunity engine reads this to decide what to recommend and to flag
 * opportunities it cannot serve (status not_a_service_fit).
 */

const JSON_ARRAY = (v) => {
  if (Array.isArray(v)) return v;
  if (v == null || v === '') return [];
  try {
    const parsed = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

function rowToCapabilities(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: Number(row.user_id),
    business_name: row.business_name || '',
    location: row.location || '',
    services: row.services || '',
    industries_served: JSON_ARRAY(row.industries_served),
    technologies: JSON_ARRAY(row.technologies),
    solution_types: JSON_ARRAY(row.solution_types),
    enabled_solutions: JSON_ARRAY(row.enabled_solutions),
    min_project_value: row.min_project_value != null ? Number(row.min_project_value) : null,
    max_project_value: row.max_project_value != null ? Number(row.max_project_value) : null,
    preferred_industries: JSON_ARRAY(row.preferred_industries),
    preferred_locations: JSON_ARRAY(row.preferred_locations),
    preferred_problem_categories: JSON_ARRAY(row.preferred_problem_categories),
    preferred_client_size: row.preferred_client_size || null,
    updated_at: row.updated_at,
  };
}

export async function getCapabilities(userId) {
  const rows = await query(
    'SELECT * FROM user_capabilities WHERE user_id = ? LIMIT 1',
    [Number(userId)]
  );
  return rowToCapabilities(rows[0]);
}

export async function saveCapabilities(userId, data = {}) {
  const cleanTags = (v, max = 200) => (Array.isArray(v) ? v.map((t) => String(t).trim().slice(0, max)).filter(Boolean) : []);
  const num = (v) => {
    const n = Number(v);
    return v !== '' && v != null && Number.isFinite(n) ? n : null;
  };
  const capabilities = {
    business_name: String(data.business_name || '').slice(0, 160),
    location: String(data.location || '').slice(0, 160),
    services: String(data.services || '').slice(0, 4000),
    industries_served: cleanTags(data.industries_served),
    technologies: cleanTags(data.technologies),
    solution_types: cleanTags(data.solution_types),
    enabled_solutions: cleanTags(data.enabled_solutions),
    min_project_value: num(data.min_project_value),
    max_project_value: num(data.max_project_value),
    preferred_industries: cleanTags(data.preferred_industries),
    preferred_locations: cleanTags(data.preferred_locations),
    preferred_problem_categories: cleanTags(data.preferred_problem_categories),
    preferred_client_size: CLIENT_SIZES.some((c) => c.value === data.preferred_client_size)
      ? data.preferred_client_size
      : null,
  };

  const json = (arr) => JSON.stringify(arr);
  await query(
    `INSERT INTO user_capabilities
       (user_id, business_name, location, services, industries_served, technologies,
        solution_types, enabled_solutions, min_project_value, max_project_value,
        preferred_industries, preferred_locations, preferred_problem_categories,
        preferred_client_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       business_name = VALUES(business_name), location = VALUES(location),
       services = VALUES(services), industries_served = VALUES(industries_served),
       technologies = VALUES(technologies), solution_types = VALUES(solution_types),
       enabled_solutions = VALUES(enabled_solutions),
       min_project_value = VALUES(min_project_value), max_project_value = VALUES(max_project_value),
       preferred_industries = VALUES(preferred_industries),
       preferred_locations = VALUES(preferred_locations),
       preferred_problem_categories = VALUES(preferred_problem_categories),
       preferred_client_size = VALUES(preferred_client_size)`,
    [
      Number(userId), capabilities.business_name, capabilities.location,
      capabilities.services, json(capabilities.industries_served), json(capabilities.technologies),
      json(capabilities.solution_types), json(capabilities.enabled_solutions),
      capabilities.min_project_value, capabilities.max_project_value,
      json(capabilities.preferred_industries), json(capabilities.preferred_locations),
      json(capabilities.preferred_problem_categories), capabilities.preferred_client_size,
    ]
  );
  return getCapabilities(userId);
}

/**
 * True when the user has an explicit capability profile AND a non-empty enabled
 * list — meaning the engine should gate opportunities on it. An empty enabled
 * list after a row exists means "I build nothing" (everything is gated).
 */
export async function hasCapabilityProfile(userId) {
  const row = await getCapabilities(userId);
  return Boolean(row && (row.business_name || row.enabled_solutions.length));
}