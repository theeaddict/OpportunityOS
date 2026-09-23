/**
 * Deterministic Financial Opportunity Engine — application code, NOT AI.
 *
 * AI is never allowed to perform the final financial calculations. This module
 * receives stored assumptions (each with optional low / base / high values) and
 * computes every scenario in application code.
 *
 * Supported scenarios (formulas are fixed and deterministic):
 *   1. additional_revenue    additional_customers × average_order_value
 *   2. improved_conversion   monthly_enquiries × conversion_improvement × average_order_value
 *   3. repeat_sales          existing_customers × repeat_rate_improvement × average_order_value
 *   4. labor_savings         hours_saved × hourly_cost
 *   5. reduced_stock_loss    estimated_stock_loss × reduction_percentage
 *   6. capacity_utilization  additional_bookings × average_booking_value
 *
 * Every scenario output contains:
 *   scenario_name, formula, assumptions, low_value, high_value, currency, period, is_illustrative
 *
 * A scenario is NEVER created if any required assumption is missing.
 */

import { MONEY_MECHANISMS } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Canonical supported scenarios (the 6 allowed by the spec).
// ---------------------------------------------------------------------------

export const FINANCIAL_SCENARIOS = {
  additional_revenue: {
    name: 'Additional revenue',
    formula: 'additional_customers × average_order_value',
    period: 'monthly',
    assumptions: [
      { key: 'additional_customers', label: 'Additional customers per month', unit: 'customers' },
      { key: 'average_order_value', label: 'Average order value', unit: 'currency' },
    ],
    compute: (a) => a.additional_customers * a.average_order_value,
  },
  improved_conversion: {
    name: 'Improved conversion',
    formula: 'monthly_enquiries × conversion_improvement × average_order_value',
    period: 'monthly',
    assumptions: [
      { key: 'monthly_enquiries', label: 'Enquiries per month', unit: 'enquiries' },
      { key: 'conversion_improvement', label: 'Conversion improvement (0.02 = 2%)', unit: 'ratio' },
      { key: 'average_order_value', label: 'Average order value', unit: 'currency' },
    ],
    compute: (a) => a.monthly_enquiries * a.conversion_improvement * a.average_order_value,
  },
  repeat_sales: {
    name: 'Repeat sales',
    formula: 'existing_customers × repeat_rate_improvement × average_order_value',
    period: 'annual',
    assumptions: [
      { key: 'existing_customers', label: 'Existing customers', unit: 'customers' },
      { key: 'repeat_rate_improvement', label: 'Repeat-rate improvement (0.05 = 5%)', unit: 'ratio' },
      { key: 'average_order_value', label: 'Average order value', unit: 'currency' },
    ],
    compute: (a) => a.existing_customers * a.repeat_rate_improvement * a.average_order_value,
  },
  labor_savings: {
    name: 'Labor savings',
    formula: 'hours_saved × hourly_cost',
    period: 'monthly',
    assumptions: [
      { key: 'hours_saved', label: 'Hours saved per month', unit: 'hours' },
      { key: 'hourly_cost', label: 'Hourly staff cost', unit: 'currency' },
    ],
    compute: (a) => a.hours_saved * a.hourly_cost,
  },
  reduced_stock_loss: {
    name: 'Reduced stock loss',
    formula: 'estimated_stock_loss × reduction_percentage',
    period: 'monthly',
    assumptions: [
      { key: 'estimated_stock_loss', label: 'Estimated monthly stock loss value', unit: 'currency' },
      { key: 'reduction_percentage', label: 'Reduction (0.2 = 20%)', unit: 'ratio' },
    ],
    compute: (a) => a.estimated_stock_loss * a.reduction_percentage,
  },
  capacity_utilization: {
    name: 'Capacity utilization',
    formula: 'additional_bookings × average_booking_value',
    period: 'monthly',
    assumptions: [
      { key: 'additional_bookings', label: 'Additional bookings per month', unit: 'bookings' },
      { key: 'average_booking_value', label: 'Average booking value', unit: 'currency' },
    ],
    compute: (a) => a.additional_bookings * a.average_booking_value,
  },
};

export const FINANCIAL_SCENARIO_KEYS = Object.keys(FINANCIAL_SCENARIOS);

