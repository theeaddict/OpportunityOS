/**
 * Solution matching — deterministic scoring engine.
 *
 * Scores every active solution in the library against the business problem
 * across four explicit dimensions:
 *   problem_fit    — how directly the solution's capabilities solve the problem
 *   industry_fit   — how well the solution targets the business's industry
 *   technical_fit  — how well the solution matches the business's technical
 *                    maturity and the capabilities the analysis flagged
 *   commercial_fit — whether the business can realistically adopt/afford it
 *
 * Shape: every dimension is 0-100; overall fit_score is a weighted blend.
 * Project value is ALWAYS taken from the configured solution pricing
 * (project_value.low/base/high) — it is never invented here or by the AI.
 * The top scored solution is "recommended"; the rest are alternatives.
 */

const WEIGHTS = { problem: 0.4, industry: 0.15, technical: 0.2, commercial: 0.25 };

const ADJACENCY = {
  manual_ordering: ['order_tracking', 'wholesale_ordering', 'lost_sales'],
  lost_sales: ['poor_conversion', 'manual_ordering'],
  poor_conversion: ['lost_sales', 'customer_service', 'customer_retention'],
  manual_booking: ['scheduling', 'customer_service'],
  scheduling: ['manual_booking', 'delivery_management', 'appointment_management'],
  order_tracking: ['production_tracking', 'manual_ordering'],
  production_tracking: ['order_tracking', 'inventory_problems'],
  inventory_problems: ['production_tracking', 'lost_sales'],
  customer_retention: ['repeat_sales', 'poor_conversion'],
  payment_reconciliation: ['operational_inefficiency'],
};

/**
 * Industry equivalence classes — SYMMETRIC and EXCLUSIVE.
 *
 * Every token belongs to exactly one class; a match requires the same class on
 * both sides (business industry token ↔ solution industry token). This replaces
 * the old one-way synonym map that let a single umbrella bridge-term ("hospitality")
 * credit UNRELATED categories: a Restaurant and a Hotel both scored 95 against a
 * "Hospitality" solution because the old map expanded both through the same word.
 * Now a bridge term can only match itself/its own class, so Restaurant vs
 * "Hospitality / hotels" and Hotel vs "Hospitality / restaurants" both stay LOW,
 * while singulars missing before (hotel, cafe, …) now match their plurals/peers.
 */
const INDUSTRY_CLASSES = [
  ['healthcare', 'health', 'medical', 'medicine', 'clinic', 'clinics', 'hospital', 'hospitals', 'doctor', 'dentist', 'dental', 'pharmacy', 'chemist'],
  ['restaurant', 'restaurants', 'cafe', 'cafes', 'food', 'beverage', 'dining', 'eatery', 'bakery', 'butcher', 'fast_food'],
  ['hotel', 'hotels', 'lodging', 'inn', 'motel', 'resort', 'resorts', 'accommodation', 'hostel'],
  ['hospitality', 'tourism', 'tourist', 'travel'],
  // Also the shop=* categories discovery produces from OpenStreetMap
  // ("Mobile Phone", "Electronics", "Supermarket"...), so a phone shop is
  // recognised as retail instead of scoring below a neutral industry fit.
  ['retail', 'shop', 'shops', 'store', 'stores', 'boutique', 'retailer', 'mobile', 'phone', 'phones', 'electronics',
    'hardware', 'supermarket', 'grocery', 'clothes', 'clothing', 'kiosk', 'books', 'shoes', 'jewelry', 'stationery',
    'copyshop', 'computer', 'convenience', 'general'],
  ['wholesale', 'wholesaler', 'distribution', 'distributor', 'distributors', 'supplier', 'suppliers'],
  ['manufacturing', 'manufacturer', 'manufacturers', 'production', 'factory'],
  ['furniture'],
  ['logistics', 'delivery', 'shipping', 'transport', 'courier', 'dispatch'],
  ['education', 'school', 'schools', 'college', 'academy', 'university'],
  ['services', 'service', 'salon', 'professional'],
  ['soap'],
  ['fashion'],
  ['fmcg'],
  ['hair', 'hairdresser', 'barber', 'beauty'],
];

const EQUIV_CLASS = new Map();
for (const cls of INDUSTRY_CLASSES) {
  for (const w of cls) EQUIV_CLASS.set(w, cls);
}

