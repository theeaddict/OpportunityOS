import {
  SCORE_WEIGHTS,
  DEFAULT_SCORE_THRESHOLDS,
  SCORE_CATEGORIES,
} from '@/lib/constants';

/**
 * Opportunity Scoring Engine — deterministic application code, never AI.
 *
 * Eight weighted dimensions each score 0-100 (raw). The overall score is the
 * weighted sum (0-100), categorised into HOT/HIGH/MEDIUM/LOW/REJECT. Every
 * dimension also carries a human-readable reason.
 *
 * IMPORTANT: follower count is NEVER a dimension and NEVER dominates. It is at
 * most a small, hard-capped supporting signal inside the commercial
 * (ability-to-pay) evidence and the reasons text — never a primary driver.
 */

// Digital order of the dimensions and how each maps to the required output key.
const DIMENSIONS = [
  { key: 'evidence_strength',      output: 'evidence_score',       label: 'Evidence',       weight: SCORE_WEIGHTS.evidence_strength },
  { key: 'problem_severity',       output: 'problem_score',        label: 'Problem',        weight: SCORE_WEIGHTS.problem_severity },
  { key: 'money_potential',        output: 'money_score',          label: 'Money',          weight: SCORE_WEIGHTS.money_potential },
  { key: 'business_maturity',      output: 'maturity_score',       label: 'Maturity',       weight: SCORE_WEIGHTS.business_maturity },
  { key: 'ability_to_pay',         output: 'ability_to_pay_score', label: 'Ability to pay', weight: SCORE_WEIGHTS.ability_to_pay },
  { key: 'solution_fit',           output: 'solution_fit_score',   label: 'Solution fit',   weight: SCORE_WEIGHTS.solution_fit },
  { key: 'contactability',         output: 'contactability_score', label: 'Contactability', weight: SCORE_WEIGHTS.contactability },
  { key: 'operational_complexity', output: 'complexity_score',     label: 'Complexity',     weight: SCORE_WEIGHTS.operational_complexity },
];

const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, Number(v) || 0));

/**
 * Classify a 0-100 overall score into a category using configurable thresholds.
 * A score equal to a boundary maps to the higher bucket (90 → HOT, 80 → HIGH…).
 */
export function classifyScore(score, thresholds = DEFAULT_SCORE_THRESHOLDS) {
  const t = { ...DEFAULT_SCORE_THRESHOLDS, ...(thresholds || {}) };
  const s = clamp(score);
  const order = [
    ['HOT', t.hot],
    ['HIGH', t.high],
    ['MEDIUM', t.medium],
    ['LOW', t.low],
    ['REJECT', t.reject != null ? t.reject : -Infinity],
  ];
  for (const [label, min] of order) {
    if (s >= Number(min)) return { label, min: Number(min) };
  }
  return { label: 'REJECT', min: order[order.length - 1][1] };
}

/** Raw factor values → per-dimension weighted "out of max" values + overall. */
export function computeScore(factorValues, { thresholds = DEFAULT_SCORE_THRESHOLDS } = {}) {
  const breakdown = {};
  const subscores = [];
  for (const { key, output, label, weight } of DIMENSIONS) {
    const raw = Math.round(clamp(factorValues[key]));
    const max = Math.round(weight * 100);        // e.g. 0.20 → 20
    const weighted = Math.round(raw * weight);   // e.g. 90 → 18 (out of 20)
    breakdown[key] = { raw, weight, max, weighted, output, label };
    subscores.push({
      key,
      output,
      label,
      raw,
      max,
      score: weighted, // e.g. 18/20
    });
  }
  // Canonical overall: round the UNROUNDED weighted sum ONCE, so the badge and
  // the narrative "Overall" reason are always identical — never a sum of
  // already-rounded per-dimension values, which inflates the total.
  const score = clamp(Math.round(sumWeighted(factorValues)));
  const { label: category } = classifyScore(score, thresholds);
  return { score, category, breakdown, subscores };
}

/** Human-readable reason for a single raw subscore against its weight band. */
function bandReason(raw, { ok = 80, medium = 55 } = {}) {
  if (raw >= ok) return { tone: 'strong', text: 'strong' };
  if (raw >= medium) return { tone: 'moderate', text: 'moderate' };
  return { tone: 'weak', text: 'weak' };
}

/**
 * Build per-dimension + overall human-readable reasons from the already
 * computed factor values plus optional context. Context only clarifies the
 * "why"; it never re-scores.
 */
