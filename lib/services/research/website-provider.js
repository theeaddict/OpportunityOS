import { politeFetch, htmlToText } from './polite-fetcher.js';

/**
 * WebsiteResearchProvider — researches a business's OWN public website.
 *
 * Extracts observable facts (keyword-anchored) into candidate evidence with the
 * page URL as source. Only what is actually on the page becomes evidence; if a
 * topic is absent, it stays uncovered (the UI shows "Research incomplete").
 *
 * CRAWL DEPTH: the homepage is always fetched; up to MAX_EXTRA_PAGES further
 * pages are fetched ONLY when the homepage HTML links to them and the path maps
 * to the common secondary-page pool below (/about, /contact, /services, /menu,
 * /pricing, /book|/booking|/reservations, /shop, /delivery, /careers, /faq,
 * /branches + common variants — one page per pool, in document order). This
 * stays one hop from the homepage (never follows links found on a secondary
 * page) — crawling a second hop would multiply fetches across every business
 * in a run and risk the per-host throttle turning a 50-business run into a
 * very slow one for a marginal evidence gain. Robots.txt is honoured per page
 * by politeFetch; the same per-host throttle/timeout applies to every fetch.
 * Each piece of evidence carries source_url = the exact page it was found on.
 *
 * SIGNAL TAGGING: every evidence row must carry a signal_key from the shared
 * vocabulary (lib/constants.js SIGNAL_KEYS) so signalsForBusiness() and the
 * rules analyzer can see it. Untagged rows are invisible to detection/scoring.
 * Mapping used here:
 *   window/shop/cart/checkout on file  -> online_ordering
 *   order/order-flow wording           -> existing_website
 *   online booking/appointment flow    -> existing_digital_systems (positive;
 *                                         absence gated by no_booking_system)
 *   delivery wording                   -> delivery_operations
 *   wholesale/bulk/contractor wording  -> wholesale_operations
 *   "our branches"/other locations     -> multiple_branches
 *   instagram/facebook/tiktok links    -> active_social_commerce
 *   team/careers wording               -> team_employees
 *   "established in YYYY"/since YYYY   -> established_history
 *   explicitly published WhatsApp nr   -> phone_whatsapp_published
 *   explicitly published public phone  -> public_phone_published
 *   no ordering path found             -> no_online_ordering (negative)
 *   no booking path found (industry)   -> no_booking_system (negative)
 * Aspects WITHOUT a legitimate vocabulary key (e.g. raw "pricing/customer
 * service" presence) produce NO evidence row rather than an untagged one.
 */

const MAX_EXTRA_PAGES = 9;

