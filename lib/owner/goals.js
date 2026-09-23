/**
 * Business Owner Mode — goal catalog.
 *
 * Every string here is written for a business owner, never for a technical
 * user. The goals the owner picks drive what the system looks for and how the
 * results are explained. Nothing about AI agents, prompts, APIs, evidence
 * models or scoring algorithms leaks into this surface.
 */

export const OWNER_GOALS = {
  more_customers: {
    key: 'more_customers',
    label: 'Get more customers',
    pitch: 'reach more of their customers',
    looks_for: 'businesses a bit like the ones you already serve, that are not easy to reach or buy from yet',
    why: 'making it easier for their customers to buy finds them new customers too',
  },
  repeat_sales: {
    key: 'repeat_sales',
    label: 'Increase repeat sales',
    pitch: 'turn one-time buyers into repeat customers',
    looks_for: 'businesses whose customers rarely come back for a second purchase',
    why: 'winning back the customers they already have is the fastest way to grow',
  },
  fewer_missed_orders: {
    key: 'fewer_missed_orders',
    label: 'Reduce missed orders',
    pitch: 'stop missing orders and enquiries',
    looks_for: 'businesses that run a real risk of missing orders today',
    why: 'every order they do not lose is money they keep',
  },
  less_manual_work: {
    key: 'less_manual_work',
    label: 'Reduce operational work',
    pitch: 'cut down on manual, day-to-day work',
    looks_for: 'businesses still doing a lot of their day-to-day work by hand',
    why: 'freeing up their time lets them serve more customers',
  },
  better_bookings: {
    key: 'better_bookings',
    label: 'Improve bookings',
    pitch: 'make booking simpler and fill more appointments',
    looks_for: 'businesses that take bookings by phone or word of mouth',
    why: 'a simpler way to book means more full appointments and fewer no-shows',
  },
  manage_stock: {
    key: 'manage_stock',
    label: 'Manage inventory',
    pitch: 'keep better track of what is in stock',
    looks_for: 'businesses that track their stock by hand',
    why: 'knowing what is in stock prevents sold-out items and wasted purchases',
  },
  better_follow_up: {
    key: 'better_follow_up',
    label: 'Improve customer follow-up',
    pitch: 'stay in touch with customers after a sale',
    looks_for: 'businesses that struggle to keep in touch with customers after a sale',
    why: 'staying in touch is what turns a one-time buyer into a loyal one',
  },
  business_partners: {
    key: 'business_partners',
    label: 'Find business partners',
    pitch: 'grow through business partnerships',
    looks_for: 'businesses that serve the same customers as you, without competing',
    why: 'the right partner brings you customers you could not reach alone',
  },
  wholesale_customers: {
    key: 'wholesale_customers',
    label: 'Find wholesale customers',
    pitch: 'find reliable wholesale buyers',
    looks_for: 'businesses that buy in bulk from suppliers like you',
    why: 'a few steady wholesale customers are worth more than hundreds of small ones',
  },
};

export const OWNER_GOAL_KEYS = Object.keys(OWNER_GOALS);

export function ownerGoal(key) {
  return OWNER_GOALS[key] || null;
}

export function ownerGoalLabels(keys) {
  return (keys || []).map((k) => ownerGoal(k)?.label || null).filter(Boolean);
}

/** Plain-language steps the system follows for every goal. */
export const OWNER_STRATEGY_STEPS = [
  'Find businesses that could be a good fit for what you offer.',
  'Learn how they operate and what they are dealing with today.',
  'Spot the most promising chances to help them.',
  'Rank the choices from best match to weakest match.',
  'Draft a friendly message you can personalise and send.',
];