export function buildScoreReasons(
  factorValues,
  { thresholds = DEFAULT_SCORE_THRESHOLDS, context = {} } = {}
) {
  const raw = (k) => Math.round(clamp(factorValues[k]));
  // Per-dimension weighted "out of max" so the explanation reads like
  // "Evidence: 18/20". max = weight * 100; score = round(raw * weight).
  const dim = (key) => {
    const weight = SCORE_WEIGHTS[key];
    return { raw: raw(key), score: Math.round(clamp(factorValues[key]) * weight), max: Math.round(weight * 100) };
  };
  const reasons = [];
  const push = (output, title, key, reason) => {
    const d = dim(key);
    reasons.push({ dimension: output, title, raw: d.raw, score: d.score, max: d.max, reason });
  };

  const ev = raw('evidence_strength');
  push('evidence_score', 'Evidence', 'evidence_strength', ev >= 80
      ? `Strong, well-confirmed evidence: multiple corroborating sources at high confidence underpin the opportunity.`
      : ev >= 55
        ? `Moderate evidence: enough to act, but several claims still need confirmation.`
        : `Thin evidence: few or low-confidence claims — treat the opportunity as provisional.`);

  const pr = raw('problem_severity');
  push('problem_score', 'Problem', 'problem_severity', pr >= 80
      ? `Severe problem: the pain is material and directly disrupts revenue or operations.`
      : pr >= 55
        ? `Observable problem: real friction exists, though not business-critical.`
        : `Mild problem: the issue is real but low-impact right now.`);

  const mo = raw('money_potential');
  const annual = Number(context?.annualMidpoint) || 0;
  const confNote = context?.confidence != null
    ? ` The estimated magnitude is discounted by ${Math.round(Number(context.confidence) * 100)}% evidence confidence.`
    : '';
  push('money_score', 'Money', 'money_potential', mo >= 80
      ? `High money potential: the illustrative annual impact is substantial (~${fmtK(annual)}).${confNote}`
      : mo >= 55
        ? `Meaningful money potential: a realistic annual upside (~${fmtK(annual)}).${confNote}`
        : `Limited money potential: the annual upside (~${fmtK(annual)}) is modest next to the effort.${confNote}`);

  const ma = raw('business_maturity');
  const maturitySignals = context?.maturitySignals ?? 0;
  push('maturity_score', 'Maturity', 'business_maturity', ma >= 80
      ? `Mature operation: ${maturitySignals} maturity signals show an established, multi-channel business.`
      : ma >= 55
        ? `Established business: ${maturitySignals} maturity signals present, with room to grow.`
        : `Early-stage business: only ${maturitySignals} maturity signals — sizeable implementation may strain capacity.`);

  const ap = raw('ability_to_pay');
  const followers = Number(context?.followers) || 0;
  const followerNote = followers > 0
    ? ` A following of ${followers.toLocaleString()} is treated only as supporting commercial evidence and adds a small, capped boost.`
    : ' No published follower count — it neither helped nor hurt the score.';
  push('ability_to_pay_score', 'Ability to pay', 'ability_to_pay', ap >= 80
      ? `Strong ability to pay: corporate/established signals and a real project-value budget.${followerNote}`
      : ap >= 55
        ? `Moderate ability to pay: some budget-capacity signals, but the price may need care.${followerNote}`
        : `Weak ability to pay: limited budget-capacity signals.${followerNote}`);

  const sf = raw('solution_fit');
  const solutionName = context?.recommendedSolution?.name || 'the recommended solution';
  push('solution_fit_score', 'Solution fit', 'solution_fit', sf >= 80
      ? `Excellent solution fit: "${solutionName}" maps closely to the problem, evidence and budget.`
      : sf >= 55
        ? `Decent solution fit: "${solutionName}" addresses the core need, with some gaps.`
        : `Weak solution fit: no strong match — the project would be a stretch.`);

  const ca = raw('contactability');
  push('contactability_score', 'Contactability', 'contactability', ca >= 80
      ? `Easily contactable: verified phone/WhatsApp or published contact channels.`
      : ca >= 55
        ? `Contactable: at least one usable channel, not fully verified.`
        : `Hard to contact: few or unverified channels make outreach unreliable.`);

  const cx = raw('operational_complexity');
  push('complexity_score', 'Complexity', 'operational_complexity', cx >= 80
      ? `Low operational complexity: a contained build with modest integration risk.`
      : cx >= 55
        ? `Moderate complexity: some integration/change risk to plan for.`
        : `High operational complexity: a heavy build that raises delivery risk and drags the score down.`);

  const overall = Math.round(sumWeighted(factorValues));
  const { label: category, min } = classifyScore(overall, thresholds);
  const categoryMeta = SCORE_CATEGORIES[category] || SCORE_CATEGORIES.REJECT;
  // REJECT's internal floor is -Infinity; report the actionable low-boundary instead.
  const t = { ...DEFAULT_SCORE_THRESHOLDS, ...(thresholds || {}) };
  const need = category === 'REJECT' ? Number(t.low) : min;
  reasons.push({
    dimension: 'overall',
    title: 'Overall',
    raw: overall,
    score: overall,
    max: 100,
    reason: `Overall the opportunity scores ${overall}/100 → ${category} (needs ≥ ${need}). ${categoryMeta.hint}`,
  });

  return reasons;
}

