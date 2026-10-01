/**
 * OpenStreetMap discovery provider (Overpass API).
 *
 * Free alternative to Google Places. Geocodes the location to a bounding box
 * via Nominatim, then queries the Overpass API for nodes/ways/relations tagged
 * with the target category, mapping each to the standard candidate shape.
 *
 * POLITENESS / USAGE POLICY:
 *  - Proper User-Agent (OSM requires it).
 *  - Throttled: per-host minimum interval, same pattern as polite-fetcher.
 *  - Results cached to disk for 24h (default) so repeated searches don't hit
 *    the free public endpoints again.
 *
 * SAFETY:
 *  - Phones are never classified as WhatsApp (always 'phone_only').
 *  - No fabricated signals: evidence carries no signal_key, and only exists
 *    when the listing actually has contact fields.
 *
 * contact_verified = has a phone or a website. OSM frequently lacks contact
 * details, so candidates with contact_verified=false are flagged for manual
 * follow-up in the review UI.
 *
 * Env:
 *   OSM_OVERPASS_API_URL          Overpass interpreter (default overpass-api.de)
 *   OSM_OVERPASS_MIN_INTERVAL_MS  min ms between Overpass calls (default 5000)
 *   OSM_OVERPASS_MAX_RESULTS      max candidates per run (default 50)
 *   OSM_NOMINATIM_URL             Nominatim search endpoint (default public)
 *   OSM_NOMINATIM_MIN_INTERVAL_MS min ms between Nominatim calls (default 1100)
 *   OSM_USER_AGENT                User-Agent sent to OSM services
 *   OSM_CACHE_DIR                 local cache dir (default /tmp/osm-overpass-cache)
 *   OSM_CACHE_TTL_MS              cache lifetime (default 24h)
 *   OSM_OVERPASS_ENABLED          0 disables the provider entirely
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cfg() {
  return {
    enabled: process.env.OSM_OVERPASS_ENABLED !== '0',
    userAgent: process.env.OSM_USER_AGENT
      || 'OpportunityOS/0.1 (openstreetmap discovery; polite polling of public OSM services)',
    overpassUrl: process.env.OSM_OVERPASS_API_URL
      || 'https://overpass-api.de/api/interpreter',
    overpassIntervalMs: Number(process.env.OSM_OVERPASS_MIN_INTERVAL_MS || 5000),
    nominatimUrl: process.env.OSM_NOMINATIM_URL
      || 'https://nominatim.openstreetmap.org/search',
    nominatimIntervalMs: Number(process.env.OSM_NOMINATIM_MIN_INTERVAL_MS || 1100),
    maxResults: Math.max(1, Math.min(200, Number(process.env.OSM_OVERPASS_MAX_RESULTS || 50))),
    cacheDir: process.env.OSM_CACHE_DIR || '/tmp/osm-overpass-cache',
    cacheTtlMs: Number(process.env.OSM_CACHE_TTL_MS || 24 * 60 * 60 * 1000),
    timeoutMs: Number(process.env.OSM_TIMEOUT_MS || 60_000),
  };
}

/* ------------------------------- throttling ------------------------------- */

const hostLastRequest = new Map();

/** Statuses worth retrying — everything else is a permanent, non-retriable failure. */
const RETRIABLE = new Set([408, 429, 500, 502, 503, 504]);

async function throttledFetch(url, { minIntervalMs, init = {}, retries = 2 } = {}) {
  const host = new URL(url).host;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Politeness is per-attempt too: OSM rate-limits by source address, not by
    // request count, so backing off between retries is mandatory.
    const last = hostLastRequest.get(host) || 0;
    const wait = last + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    hostLastRequest.set(host, Date.now());

    let res;
    try {
      res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': cfg().userAgent, ...(init.headers || {}) },
        signal: AbortSignal.timeout(cfg().timeoutMs),
      });
    } catch (err) {
      if (attempt >= retries) throw err;
      lastErr = err;
      await sleep(500 * 2 ** attempt);
      continue;
    }

    if (res.ok) return res;
    if (!RETRIABLE.has(res.status)) {
      throw new Error(`OSM request to ${host} failed (${res.status})`);
    }
    if (attempt >= retries) {
      throw new Error(`OSM request to ${host} failed (${res.status}) after ${retries + 1} attempts`);
    }
    lastErr = new Error(`OSM request to ${host} failed (${res.status})`);
    await sleep(500 * 2 ** attempt);
  }
  throw lastErr || new Error(`OSM request to ${host} failed`);
}

