import { politeFetch, htmlToText } from './polite-fetcher.js';

/**
 * WebsiteResearchProvider — researches a business's OWN public website.
 *
 * Extracts observable facts (keyword-anchored) into candidate evidence with the
 * page URL as source. Only what is actually on the page becomes evidence; if a
 * topic is absent, it stays uncovered (the UI shows "Research incomplete").
 */

const ASPECT_PATTERNS = [
  { aspect: 'online_sales', signalKey: 'online_ordering', patterns: [/\bshop now\b/i, /\border online\b/i, /\badd to (cart|basket)\b/i, /\bcheckout\b/i, /\bonline store\b/i] },
  { aspect: 'ordering', signalKey: 'existing_website', patterns: [/\bplace (an )?order\b/i, /\bhow to order\b/i, /\bmenu\b.{0,30}\bprice/i] },
  { aspect: 'booking', signalKey: null, patterns: [/\bbook(ing)? (now|online|an appointment)\b/i, /\bappointment(s)?\b/i, /\breserve\b/i, /\bmake a reservation\b/i] },
  { aspect: 'delivery', signalKey: 'delivery_operations', patterns: [/\bwe deliver\b/i, /\bfree delivery\b/i, /\bdelivery available\b/i, /\briders?\b/i, /\bdoor[- ]to[- ]door\b/i] },
  { aspect: 'wholesale', signalKey: 'wholesale_operations', patterns: [/\bwholesale\b/i, /\bbulk (order|price)s?\b/i, /\bdistributors? wanted\b/i, /\bcontractor prices?\b/i] },
  { aspect: 'pricing', signalKey: null, patterns: [/(\bKSh\b|\bKES\b|\bTZS\b|\bUGX\b|\$\s?\d|\bUSD\s?\d)/i, /\bprice list\b/i, /\bfrom \$?\d/i] },
  { aspect: 'locations_branches', signalKey: 'multiple_branches', patterns: [/\bour branches\b/i, /\bother locations?\b/i, /\bvisit us at\b/i, /\bfind us (at|in)\b/i] },
  { aspect: 'customer_service', signalKey: null, patterns: [/\bcontact us\b/i, /\bcustomer (care|service|support)\b/i, /\bwhatsapp us\b/i] },
  { aspect: 'social_commerce', signalKey: 'active_social_commerce', patterns: [/\bfollow us on (instagram|facebook|tiktok)\b/i, /instagram\.com\//i, /facebook\.com\//i, /tiktok\.com\/@/i] },
  { aspect: 'team', signalKey: 'team_employees', patterns: [/\bour team\b/i, /\bmeet the team\b/i, /\bwe are hiring\b/i, /\bcareers\b/i] },
  { aspect: 'established_history', signalKey: 'established_history', patterns: [/\bestablished in \d{4}\b/i, /\bsince \d{4}\b/i, /\byears of experience\b/i] },
];

// WhatsApp explicitly published on the site → the ONLY path to verified WhatsApp.
const WHATSAPP_PATTERN = /(?:wa\.me\/(\+?\d{7,15})|api\.whatsapp\.com\/send\?phone=(\+?\d{7,15})|\bwhatsapp[:\s+]*([+\d][\d\s-]{7,17}))/i;

function bookingRelevant(industry = '') {
  return /(clinic|doctor|dentist|salon|hair|barber|hotel|restaurant|cafe|school|gym|fitness|spa|beauty|repair)/i.test(String(industry || ''));
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

    // Homepage first; contact/about pages only if linked from homepage HTML.
    const home = await politeFetch(business.website.startsWith('http') ? business.website : `https://${business.website}`);
    if (!home.ok) {
      return { findings, pagesFetched, skipped: [`homepage: ${home.reason}`], note: 'Website unreachable — research incomplete.' };
    }
    pagesFetched.push(home.finalUrl);

    const candidates = [{ url: home.finalUrl, text: htmlToText(home.text), raw: home.text }];
    for (const extra of ['/contact', '/about']) {
      try {
        const u = new URL(extra, home.finalUrl).toString();
        const r = await politeFetch(u);
        if (r.ok) {
          candidates.push({ url: r.finalUrl, text: htmlToText(r.text), raw: r.text });
          pagesFetched.push(r.finalUrl);
        } else {
          skipped.push(`${extra}: ${r.reason}`);
        }
      } catch { /* invalid URL construction — skip */ }
    }

    const matchedAspects = new Set();
    const matchedSignals = new Set();

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
    }

    if (!matchedSignals.has('online_ordering')) {
      findings.push({
        signalKey: 'no_online_ordering',
        evidenceType: 'observation',
        claimType: 'INFERENCE',
        text: 'Sampled public website pages did not expose a checkout, cart, or clear online ordering path.',
        excerptSummary: 'Homepage/contact/about pages sampled; no visible online ordering flow matched.',
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
        excerptSummary: 'Homepage/contact/about pages sampled; no booking/reservation flow matched.',
        sourceName: 'Business website',
        sourceUrl: home.finalUrl,
        confidence: 0.5,
      });
    }

    return { findings, pagesFetched, skipped };
  },
};