// Mechanism -> the dominant canonical scenario(s) it implies.
const MECHANISM_SCENARIOS = {
  additional_sales: ['additional_revenue'],
  higher_conversion: ['improved_conversion'],
  higher_repeat_purchase: ['repeat_sales'],
  reduced_missed_bookings: ['capacity_utilization'],
  reduced_waste: ['reduced_stock_loss'],
  reduced_stock_outs: ['reduced_stock_loss'],
  reduced_administrative_labor: ['labor_savings'],
  faster_order_processing: ['additional_revenue'],
  better_payment_reconciliation: ['additional_revenue'],
  better_capacity_utilization: ['capacity_utilization'],
  fewer_operational_errors: ['labor_savings'],
};

// Default low/base/high triples per assumption (editable; always illustrative).
// Example (per spec): monthly_enquiries low 100 / base 200 / high 300,
// conversion_improvement low 0.02 / base 0.05 / high 0.08,
// average_order_value low 20000 / base 30000 / high 40000.
function defaultTriples() {
  return {
    additional_customers: roundBoth({ low: 4, base: 8, high: 12 }),
    monthly_enquiries: roundBoth({ low: 100, base: 200, high: 300 }),
    conversion_improvement: { low: 0.02, base: 0.05, high: 0.08 },
    average_order_value: roundBoth({ low: 20000, base: 30000, high: 40000 }),
    existing_customers: roundBoth({ low: 200, base: 500, high: 800 }),
    repeat_rate_improvement: { low: 0.02, base: 0.05, high: 0.08 },
    hours_saved: roundBoth({ low: 10, base: 30, high: 60 }),
    hourly_cost: roundBoth({ low: 200, base: 500, high: 800 }),
    estimated_stock_loss: roundBoth({ low: 10000, base: 30000, high: 60000 }),
    reduction_percentage: { low: 0.1, base: 0.2, high: 0.35 },
    additional_bookings: roundBoth({ low: 5, base: 15, high: 30 }),
    average_booking_value: roundBoth({ low: 3000, base: 6000, high: 10000 }),
  };
}

function roundBoth(t) {
  return { low: t.low, base: t.base, high: t.high };
}

/** Normalise a possibly partial triple to { low, base, high } with base fallback. */
function normTriple(value, def) {
  if (value == null) return { ...def };
  const toNum = (v, fb) => (v == null || Number.isNaN(Number(v))) ? fb : Number(v);
  return {
    low: toNum(value.low, def.base),
    base: toNum(value.base, def.base),
    high: toNum(value.high, def.base),
  };
}

/**
 * Deterministically compute one scenario from low/base/high assumption triples.
 * Returns null when ANY required assumption lacks a usable base value.
 */
export function computeFinancialScenario(key, triples = {}) {
  const def = FINANCIAL_SCENARIOS[key];
  if (!def) return null;

  const defaults = defaultTriples();
  // If the caller supplied NO assumption overrides at all we fall back to the
  // editable defaults. If they supplied any overrides but left a required field
  // out, that is a missing assumption and we refuse to create the scenario.
  const explicitlyEdited = Object.keys(triples).length > 0;

  const resolved = {};
  const assumptionList = [];
  for (const field of def.assumptions) {
    if (explicitlyEdited && triples[field.key] == null) return null;
    const triple = normTriple(triples[field.key], defaults[field.key] || { low: 0, base: 0, high: 0 });
    if (!Number.isFinite(triple.base)) return null;
    resolved[field.key] = triple;
    assumptionList.push({
      key: field.key,
      label: field.label,
      unit: field.unit,
      low: triple.low,
      base: triple.base,
      high: triple.high,
    });
  }

  const at = (mode) => {
    const o = {};
    for (const field of def.assumptions) o[field.key] = resolved[field.key][mode];
    return o;
  };

  const low_value = Math.max(0, Math.round(def.compute(at('low'))));
  const base_value = Math.max(0, Math.round(def.compute(at('base'))));
  const high_value = Math.max(0, Math.round(def.compute(at('high'))));

  return {
    scenario_name: def.name,
    scenario_key: key,
    formula: def.formula,
    assumptions: assumptionList,
    low_value,
    base_value,
    high_value,
    currency: 'KES',
    period: def.period,
    is_illustrative: true,
  };
}