// Keyword-anchored aspect detection. Positive aspects map 1:1 to a signal key.
const ASPECT_PATTERNS = [
  { aspect: 'online_sales', signalKey: 'online_ordering', patterns: [/\bshop now\b/i, /\border online\b/i, /\badd to (cart|basket)\b/i, /\bcheckout\b/i, /\bonline store\b/i] },
  { aspect: 'ordering', signalKey: 'existing_website', patterns: [/\bplace (an )?order\b/i, /\bhow to order\b/i, /\bmenu\b.{0,30}\bprice/i] },
  { aspect: 'booking', signalKey: 'existing_digital_systems', patterns: [/\bbook(ing)? (now|online|an appointment)\b/i, /\bonline booking\b/i, /\bappointment(s)?\b/i, /\breserve\b/i, /\bmake a reservation\b/i] },
  { aspect: 'delivery', signalKey: 'delivery_operations', patterns: [/\bwe deliver\b/i, /\bfree delivery\b/i, /\bdelivery available\b/i, /\briders?\b/i, /\bdoor[- ]to[- ]door\b/i] },
  { aspect: 'wholesale', signalKey: 'wholesale_operations', patterns: [/\bwholesale\b/i, /\bbulk (order|price)s?\b/i, /\bdistributors? wanted\b/i, /\bcontractor prices?\b/i] },
  { aspect: 'locations_branches', signalKey: 'multiple_branches', patterns: [/\bour branches\b/i, /\bother locations?\b/i, /\bvisit us at\b/i, /\bfind us (at|in)\b/i] },
  { aspect: 'social_commerce', signalKey: 'active_social_commerce', patterns: [/\bfollow us on (instagram|facebook|tiktok)\b/i, /instagram\.com\//i, /facebook\.com\//i, /tiktok\.com\/@/i] },
  { aspect: 'team', signalKey: 'team_employees', patterns: [/\bour team\b/i, /\bmeet the team\b/i, /\bwe are hiring\b/i, /\bcareers\b/i] },
  { aspect: 'established_history', signalKey: 'established_history', patterns: [/\bestablished in \d{4}\b/i, /\bsince \d{4}\b/i, /\byears of experience\b/i] },
];

// WhatsApp explicitly published on the site → the ONLY path to verified WhatsApp.
const WHATSAPP_PATTERN = /(?:wa\.me\/(\+?\d{7,15})|api\.whatsapp\.com\/send\?phone=(\+?\d{7,15})|\bwhatsapp[:\s+]*([+\d][\d\s-]{7,17}))/i;

// tel: hrefs and Kenya-style visible numbers (0XXXXXXXXX | +254XXXXXXXXX | 254XXXXXXXXX).
const TEL_HREF_PATTERN = /href\s*=\s*["']\s*tel:([^"'\s<>]+)/gi;
const VISIBLE_PHONE_PATTERN = /(?<![\d])((?:0|\+?254)\s?[\d][\d\s\-().]{7,12})(?![\d])/g;

// Common secondary pages (pool → path aliases). Only fetched when linked.
const SECONDARY_PAGES = [
  { pool: 'about', aliases: ['about', 'about-us', 'aboutus', 'who-we-are', 'our-story', 'our-company'] },
  { pool: 'contact', aliases: ['contact', 'contact-us', 'contactus', 'get-in-touch', 'reach-us', 'reach-out', 'enquiries'] },
  { pool: 'services', aliases: ['services', 'our-services', 'service', 'what-we-do', 'our-work', 'what-we-offer'] },
  { pool: 'menu', aliases: ['menu', 'our-menu', 'menus'] },
  { pool: 'pricing', aliases: ['pricing', 'prices', 'price-list', 'rates', 'fees'] },
  { pool: 'booking', aliases: ['book', 'booking', 'book-now', 'book-online', 'book-an-appointment', 'appointments', 'appointment', 'reservations', 'reservation', 'reserve'] },
  { pool: 'shop', aliases: ['shop', 'store', 'products', 'catalog', 'catalogue', 'order-online', 'shop-online'] },
  { pool: 'delivery', aliases: ['delivery', 'shipping', 'delivery-info', 'delivery-areas'] },
  { pool: 'careers', aliases: ['careers', 'jobs', 'join-us', 'work-with-us', 'vacancies'] },
  { pool: 'faq', aliases: ['faq', 'faqs', 'help', 'support'] },
  { pool: 'branches', aliases: ['branches', 'locations', 'find-us', 'stores', 'our-branches'] },
];

function bookingRelevant(industry = '') {
  return /(clinic|doctor|dentist|salon|hair|barber|hotel|restaurant|cafe|school|gym|fitness|spa|beauty|repair)/i.test(String(industry || ''));
}

/** "/about-us/" style path → reusable key; root becomes "/". */
function pathKey(u) {
  const p = String(u.pathname || '/').toLowerCase().replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

/** Does the normalized path key denote the given page alias (anywhere in the path)? */
function aliasMatches(key, alias) {
  const a = alias.toLowerCase();
  return key === `/${a}`
    || key === `/${a}/index`
    || key.startsWith(`/${a}-`)
    || key.startsWith(`/${a}_`)
    || key.split('/').includes(a);
}

/**
 * Pick up to maxExtra same-origin pages that the homepage HTML links to and the
 * common secondary-page aliases describe. One page per pool, in document order.
 */
function pickSecondaryPages(html, baseUrl, maxExtra) {
  const base = new URL(baseUrl);
  const links = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = String(m[1] || '').trim();
    if (!raw || /^(#|mailto:|tel:|javascript:|data:)/i.test(raw)) continue;
    try {
      const u = new URL(raw, base);
      if (u.origin !== base.origin) continue;
      if (u.href === base.href) continue;
      links.push(u);
    } catch { /* skip malformed URLs */ }
  }

  const picked = [];
  const usedKeys = new Set();
  const usedPools = new Set();
  for (const u of links) {
    if (picked.length >= maxExtra) break;
    const k = pathKey(u);
    if (usedKeys.has(k)) continue;
    const pool = SECONDARY_PAGES.find((def) =>
      !usedPools.has(def.pool) && def.aliases.some((a) => aliasMatches(k, a))
    );
    if (!pool) continue;
    usedPools.add(pool.pool);
    usedKeys.add(k);
    picked.push({ pool: pool.pool, url: u });
  }
  return picked;
}

/** Normalize a phone-looking string to E.164 Kenya form, or null if it isn't one. */
function normalizePhoneish(raw) {
  const compact = String(raw || '').replace(/[\s\-().]/g, '');
  if (/^\+254\d{9}$/.test(compact)) return compact;
  if (/^254\d{9}$/.test(compact)) return `+${compact}`;
  if (/^0\d{9}$/.test(compact)) return `+254${compact.slice(1)}`;
  return null;
}

/** Public phone numbers that are actually published on the page (provenance per page). */
function extractPublishedPhones(raw, text) {
  const phones = new Set();
  let m;
  TEL_HREF_PATTERN.lastIndex = 0;
  while ((m = TEL_HREF_PATTERN.exec(raw))) {
    const n = normalizePhoneish(m[1]);
    if (n) phones.add(n);
  }
  VISIBLE_PHONE_PATTERN.lastIndex = 0;
  while ((m = VISIBLE_PHONE_PATTERN.exec(text))) {
    const n = normalizePhoneish(m[1]);
    if (n) phones.add(n);
  }
  return [...phones];
}

export const websiteResearchProvider = {
  id: 'website',
  label: "Business website (public pages, robots.txt respected)",

  /**
   * @returns {Promise<{findings: ResearchFinding[], pagesFetched: string[], skipped: string[]}>}
   */
  async research({ business }) {
    const findings = [];
    const pagesFetched = [];
    const skipped = [];

    if (!business.website) {
      return { findings, pagesFetched, skipped, note: 'No website on file — nothing to fetch.' };
    }

    // Homepage always first; politeFetch honours robots.txt + per-host throttle.
    const home = await politeFetch(business.website.startsWith('http') ? business.website : `https://${business.website}`);
    if (!home.ok) {
      return { findings, pagesFetched, skipped: [`homepage: ${home.reason}`], note: 'Website unreachable — research incomplete.' };
    }
    pagesFetched.push(home.finalUrl);

    const candidates = [{ url: home.finalUrl, text: htmlToText(home.text), raw: home.text }];

    // Secondary pages: only common pages the homepage actually links to.
    for (const { pool, url } of pickSecondaryPages(home.text, home.finalUrl, MAX_EXTRA_PAGES)) {
      try {
        const r = await politeFetch(url.href);
        if (r.ok) {
          candidates.push({ url: r.finalUrl, text: htmlToText(r.text), raw: r.text });
          pagesFetched.push(r.finalUrl);
        } else {
          skipped.push(`${url.pathname} (${pool}): ${r.reason}`);
        }
      } catch {
        skipped.push(`${url.pathname} (${pool}): invalid URL`);
      }
    }

    const matchedAspects = new Set();
    const matchedSignals = new Set();
    const sampledSince = `Homepage and ${Math.max(0, pagesFetched.length - 1)} additional linked page${pagesFetched.length === 2 ? '' : 's'} sampled`;

    for (const page of candidates) {
      for (const spec of ASPECT_PATTERNS) {
        const hit = spec.patterns.find((re) => re.test(page.text));
        if (!hit) continue;
        const idx = page.text.search(hit);
        matchedAspects.add(spec.aspect);
        if (spec.signalKey) matchedSignals.add(spec.signalKey);
        findings.push({
          signalKey: spec.signalKey,
          evidenceType: 'observation',
          claimType: 'FACT',
          text: `Website states (${spec.aspect.replaceAll('_', ' ')}): matched “${page.text.slice(Math.max(0, idx - 40), idx + 120).trim()}”`,
          excerptSummary: page.text.slice(Math.max(0, idx - 60), idx + 160).trim(),
          sourceName: 'Business website',
          sourceUrl: page.url,
          confidence: 0.65,
        });
      }

      // Explicit WhatsApp publication
      const waMatch = page.raw.match(WHATSAPP_PATTERN);
      if (waMatch) {
        const number = (waMatch[1] || waMatch[2] || waMatch[3]).replace(/[\s-]/g, '');
        findings.push({
          signalKey: 'phone_whatsapp_published',
          evidenceType: 'listing_detail',
          claimType: 'FACT',
          text: `Business website publishes a WhatsApp contact number (+${number.replace(/^\+/, '')}).`,
          excerptSummary: 'WhatsApp link/number found in page markup.',
          sourceName: 'Business website',
          sourceUrl: page.url,
          confidence: 0.9,
          whatsappNumber: `+${number.replace(/^\+/, '')}`,
        });
      }

      // Explicit public phone number (kept as an evidence signal, never implies
      // WhatsApp; stored as evidence only — contact rows stay provider-owned).
      for (const phone of extractPublishedPhones(page.raw, page.text)) {
        findings.push({
          signalKey: 'public_phone_published',
          evidenceType: 'listing_detail',
          claimType: 'FACT',
          text: `Business website publishes a public phone number (${phone}).`,
          excerptSummary: 'Phone number published on the page.',
          sourceName: 'Business website',
          sourceUrl: page.url,
          confidence: 0.7,
        });
      }
    }

    if (!matchedSignals.has('online_ordering')) {
      findings.push({
        signalKey: 'no_online_ordering',
        evidenceType: 'observation',
        claimType: 'INFERENCE',
        text: 'Sampled public website pages did not expose a checkout, cart, or clear online ordering path.',
        excerptSummary: sampledSince + '; no visible online ordering flow matched.',
        sourceName: 'Business website',
        sourceUrl: home.finalUrl,
        confidence: 0.55,
      });
    }

    if (bookingRelevant(business.industry) && !matchedAspects.has('booking')) {
      findings.push({
        signalKey: 'no_booking_system',
        evidenceType: 'observation',
        claimType: 'INFERENCE',
        text: 'Sampled public website pages did not expose an online booking or reservation path.',
        excerptSummary: sampledSince + '; no booking/reservation flow matched.',
        sourceName: 'Business website',
        sourceUrl: home.finalUrl,
        confidence: 0.5,
      });
    }

    return { findings, pagesFetched, skipped };
  },
};