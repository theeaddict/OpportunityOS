import { query } from '@/lib/db';
import { PIPELINE_COLUMNS } from '@/lib/constants';

const OPEN = ['new', 'researching', 'qualified', 'contacted', 'replied', 'demo', 'proposal', 'negotiation'];
const NEED_ACTION = ['new', 'researching', 'qualified', 'contacted', 'replied'];

const FEED_SELECT = `
  SELECT o.id, o.business_id, o.title, o.problem_type, o.problem, o.opportunity, o.why_it_matters,
         o.money_mechanism, o.money_mechanism_key, o.status, o.opportunity_score,
         o.confidence_score, o.score_category, o.next_action, o.updated_at,
         o.project_value, o.project_currency, o.probability, o.weighted_pipeline,
         o.days_in_stage, o.notes,
         b.name AS business_name, b.location AS business_location,
         b.industry AS business_industry, b.data_origin AS business_data_origin,
         b.description AS business_description,
         (SELECT COUNT(*) FROM opportunity_evidence oe
           WHERE oe.opportunity_id = o.id AND oe.account_id = o.account_id) AS evidence_count,
         (SELECT os.project_value_base FROM opportunity_solutions os
           WHERE os.opportunity_id = o.id AND os.recommended = 1 LIMIT 1) AS project_value_base,
         (SELECT os.project_value_low FROM opportunity_solutions os
           WHERE os.opportunity_id = o.id AND os.recommended = 1 LIMIT 1) AS project_value_low,
         (SELECT os.project_value_high FROM opportunity_solutions os
           WHERE os.opportunity_id = o.id AND os.recommended = 1 LIMIT 1) AS project_value_high,
         (SELECT s.currency FROM opportunity_solutions os JOIN solutions s ON s.id = os.solution_id
           WHERE os.opportunity_id = o.id AND os.recommended = 1 LIMIT 1) AS project_value_currency,
         (SELECT s.name FROM opportunity_solutions os JOIN solutions s ON s.id = os.solution_id
           WHERE os.opportunity_id = o.id AND os.recommended = 1 LIMIT 1) AS recommended_solution_name,
         (SELECT COUNT(*) FROM outreach_messages m WHERE m.opportunity_id = o.id) AS message_count
    FROM opportunities o JOIN businesses b ON b.id = o.business_id`;

function annualMidpoint(s) {
  if (s.impact_low == null && s.impact_high == null) return 0;
  const lo = Number(s.impact_low || 0);
  const hi = Number(s.impact_high || 0);
  let mid = (lo + hi) / 2;
  if (s.period === 'monthly') mid *= 12;
  return mid;
}

function memberClause(memberUserId) {
  return memberUserId != null ? ' AND o.assignee_id = ?' : '';
}
function memberParam(memberUserId) {
  return memberUserId != null ? Number(memberUserId) : null;
}

export async function getDashboard(accountId, memberUserId = null) {
  const openListSQL = OPEN.map(() => '?').join(',');
  const needSQL = NEED_ACTION.map(() => '?').join(',');
  const memberSql = memberClause(memberUserId);
  const memberP = memberParam(memberUserId);

  const [metrics, feed] = await Promise.all([
    getMetrics(accountId, memberUserId, openListSQL, needSQL, memberSql, memberP),
    getFeed(accountId, memberUserId, memberSql, memberP),
  ]);

  return { metrics, feed };
}

