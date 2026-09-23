/**
 * Business Owner Mode — strategy builder.
 *
 * Turns the owner's plain-language answers into the internal opportunity-
 * finding strategy. The owner never sees this mapping; they only see the plain
 * plan rendered from OWNER_STRATEGY_STEPS plus the derived focus, e.g.
 * "We'll focus on: Events, Office, Restaurant — in Nairobi".
 */

import { OWNER_STRATEGY_STEPS, ownerGoal } from '@/lib/owner/goals.js';

const SECTORS = [
  {
    key: 'furniture',
    words: ['furniture', 'decor', 'décor', 'interior', 'fitting'],
    targets: ['Events', 'Office', 'Restaurant', 'Hotel'],
  },
  {
    key: 'events',
    words: ['events', 'event', 'party', 'wedding', 'styling'],
    targets: ['Events', 'Restaurant', 'Hotel', 'Retail'],
  },
  {
    key: 'hardware',
    words: ['hardware', 'building', 'construction', 'tools', 'materials', 'paint'],
    targets: ['Furniture', 'Events', 'Restaurant', 'Hotel'],
  },
  {
    key: 'care',
    words: ['clinic', 'medical', 'health', 'dental', 'wellness', 'salon', 'beauty'],
    targets: ['Healthcare', 'Office', 'Retail'],
  },
  {
    key: 'food',
    words: ['food', 'catering', 'restaurant', 'bakery', 'meals', 'juice', 'coffee'],
    targets: ['Restaurant', 'Hotel', 'Events', 'Office'],
  },
  {
    key: 'retail',
    words: ['clothing', 'fashion', 'retail', 'shoes', 'bags', 'shop'],
    targets: ['Retail', 'Events', 'Restaurant'],
  },
  {
    key: 'wholesale',
    words: ['wholesale', 'distribution', 'supply', 'logistics'],
    targets: ['Retail', 'Restaurant', 'Hotel', 'Furniture'],
  },
  {
    key: 'software',
    words: ['software', 'app', 'system', 'tech', 'digital', 'website', 'pos', 'point of sale'],
    targets: null, // any business could be a customer
  },
];

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'to', 'of', 'in', 'on', 'at', 'we',
  'our', 'i', 'my', 'is', 'are', 'do', 'does', 'sell', 'sells', 'selling',
  'make', 'makes', 'making', 'offer', 'provide', 'providing', 'specialise', 'specialize',
  'custom', 'mostly', 'mainly', 'also', 'people', 'help', 'helps', 'helping',
]);

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ''))
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

export function detectSector(sellWhat = '', idealCustomers = '') {
  const haystack = `${sellWhat} ${idealCustomers}`.toLowerCase();
  const hit = SECTORS.find((s) => s.words.some((w) => haystack.includes(w)));
  return hit?.key || 'any';
}

export function sectorTargets(sector) {
  return SECTORS.find((s) => s.key === sector)?.targets || null;
}

/**
 * Build the internal strategy + search filters from a saved owner profile.
 * Returns the owner-facing plan { steps, focus } and the search filters the
 * DISCOVERY engine actually runs with.
 */
export function buildStrategy(profile) {
  const sellWhat = String(profile.sell_what || '').trim();
  const idealCustomers = String(profile.ideal_customers || '').trim();
  const sector = detectSector(sellWhat, idealCustomers);
  const targets = sectorTargets(sector);

  // Search keywords come straight from the owner's own words, so the run looks
  // for exactly the kind of businesses they described.
  const queryWords = [...new Set([...tokens(sellWhat), ...tokens(idealCustomers)])].slice(0, 40);

  const filters = {
    query: queryWords.join(' '),
    industry: targets ? targets.join(', ') : null,
    location: String(profile.location || '').trim() || null,
    businessMaturity: 'any',
    problemCategories: [],
  };

  const focusIndustries = targets && targets.length
    ? targets
    : (queryWords.length ? ['businesses like the ones you described'] : ['any business that could fit']);

  return {
    strategy: {
      steps: OWNER_STRATEGY_STEPS,
      focus: {
        industries: focusIndustries,
        location: filters.location,
        goalLabels: (profile.goals || []).map(ownerGoal).filter(Boolean).map((g) => g.label),
      },
      filters,
    },
  };
}