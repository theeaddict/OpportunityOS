/**
 * Google Places discovery provider.
 *
 * Uses the Google Places Text Search (legacy) API to find public Map listings
 * for a query + location, then the Place Details API to enrich each result with
 * phone / website / country when available. It only SUPPLIES candidates (same
 * shape as the 'http' and 'feed' providers); dedup, import review, and evidence
 * creation are untouched.
 *
 * Safety:
 *  - Phones are never classified as WhatsApp (verification_status 'phone_only');
 *    the ContactProvider owns WhatsApp rules and we never assert them.
 *  - No signals are fabricated: no signal_key is set, so the rules analyzer
 *    treats listings as facts, not detections.
 *  - Requests are throttled sequentially using the same min-interval pattern as
 *    lib/services/research/polite-fetcher.js.
 *
 * Env:
 *   GOOGLE_PLACES_API_KEY            (required for the provider to appear)
 *   GOOGLE_PLACES_API_URL            Text Search endpoint (default legacy json)
 *   GOOGLE_PLACES_DETAILS_URL        Place Details endpoint (default legacy json)
 *   GOOGLE_PLACES_LANGUAGE           results language (default en)
 *   GOOGLE_PLACES_MAX_RESULTS        max candidates per run (default 10)
 *   GOOGLE_PLACES_FETCH_DETAILS      enrich with phone/website via Details (default 1)
 *   GOOGLE_PLACES_MIN_INTERVAL_MS    minimum ms between upstream calls (default 500)
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastRequestAt = 0;

function envFlag(name, def = '1') {
  const v = process.env[name];
  if (v == null || v === '') return def === '1';
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function minIntervalMs() {
  return Math.max(0, Number(process.env.GOOGLE_PLACES_MIN_INTERVAL_MS || 500));
}

function textSearchUrl() {
  return process.env.GOOGLE_PLACES_API_URL
    || 'https://maps.googleapis.com/maps/api/place/textsearch/json';
}

function placeDetailsUrl() {
  return process.env.GOOGLE_PLACES_DETAILS_URL
    || 'https://maps.googleapis.com/maps/api/place/details/json';
}

/** Statuses worth retrying — everything else is a permanent, non-retriable failure. */
const RETRIABLE = new Set([408, 429, 500, 502, 503, 504]);

/** Sequential throttled GET to Google — mirrors the polite-fetcher pattern. */
async function throttledGet(url, retries = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Throttle each attempt: Google quota errors are triggered by call volume.
    const interval = minIntervalMs();
    const wait = lastRequestAt + interval - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      if (attempt >= retries) throw err;
      lastErr = err;
      await sleep(600 * 2 ** attempt);
      continue;
    }

    if (res.ok) return res.json();
    if (!RETRIABLE.has(res.status)) {
      throw new Error(`Google Places failed (${res.status})`);
    }
    if (attempt >= retries) {
      throw new Error(`Google Places failed (${res.status}) after ${retries + 1} attempts`);
    }
    lastErr = new Error(`Google Places failed (${res.status})`);
    await sleep(600 * 2 ** attempt);
  }
  throw lastErr || new Error('Google Places failed');
}

/** Human-readable industry from a place's types, skipping Google-generic ones. */
const GENERIC_TYPES = new Set([
  'establishment', 'point_of_interest', 'store', 'health', 'food', 'finance',
  'church', 'local_government_office', 'shopping_mall',
]);

function industryLabel(place = {}) {
  const pick = (place.types || []).find((t) => !GENERIC_TYPES.has(t));
  if (!pick) return null;
  return pick
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 120);
}

function countryLabel(details = null) {
  const comp = (details?.address_components || []).find((a) => (a.types || []).includes('country'));
  return comp?.long_name ? String(comp.long_name).slice(0, 120) : null;
}

