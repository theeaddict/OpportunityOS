/**
 * Free-text -> search filters. Lets the Discover page's "describe it" box turn
 * a plain-language description straight into a real search (industry,
 * location, problem categories) against the actual discovery providers
 * (OSM/Google Places) — never a fabricated result, and never a TikTok/social
 * scrape (see ARCHITECTURE.md discovery section for why that's off the table).
 *
 * Deterministic keyword matching, not language understanding: it catches
 * common, explicit phrasing well ("hair salon", "booking") but will miss
 * indirect descriptions that never say the industry outright. Client-safe
 * (no server-only imports) so it runs instantly with no network round trip;
 * the caller always shows what was extracted and lets the user correct it
 * before/instead of running the search.
 */

const INDUSTRY_SYNONYMS = [
  { label: 'Furniture', match: ['furniture', 'sofa', 'sofas', 'couch', 'upholster', 'mattress', 'carpentry', 'carpenter', 'woodwork'] },
  { label: 'Hair Salon', match: ['salon', 'hairdresser', 'hair stylist', 'barbershop', 'barber'] },
  { label: 'Restaurant', match: ['restaurant', 'eatery', 'diner', 'cafe', 'coffee shop'] },
  { label: 'Clinic', match: ['clinic', 'dentist', 'dental', 'doctor', 'hospital', 'pharmacy', 'chemist'] },
  { label: 'Hotel', match: ['hotel', 'lodge', 'guesthouse', 'hostel'] },
  { label: 'Auto Repair', match: ['garage', 'mechanic', 'car repair', 'auto repair', 'car wash', 'carwash'] },
  { label: 'Retail', match: ['boutique', 'clothing store', 'fashion store', 'retail shop', 'supermarket', 'grocery'] },
  { label: 'Gym', match: ['gym', 'fitness centre', 'fitness center'] },
  { label: 'Electronics', match: ['electronics shop', 'gadget shop', 'phone shop'] },
  { label: 'Hardware', match: ['hardware store', 'hardware shop'] },
  { label: 'Wholesale', match: ['wholesale', 'wholesaler', 'distributor', 'bulk supplier', 'trade shop'] },
  { label: 'School', match: ['school', 'academy', 'tuition centre'] },
  { label: 'Events', match: ['event planner', 'events company', 'wedding planner'] },
  { label: 'Cleaning', match: ['cleaning service', 'cleaning company', 'cleaning', 'laundry', 'dry cleaner'] },
  { label: 'Photography', match: ['photographer', 'photography studio'] },
  { label: 'Bakery', match: ['bakery', 'baker', 'cake shop'] },
  { label: 'Florist', match: ['florist', 'flower shop'] },
  { label: 'Veterinary', match: ['vet clinic', 'veterinary', 'pet store'] },
  { label: 'Plumber', match: ['plumber', 'plumbing'] },
  { label: 'Electrician', match: ['electrician', 'electrical contractor'] },
  { label: 'Tailor', match: ['tailor', 'tailoring', 'seamstress'] },
  { label: 'Locksmith', match: ['locksmith'] },
  { label: 'Painter', match: ['painter', 'painting contractor', 'decorator'] },
];

const PROBLEM_SYNONYMS = {
  manual_booking: ['booking', 'book by phone', 'book an appointment', 'appointment', 'reservation', 'scheduling'],
  manual_ordering: ['ordering', 'checkout', 'cart', 'place an order'],
  quotation_management: ['quotation', 'quote', 'estimate'],
  production_tracking: ['production stage', 'job record', 'workshop', 'work in progress', 'job status', 'tracking each job'],
  order_tracking: ['order status', 'delivery status', 'track order', 'where is my order'],
  payment_reconciliation: ['payment', 'invoice', 'reconcil'],
  inventory_problems: ['stock', 'inventory'],
  delivery_management: ['delivery', 'dispatch', 'riders', 'logistics'],
  customer_retention: ['repeat customer', 'loyalty', 'follow up', 'follow-up'],
  wholesale_ordering: ['wholesale order', 'bulk order', 'contractor order'],
  staff_management: ['staff schedule', 'team schedule', 'employee schedule'],
  multi_branch_management: ['branches', 'multiple locations', 'multi-branch'],
  customer_communication: ['dm', 'comments', 'unanswered message'],
  reporting: ['dashboard', 'visibility into', 'clear view of'],
};

// A handful of well-known East African cities as a fallback when no "in X" /
// "near X" phrase is present — a convenience, never the only way to specify a
// location (the field this fills stays editable before the search runs).
const KNOWN_LOCATIONS = [
  'Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret', 'Thika', 'Kampala', 'Kigali',
  'Dar es Salaam', 'Arusha', 'Lagos', 'Accra', 'Addis Ababa',
];

// Words that would otherwise false-positive-match the "in X" / "near X"
// pattern (platforms, generic nouns) — never a real location.
const LOCATION_BLOCKLIST = new Set([
  'tiktok', 'instagram', 'facebook', 'whatsapp', 'twitter', 'x', 'youtube', 'google',
  'tech', 'the workshop', 'workshop', 'nairobi kenya',
]);

function findIndustry(text) {
  const lower = text.toLowerCase();
  for (const { label, match } of INDUSTRY_SYNONYMS) {
    if (match.some((m) => lower.includes(m))) return label;
  }
  return null;
}

function findLocation(text) {
  // Each word in the captured phrase must itself start with a capital letter
  // (proper-noun heuristic) so the match stops at the first lowercase word
  // instead of swallowing the rest of the sentence — "in Nairobi that only
  // book by phone" must capture "Nairobi", not "Nairobi that only book...".
  const pattern = /\b(?:in|near|around)\s+([A-Z]\S*(?:\s+[A-Z]\S*){0,2})\b/g;
  for (const m of text.matchAll(pattern)) {
    const candidate = m[1].trim();
    if (candidate && !LOCATION_BLOCKLIST.has(candidate.toLowerCase())) return candidate;
  }
  for (const city of KNOWN_LOCATIONS) {
    if (text.includes(city)) return city;
  }
  return null;
}

function findProblemCategories(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const [key, words] of Object.entries(PROBLEM_SYNONYMS)) {
    if (words.some((w) => lower.includes(w))) found.push(key);
  }
  return found;
}

/** @returns {{industry: string|null, location: string|null, problem_categories: string[]}} */
export function parseSearchIntent(text) {
  const t = String(text || '').trim();
  if (!t) return { industry: null, location: null, problem_categories: [] };
  return {
    industry: findIndustry(t),
    location: findLocation(t),
    problem_categories: findProblemCategories(t),
  };
}
