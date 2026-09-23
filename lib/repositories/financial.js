import { query, insert } from '@/lib/db';
import { OPPORTUNITY_STATUSES, DEFAULT_PROBABILITIES, PIPELINE_COLUMNS } from '@/lib/constants';

/**
 * Financial scenario + assumption persistence.
 * impact_low/high are ILLUSTRATIVE bounds; is_illustrative defaults to 1 and
 * only a human should ever change it.
 * Multi-tenant: every query is scoped to the caller's account via accountId.
 */

export async function replaceAssumptions(accountId, opportunityId, assumptions) {
  await query(
    'DELETE FROM opportunity_assumptions WHERE opportunity_id = ? AND account_id = ?',
    [Number(opportunityId), Number(accountId)]
  );
  for (const a of assumptions) {
    await createAssumption({ account_id: accountId, opportunity_id: opportunityId, ...a });
  }
}

export async function createAssumption({ account_id, opportunity_id, assumption_name, assumption_value,
                                         assumption_low, assumption_high,
                                         unit = null, source = 'Analyst estimate', confidence = 0.4 }) {
  return insert(
    `INSERT INTO opportunity_assumptions
       (account_id, opportunity_id, assumption_name, assumption_value, assumption_low, assumption_high,
        unit, source, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE assumption_value = VALUES(assumption_value),
       assumption_low = VALUES(assumption_low), assumption_high = VALUES(assumption_high),
       unit = VALUES(unit), source = VALUES(source), confidence = VALUES(confidence)`,
    [Number(account_id) || null, Number(opportunity_id), assumption_name, Number(assumption_value) || 0,
     assumption_low == null ? null : Number(assumption_low),
     assumption_high == null ? null : Number(assumption_high),
     unit || null, source || 'Analyst estimate', Math.min(1, Math.max(0, Number(confidence) || 0.4))]
  );
}

export async function listAssumptions(accountId, opportunityId) {
  return query(
    `SELECT * FROM opportunity_assumptions
      WHERE opportunity_id = ? AND account_id = ? ORDER BY id`,
    [Number(opportunityId), Number(accountId)]
  );
}