function sumWeighted(factorValues) {
  return DIMENSIONS.reduce((s, { key, weight }) => s + clamp(factorValues[key]) * weight, 0);
}

function fmtK(v) {
  const n = Number(v) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`.replace(/\.0/, '');
  if (n >= 1e3) return `${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1)}K`.replace(/\.0/, '');
  return String(Math.round(n));
}

// --- factor calculators -----------------------------------------------------

const MATURITY_SIGNALS = [
  'multiple_branches', 'team_employees', 'wholesale_operations', 'high_value_products',
  'high_transaction_volume', 'multiple_channels', 'delivery_operations', 'existing_website',
  'online_ordering', 'established_history', 'professional_premises', 'corporate_customers',
  'inventory_complexity',
];

const PAY_CAPACITY_SIGNALS = [
  'high_value_products', 'corporate_customers', 'wholesale_operations', 'established_history',
  'multiple_branches', 'high_transaction_volume',
];

export function evidenceStrengthFactor(evidenceRows) {
  const n = evidenceRows.length;
  const avgConf = n ? evidenceRows.reduce((s, e) => s + Number(e.confidence_score), 0) / n : 0;
  const countScore = Math.min(1, n / 4);
  return Math.round(countScore * 60 + avgConf * 100 * 0.4);
}

/** Number of MATURITY_SIGNALS actually present — used by scoring AND the reasons text. */
export function countMaturitySignals(signals) {
  return MATURITY_SIGNALS.filter((k) => signals[k]).length;
}

export function maturityFactor(signals) {
  return Math.round(Math.min(1, countMaturitySignals(signals) / 6) * 100);
}

/**
 * Bounded supporting contribution from follower count — NEVER a dominant factor.
 * Followers only nudge commercial (ability-to-pay) evidence inside a strict cap,
 * so their influence stays small regardless of how large the audience is.
 */
function followerSupportPoints(followers) {
  const n = Number(followers) || 0;
  if (n <= 0) return 0;
  if (n >= 50000) return 5;   // plateaus — cannot keep growing
  if (n >= 10000) return 4;
  if (n >= 2000) return 3;
  if (n >= 500) return 2;
  return 1;
}

export function abilityToPayFactor(signals, recommendedSolution = null, followers = null) {
  const present = PAY_CAPACITY_SIGNALS.filter((k) => signals[k]);
  let score = Math.min(1, present.length / 3) * 70;
  // Budget floor from the recommended solution's published minimum project value.
  // The match object carries project_value.{low,base,high}; full solution rows
  // carry minimum_project_value — honour either so the +30 is never dead code.
  const minValue = Number(
    recommendedSolution?.minimum_project_value ?? recommendedSolution?.project_value?.base
  ) || 0;
  if (minValue >= 1000) score += 30;
  score = Math.min(100, score + followerSupportPoints(followers));
  return Math.round(score);
}

export function contactabilityFactor(contacts = []) {
  if (!contacts.length) return 0;
  let best = 0;
  for (const c of contacts) {
    if (!c.contact_value) continue;
    let s = 50;
    if (c.verification_status === 'source_published' || c.verification_status === 'user_confirmed') s += 25;
    else s -= 15;
    s += Number(c.confidence_score || 0) * 25;
    best = Math.max(best, s);
  }
  return Math.round(Math.min(100, best));
}

export function severityFactor(problemType, aiSeverity = null) {
  const base = { lost_sales: 70, poor_conversion: 60, manual_ordering: 55, inventory_problems: 65,
    multi_branch_management: 65, wholesale_ordering: 60 }[problemType] ?? 50;
  const mult = aiSeverity ? 0.6 + (Math.min(5, Math.max(1, aiSeverity)) - 1) * 0.15 : 1; // 0.6–1.2
  return Math.round(Math.min(100, base * mult));
}

/** Higher project value ≈ heavier build ⇒ higher operational complexity penalty. */
export function complexityFactor(recommendedSolution = null) {
  // Use the solution's published maximum project span (match objects carry
  // project_value.high as a fallback) so this is data-driven, never a constant.
  const max = Number(
    recommendedSolution?.maximum_project_value ?? recommendedSolution?.project_value?.high
  ) || 3000;
  if (max <= 3500) return 85;
  if (max <= 7000) return 60;
  if (max <= 15000) return 45;
  return 30;
}