/**
 * Build a scenario bundle for a money mechanism using the low/base/high engine.
 * Returns an empty { scenarios: [], assumptions: [] } when nothing is computable
 * rather than inventing numbers with missing assumptions.
 */
export function buildFinancialScenariosForMechanism(mechanismKey, triples = {}) {
  const keys = MECHANISM_SCENARIOS[mechanismKey] || ['additional_revenue'];
  const scenarios = [];
  const assumptionMap = {};

  for (const key of keys) {
    const sc = computeFinancialScenario(key, triples);
    if (!sc) continue; // required assumptions missing -> skip, never invent
    for (const a of sc.assumptions) {
      if (!assumptionMap[a.key]) {
        assumptionMap[a.key] = {
          assumption_name: a.key,
          assumption_value: a.base,
          assumption_low: a.low,
          assumption_high: a.high,
          unit: a.unit,
          source: 'Analyst estimate — needs confirmation',
          confidence: 0.35,
        };
      }
    }
    scenarios.push(sc);
  }

  const disclaimer =
    'Illustrative scenario based on the stored low/base/high assumptions. These are '
    + 'plausible bounds, NOT forecasts. Edit the assumptions to match what the business confirms.';

  return {
    scenarios,
    assumptions: Object.values(assumptionMap),
    disclaimer,
  };
}

// ---------------------------------------------------------------------------
// Backward-compatible exports kept for existing consumers (orchestrator legacy
// path and the self-test). New code should use the canonical engine above.
// ---------------------------------------------------------------------------

