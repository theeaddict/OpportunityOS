/**
 * Multi-query search strategy + automatic expansion.
 *
 * A single query for an industry often misses real listings that a slightly
 * different phrasing would catch — OSM's category matching and Google's
 * free-text search both respond differently to wording. Instead of one
 * search, this generates a short list of real phrasing variants for the SAME
 * industry, and the pipeline tries them in order, stopping once enough
 * candidates are found (or the variants run out).
 *
 * This is entirely about widening the net on the SAME real, public data
 * sources (OSM + Google Places) already wired up — never a new/different
 * data source, and never fabricated variety for its own sake.
 */

const GENERIC_MODIFIERS = ['', ' workshop', ' company', ' shop', ' services'];

/**
 * @param {{industry: string|null, query: string|null}} filters
 * @returns {string[]} ordered list of query strings to try, most specific/
 *   likely-correct first. Always includes the original phrasing exactly as
 *   given, even if it doesn't match any modifier pattern.
 */
export function buildQueryVariants({ industry, query } = {}) {
  const base = String(query || industry || '').trim();
  if (!base) return [];

  const variants = [base];
  // Only pile on generic modifiers for a short, single-concept industry term
  // ("furniture") — appending "workshop"/"company" to something the user
  // already phrased as a full sentence or multi-word description would just
  // produce nonsense variants no provider will match.
  if (base.split(/\s+/).length <= 2) {
    for (const suffix of GENERIC_MODIFIERS.slice(1)) {
      variants.push(`${base}${suffix}`);
    }
  }
  return [...new Set(variants)];
}

/**
 * Runs `searchFn` (typically runAllSearches from ./index.js) across query
 * variants in order, merging candidates and deduping by the provider's own
 * external_identifier (a business found by two variants must not be
 * processed twice before import's own dedup even sees it). Stops once
 * `minResults` is reached or variants run out — this is the "search
 * expansion" behavior: only widen the search when the first, most specific
 * phrasing didn't find enough.
 *
 * @param {(filters: object) => Promise<Array>} searchFn
 * @param {object} filters — same shape runAllSearches/runSearch expects
 * @param {{minResults?: number, maxVariants?: number}} [options]
 * @returns {Promise<{candidates: Array, queriesTried: string[]}>}
 */
export async function searchWithExpansion(searchFn, filters, { minResults = 8, maxVariants = 4 } = {}) {
  const variants = buildQueryVariants(filters).slice(0, maxVariants);
  if (!variants.length) return { candidates: await searchFn(filters), queriesTried: [] };

  const seen = new Set();
  const candidates = [];
  const queriesTried = [];

  for (const query of variants) {
    queriesTried.push(query);
    let found;
    try {
      found = await searchFn({ ...filters, query, industry: query });
    } catch {
      found = []; // one bad variant must not sink the others
    }
    for (const c of found) {
      const key = c?.source?.external_identifier || `${c?.name || ''}|${c?.website || ''}|${c?.phone || ''}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push(c);
    }
    if (candidates.length >= minResults) break;
  }
  return { candidates, queriesTried };
}
