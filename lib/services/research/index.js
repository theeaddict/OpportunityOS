import { websiteResearchProvider } from './website-provider.js';

/** Research checklist used by the manual workspace UI. */
export const RESEARCH_CHECKLIST = [
  { key: 'web_presence', label: 'Website & online ordering', hint: 'Do they have a website? Can customers order or book online?' },
  { key: 'social', label: 'Social media activity', hint: 'Are they actively selling via social channels? Do they take orders in DMs/comments?' },
  { key: 'listings', label: 'Business listings & maps', hint: 'Branches, opening hours, photos, category details.' },
  { key: 'reviews', label: 'Customer reviews', hint: 'Complaints about slow replies, stock, delivery, quotes — these reveal real problems.' },
  { key: 'team', label: 'Team & hiring signals', hint: 'Job adverts, staff mentions and team pages show size and structure.' },
  { key: 'operations', label: 'Operations signals', hint: 'Delivery fleets, wholesale terms, export activity, multiple channels.' },
];

function withManualHelpers(provider) {
  return {
    ...provider,
    checklist: RESEARCH_CHECKLIST,
    async candidatesFor(business) {
      return []; // automated providers return real evidence; manual adds by hand
    },
  };
}

/**
 * BusinessResearchProvider registry.
 *
 * RESEARCH_PROVIDER env selects the implementation:
 *   website  — fetches the business's OWN public site (robots.txt respected)  [default]
 *   http     — operator-configured endpoint (RESEARCH_API_URL), e.g. a licensed
 *              data provider API; contract: POST {business} -> {findings:[…]}
 *   manual   — checklist only (no automated fetching)
 */
export function getResearchProvider() {
  return withManualHelpers(getRawProvider());
}

export function getRawProvider() {
  const kind = process.env.RESEARCH_PROVIDER || 'website';
  if (kind === 'http' && process.env.RESEARCH_API_URL) {
    return httpResearchProvider();
  }
  if (kind === 'manual') {
    return {
      id: 'manual',
      label: 'Manual research (no automated fetching)',
      async research() {
        return { findings: [], pagesFetched: [], skipped: [], note: 'Automated research disabled.' };
      },
    };
  }
  return websiteResearchProvider;
}

function httpResearchProvider() {
  return {
    id: 'http',
    label: `Configured research API (${process.env.RESEARCH_API_URL})`,
    async research({ business }) {
      const res = await fetch(process.env.RESEARCH_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: business.name, website: business.website, industry: business.industry, location: business.location }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`research API failed (${res.status})`);
      const data = await res.json();
      const findings = (Array.isArray(data.findings) ? data.findings : []).map((f) => ({
        signalKey: f.signal_key ?? f.signalKey ?? null,
        evidenceType: f.evidence_type ?? f.evidenceType ?? 'observation',
        claimType: ['FACT', 'INFERENCE', 'HYPOTHESIS'].includes(String(f.claim_type || f.claimType || '').toUpperCase())
          ? String(f.claim_type || f.claimType).toUpperCase() : 'HYPOTHESIS',
        text: String(f.text || '').slice(0, 2000),
        excerptSummary: f.excerpt_summary ?? f.excerptSummary ?? null,
        sourceName: String(f.source_name || f.sourceName || 'Research API').slice(0, 200),
        sourceUrl: f.source_url ?? f.sourceUrl ?? null,
        confidence: Math.min(1, Math.max(0, Number(f.confidence ?? 0.5))),
        whatsappNumber: f.whatsapp_number ?? f.whatsappNumber ?? null,
      }));
      return { findings, pagesFetched: data.pages_fetched || [], skipped: [] };
    },
  };
}

export { websiteResearchProvider };
export * from './coverage.js';