export const SCENARIO_TEMPLATES = {
  higher_conversion: {
    label: 'Higher conversion of existing enquiries', unit: 'currency',
    formula: 'monthly_enquiries × conversion_improvement × average_order_value', period: 'monthly',
    assumption_fields: [
      { key: 'monthly_enquiries', label: 'Enquiries per month', type: 'number', unit: 'enquiries' },
      { key: 'conversion_improvement', label: 'Conversion improvement', type: 'number', unit: 'ratio' },
      { key: 'average_order_value', label: 'Average order value', type: 'currency', unit: 'currency' },
    ],
    compute: (a) => a.monthly_enquiries * a.conversion_improvement * a.average_order_value,
  },
  additional_sales: {
    label: 'Additional sales captured', unit: 'currency',
    formula: 'additional_orders × average_order_value', period: 'monthly',
    assumption_fields: [
      { key: 'additional_orders', label: 'Additional orders per month', type: 'number', unit: 'orders' },
      { key: 'average_order_value', label: 'Average order value', type: 'currency', unit: 'currency' },
    ],
    compute: (a) => a.additional_orders * a.average_order_value,
  },
  repeat_sales: {
    label: 'Higher repeat purchase', unit: 'currency',
    formula: 'active_customers × repeat_rate_uplift × average_order_value × purchases_per_year', period: 'annual',
    assumption_fields: [
      { key: 'active_customers', label: 'Active customers', type: 'number', unit: 'customers' },
      { key: 'repeat_rate_uplift', label: 'Repeat-rate uplift', type: 'number', unit: 'ratio' },
      { key: 'average_order_value', label: 'Average order value', type: 'currency', unit: 'currency' },
      { key: 'purchases_per_year', label: 'Purchases per customer per year', type: 'number', unit: 'orders' },
    ],
    compute: (a) => a.active_customers * a.repeat_rate_uplift * a.average_order_value * a.purchases_per_year,
  },
  fewer_missed_bookings: {
    label: 'Fewer missed bookings', unit: 'currency',
    formula: 'missed_bookings_per_month × average_booking_value', period: 'monthly',
    assumption_fields: [
      { key: 'missed_bookings_per_month', label: 'Missed/unfilled bookings per month', type: 'number', unit: 'bookings' },
      { key: 'average_booking_value', label: 'Average booking value', type: 'currency', unit: 'currency' },
    ],
    compute: (a) => a.missed_bookings_per_month * a.average_booking_value,
  },
  reduced_waste: {
    label: 'Reduced waste / shrinkage', unit: 'currency',
    formula: 'monthly_waste_value × waste_reduction', period: 'monthly',
    assumption_fields: [
      { key: 'monthly_waste_value', label: 'Monthly measured waste value', type: 'currency', unit: 'currency' },
      { key: 'waste_reduction', label: 'Waste reduction', type: 'number', unit: 'ratio' },
    ],
    compute: (a) => a.monthly_waste_value * a.waste_reduction,
  },
  reduced_stock_outs: {
    label: 'Reduced stock-outs', unit: 'currency',
    formula: 'monthly_lost_sales_from_stockouts × stockout_reduction', period: 'monthly',
    assumption_fields: [
      { key: 'monthly_lost_sales_from_stockouts', label: 'Monthly sales lost to stock-outs', type: 'currency', unit: 'currency' },
      { key: 'stockout_reduction', label: 'Stock-out reduction', type: 'number', unit: 'ratio' },
    ],
    compute: (a) => a.monthly_lost_sales_from_stockouts * a.stockout_reduction,
  },
  time_saved: {
    label: 'Staff time saved', unit: 'currency',
    formula: 'hours_saved × hourly_cost × 52', period: 'annual',
    assumption_fields: [
      { key: 'hours_saved', label: 'Hours saved per week', type: 'number', unit: 'hours' },
      { key: 'hourly_cost', label: 'Estimated hourly staff cost', type: 'currency', unit: 'currency' },
    ],
    compute: (a) => a.hours_saved * a.hourly_cost * 52,
  },
  faster_order_processing: {
    label: 'Faster order processing', unit: 'currency',
    formula: 'orders_per_month × cost_of_slow_or_error_per_order', period: 'monthly',
    assumption_fields: [
      { key: 'orders_per_month', label: 'Orders per month', type: 'number', unit: 'orders' },
      { key: 'cost_of_slow_or_error_per_order', label: 'Cost per slow/errored order', type: 'currency', unit: 'currency' },
    ],
    compute: (a) => a.orders_per_month * a.cost_of_slow_or_error_per_order,
  },
  reconciliation_recovery: {
    label: 'Payment reconciliation recovered', unit: 'currency',
    formula: 'monthly_leakage × recovery_rate', period: 'monthly',
    assumption_fields: [
      { key: 'monthly_leakage', label: 'Monthly unreconciled leakage', type: 'currency', unit: 'currency' },
      { key: 'recovery_rate', label: 'Recovery rate', type: 'number', unit: 'ratio' },
    ],
    compute: (a) => a.monthly_leakage * a.recovery_rate,
  },
  capacity_utilization: {
    label: 'Better capacity utilization', unit: 'currency',
    formula: 'added_units_per_month × contribution_per_unit', period: 'monthly',
    assumption_fields: [
      { key: 'added_units_per_month', label: 'Added units/deliveries per month', type: 'number', unit: 'units' },
      { key: 'contribution_per_unit', label: 'Contribution per unit', type: 'currency', unit: 'currency' },
    ],
    compute: (a) => a.added_units_per_month * a.contribution_per_unit,
  },
  fewer_errors: {
    label: 'Fewer operational errors', unit: 'currency',
    formula: 'costly_errors_per_month × cost_per_error', period: 'monthly',
    assumption_fields: [
      { key: 'costly_errors_per_month', label: 'Costly errors per month', type: 'number', unit: 'errors' },
      { key: 'cost_per_error', label: 'Average cost per error', type: 'currency', unit: 'currency' },
    ],
    compute: (a) => a.costly_errors_per_month * a.cost_per_error,
  },
  recovered_orders: {
    label: 'Recovered lost orders', unit: 'currency',
    formula: 'additional_orders × average_order_value × 12', period: 'annual',
    assumption_fields: [
      { key: 'additional_orders', label: 'Additional orders per month', type: 'number', unit: 'orders' },
      { key: 'average_order_value', label: 'Average order value', type: 'currency', unit: 'currency' },
    ],
    compute: (a) => a.additional_orders * a.average_order_value * 12,
  },
  retention_uplift: {
    label: 'Repeat-customer uplift', unit: 'currency',
    formula: 'active_customers × conversion_improvement × average_order_value × purchases_per_year', period: 'annual',
    assumption_fields: [
      { key: 'active_customers', label: 'Active customers', type: 'number', unit: 'customers' },
      { key: 'conversion_improvement', label: 'Repeat-rate improvement', type: 'number', unit: 'ratio' },
      { key: 'average_order_value', label: 'Average order value', type: 'currency', unit: 'currency' },
      { key: 'purchases_per_year', label: 'Purchases per customer per year', type: 'number', unit: 'orders' },
    ],
    compute: (a) => a.active_customers * a.conversion_improvement * a.average_order_value * a.purchases_per_year,
  },
  shrinkage_reduction: {
    label: 'Stock-loss reduction', unit: 'currency',
    formula: 'monthly_stock_value × shrinkage_reduction × 12', period: 'annual',
    assumption_fields: [
      { key: 'monthly_stock_value', label: 'Monthly stock value', type: 'currency', unit: 'currency' },
      { key: 'shrinkage_reduction', label: 'Shrinkage reduction', type: 'number', unit: 'ratio' },
    ],
    compute: (a) => a.monthly_stock_value * a.shrinkage_reduction * 12,
  },
};