function tokens(str = '') {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9 +&/]+/g, ' ')
    .split(/[\s+/&/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

function synonymOf(w) {
  return EQUIV_CLASS.get(w) || [w];
}

function industryFit(businessIndustry, solutionIndustries) {
  const bTokens = tokens(businessIndustry);
  if (!bTokens.length || !Array.isArray(solutionIndustries) || !solutionIndustries.length) return 50;
  const sTokens = new Set(solutionIndustries.flatMap((i) => tokens(i)));
  let matched = 0;
  for (const bt of bTokens) {
    if (synonymOf(bt).some((s) => sTokens.has(s))) matched++;
  }
  if (matched === 0) return 40;
  const ratio = matched / bTokens.length;
  return Math.round(40 + ratio * 55);
}

function problemFit(problemType, solves) {
  const solvesList = Array.isArray(solves) ? solves : [];
  if (solvesList.includes(problemType)) return 95;
  const overlap = solvesList.filter((p) => (ADJACENCY[problemType] || []).includes(p)).length;
  if (overlap) return 65 + overlap * 10;
  if (solvesList.length) return 45;
  return 10;
}

function technicalFit(solves, name, descriptionText, capabilities, signals) {
  const text = `${name} ${descriptionText}`.toLowerCase();
  const cap = capabilities || [];
  let hits = 0;
  for (const c of cap) {
    const words = tokens(c);
    if (words.some((w) => w.length > 3 && text.includes(w))) hits++;
  }
  let score = 45 + Math.min(30, hits * 10);
  const digital = Boolean(signals.existing_digital_systems);
  const team = Boolean(signals.team_employees || signals.multiple_branches);
  if (digital) score += 8;
  if (team) score += 7;
  return Math.max(0, Math.min(100, score));
}

function priceTier(base) {
  const b = Number(base) || 0;
  if (b <= 50000) return 0;
  if (b <= 100000) return 1;
  if (b <= 200000) return 2;
  return 3;
}

const PAY_SIGNALS = [
  'high_value_products', 'corporate_customers', 'established_history',
  'multiple_branches', 'team_employees', 'high_transaction_volume',
];

function abilityToPay(signals) {
  return PAY_SIGNALS.filter((s) => signals && signals[s]).length;
}

function commercialFit(baseValue, signals) {
  const ability = abilityToPay(signals);
  const tier = priceTier(baseValue);
  const deficit = Math.max(0, tier - Math.floor(ability / 2));
  const score = 55 + ability * 8 - deficit * 22;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildWhy(s, problemType, businessIndustry) {
  const parts = [];
  const solves = Array.isArray(s.solves_problem_types) ? s.solves_problem_types : [];
  if (solves.includes(problemType)) {
    parts.push(`directly addresses ${String(problemType).replaceAll('_', ' ')}`);
  } else if (solves.some((p) => (ADJACENCY[problemType] || []).includes(p))) {
    parts.push(`closely supports the ${String(problemType).replaceAll('_', ' ')} effort`);
  } else if (solves.length) {
    parts.push(`helps with related ${solves.slice(0, 2).map((p) => p.replaceAll('_', ' ')).join(' and ')}`);
  }
  if (businessIndustry && (s.industries || []).some((i) => {
    const sT = new Set(tokens(i));
    return tokens(businessIndustry).some((bt) => synonymOf(bt).some((x) => sT.has(x)));
  })) {
    parts.push(`suits the ${businessIndustry} market`);
  }
  parts.push('priced within the configured project-value range for this kind of business');
  return parts.join('; ') + '.';
}

/**
 * Preference adjustments derived from the user's own capability profile
 * ("My Capabilities"). These nudge the four fit dimensions but never override
 * the problem/solution mapping itself:
 *   - enabled_solutions          → hard gate: disabled solutions are excluded
 *   - preferred_industries       → boost industry_fit when the market is wanted
 *   - preferred_problem_categories → boost problem_fit when the pain is wanted
 *   - min/max_project_value      → the acceptable quote range: over-budget
 *                                  solutions are penalised in commercial_fit
 */
function preferenceAdjustments(profile) {
  if (!profile) return { enabled: null, industryBonus: [], problemBonus: [], priceMin: null, priceMax: null };
  const prefer = (v) => (Array.isArray(v) ? v.map((t) => String(t).toLowerCase().trim()).filter(Boolean) : []);
  return {
    enabled: profile.enabled_solutions != null ? new Set((profile.enabled_solutions || []).map((x) => Number(x))) : null,
    industryBonus: prefer(profile.preferred_industries),
    problemBonus: prefer(profile.preferred_problem_categories),
    priceMin: profile.min_project_value != null && profile.min_project_value !== '' ? Number(profile.min_project_value) : null,
    priceMax: profile.max_project_value != null && profile.max_project_value !== '' ? Number(profile.max_project_value) : null,
  };
}

function matchesTokenList(businessText, preferred) {
  if (!preferred.length || !businessText) return false;
  const bTokens = new Set(tokens(businessText));
  return preferred.some((p) => {
    const pTokens = tokens(p);
    return pTokens.length && pTokens.some((pt) => (bTokens.has(pt) || synonymOf(pt).some((s) => bTokens.has(s))));
  });
}

function adjustedProblemFit(base, problemType, prefs) {
  if (prefs.problemBonus.includes(problemType)) return Math.min(100, base + 10);
  return base;
}

function adjustedIndustryFit(base, businessIndustry, prefs) {
  if (matchesTokenList(businessIndustry, prefs.industryBonus)) return Math.min(100, base + 12);
  return base;
}

function adjustedCommercialFit(base, baseValue, prefs) {
  let score = base;
  if (prefs.priceMax != null && baseValue > prefs.priceMax) score = Math.min(score, 35);
  else if (prefs.priceMin != null && prefs.priceMax != null && baseValue >= prefs.priceMin && baseValue <= prefs.priceMax) score += 5;
  return Math.max(0, Math.min(100, score));
}

/**
 * Score + rank every active solution.
 * Returns array (descending by fit_score):
 *   { solution_id, name, currency, fit_score, problem_fit, industry_fit,
 *     technical_fit, commercial_fit, project_value:{low,base,high}, why }
 * Only solutions with a meaningful overall fit are returned.
 *
 * `profile` (the user's capability profile) is optional and adds a hard gate on
 * enabled_solutions plus preference nudges. `capabilities` are the technical
 * capability flags the analyst flagged for this business.
 */
export function matchSolutions(solutions, { business = {}, problem_type, signals = {}, capabilities = [], profile = null } = {}) {
  const cap = capabilities || [];
  const prefs = preferenceAdjustments(profile);
  return solutions
    .filter((s) => !prefs.enabled || prefs.enabled.has(Number(s.id)))
    .map((s) => {
      const low = Number(s.project_value?.low ?? s.minimum_project_value) || 0;
      const base = Number(s.project_value?.base) || Number(s.project_value?.low) || ((Number(s.project_value?.low || 0) + Number(s.project_value?.high || 0)) / 2) || 0;
      const high = Number(s.project_value?.high ?? s.maximum_project_value) || 0;

      const problemFitScore = adjustedProblemFit(problemFit(problem_type, s.solves_problem_types), problem_type, prefs);
      const industryFitScore = adjustedIndustryFit(industryFit(business.industry, s.industries), business.industry, prefs);
      const technicalFitScore = technicalFit(s.solves_problem_types, s.name, `${s.description} ${(s.features || []).join(' ')}`, cap, signals);
      const commercialFitScore = adjustedCommercialFit(commercialFit(base, signals), base, prefs);

      const fitScore = Math.round(
        problemFitScore * WEIGHTS.problem
        + industryFitScore * WEIGHTS.industry
        + technicalFitScore * WEIGHTS.technical
        + commercialFitScore * WEIGHTS.commercial
      );

      return {
        solution_id: s.id,
        name: s.name,
        currency: s.currency,
        problem_fit: problemFitScore,
        industry_fit: industryFitScore,
        technical_fit: technicalFitScore,
        commercial_fit: commercialFitScore,
        fit_score: Math.max(0, Math.min(100, fitScore)),
        project_value: { low, base, high },
        why: buildWhy(s, problem_type, business.industry),
      };
    })
    .filter((m) => m.problem_fit >= 35 && m.fit_score >= 45)
    .sort((a, b) => b.fit_score - a.fit_score);
}