async function getMetrics(accountId, memberUserId, openListSQL, needSQL, memberSql, memberP) {
  const rows = await query(
    `SELECT
       COUNT(*) AS total,
       COUNT(DISTINCT CASE WHEN status = 'new' THEN id END) AS new_opportunities,
       COUNT(DISTINCT CASE WHEN score_category = 'HOT' OR opportunity_score IS NOT NULL AND opportunity_score >= 90 THEN id END) AS hot_opportunities,
       COUNT(DISTINCT CASE WHEN status IN (${needSQL}) THEN id END) AS needing_action,
       COUNT(DISTINCT CASE WHEN status = 'proposal' THEN id END) AS proposals,
       COUNT(DISTINCT CASE WHEN status = 'won' THEN id END) AS won
     FROM opportunities o WHERE account_id = ?${memberSql}`,
    [...NEED_ACTION, Number(accountId)].concat(memberP != null ? [memberP] : [])
  );
  const m = rows[0] || {};

  const demoRows = await query(
    `SELECT COUNT(DISTINCT opportunity_id) AS demos
       FROM ai_jobs WHERE account_id = ? AND job_type = 'demo_specification' AND status = 'completed'`,
    [Number(accountId)]
  );

  // Project value pipeline (from opportunities.project_value, NOT business impact)
  const pvRows = await query(
    `SELECT
       SUM(CASE WHEN status IN (${openListSQL}) THEN project_value ELSE 0 END) AS total_pipeline,
       SUM(CASE WHEN status IN (${openListSQL}) THEN weighted_pipeline ELSE 0 END) AS weighted_pipeline,
       SUM(CASE WHEN status = 'won' THEN project_value ELSE 0 END) AS won_revenue,
       COUNT(CASE WHEN status = 'won' THEN 1 END) AS won_count,
       COUNT(CASE WHEN status IN (${openListSQL}) THEN 1 END) AS active_count,
       AVG(CASE WHEN status = 'won' THEN project_value END) AS avg_project_value,
       AVG(CASE WHEN status IN ('won','lost') AND stage_entered_at IS NOT NULL
             THEN DATEDIFF(updated_at, stage_entered_at) END) AS avg_days_to_close,
       COUNT(CASE WHEN status = 'lost' THEN 1 END) AS lost_count
     FROM opportunities o WHERE account_id = ?${memberSql}`,
    [...OPEN, ...OPEN, ...OPEN, Number(accountId)].concat(memberP != null ? [memberP] : [])
  );
  const pv = pvRows[0] || {};

  const totalPipeline = Number(pv.total_pipeline || 0);
  const weightedPipeline = Number(pv.weighted_pipeline || 0);
  const wonRevenue = Number(pv.won_revenue || 0);
  const wonCount = Number(pv.won_count || 0);
  const lostCount = Number(pv.lost_count || 0);
  const winRate = (wonCount + lostCount) > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : 0;

  // Annualized business impact of OPEN opportunities — the money at stake, not
  // the deal. Mirrors the feed's scenario selection: for each opportunity take
  // the largest illustrative scenario and annualize its midpoint.
  const impactRows = await query(
    `SELECT fs.opportunity_id, fs.period, fs.impact_low, fs.impact_high, fs.currency
       FROM financial_scenarios fs
       JOIN opportunities o ON o.id = fs.opportunity_id AND o.account_id = ?
      WHERE fs.is_illustrative = 1 AND o.status IN (${openListSQL})${memberSql}`,
    [Number(accountId), ...OPEN].concat(memberP != null ? [memberP] : [])
  );
  const pick = new Map();
  for (const s of impactRows) {
    const mid = annualMidpoint(s);
    const cur = pick.get(s.opportunity_id);
    if (!cur || mid > cur.mid) pick.set(s.opportunity_id, { mid, currency: s.currency || 'KES' });
  }
  let impactTotal = 0;
  let impactCurrency = 'KES';
  for (const { mid, currency } of pick.values()) {
    impactTotal += mid;
    impactCurrency = currency;
  }

  return {
    total: Number(m.total || 0),
    newOpportunities: Number(m.new_opportunities || 0),
    hotOpportunities: Number(m.hot_opportunities || 0),
    needingAction: Number(m.needing_action || 0),
    demos: Number(demoRows[0]?.demos || 0),
    proposals: Number(m.proposals || 0),
    won: Number(m.won || 0),
    // Pipeline metrics (project value, NOT business impact)
    totalPipeline,
    weightedPipeline,
    wonRevenue,
    winRate,
    activeCount: Number(pv.active_count || 0),
    avgProjectValue: Math.round(Number(pv.avg_project_value || 0)),
    avgDaysToClose: Math.round(Number(pv.avg_days_to_close || 0)),
    pipelineCurrency: 'KES',
    // Money-grade headline metrics (annualized business impact, not deals)
    businessImpact: { total: Math.round(impactTotal), currency: impactCurrency },
    projectValue: { total: totalPipeline, weighted: weightedPipeline, currency: 'KES' },
  };
}

async function getFeed(accountId, memberUserId, memberSql, memberP) {
  const opportunities = await query(
    `${FEED_SELECT} WHERE o.account_id = ?${memberSql}
      ORDER BY o.opportunity_score DESC, o.updated_at DESC LIMIT 200`,
    [Number(accountId)].concat(memberP != null ? [memberP] : [])
  );
  if (!opportunities.length) return [];

  const oppIds = opportunities.map((o) => o.id);
  const bizIds = [...new Set(opportunities.map((o) => o.business_id))];
  const inOpps = oppIds.map(() => '?').join(',');
  const inBiz = bizIds.map(() => '?').join(',');

  const [scenarios, contacts, demos] = await Promise.all([
    query(
      `SELECT opportunity_id, currency, impact_low, impact_high, period, scenario_type, formula_description
         FROM financial_scenarios
        WHERE opportunity_id IN (${inOpps}) AND is_illustrative = 1
        ORDER BY id`,
      oppIds
    ),
    query(
      `SELECT bc.business_id, bc.contact_type, bc.verification_status
         FROM business_contacts bc
         JOIN businesses b ON b.id = bc.business_id AND b.account_id = ?
        WHERE bc.business_id IN (${inBiz})
          AND bc.contact_type = 'whatsapp'
          AND bc.verification_status IN ('source_published','user_confirmed')`,
      [Number(accountId), ...bizIds]
    ),
    query(
      `SELECT DISTINCT opportunity_id AS oid
         FROM ai_jobs WHERE account_id = ? AND job_type = 'demo_specification' AND status = 'completed'
         AND opportunity_id IN (${inOpps})`,
      [Number(accountId), ...oppIds]
    ),
  ]);

  const demoSet = new Set(demos.map((d) => Number(d.oid)));
  const whatsappSet = new Set(contacts.map((c) => Number(c.business_id)));

  const scenarioByOpp = new Map();
  for (const s of scenarios) {
    const cur = scenarioByOpp.get(s.opportunity_id) || null;
    const val = annualMidpoint(s);
    if (!cur || val > cur.impactMid) {
      scenarioByOpp.set(s.opportunity_id, {
        scenarioType: s.scenario_type,
        currency: s.currency || 'USD',
        impactLow: s.impact_low,
        impactHigh: s.impact_high,
        period: s.period,
        impactMid: val,
      });
    }
  }

  return opportunities.map((o) => {
    const scenario = scenarioByOpp.get(o.id) || null;
    return {
      ...o,
      business_city: o.business_location,
      hasWhatsapp: whatsappSet.has(Number(o.business_id)),
      hasDemo: demoSet.has(Number(o.id)),
      scenario,
    };
  });
}