// Legacy: problem_type -> scenario keys (used only when no mechanism is set).
const PROBLEM_DEFAULTS = {
  lost_sales: ['recovered_orders', 'time_saved'],
  poor_conversion: ['recovered_orders'],
  manual_ordering: ['time_saved', 'recovered_orders'],
  manual_booking: ['time_saved', 'recovered_orders'],
  inventory_problems: ['shrinkage_reduction', 'recovered_orders'],
  multi_branch_management: ['time_saved'],
  customer_retention: ['retention_uplift'],
  delivery_management: ['time_saved', 'recovered_orders'],
  quotation_management: ['recovered_orders', 'time_saved'],
  wholesale_ordering: ['recovered_orders', 'time_saved'],
  staff_management: ['time_saved'],
  payment_reconciliation: ['time_saved'],
  reporting: ['time_saved'],
  operational_inefficiency: ['time_saved'],
  customer_communication: ['recovered_orders'],
  scheduling: ['time_saved'],
  production_tracking: ['time_saved'],
  order_tracking: ['time_saved', 'recovered_orders'],
  customer_service: ['recovered_orders'],
  repeat_sales: ['retention_uplift'],
  administrative_inefficiency: ['time_saved'],
};

export const DEFAULT_ASSUMPTIONS = {
  monthly_enquiries: 100, conversion_improvement: 0.05, average_order_value: 20000,
  additional_orders: 5, active_customers: 300, repeat_rate_uplift: 0.05,
  purchases_per_year: 4, missed_bookings_per_month: 5, average_booking_value: 5000,
  monthly_waste_value: 10000, waste_reduction: 0.2, monthly_lost_sales_from_stockouts: 20000,
  stockout_reduction: 0.5, hours_saved: 4, hourly_cost: 500, orders_per_month: 100,
  cost_of_slow_or_error_per_order: 200, monthly_leakage: 30000, recovery_rate: 0.5,
  added_units_per_month: 20, contribution_per_unit: 500, costly_errors_per_month: 5,
  cost_per_error: 2000,
};

const LOW_FACTOR = 0.5;
const HIGH_FACTOR = 1.5;

/**
 * Legacy mechanism-driven bundle (kept for backward compatibility). Prefers the
 * canonical low/base/high engine when the mechanism maps to a supported scenario.
 */
