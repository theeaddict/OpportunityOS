export const PROBLEM_TYPES = {
  lost_sales: { label: 'Lost sales', severity: 70 },
  poor_conversion: { label: 'Poor conversion', severity: 60 },
  manual_ordering: { label: 'Manual ordering', severity: 55 },
  manual_booking: { label: 'Manual booking', severity: 50 },
  inventory_problems: { label: 'Inventory problems', severity: 65 },
  multi_branch_management: { label: 'Multi-branch management', severity: 65 },
  customer_retention: { label: 'Customer retention', severity: 55 },
  delivery_management: { label: 'Delivery management', severity: 55 },
  quotation_management: { label: 'Quotation management', severity: 50 },
  wholesale_ordering: { label: 'Wholesale ordering', severity: 60 },
  staff_management: { label: 'Staff management', severity: 45 },
  payment_reconciliation: { label: 'Payment reconciliation', severity: 55 },
  reporting: { label: 'Reporting', severity: 40 },
  operational_inefficiency: { label: 'Operational inefficiency', severity: 45 },
  customer_communication: { label: 'Customer communication', severity: 40 },
  scheduling: { label: 'Scheduling', severity: 40 },
  production_tracking: { label: 'Production tracking', severity: 55 },
  order_tracking: { label: 'Order tracking', severity: 50 },
  customer_service: { label: 'Customer service', severity: 45 },
  repeat_sales: { label: 'Repeat sales', severity: 50 },
  administrative_inefficiency: { label: 'Administrative inefficiency', severity: 40 },
};

export const PROBLEM_TYPE_KEYS = Object.keys(PROBLEM_TYPES);

// Signals that evidence rows can assert. The analyzer maps these to problems.
export const SIGNAL_KEYS = {
  multiple_branches: 'Operates more than one branch/location',
  team_employees: 'Has employees / a team beyond the owner',
  wholesale_operations: 'Sells to wholesale/bulk buyers',
  high_value_products: 'Sells high-value products/services',
  high_transaction_volume: 'Handles a high volume of transactions/orders',
  multiple_channels: 'Sells through multiple channels',
  delivery_operations: 'Runs its own delivery operations',
  existing_website: 'Has an existing website',
  online_ordering: 'Customers can order online today',
  existing_digital_systems: 'Already uses some digital systems',
  established_history: 'Established business history',
  active_social_commerce: 'Actively sells via social media',
  professional_premises: 'Operates from professional/commercial premises',
  corporate_customers: 'Serves corporate/business customers',
  inventory_complexity: 'Manages complex or large inventory',
  no_online_ordering: 'No way to order online',
  no_booking_system: 'No online booking/appointment system',
  manual_stock_tracking: 'Tracks stock manually (paper/notebook/memory)',
  phone_whatsapp_published: 'Business publishes a WhatsApp number for customers',
  public_phone_published: 'Business publishes a public phone number for customers',
  slow_quote_turnaround: 'Quotes take a long time to prepare',
  no_customer_records: 'No structured customer records/follow-up',
  cash_reconciliation_gaps: 'Payment records are reconciled manually with gaps',
  no_reporting: 'No regular business reports available',
  delivery_coordination_pain: 'Delivery coordination handled ad-hoc',
  unanswered_enquiries: 'Evidence of missed/ignored customer enquiries',
  repeat_customer_mentions: 'Reviews/posts indicate strong repeat custom',
  order_tracking_pain: 'Customers or staff struggle to track order status',
};

// Scoring weights (must sum to 1). Each factor scores 0-100.
export const SCORE_WEIGHTS = {
  evidence_strength: 0.20,
  problem_severity: 0.15,
  money_potential: 0.15,
  solution_fit: 0.15,
  business_maturity: 0.10,
  ability_to_pay: 0.10,
  operational_complexity: 0.10, // higher complexity LOWERS the total
  contactability: 0.05,
};

/**
 * Opportunity score categories. The boundaries are driven by the configurable
 * score_thresholds (see lib/services/analysis/scoring.js). Below the `low`
 * threshold the opportunity is REJECTed. HOT/HIGH/MEDIUM/LOW labels subtract
 * rounding from the upper boundary so a score equal to the threshold maps to
 * the higher bucket (e.g. 90 → HOT, 89 → HIGH).
 */
export const SCORE_CATEGORIES = {
  HOT:    { min: 90, color: 'bg-emerald-600',   hint: 'Signal-to-score is strong across most dimensions: act now.' },
  HIGH:   { min: 80, color: 'bg-emerald-500',   hint: 'Compelling opportunity with a couple of modest weaknesses.' },
  MEDIUM: { min: 65, color: 'bg-blue-500',      hint: 'Solid but not exceptional; worth pursuing with validation.' },
  LOW:    { min: 50, color: 'bg-amber-500',     hint: 'Weak on several dimensions; needs meaningful validation first.' },
  REJECT: { min: 0,  color: 'bg-gray-400',      hint: 'Falls below the configured minimum; not worth pursuing.' },
};

/** Default category thresholds. Made configurable via app_settings. */
export const DEFAULT_SCORE_THRESHOLDS = { hot: 90, high: 80, medium: 65, low: 50 };

