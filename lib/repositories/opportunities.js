import { query, insert } from '@/lib/db';
import { PROBLEM_TYPE_KEYS, OPPORTUNITY_STATUSES, SCORE_WEIGHTS, DEFAULT_PROBABILITIES } from '@/lib/constants';

/**
 * Opportunity repository: createOpportunity / attachEvidence / matchSolution /
 * factor-score persistence. Pipeline transitions live in repositories/financial.js.
 * Multi-tenant: every query is scoped to the caller's account via accountId.
 * MEMBER role: lists/fetches are additionally restricted to assets assigned to
 * the member (assignee_id = user.id) — enforced here and in the pipeline views.
 */

export async function createOpportunity({ account_id, business_id, title, problem_type, problem,
                                          opportunity, why_it_matters, money_mechanism = null,
                                          money_mechanism_key = null, created_by = null }) {
  if (!PROBLEM_TYPE_KEYS.includes(problem_type)) throw new Error(`Unknown problem_type: ${problem_type}`);
  return insert(
    `INSERT INTO opportunities
       (account_id, assignee_id, business_id, title, problem_type, problem, opportunity, why_it_matters, money_mechanism, money_mechanism_key, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [Number(account_id) || null, null, Number(business_id), title, problem_type, problem, opportunity, why_it_matters, money_mechanism,
     money_mechanism_key || null, created_by]
  );
}

/** Update the analyst-owned narrative fields (evidence links untouched). */
export async function updateOpportunityText(accountId, id, { problem, opportunity, why_it_matters, money_mechanism, money_mechanism_key }) {
  await query(
    `UPDATE opportunities SET problem = ?, opportunity = ?, why_it_matters = ?, money_mechanism = ?, money_mechanism_key = ?
     WHERE id = ? AND account_id = ?`,
    [String(problem).slice(0, 4000), String(opportunity).slice(0, 4000),
     String(why_it_matters).slice(0, 4000), money_mechanism ? String(money_mechanism).slice(0, 500) : null,
     money_mechanism_key || null, Number(id), Number(accountId)]
  );
}

/** Persist the 4-part structured explanation (WHY/WHAT/HOW/UNCERTAIN). */
export async function saveExplanation(accountId, id, explanation) {
  const { why_exists, evidence_support, money_impact, uncertain, money_mechanism_key } = explanation || {};
  await query(
    `UPDATE opportunities SET opportunity_explanation = ?, money_mechanism_key = COALESCE(?, money_mechanism_key)
     WHERE id = ? AND account_id = ?`,
    [
      JSON.stringify({
        why_exists: String(why_exists || '').slice(0, 3000),
        evidence_support: String(evidence_support || '').slice(0, 3000),
        money_impact: String(money_impact || '').slice(0, 3000),
        uncertain: String(uncertain || '').slice(0, 3000),
      }),
      money_mechanism_key || null,
      Number(id),
      Number(accountId),
    ]
  );
}

export async function getExplanation(accountId, id) {
  const rows = await query(
    'SELECT opportunity_explanation FROM opportunities WHERE id = ? AND account_id = ?',
    [Number(id), Number(accountId)]
  );
  if (!rows[0] || !rows[0].opportunity_explanation) return null;
  try {
    return typeof rows[0].opportunity_explanation === 'string'
      ? JSON.parse(rows[0].opportunity_explanation) : rows[0].opportunity_explanation;
  } catch {
    return null;
  }
}

export async function findById(accountId, id) {
  const rows = await query(
    `SELECT o.*, b.name AS business_name, b.location AS business_location,
            b.industry AS business_industry, b.data_origin AS business_data_origin
       FROM opportunities o JOIN businesses b ON b.id = o.business_id
      WHERE o.id = ? AND o.account_id = ?`,
    [Number(id), Number(accountId)]
  );
  return rows[0] || null;
}

export async function findByBusiness(accountId, businessId) {
  return query(
    `SELECT o.*, b.name AS business_name, b.data_origin AS business_data_origin
       FROM opportunities o JOIN businesses b ON b.id = o.business_id
      WHERE o.business_id = ? AND o.account_id = ? ORDER BY o.opportunity_score DESC`,
    [Number(businessId), Number(accountId)]
  );
}

export async function findByBusinessAndProblem(accountId, businessId, problemType) {
  const rows = await query(
    'SELECT * FROM opportunities WHERE business_id = ? AND problem_type = ? AND account_id = ? LIMIT 1',
    [Number(businessId), problemType, Number(accountId)]
  );
  return rows[0] || null;
}

/** Rich rows for a set of opportunity ids (used by the discovery result feed). */
export async function listByIds(accountId, ids) {
  const clean = (ids || []).map(Number).filter(Boolean);
  if (!clean.length) return [];
  const placeholders = clean.map(() => '?').join(',');
  return query(
    `${LIST_SELECT} WHERE o.id IN (${placeholders}) AND o.account_id = ? ORDER BY o.opportunity_score DESC`,
    [...clean, Number(accountId)]
  );
}

const LIST_SELECT = `
  SELECT o.*,
         b.name AS business_name, b.location AS business_location,
         b.industry AS business_industry, b.data_origin AS business_data_origin,
         b.description AS business_description,
         (SELECT COUNT(*) FROM opportunity_evidence oe
           WHERE oe.opportunity_id = o.id AND oe.account_id = o.account_id) AS evidence_count,
         (SELECT os.project_value_low FROM opportunity_solutions os
           WHERE os.opportunity_id = o.id AND os.recommended = 1 LIMIT 1) AS project_value_low,
         (SELECT os.project_value_high FROM opportunity_solutions os
           WHERE os.opportunity_id = o.id AND os.recommended = 1 LIMIT 1) AS project_value_high,
         (SELECT s.currency FROM opportunity_solutions os JOIN solutions s ON s.id = os.solution_id
           WHERE os.opportunity_id = o.id AND os.recommended = 1 LIMIT 1) AS currency,
         (SELECT s.name FROM opportunity_solutions os JOIN solutions s ON s.id = os.solution_id
           WHERE os.opportunity_id = o.id AND os.recommended = 1 LIMIT 1) AS recommended_solution_name,
         (SELECT COUNT(*) FROM outreach_messages m WHERE m.opportunity_id = o.id) AS message_count
    FROM opportunities o JOIN businesses b ON b.id = o.business_id`;

/**
 * Account-scoped listing. When `memberUserId` is provided the result is
 * restricted to opportunities where that member is the assignee.
 */
export async function list({ accountId, memberUserId = null, status = '', problemType = '', limit = 200 } = {}) {
  const params = [Number(accountId)];
  let sql = `${LIST_SELECT} WHERE o.account_id = ?`;
  if (memberUserId != null) {
    sql += ' AND o.assignee_id = ?';
    params.push(Number(memberUserId));
  }
  if (status) {
    sql += ' AND o.status = ?';
    params.push(status);
  }
  if (problemType) {
    sql += ' AND o.problem_type = ?';
    params.push(problemType);
  }
  sql += ` ORDER BY o.opportunity_score DESC, o.updated_at DESC LIMIT ${Number(limit)}`;
  return query(sql, params);
}

/**
 * Persist analysis results: the eight factor scores in dedicated columns plus
 * the weighted total, the derived HOT/HIGH/MEDIUM/LOW/REJECT category, and the
 * per-dimension human-readable reasons. Deterministic application code — never
 * AI output. Thresholds are configurable via app_settings (per account).
 */
export async function updateAnalysis(accountId, id, factors, context = {}) {
  const [{ computeScore, buildScoreReasons }, { getScoreThresholds }] = await Promise.all([
    import('@/lib/services/analysis/scoring'),
    import('@/lib/repositories/settings'),
  ]);
  const thresholds = await getScoreThresholds(accountId);
  const factorValues = {
    evidence_strength: factors.evidence_strength ?? 0,
    problem_severity: factors.problem_severity ?? 0,
    money_potential: factors.money_potential ?? 0,
    solution_fit: factors.solution_fit ?? 0,
    business_maturity: factors.business_maturity ?? 0,
    ability_to_pay: factors.ability_to_pay ?? 0,
    operational_complexity: factors.operational_complexity ?? 0,
    contactability: factors.contactability ?? 0,
  };
  const { score, category, breakdown, subscores } = computeScore(factorValues, { thresholds });
  const reasons = buildScoreReasons(
    { ...factorValues, overall: score },
    { thresholds, context }
  );
  await query(
    `UPDATE opportunities SET
       confidence_score = ?, opportunity_score = ?,
       evidence_strength_score = ?,
       problem_severity_score = ?, money_potential_score = ?, business_maturity_score = ?,
       ability_to_pay_score = ?, solution_fit_score = ?, contactability_score = ?,
       operational_complexity_score = ?,
       score_category = ?, score_reasons = ?,
       next_action = COALESCE(?, next_action), analysis_provider = ?
     WHERE id = ? AND account_id = ?`,
    [
      factors.confidence_score ?? null,
      score,
      factors.evidence_strength ?? null,
      factors.problem_severity ?? null,
      factors.money_potential ?? null,
      factors.business_maturity ?? null,
      factors.ability_to_pay ?? null,
      factors.solution_fit ?? null,
      factors.contactability ?? null,
      factors.operational_complexity ?? null,
      category,
      JSON.stringify(reasons),
      factors.next_action || null,
      factors.analysis_provider || 'rules',
      Number(id),
      Number(accountId),
    ]
  );
  await setStatusIfNew(accountId, Number(id));
  return { score, category, breakdown, subscores, reasons };
}

async function setStatusIfNew(accountId, id) {
  // Auto-advance new → researching AND seed the pipeline fields that
  // updatePipeline() normally sets on a manual transition, so the pipeline
  // UI never shows an armed but un-priced ('—') opportunity.
  const prob = DEFAULT_PROBABILITIES.researching;
  await query(
    `UPDATE opportunities
        SET status = 'researching',
            probability = COALESCE(probability, ?),
            weighted_pipeline = COALESCE(weighted_pipeline, project_value * ? / 100),
            stage_entered_at = COALESCE(stage_entered_at, NOW()),
            days_in_stage = 0
      WHERE id = ? AND account_id = ? AND status = 'new'`,
    [prob, prob, id, accountId]
  );
}

/** Reassign an opportunity to a member of the same account (recording audit is the caller's job). */
export async function updateAssignee(accountId, id, assigneeId) {
  await query(
    'UPDATE opportunities SET assignee_id = ? WHERE id = ? AND account_id = ?',
    [assigneeId ? Number(assigneeId) : null, Number(id), Number(accountId)]
  );
}

/** attachEvidence links supporting evidence with an explicit relevance score. */
export async function attachEvidence(accountId, opportunityId, evidenceId, relevanceScore = 0.5) {
  await query(
    `INSERT INTO opportunity_evidence (account_id, opportunity_id, evidence_id, relevance_score)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE relevance_score = VALUES(relevance_score)`,
    [Number(accountId), Number(opportunityId), Number(evidenceId),
     Math.min(1, Math.max(0, Number(relevanceScore) || 0.5))]
  );
}

export async function linkedEvidence(accountId, opportunityId) {
  return query(
    `SELECT e.id, e.claim_type, e.evidence_type, e.signal_key, e.evidence_text,
            e.source_excerpt_summary, e.confidence_score, e.captured_at, e.captured_by,
            s.source_name, s.source_url, oe.relevance_score
       FROM opportunity_evidence oe
       JOIN business_evidence e ON e.id = oe.evidence_id
       LEFT JOIN business_sources s ON s.id = e.source_id
      WHERE oe.opportunity_id = ? AND oe.account_id = ?
      ORDER BY oe.relevance_score DESC, e.confidence_score DESC`,
    [Number(opportunityId), Number(accountId)]
  );
}

/** Persist matched solutions for an opportunity. */
export async function replaceSolutionMatches(accountId, opportunityId, matches) {
  await query(
    'DELETE FROM opportunity_solutions WHERE opportunity_id = ? AND account_id = ?',
    [Number(opportunityId), Number(accountId)]
  );
  for (const m of matches) {
    await matchSolution({
      account_id: accountId,
      opportunity_id: opportunityId,
      solution_id: m.solution_id,
      fit_score: m.fit_score,
      reason: m.why || m.reason || m.rationale || null,
      problem_fit: m.problem_fit,
      industry_fit: m.industry_fit,
      technical_fit: m.technical_fit,
      commercial_fit: m.commercial_fit,
      recommended: Boolean(m.is_recommended || m.recommended),
      project_value_low: (m.project_value && m.project_value.low != null)
        ? m.project_value.low
        : (m.project_value_low ?? m.minimum_project_value ?? null),
      project_value_base: (m.project_value && m.project_value.base != null)
        ? m.project_value.base
        : (m.project_value_base ?? null),
      project_value_high: (m.project_value && m.project_value.high != null)
        ? m.project_value.high
        : (m.project_value_high ?? m.maximum_project_value ?? null),
    });
  }
}

export async function matchSolution({ account_id, opportunity_id, solution_id, fit_score, reason,
                                      recommended, project_value_low, project_value_base,
                                      project_value_high, problem_fit, industry_fit,
                                      technical_fit, commercial_fit }) {
  return insert(
    `INSERT INTO opportunity_solutions
       (account_id, opportunity_id, solution_id, fit_score, reason, recommended,
        project_value_low, project_value_base, project_value_high,
        problem_fit, industry_fit, technical_fit, commercial_fit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE fit_score = VALUES(fit_score), reason = VALUES(reason),
       recommended = VALUES(recommended),
       project_value_low = VALUES(project_value_low),
       project_value_base = VALUES(project_value_base),
       project_value_high = VALUES(project_value_high),
       problem_fit = VALUES(problem_fit), industry_fit = VALUES(industry_fit),
       technical_fit = VALUES(technical_fit), commercial_fit = VALUES(commercial_fit)`,
    [Number(account_id) || null, Number(opportunity_id), Number(solution_id), Math.round(Number(fit_score) || 0),
     reason || null, recommended ? 1 : 0, project_value_low ?? null, project_value_base ?? null,
     project_value_high ?? null, problem_fit ?? null, industry_fit ?? null,
     technical_fit ?? null, commercial_fit ?? null]
  );
}

export async function solutionLinks(accountId, opportunityId) {
  return query(
    `SELECT os.*, s.name AS solution_name, s.description AS solution_description,
            s.features AS solution_features, s.currency AS solution_currency
       FROM opportunity_solutions os JOIN solutions s ON s.id = os.solution_id
      WHERE os.opportunity_id = ? AND os.account_id = ? ORDER BY os.fit_score DESC`,
    [Number(opportunityId), Number(accountId)]
  );
}

export async function updateProjectValue(accountId, id, projectValue, currency = 'KES') {
  await query(
    `UPDATE opportunities SET project_value = ?, project_currency = ?, weighted_pipeline = project_value * COALESCE(probability, 0) / 100
      WHERE id = ? AND account_id = ?`,
    [Number(projectValue), currency, Number(id), Number(accountId)]
  );
}

export async function updateNotes(accountId, id, notes) {
  await query(
    'UPDATE opportunities SET notes = ? WHERE id = ? AND account_id = ?',
    [String(notes).slice(0, 5000), Number(id), Number(accountId)]
  );
}

export async function updateNextAction(accountId, id, nextAction) {
  await query(
    'UPDATE opportunities SET next_action = ? WHERE id = ? AND account_id = ?',
    [String(nextAction).slice(0, 300), Number(id), Number(accountId)]
  );
}

/**
 * Capability gate: the opportunity was detected but none of the user's enabled
 * solutions can serve it. Terminal status — excluded from the pipeline board.
 */
export async function markNotAServiceFit(accountId, id, reason) {
  await query(
    `UPDATE opportunities SET status = 'not_a_service_fit', probability = 0,
       weighted_pipeline = 0, notes = CONCAT('Capability gate: ', ?, '\n', COALESCE(notes, ''))
     WHERE id = ? AND account_id = ?`,
    [String(reason || 'No enabled capability matches this problem.').slice(0, 500), Number(id), Number(accountId)]
  );
  const { logActivity } = await import('@/lib/repositories/financial');
  await logActivity({
    account_id: accountId,
    opportunity_id: Number(id),
    activity_type: 'pipeline_edit',
    title: 'Marked not a service fit',
    detail: String(reason || 'No enabled capability matches this problem.').slice(0, 500),
  });
}