export function buildScenariosByMechanism(mechanismKey, overrides = {}, fallbackProblemType = null) {
  if (mechanismKey && MECHANISM_SCENARIOS[mechanismKey]) {
    const triples = flattenTriples(overrides);
    return buildFinancialScenariosForMechanism(mechanismKey, triples);
  }
  const { mechScenarios } = requireMechanismKeys(mechanismKey, fallbackProblemType);
  const assumptionsByKey = {};
  const scenarios = mechScenarios.map((key) => {
    const template = SCENARIO_TEMPLATES[key];
    if (!template) return null;
    const values = { ...DEFAULT_ASSUMPTIONS, ...(overrides[key] || {}), ...(overrides.mechanism || {}) };
    const assumptions_json = {};
    for (const f of template.assumption_fields) {
      assumptions_json[f.key] = Number(values[f.key]) || 0;
      assumptionsByKey[f.key] = {
        assumption_name: f.key, assumption_value: Number(values[f.key]) || 0,
        unit: f.unit, source: 'Analyst estimate — needs confirmation', confidence: 0.35,
      };
    }
    const base = Math.max(0, Math.round(template.compute(assumptions_json)));
    return {
      scenario_type: key, label: template.label, currency: 'KES',
      formula_description: template.formula,
      impact_low: Math.round(base * LOW_FACTOR), impact_high: Math.round(base * HIGH_FACTOR),
      period: template.period, assumptions_json, is_illustrative: 1,
    };
  }).filter(Boolean);
  return {
    assumptions: Object.values(assumptionsByKey), scenarios,
    disclaimer: 'Illustrative scenarios based on the stored assumptions. Edit the assumptions to match what you learn from the business.',
  };
}

/** Flatten nested {scenario:{field:{low,base,high}}} / {field:value} overrides into per-field triples. */
export function flattenTriples(overrides) {
  const triples = {};
  for (const group of Object.values(overrides)) {
    if (!group || typeof group !== 'object') continue;
    for (const [k, v] of Object.entries(group)) {
      if (v && typeof v === 'object' && 'base' in v) {
        triples[k] = { low: v.low, base: v.base, high: v.high };
      } else {
        triples[k] = { low: v, base: v, high: v };
      }
    }
  }
  return triples;
}

function requireMechanismKeys(mechanismKey, fallbackProblemType) {
  const m = MONEY_MECHANISMS[mechanismKey];
  if (m && m.scenarios && m.scenarios.length) return { mechScenarios: m.scenarios };
  const keys = PROBLEM_DEFAULTS[fallbackProblemType] || ['time_saved'];
  return { mechScenarios: keys };
}

/** Backward-compatible wrapper (problem type based). */
export function buildScenarios(problemType, overrides = {}) {
  const mechKey = legacyMechanismForProblem(problemType);
  if (mechKey) return buildScenariosByMechanism(mechKey, overrides, problemType);
  return buildScenariosByMechanism(null, overrides, problemType);
}

/** Best-fit default mechanism for a problem type when none was chosen yet. */
export function legacyMechanismForProblem(problemType) {
  const map = {
    lost_sales: 'additional_sales', poor_conversion: 'higher_conversion',
    manual_ordering: 'faster_order_processing', manual_booking: 'reduced_missed_bookings',
    inventory_problems: 'reduced_stock_outs', multi_branch_management: 'reduced_administrative_labor',
    customer_retention: 'higher_repeat_purchase', delivery_management: 'better_capacity_utilization',
    quotation_management: 'higher_conversion', wholesale_ordering: 'additional_sales',
    staff_management: 'reduced_administrative_labor', payment_reconciliation: 'better_payment_reconciliation',
    reporting: 'reduced_administrative_labor', operational_inefficiency: 'reduced_administrative_labor',
    customer_communication: 'higher_conversion', scheduling: 'better_capacity_utilization',
    production_tracking: 'fewer_operational_errors', order_tracking: 'faster_order_processing',
    customer_service: 'higher_conversion', repeat_sales: 'higher_repeat_purchase',
    administrative_inefficiency: 'reduced_administrative_labor',
  };
  return map[problemType] || null;
}

export function midpointAnnualPotential(scenarios = []) {
  if (!scenarios.length) return 0;
  const annualTotal = scenarios.reduce((sum, x) => {
    const low = Number(x.low_value ?? x.impact_low) || 0;
    const high = Number(x.high_value ?? x.impact_high) || 0;
    const mid = (low + high) / 2;
    const period = x.period || 'annual';
    const annualised = period === 'monthly' ? mid * 12 : mid;
    return sum + annualised;
  }, 0);
  return Math.round(annualTotal);
}

/** money_potential scoring factor: bands of annual illustrative potential. */
export function moneyPotentialFactor(annualPotentialMidpoint) {
  const v = Number(annualPotentialMidpoint) || 0;
  let score = 20;
  for (const t of [1000, 5000, 15000, 50000]) if (v >= t) score += 20;
  return Math.min(100, score);
}