/**
 * The 11 commercial money mechanisms the Opportunity Detection Engine can
 * select. Each maps to the financial-scenario keys that quantify it. The
 * mechanism is chosen during analysis (rule engine or AI) and stored as
 * money_mechanism_key; the matching scenario uses the SAME math.
 */
export const MONEY_MECHANISMS = {
  additional_sales: {
    label: 'Additional sales',
    description: 'New revenue captured that the business currently misses (new orders, after-hours demand).',
    scenarios: ['additional_sales'],
  },
  higher_conversion: {
    label: 'Higher conversion',
    description: 'A larger share of existing enquiries become paying orders.',
    scenarios: ['higher_conversion'],
  },
  higher_repeat_purchase: {
    label: 'Higher repeat purchase',
    description: 'Existing customers buy again more often.',
    scenarios: ['repeat_sales'],
  },
  reduced_missed_bookings: {
    label: 'Reduced missed bookings',
    description: 'Slots that were going unfilled now get booked; fewer no-shows.',
    scenarios: ['fewer_missed_bookings'],
  },
  reduced_waste: {
    label: 'Reduced waste',
    description: 'Less stock/product written off due to over-ordering or expiry.',
    scenarios: ['reduced_waste'],
  },
  reduced_stock_outs: {
    label: 'Reduced stock-outs',
    description: 'Fewer out-of-stock incidents on fast-moving items that cost sales.',
    scenarios: ['reduced_stock_outs'],
  },
  reduced_administrative_labor: {
    label: 'Reduced administrative labor',
    description: 'Staff hours released from manual admin.',
    scenarios: ['time_saved'],
  },
  faster_order_processing: {
    label: 'Faster order processing',
    description: 'Orders move through fulfilment faster, cutting status-enquiries and errors.',
    scenarios: ['faster_order_processing'],
  },
  better_payment_reconciliation: {
    label: 'Better payment reconciliation',
    description: 'Fewer unreconciled payments means less silent revenue leakage.',
    scenarios: ['reconciliation_recovery'],
  },
  better_capacity_utilization: {
    label: 'Better capacity utilization',
    description: 'Staff, vehicles or production capacity used more fully.',
    scenarios: ['capacity_utilization'],
  },
  fewer_operational_errors: {
    label: 'Fewer operational errors',
    description: 'Costly mistakes (missed orders, wrong quotes, compensation payouts) reduced.',
    scenarios: ['fewer_errors'],
  },
};

export const MONEY_MECHANISM_KEYS = Object.keys(MONEY_MECHANISMS);

export function moneyMechanismLabel(key) {
  return MONEY_MECHANISMS[key]?.label || key.replaceAll('_', ' ');
}

export const OPPORTUNITY_STATUSES = {
  new: 'New',
  researching: 'Researching',
  qualified: 'Qualified',
  contacted: 'Contacted',
  replied: 'Replied',
  demo: 'Demo',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
  not_a_fit: 'Not a fit',
  not_a_service_fit: 'Not a service fit',
};

export const PIPELINE_COLUMNS = ['new', 'researching', 'qualified', 'contacted', 'replied', 'demo', 'proposal', 'negotiation', 'won'];

/** Allowed next-status transitions from each stage. */
export const PIPELINE_TRANSITIONS = {
  new:          ['researching', 'not_a_fit', 'not_a_service_fit'],
  researching:  ['qualified', 'new', 'not_a_fit', 'not_a_service_fit'],
  qualified:    ['contacted', 'researching', 'not_a_fit', 'not_a_service_fit'],
  contacted:    ['replied', 'qualified', 'not_a_fit', 'not_a_service_fit'],
  replied:      ['demo', 'contacted', 'not_a_fit', 'not_a_service_fit'],
  demo:         ['proposal', 'replied', 'not_a_fit', 'not_a_service_fit'],
  proposal:     ['negotiation', 'demo', 'lost'],
  negotiation:  ['won', 'proposal', 'lost'],
  won:          [],
  lost:         [],
  not_a_fit:    [],
  not_a_service_fit: [],
};

/** Default probability (%) per pipeline stage. */
export const DEFAULT_PROBABILITIES = {
  new: 10,
  researching: 20,
  qualified: 30,
  contacted: 40,
  replied: 50,
  demo: 60,
  proposal: 70,
  negotiation: 80,
  won: 100,
  lost: 0,
  not_a_fit: 0,
  not_a_service_fit: 0,
};

export const CLIENT_SIZES = [
  { value: 'small', label: 'Small (1-10 people)' },
  { value: 'medium', label: 'Medium (11-50)' },
  { value: 'large', label: 'Large (51-200)' },
  { value: 'enterprise', label: 'Enterprise (200+)' },
];

export const CLAIM_TYPES = {
  fact: { label: 'Fact', hint: 'Directly observable from a public source.' },
  inference: { label: 'Inference', hint: 'A reasonable conclusion drawn from facts.' },
  hypothesis: { label: 'Hypothesis', hint: 'A plausible explanation — needs confirmation.' },
};

export function problemLabel(key) {
  return PROBLEM_TYPES[key]?.label || key;
}

export function statusLabel(key) {
  return OPPORTUNITY_STATUSES[key] || key;
}

export function signalLabel(key) {
  return SIGNAL_KEYS[key] || key.replaceAll('_', ' ');
}
