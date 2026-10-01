/**
 * Website Finder — looks up a business's website via an official search API
 * when no discovery provider (Google Places / OSM) supplied one. Optional:
 * the app is fully functional without it — research simply has nothing to
 * crawl for that business, exactly as before this existed.
 *
 * Deliberately uses Google's own Programmable Search Engine (Custom Search
 * JSON API) rather than scraping Google's search result pages directly —
 * scraping search results violates Google's Terms of Service, is fragile
 * (breaks on any markup change), and risks the whole app's IP getting
 * blocked. This is the sanctioned, ToS-compliant way to do a web lookup
 * programmatically.
 *
 * A search match is a GUESS, not a confirmed fact — name collisions happen
 * ("Savannah" could be many things). It is only ever used to fill a business's
 * website when nothing else did (see lib/repositories/businesses.js
 * setWebsiteIfMissing), and it's self-correcting: the website research
 * provider fetches the guessed URL for real content next, so a wrong guess
 * just yields no useful evidence rather than corrupting anything.
 *
 * Env:
 *   GOOGLE_CUSTOM_SEARCH_API_KEY   (required for lookup to run)
 *   GOOGLE_CUSTOM_SEARCH_CX        Programmable Search Engine id (required)
 *   GOOGLE_CUSTOM_SEARCH_URL       default https://www.googleapis.com/customsearch/v1
 */

const DEFAULT_URL = 'https://www.googleapis.com/customsearch/v1';

// Never a business's OWN website even when they rank first for its name —
// directories, social platforms, map/review/delivery aggregators.
const EXCLUDED_HOSTS = [
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'tiktok.com',
  'youtube.com', 'pinterest.com', 'whatsapp.com',
  'yelp.com', 'tripadvisor.com', 'foursquare.com', 'opentable.com',
  'google.com', 'maps.app.goo.gl', 'g.page',
  'yellowpages.com', 'wikipedia.org', 'jiji.co.ke', 'jumia.co.ke', 'jumia.com', 'olx.co.ke',
  'ubereats.com', 'glovoapp.com', 'bolt.eu',
];

export function isConfigured() {
  return Boolean(process.env.GOOGLE_CUSTOM_SEARCH_API_KEY && process.env.GOOGLE_CUSTOM_SEARCH_CX);
}

function isExcludedHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^www\./, '');
  return EXCLUDED_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

/**
 * @param {{name: string, location?: string}} business
 * @returns {Promise<string|null>} a plausible website URL, or null (never throws).
 */
export async function findWebsite({ name, location } = {}) {
  if (!isConfigured()) return null;
  const q = [name, location].filter(Boolean).join(' ').trim();
  if (!q) return null;

  const params = new URLSearchParams({
    key: process.env.GOOGLE_CUSTOM_SEARCH_API_KEY,
    cx: process.env.GOOGLE_CUSTOM_SEARCH_CX,
    q,
    num: '5',
  });

  let data;
  try {
    const res = await fetch(`${process.env.GOOGLE_CUSTOM_SEARCH_URL || DEFAULT_URL}?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null; // best-effort: a lookup failure just means "no website found", never a hard error
  }

  for (const item of data?.items || []) {
    let u;
    try {
      u = new URL(item?.link);
    } catch {
      continue;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    if (isExcludedHost(u.hostname)) continue;
    return u.href;
  }
  return null;
}