/* --------------------------------- caching -------------------------------- */

function keyPath(key) {
  const hash = createHash('sha256').update(key).digest('hex');
  return join(cfg().cacheDir, `${hash}.json`);
}

async function cacheGet(key) {
  try {
    const p = keyPath(key);
    const st = await stat(p);
    if (Date.now() - st.mtimeMs > cfg().cacheTtlMs) return null;
    const parsed = JSON.parse(await readFile(p, 'utf8'));
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

async function cacheSet(key, data) {
  try {
    await mkdir(cfg().cacheDir, { recursive: true });
    const p = keyPath(key);
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify({ savedAt: Date.now(), key, data }), 'utf8');
    await rename(tmp, p);
  } catch {
    /* cache is best-effort */
  }
}

/* ------------------------------ field helpers ----------------------------- */

function firstTag(tags, keys) {
  for (const k of keys) {
    const v = tags ? tags[k] : null;
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

function looksLikeWebsite(v) {
  const s = String(v || '').trim();
  if (!s) return false;
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function titleCase(s) {
  return String(s || '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/* ------------------------- category -> OSM tags -------------------------- */

const KNOWN_CATEGORIES = {
  dentist: { amenity: 'dentist' },
  'dental clinic': { amenity: 'dentist' },
  'dental clinic clinic': { amenity: 'dentist' },
  doctors: { amenity: 'doctors' },
  doctor: { amenity: 'doctors' },
  clinic: { amenity: 'clinic' },
  hospital: { amenity: 'hospital' },
  pharmacy: { amenity: 'pharmacy' },
  chemist: { amenity: 'pharmacy' },
  restaurant: { amenity: 'restaurant' },
  cafe: { amenity: 'cafe' },
  coffee: { amenity: 'cafe' },
  'fast food': { amenity: 'fast_food' },
  supermarket: { shop: 'supermarket' },
  grocery: { shop: 'supermarket' },
  barber: { shop: 'hairdresser' },
  hairdresser: { shop: 'hairdresser' },
  'hair salon': { shop: 'hairdresser' },
  'beauty salon': { shop: 'beauty' },
  bakery: { shop: 'bakery' },
  butcher: { shop: 'butcher' },
  hardware: { shop: 'hardware' },
  bookstore: { shop: 'books' },
  gym: { leisure: 'fitness_centre' },
  'car repair': { shop: 'car_repair' },
  mechanic: { shop: 'car_repair' },
  garage: { shop: 'car_repair' },
  'clothing store': { shop: 'clothes' },
  fashion: { shop: 'clothes' },
  electronics: { shop: 'electronics' },
  furniture: { shop: 'furniture' },
  'furniture store': { shop: 'furniture' },
  florist: { shop: 'florist' },
  carwash: { amenity: 'car_wash' },
  'car wash': { amenity: 'car_wash' },
  laundry: { shop: 'laundry' },
  'pet store': { shop: 'pet' },
  veterinary: { amenity: 'veterinary' },
  vet: { amenity: 'veterinary' },
  school: { amenity: 'school' },
  church: { amenity: 'place_of_worship' },
  hotel: { tourism: 'hotel' },
  lodging: { tourism: 'hotel' },
  hostel: { tourism: 'hostel' },
  plumber: { craft: 'plumber' },
  plumbing: { craft: 'plumber' },
  electrician: { craft: 'electrician' },
  carpenter: { craft: 'carpenter' },
  upholsterer: { craft: 'upholsterer' },
  upholstery: { craft: 'upholsterer' },
  tailor: { shop: 'tailor' },
  locksmith: { shop: 'locksmith' },
  painter: { craft: 'painter' },
  'wholesale': { shop: 'trade' },
  'wholesaler': { shop: 'trade' },
  'trade shop': { shop: 'trade' },
  cleaning: { craft: 'cleaning' },
  'cleaning service': { craft: 'cleaning' },
  'cleaning company': { craft: 'cleaning' },
  // Verified against taginfo.openstreetmap.org (all >1,000 uses worldwide).
  phone: { shop: 'mobile_phone' },
  'mobile phone': { shop: 'mobile_phone' },
  mobile: { shop: 'mobile_phone' },
  cellphone: { shop: 'mobile_phone' },
  smartphone: { shop: 'mobile_phone' },
  telecom: { shop: 'telecommunication' },
  computer: { shop: 'computer' },
  laptop: { shop: 'computer' },
  printing: { shop: 'copyshop' },
  'print shop': { shop: 'copyshop' },
  printer: { shop: 'copyshop' },
  copyshop: { shop: 'copyshop' },
  stationery: { shop: 'stationery' },
  shoe: { shop: 'shoes' },
  shoes: { shop: 'shoes' },
  jewelry: { shop: 'jewelry' },
  jewellery: { shop: 'jewelry' },
  optician: { shop: 'optician' },
  'car dealer': { shop: 'car' },
  'car dealership': { shop: 'car' },
  'spare parts': { shop: 'car_parts' },
  'car parts': { shop: 'car_parts' },
  tyre: { shop: 'tyres' },
  tire: { shop: 'tyres' },
  boutique: { shop: 'boutique' },
  greengrocer: { shop: 'greengrocer' },
  'fruit and vegetables': { shop: 'greengrocer' },
  convenience: { shop: 'convenience' },
  kiosk: { shop: 'kiosk' },
  'general store': { shop: 'general' },
  'agro vet': { shop: 'agrarian' },
  'farm supplies': { shop: 'agrarian' },
  'building materials': { shop: 'doityourself' },
  fabric: { shop: 'fabric' },
  paint: { shop: 'paint' },
  cosmetics: { shop: 'cosmetics' },
  motorcycle: { shop: 'motorcycle' },
  bicycle: { shop: 'bicycle' },
  sports: { shop: 'sports' },
  toys: { shop: 'toys' },
  gift: { shop: 'gift' },
  electrical: { shop: 'electrical' },
  lighting: { shop: 'lighting' },
  houseware: { shop: 'houseware' },
  'interior decoration': { shop: 'interior_decoration' },
  interiors: { shop: 'interior_decoration' },
  beverages: { shop: 'beverages' },
  liquor: { shop: 'alcohol' },
  alcohol: { shop: 'alcohol' },
  seafood: { shop: 'seafood' },
  bank: { amenity: 'bank' },
  'mobile money': { amenity: 'money_transfer' },
  'money transfer': { amenity: 'money_transfer' },
  bar: { amenity: 'bar' },
  pub: { amenity: 'pub' },
  nightclub: { amenity: 'nightclub' },
  market: { amenity: 'marketplace' },
  'driving school': { amenity: 'driving_school' },
  'estate agent': { office: 'estate_agent' },
  'real estate': { office: 'estate_agent' },
  insurance: { office: 'insurance' },
  lawyer: { office: 'lawyer' },
  accountant: { office: 'accountant' },
  'travel agency': { shop: 'travel_agency' },
  photo: { shop: 'photo' },
  photography: { shop: 'photo' },
  'internet cafe': { amenity: 'internet_cafe' },
  welder: { craft: 'welder' },
  welding: { craft: 'welder' },
  shoemaker: { craft: 'shoemaker' },
  caterer: { craft: 'caterer' },
  catering: { craft: 'caterer' },
  'metal fabrication': { craft: 'metal_construction' },
};

// Words people append to a business type ("phone sellers", "furniture
// workshops") that carry no OSM meaning — stripped before lookup.
const FILLER_WORDS = new Set([
  'seller', 'sellers', 'shop', 'shops', 'store', 'stores', 'dealer', 'dealers', 'vendor', 'vendors',
  'retailer', 'retailers', 'supplier', 'suppliers', 'outlet', 'outlets', 'business', 'businesses',
  'company', 'companies', 'service', 'services', 'maker', 'makers', 'manufacturer', 'manufacturers',
  'workshop', 'workshops', 'agency', 'agencies', 'centre', 'center', 'centres', 'centers',
]);

function singulars(word) {
  const out = [word];
  if (word.endsWith('ies')) out.push(`${word.slice(0, -3)}y`);
  if (word.endsWith('es')) out.push(word.slice(0, -2));
  if (word.endsWith('s')) out.push(word.slice(0, -1));
  return out;
}

/** Candidate stems of a phrase: itself, then with trailing filler words peeled off. */
function stems(term) {
  const words = term.split(/\s+/).filter(Boolean);
  const out = [term];
  while (words.length > 1 && FILLER_WORDS.has(words[words.length - 1])) {
    words.pop();
    out.push(words.join(' '));
  }
  return out;
}

/** Keyword -> OSM tag object. Accepts raw 'key=value' too. Returns null/{} if unusable. */
export function resolveTags(keyword) {
  const term = String(keyword || '').trim().toLowerCase();
  if (!term) return null;
  if (term.includes('=')) {
    const [k, ...rest] = term.split('=');
    const v = rest.join('=').trim();
    if (k && v) return { [k.trim()]: v };
  }
  const candidates = stems(term).flatMap((stem) => {
    const w = stem.split(' ');
    return singulars(w[w.length - 1]).map((last) => [...w.slice(0, -1), last].join(' '));
  });
  for (const c of candidates) if (KNOWN_CATEGORIES[c]) return KNOWN_CATEGORIES[c];
  for (const c of candidates) {
    if (c.length < 4) continue; // a 1-3 letter fragment would fuzzy-match almost anything
    const fuzzy = Object.keys(KNOWN_CATEGORIES).find((k) => k.includes(c) || c.includes(k));
    if (fuzzy) return KNOWN_CATEGORIES[fuzzy];
  }
  // Unknown type: `amenity=<whatever was typed>` almost never exists in OSM and
  // silently returns nothing. Search business NAMES instead (restricted to
  // shop/amenity/craft/office features in buildQuery) using the stem left
  // after stripping filler words.
  const best = stems(term).pop().replace(/[^a-z0-9 ]/g, '').trim();
  return best.length >= 3 ? { __name: best } : null;
}

/* ------------------------------- geocoding -------------------------------- */

async function geocodeLocation(place) {
  const key = `geocode:${String(place).toLowerCase().trim()}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const params = new URLSearchParams({ q: place, format: 'json', limit: '1', addressdetails: '1' });
  const res = await throttledFetch(`${cfg().nominatimUrl}?${params}`, {
    minIntervalMs: cfg().nominatimIntervalMs,
  });
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) return null;

  const first = rows[0];
  const [south, north, west, east] = (first.boundingbox || []).map(Number);
  if (![south, north, west, east].every(Number.isFinite)) return null;

  const result = {
    south, north, west, east,
    lat: Number(first.lat) || null,
    lon: Number(first.lon) || null,
    country: first.address?.country || null,
    countryCode: first.address?.country_code || null,
    displayName: String(first.display_name || '').slice(0, 200),
  };
  await cacheSet(key, result);
  return result;
}

/* ------------------------------- overpass --------------------------------- */

export function buildQuery(tags, bbox) {
  const extent0 = `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`;
  if (tags.__name) {
    const name = String(tags.__name).replace(/[^a-z0-9 ]/gi, '');
    const bodies = ['shop', 'amenity', 'craft', 'office']
      .flatMap((key) => ['node', 'way'].map((t) => `${t}["name"~"${name}",i]["${key}"]${extent0};`))
      .join('');
    return `[out:json][timeout:25];(${bodies});out body center;`;
  }
  const tag = Object.entries(tags)
    .map(([k, v]) => `["${k}"="${v}"]`)
    .join('');
  const extent = `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`;
  const bodies = ['node', 'way', 'relation']
    .map((t) => `${t}${tag}${extent};`)
    .join('');
  return `[out:json][timeout:25];(${bodies});out body center;`;
}

async function queryOverpass(tags, bbox) {
  const query = buildQuery(tags, bbox);
  const key = `overpass:${query}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const body = new URLSearchParams({ data: query }).toString();
  const res = await throttledFetch(cfg().overpassUrl, {
    minIntervalMs: cfg().overpassIntervalMs,
    init: { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
  });
  const data = await res.json();
  await cacheSet(key, data);
  return data;
}

/* ----------------------------- element mapping ---------------------------- */

// Nationwide/global brands and telcos whose outlets are corporate-run, not
// independent SMEs that would buy a management system. Matched on the whole
// name or its first word(s), so "Safaricom Outlet" is a chain outlet but
// "Extelcom shop" (an independent dealer) is not.
const CHAIN_NAMES = [
  'safaricom', 'airtel', 'telkom', 'faiba', 'mpesa', 'm-pesa', 'samsung', 'tecno', 'infinix', 'itel', 'oppo',
  'vivo', 'realme', 'xiaomi', 'huawei', 'apple', 'nokia', 'kfc', 'java house', 'artcaffe', 'naivas',
  'quickmart', 'carrefour', 'chandarana', 'tuskys', 'shell', 'total', 'totalenergies', 'rubis', 'kenol',
  'oilibya', 'subway', 'dominos', 'pizza inn', 'galitos', 'chicken inn',
];

/** True for outlets of a known chain/brand (OSM `brand:wikidata`, or a chain name). */
export function isChainOutlet(tags = {}) {
  if (tags['brand:wikidata']) return true;
  const name = String(tags.name || tags['name:en'] || '')
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .trim();
  if (!name) return false;
  return CHAIN_NAMES.some((c) => name === c || name.startsWith(`${c} `));
}

export function mapElement(el, geo) {
  const t = el.tags || {};
  const name = firstTag(t, ['name', 'name:en', 'brand', 'operator']);
  if (!name) return null;

  const rawPhone = firstTag(t, ['contact:phone', 'phone', 'contact:mobile', 'tel']);
  const rawWebsite = firstTag(t, ['website', 'contact:website', 'contact:web', 'url']);
  const phone = rawPhone || null;
  const website = rawWebsite && looksLikeWebsite(rawWebsite) ? rawWebsite : null;

  const street = [firstTag(t, ['addr:housenumber']), firstTag(t, ['addr:street'])]
    .filter(Boolean).join(' ');
  const area = firstTag(t, ['addr:city', 'addr:town', 'addr:village', 'addr:suburb', 'addr:subdistrict']);
  const location = [street, area].filter(Boolean).join(', ') || null;

  const category = firstTag(t, ['amenity', 'shop', 'office', 'craft', 'healthcare', 'leisure', 'tourism']);

  const osmLink = `https://www.openstreetmap.org/${el.type}/${el.id}`;
  const contactVerified = Boolean(phone || website);

  const evidence = [];
  if (contactVerified) {
    evidence.push({
      signal_key: null,
      evidence_type: 'listing_detail',
      claim_type: 'FACT',
      text: `${name} is listed on OpenStreetMap${category ? ` as ${titleCase(category)}` : ''}`
        + `${phone ? ` with phone ${phone}` : ''}${website ? ` and website ${website}` : ''}.`,
      excerpt_summary: 'OSM listing contact info published',
      source_name: 'OpenStreetMap',
      source_url: osmLink,
      confidence: 0.8,
    });
    if (phone) {
      evidence.push({
        signal_key: 'public_phone_published',
        evidence_type: 'listing_detail',
        claim_type: 'FACT',
        text: `${name} publishes a public phone number on OpenStreetMap (${phone}).`,
        excerpt_summary: 'OSM listing includes public phone number',
        source_name: 'OpenStreetMap',
        source_url: osmLink,
        confidence: 0.8,
      });
    }
    if (website) {
      evidence.push({
        signal_key: 'existing_website',
        evidence_type: 'listing_detail',
        claim_type: 'FACT',
        text: `${name} publishes a public website on OpenStreetMap (${website}).`,
        excerpt_summary: 'OSM listing includes public website',
        source_name: 'OpenStreetMap',
        source_url: osmLink,
        confidence: 0.8,
      });
    } else {
      // contactVerified is true here via phone (the only other branch), so this
      // is a real, tagged listing with no website tag. OSM tagging is crowd-sourced
      // and can simply be incomplete, so this stays an INFERENCE at lower confidence
      // than the Google Places equivalent (which checks a dedicated Details field).
      evidence.push({
        signal_key: 'no_public_website',
        evidence_type: 'listing_detail',
        claim_type: 'INFERENCE',
        text: `${name} has a tagged OpenStreetMap listing with a published phone number, but no website tag.`,
        excerpt_summary: 'OSM listing has a phone but no website tag',
        source_name: 'OpenStreetMap',
        source_url: osmLink,
        confidence: 0.55,
      });
    }
  }

  return {
    name,
    industry: category ? titleCase(category) : null,
    description: firstTag(t, ['description', 'opening_hours']) || null,
    location,
    country: geo?.country || t['addr:country'] || null,
    website,
    phone,
    socialUrl: null,
    latitude: el.lat ?? el.center?.lat ?? null,
    longitude: el.lon ?? el.center?.lon ?? null,
    contacts: phone
      ? [{ contact_type: 'phone', contact_value: phone, verification_status: 'phone_only', confidence: 0.8 }]
      : [],
    evidence,
    source: {
      source_type: 'provider_api',
      source_name: 'OpenStreetMap',
      source_url: osmLink,
      external_identifier: `osm:${el.type}/${el.id}`,
    },
    contact_verified: contactVerified,
  };
}

/* ------------------------------- provider --------------------------------- */

export const osmOverpassProvider = {
  id: 'osm_overpass',
  label: 'OpenStreetMap (Overpass)',
  available: cfg().enabled,

  /**
   * Search filters -> Candidate[].
   * Uses filters.query || filters.industry as the OSM category keyword.
   * Area comes from EITHER filters.bbox (a user-picked map area — takes
   * priority, skips geocoding entirely) OR filters.location (a place name,
   * geocoded via Nominatim). One of the two is required.
   */
  async search(filters = {}) {
    if (!cfg().enabled) return [];
    const keyword = String(filters.query || filters.industry || '').trim();
    if (!keyword) return [];

    const tags = resolveTags(keyword);
    if (!tags) return [];

    const location = String(filters.location || '').trim();
    const geo = filters.bbox || (location ? await geocodeLocation(location) : null);
    if (!geo) return [];

    const data = await queryOverpass(tags, geo);
    const elements = Array.isArray(data?.elements) ? data.elements : [];
    if (!elements.length) return [];

    const max = cfg().maxResults;
    const candidates = [];
    const seen = new Set();
    for (const el of elements) {
      if (candidates.length >= max) break;
      // Independent SMEs are the target; OSM_INCLUDE_CHAINS=1 or filters.includeChains keeps brand outlets.
      if (!filters.includeChains && process.env.OSM_INCLUDE_CHAINS !== '1' && isChainOutlet(el.tags)) continue;
      const c = mapElement(el, geo);
      if (!c) continue;
      if (seen.has(c.source.external_identifier)) continue;
      seen.add(c.source.external_identifier);
      if (filters.requiredContactType === 'phone' && !c.phone) continue;
      if (filters.requiredContactType && filters.requiredContactType !== 'phone') continue;
      candidates.push(c);
    }
    return candidates;
  },
};