/** createFinancialScenario — one row per scenario per opportunity. */
export async function createFinancialScenario({ account_id, opportunity_id, scenario_type, currency = 'USD',
                                                formula_description, impact_low, impact_high,
                                                scenario_name = null, base_value = null,
                                                low_value = null, high_value = null,
                                                period = 'annual', assumptions_json = null,
                                                is_illustrative = 1 }) {
  const low = Number(low_value ?? impact_low);
  const high = Number(high_value ?? impact_high);
  return insert(
    `INSERT INTO financial_scenarios
       (account_id, opportunity_id, scenario_type, scenario_name, currency, formula_description,
        impact_low, impact_high, base_value, period, assumptions_json, is_illustrative)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [Number(account_id) || null, Number(opportunity_id), scenario_type, scenario_name || null, currency, formula_description,
     Number.isFinite(low) ? low : null, Number.isFinite(high) ? high : null,
     Number.isFinite(Number(base_value)) ? Number(base_value) : null, period,
     assumptions_json ? JSON.stringify(assumptions_json) : null, is_illustrative ? 1 : 0]
  );
}

export async function replaceScenarios(accountId, opportunityId, scenarios) {
  await query(
    'DELETE FROM financial_scenarios WHERE opportunity_id = ? AND account_id = ?',
    [Number(opportunityId), Number(accountId)]
  );
  const ids = [];
  for (const s of scenarios) {
    // Map the canonical engine output onto the persistence schema.
    const row = s.scenario_key
      ? {
          ...s,
          scenario_type: s.scenario_key,
          formula_description: s.formula,
          low_value: s.low_value,
          base_value: s.base_value,
          high_value: s.high_value,
          assumptions_json: Object.fromEntries(s.assumptions.map((a) => [
            a.key, { low: a.low, base: a.base, high: a.high },
          ])),
        }
      : s;
    ids.push(await createFinancialScenario({ account_id: accountId, opportunity_id: opportunityId, ...row }));
  }
  return ids;
}

export async function listScenarios(accountId, opportunityId) {
  return query(
    `SELECT * FROM financial_scenarios WHERE opportunity_id = ? AND account_id = ? ORDER BY id`,
    [Number(opportunityId), Number(accountId)]
  );
}

// ------------------------------------------------------------------ pipeline

/**
 * updatePipeline — the ONLY way opportunity status changes.
 * Records the transition in pipeline_events + activity_log, updates probability,
 * weighted_pipeline, days_in_stage, and stage_entered_at.
 */
export async function updatePipeline(accountId, opportunityId, toStatus, { notes = null, actor_user_id = null, project_value = null, project_currency = null } = {}) {
  if (!OPPORTUNITY_STATUSES[toStatus]) throw new Error(`Unknown status: ${toStatus}`);
  const current = await query(
    'SELECT id, status, project_value, project_currency FROM opportunities WHERE id = ? AND account_id = ?',
    [Number(opportunityId), Number(accountId)]
  );
  if (!current[0]) throw new Error('Opportunity not found');
  const fromStatus = current[0].status;
  if (fromStatus === toStatus && notes == null && project_value == null) return current[0].id;

  const prob = DEFAULT_PROBABILITIES[toStatus] ?? 0;
  const pv = project_value != null ? Number(project_value) : current[0].project_value;
  const cur = project_currency || current[0].project_currency || 'KES';
  const weighted = pv != null ? Math.round(pv * prob / 100 * 100) / 100 : null;

  const updates = [
    'status = ?',
    'probability = ?',
    'weighted_pipeline = ?',
    'stage_entered_at = NOW()',
    'days_in_stage = 0',
  ];
  const params = [toStatus, prob, weighted];

  if (notes != null) {
    updates.push('notes = ?');
    params.push(String(notes).slice(0, 5000));
  }
  if (project_value != null) {
    updates.push('project_value = ?', 'project_currency = ?');
    params.push(Number(project_value), cur);
  }

  params.push(Number(opportunityId), Number(accountId));
  await query(`UPDATE opportunities SET ${updates.join(', ')} WHERE id = ? AND account_id = ?`, params);

  // Record in pipeline_events (backward compatible).
  await addPipelineEvent({
    account_id: accountId,
    opportunity_id: Number(opportunityId),
    from_status: fromStatus,
    to_status: toStatus,
    notes,
    actor_user_id,
  });

  // Record in activity_log (the primary timeline).
  await logActivity({
    account_id: accountId,
    opportunity_id: Number(opportunityId),
    activity_type: 'status_change',
    title: `${OPPORTUNITY_STATUSES[fromStatus] || fromStatus} → ${OPPORTUNITY_STATUSES[toStatus] || toStatus}`,
    detail: notes || null,
    actor_user_id,
  });

  return current[0].id;
}

export async function addPipelineEvent({ account_id, opportunity_id, from_status, to_status, notes, actor_user_id }) {
  return insert(
    `INSERT INTO pipeline_events (account_id, opportunity_id, from_status, to_status, notes, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [Number(account_id) || null, Number(opportunity_id), from_status || null, to_status, notes || null, actor_user_id || null]
  );
}

export async function eventsForOpportunity(accountId, opportunityId) {
  return query(
    `SELECT pe.*, u.name AS actor_name FROM pipeline_events pe
      LEFT JOIN users u ON u.id = pe.actor_user_id
     WHERE pe.opportunity_id = ? AND pe.account_id = ? ORDER BY pe.created_at DESC, pe.id DESC`,
    [Number(opportunityId), Number(accountId)]
  );
}

export async function recentEvents(accountId, limit = 20) {
  return query(
    `SELECT pe.*, u.name AS actor_name, o.title AS opportunity_title, b.name AS business_name
       FROM pipeline_events pe
       JOIN opportunities o ON o.id = pe.opportunity_id AND o.account_id = ?
       JOIN businesses b ON b.id = o.business_id
       LEFT JOIN users u ON u.id = pe.actor_user_id
      ORDER BY pe.created_at DESC LIMIT ${Number(limit)}`,
    [Number(accountId)]
  );
}

// ------------------------------------------------------------- activity log

export async function logActivity({ account_id, opportunity_id, activity_type, title = null, detail = null, metadata = null, actor_user_id = null }) {
  return insert(
    `INSERT INTO activity_log (account_id, opportunity_id, activity_type, title, detail, metadata, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [Number(account_id) || null, Number(opportunity_id), activity_type, title || null, detail || null,
     metadata ? JSON.stringify(metadata) : null, actor_user_id || null]
  );
}

export async function activityForOpportunity(accountId, opportunityId, { limit = 50 } = {}) {
  return query(
    `SELECT al.*, u.name AS actor_name
       FROM activity_log al
       LEFT JOIN users u ON u.id = al.actor_user_id
      WHERE al.opportunity_id = ? AND al.account_id = ?
      ORDER BY al.created_at DESC, al.id DESC
      LIMIT ${Number(limit)}`,
    [Number(opportunityId), Number(accountId)]
  );
}

// ------------------------------------------------------------- pipeline views

/**
 * Kanban board grouped by status. `memberUserId` restricts the board to
 * opportunities assigned to that member (the MEMBER role's view).
 */
export async function pipelineKanban({ accountId, memberUserId = null, columns } = {}) {
  const cols = columns || PIPELINE_COLUMNS;
  const inCols = cols.map(() => '?').join(',');
  const memberParams = [];
  let memberSql = '';
  if (memberUserId != null) {
    memberSql = ' AND o.assignee_id = ?';
    memberParams.push(Number(memberUserId));
  }
  const rows = await query(
    `SELECT o.id, o.title, o.status, o.opportunity_score, o.score_category,
            o.project_value, o.project_currency, o.probability, o.weighted_pipeline,
            o.days_in_stage, o.next_action, o.notes, o.updated_at,
            b.name AS business_name, b.location AS business_location,
            b.industry AS business_industry, b.data_origin AS business_data_origin,
            (SELECT s.name FROM opportunity_solutions os JOIN solutions s ON s.id = os.solution_id
              WHERE os.opportunity_id = o.id AND os.recommended = 1 LIMIT 1) AS recommended_solution_name
       FROM opportunities o JOIN businesses b ON b.id = o.business_id
      WHERE o.account_id = ? AND o.status IN (${inCols})${memberSql}
      ORDER BY o.opportunity_score DESC, o.updated_at DESC`,
    [Number(accountId), ...cols, ...memberParams]
  );

  const byStatus = {};
  for (const col of cols) byStatus[col] = [];
  for (const r of rows) {
    if (byStatus[r.status]) byStatus[r.status].push(r);
  }
  return byStatus;
}

export async function pipelineMetrics(accountId) {
  const open = ['new', 'researching', 'qualified', 'contacted', 'replied', 'demo', 'proposal', 'negotiation'];
  const inOpen = open.map(() => '?').join(',');
  const rows = await query(
    `SELECT
       SUM(CASE WHEN status IN (${inOpen}) THEN project_value ELSE 0 END) AS total_pipeline,
       SUM(CASE WHEN status IN (${inOpen}) THEN weighted_pipeline ELSE 0 END) AS weighted_pipeline,
       SUM(CASE WHEN status = 'won' THEN project_value ELSE 0 END) AS won_revenue,
       COUNT(CASE WHEN status = 'won' THEN 1 END) AS won_count,
       COUNT(CASE WHEN status = 'lost' THEN 1 END) AS lost_count,
       AVG(CASE WHEN status = 'won' THEN project_value END) AS avg_project_value,
       AVG(CASE WHEN status IN ('won','lost') AND stage_entered_at IS NOT NULL
             THEN DATEDIFF(updated_at, stage_entered_at) END) AS avg_days_to_close
     FROM opportunities WHERE account_id = ?`,
    [...open, ...open, Number(accountId)]
  );
  const r = rows[0] || {};
  const won = Number(r.won_count || 0);
  const lost = Number(r.lost_count || 0);
  return {
    totalPipeline: Number(r.total_pipeline || 0),
    weightedPipeline: Number(r.weighted_pipeline || 0),
    wonRevenue: Number(r.won_revenue || 0),
    winRate: (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : 0,
    avgProjectValue: Math.round(Number(r.avg_project_value || 0)),
    avgDaysToClose: Math.round(Number(r.avg_days_to_close || 0)),
    currency: 'KES',
  };
}