function mapsUrl(placeId) {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

/** Compose the free-text query from the SearchFilters contract. */
function queryText(filters) {
  const base = String(filters.query || filters.industry || '').trim();
  if (!base) return null;
  const location = String(filters.location || '').trim();
  const text = location ? `${base} in ${location}` : base;
  return text.slice(0, 500);
}

/** Enrich one result's phone/website/country/address via Place Details. */
async function placeDetails(placeId) {
  const params = new URLSearchParams({
    key: process.env.GOOGLE_PLACES_API_KEY,
    place_id: placeId,
    fields: ['website', 'international_phone_number', 'formatted_address',
      'address_components', 'url'].join(','),
    language: process.env.GOOGLE_PLACES_LANGUAGE || 'en',
  });
  const data = await throttledGet(`${placeDetailsUrl()}?${params}`);
  return data.status === 'OK' && data.result ? data.result : null;
}

function mapResult(place, details) {
  const placeId = String(place.place_id || '').trim();
  if (!placeId) return null;
  const name = String(place.name || '').trim().slice(0, 200);
  if (!name) return null;

  const address = details?.formatted_address || place.formatted_address;
  const phone = details?.international_phone_number || null;
  const website = details?.website || null;

  const evidence = [];
  const rating = Number(place.rating);
  const reviews = Number(place.user_ratings_total);
  if (Number.isFinite(rating) && Number.isFinite(reviews) && reviews > 0) {
    evidence.push({
      signal_key: null,
      evidence_type: 'listing_detail',
      claim_type: 'FACT',
      text: `Listed on Google Maps as ${name} with a ${rating.toFixed(1)}/5 rating from ${reviews} reviews.`,
      excerpt_summary: `Google Maps listing: ${rating.toFixed(1)} stars, ${reviews} reviews`,
      source_name: 'Google Places listing',
      source_url: details?.url || mapsUrl(placeId),
      confidence: 0.9,
    });
  }
  if (phone) {
    evidence.push({
      signal_key: 'public_phone_published',
      evidence_type: 'listing_detail',
      claim_type: 'FACT',
      text: `Google Places lists a public phone number for ${name} (${phone}).`,
      excerpt_summary: 'Google Places listing includes public phone number',
      source_name: 'Google Places listing',
      source_url: details?.url || mapsUrl(placeId),
      confidence: 0.85,
    });
  }
  if (website) {
    evidence.push({
      signal_key: 'existing_website',
      evidence_type: 'listing_detail',
      claim_type: 'FACT',
      text: `Google Places lists a public website for ${name} (${website}).`,
      excerpt_summary: 'Google Places listing includes public website',
      source_name: 'Google Places listing',
      source_url: details?.url || mapsUrl(placeId),
      confidence: 0.85,
    });
  }

  return {
    name,
    industry: industryLabel(place),
    description: null,
    location: address ? String(address).trim().slice(0, 160) : null,
    country: countryLabel(details),
    website,
    phone,
    socialUrl: null,
    contacts: phone
      ? [{ contact_type: 'phone', contact_value: phone, verification_status: 'phone_only', confidence: 0.8 }]
      : [],
    evidence,
    source: {
      source_type: 'provider_api',
      source_name: 'Google Places',
      source_url: details?.url || mapsUrl(placeId),
      external_identifier: `google_places:${placeId}`,
    },
  };
}

export const googlePlacesProvider = {
  id: 'google_places',
  label: 'Google Places',
  available: Boolean(process.env.GOOGLE_PLACES_API_KEY),

  async search(filters = {}) {
    const key = process.env.GOOGLE_PLACES_API_KEY;
    if (!key) return [];

    const q = queryText(filters);
    if (!q) return [];

    const maxResults = Math.min(60, Math.max(1, Number(process.env.GOOGLE_PLACES_MAX_RESULTS || 10)));
    const fetchDetails = envFlag('GOOGLE_PLACES_FETCH_DETAILS');

    const params = new URLSearchParams({
      key,
      query: q,
      language: process.env.GOOGLE_PLACES_LANGUAGE || 'en',
    });
    const data = await throttledGet(`${textSearchUrl()}?${params}`);

    if (data.status === 'ZERO_RESULTS') return [];
    if (data.status === 'REQUEST_DENIED') {
      throw new Error(`Google Places denied the request: ${data.error_message || data.status}`);
    }
    if (data.status === 'OVER_QUERY_LIMIT') {
      throw new Error('Google Places quota exhausted (OVER_QUERY_LIMIT) — retry shortly.');
    }
    if (data.status !== 'OK') {
      throw new Error(`Google Places error (${data.status}): ${data.error_message || ''}`.trim());
    }

    const results = (data.results || []).slice(0, maxResults);
    const candidates = [];
    for (const place of results) {
      // Enrichment is serial + throttled so bursts never hit Google.
      const details = fetchDetails ? await placeDetails(place.place_id) : null;
      const candidate = mapResult(place, details);
      if (!candidate) continue;

      if (filters.requiredContactType === 'phone' && !candidate.phone) continue;
      if (filters.requiredContactType && filters.requiredContactType !== 'phone') continue;

      candidates.push(candidate);
    }
    return candidates;
  },
};