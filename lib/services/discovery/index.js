/**
 * DiscoveryProvider implementations + registry.
 *
 * COMPLIANCE: no platform is scraped directly. Social discovery requires an
 * operator-configured supported API (DISCOVERY_API_URL). Built-ins:
 *   http          — generic POST {filters} -> {results:[…]} endpoint
 *   feed          — pull-based ingestion from SOCIAL_MEDIA_FEED_URL (licensed lead source)
 *   google_places — Google Places Text Search, enabled with GOOGLE_PLACES_API_KEY
 *   osm_overpass  — OpenStreetMap Overpass (free; OSM_OVERPASS_ENABLED=0 disables)
 *   manual        — nothing automatic; user adds businesses by hand
 */

import * as businessesRepo from '@/lib/repositories/businesses.js';
import { manualContactProvider } from '@/lib/services/providers/contact-provider.js';
import { googlePlacesProvider } from '@/lib/services/discovery/providers/google-places.js';
import { osmOverpassProvider } from '@/lib/services/discovery/providers/osm-overpass.js';
import { normalizeSocialHandle } from '@/lib/normalize.js';
import { isEmail, isUrl } from '@/lib/validation.js';

export const PROVIDERS = {
  manual: {
    id: 'manual',
    label: 'Manual entry',
    description: 'No external discovery provider configured. Add businesses manually; the platform researches and analyzes them.',
    available: true,
  },
  ...(process.env.DISCOVERY_API_URL ? {
    http: {
      id: 'http',
      label: `Configured discovery API (${process.env.DISCOVERY_API_URL})`,
      description: 'Operator-provided discovery source (must be a licensed/supported data provider).',
      available: true,
    },
  } : {}),
  ...(process.env.SOCIAL_MEDIA_FEED_URL ? {
    feed: {
      id: 'feed',
      label: `Social feed (${process.env.SOCIAL_MEDIA_FEED_URL})`,
      description: 'Pull-based ingestion from a configured social/lead-collection endpoint (media posts or leads crawled under license).',
      available: true,
    },
  } : {}),
  ...(process.env.GOOGLE_PLACES_API_KEY ? {
    google_places: {
      id: 'google_places',
      label: 'Google Places',
      description: 'Searches public Google Maps listings via the Places Text Search API.',
      available: true,
    },
  } : {}),
  ...(osmOverpassProvider.available ? {
    osm_overpass: {
      id: 'osm_overpass',
      label: osmOverpassProvider.label,
      description: 'Searches public OpenStreetMap listings via the free Overpass API (no key required; throttled + cached).',
      available: true,
    },
  } : {}),
};

export function listProviders() {
  return Object.values(PROVIDERS);
}

export function getDiscoveryProvider(id) {
  return PROVIDERS[id] ?? null;
}

/** Default provider fallback: prefer http, then feed, then google_places, then osm_overpass, then manual. */
export function defaultProvider() {
  return getDiscoveryProvider('http') ? 'http'
    : getDiscoveryProvider('feed') ? 'feed'
    : getDiscoveryProvider('google_places') ? 'google_places'
    : getDiscoveryProvider('osm_overpass')?.available ? 'osm_overpass'
    : 'manual';
}

/** A user-picked map area — takes priority over geocoding `location` by name. */
function normalizeBbox(bbox) {
  if (!bbox || typeof bbox !== 'object') return null;
  const { south, north, west, east } = bbox;
  const nums = [south, north, west, east].map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [s, n, w, e] = nums;
  if (s < -90 || n > 90 || s >= n || w < -180 || e > 180 || w >= e) return null;
  return { south: s, north: n, west: w, east: e };
}

/** Normalize incoming filters into the SearchFilters contract. */
export function normalizeFilters(body = {}) {
  return {
    query: String(body.query || '').trim().slice(0, 300),
    industry: body.industry ? String(body.industry).slice(0, 120) : null,
    location: body.location ? String(body.location).slice(0, 160) : null,
    bbox: normalizeBbox(body.bbox),
    platform: body.platform ? String(body.platform).toLowerCase().slice(0, 40) : null,
    minimumAudience: body.minimumAudience != null && Number(body.minimumAudience) > 0 ? Math.floor(Number(body.minimumAudience)) : null,
    businessMaturity: ['any', 'small', 'established', 'mature'].includes(body.businessMaturity) ? body.businessMaturity : 'any',
    keywords: body.keywords ? String(body.keywords).slice(0, 2000) : null,
    problemCategories: Array.isArray(body.problemCategories) ? body.problemCategories.slice(0, 10) : [],
    solutions: body.solutions ? String(body.solutions).slice(0, 500) : null,
    requiredContactType: ['email', 'phone', 'whatsapp', 'social'].includes(body.requiredContactType) ? body.requiredContactType : null,
  };
}

export async function runSearch(providerId, filters) {
  if (providerId === 'http' && process.env.DISCOVERY_API_URL) {
    const res = await fetch(process.env.DISCOVERY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filters),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Discovery provider failed (${res.status})`);
    const data = await res.json();
    return Array.isArray(data.results) ? data.results : [];
  }
  if (providerId === 'feed' && process.env.SOCIAL_MEDIA_FEED_URL) {
    const res = await fetch(process.env.SOCIAL_MEDIA_FEED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Language': 'en' },
      body: JSON.stringify({ ...filters, since: filters.since || null }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Social feed failed (${res.status})`);
    const data = await res.json();
    return Array.isArray(data) ? data : (Array.isArray(data.results) ? data.results : []);
  }
  if (providerId === 'google_places' && process.env.GOOGLE_PLACES_API_KEY) {
    return googlePlacesProvider.search(filters);
  }
  if (providerId === 'osm_overpass' && osmOverpassProvider.available) {
    return osmOverpassProvider.search(filters);
  }
  return []; // manual
}

/**
 * Runs every configured PUBLIC-LISTING provider (google_places, osm_overpass)
 * for the SAME filters at once and merges their candidates into one list —
 * each source sees whatever it can find independently, so a business missing
 * from one (e.g. no website field on OSM) can still be confirmed by the
 * other. importCandidates()'s existing dedup (normalized name/website/phone/
 * social) then naturally merges a business both sources found into one
 * record carrying evidence from both, rather than creating a duplicate.
 *
 * 'http'/'feed' are deliberately excluded — those are operator-configured,
 * licensed sources meant to be used on purpose, not silently combined with
 * public listing search. A provider erroring (e.g. a Google quota failure)
 * never sinks the others.
 */
export async function runAllSearches(filters) {
  const ids = [];
  if (process.env.GOOGLE_PLACES_API_KEY) ids.push('google_places');
  if (osmOverpassProvider.available) ids.push('osm_overpass');
  if (!ids.length) return [];

  const settled = await Promise.allSettled(ids.map((id) => runSearch(id, filters)));
  const combined = [];
  settled.forEach((r) => {
    if (r.status === 'fulfilled') combined.push(...r.value);
  });
  return combined;
}

/**
 * Normalize + import candidate businesses:
 *  - dedup across normalized name / website / phone / social handle
 *  - contacts classified by the ContactProvider (WhatsApp rules enforced there)
 *  - social profiles stored as sources with external_identifier
 *  - candidate evidence imported with provenance
 */
export async function importCandidates(accountId, candidates, { userId }) {
  const outcomes = [];
  for (const c of candidates) {
    try {
      const name = String(c.name || '').trim().slice(0, 200);
      if (!name) throw new Error('missing name');

      const social = normalizeSocialHandle(c.socialUrl, c.platform);

      // Deduplicate BEFORE creating anything (within this account).
      const existing = await businessesRepo.findBusinessByMatch(accountId, {
        name, website: c.website, phone: c.phone, socialUrl: c.socialUrl,
        externalId: c.source?.external_identifier || null,
      });
      if (existing) {
        // Forward-looking import rule: a re-scan never *replaces* a matching
        // business, but it also must not hide fresh public data. Evidence is
        // deduped by exact text, so a same-source re-scan appends nothing
        // (status 'duplicate'), while a different source — e.g. an OSM phone-only
        // listing being re-scanned by Google Places — appends its distinct rows
        // (status 'updated'). Contacts upsert by normalized value. This is the
        // same append-on-duplicate model ingestLeads uses for live leads.
        const added = await appendCandidateEvidence(accountId, existing.id, c, { userId, social });
        const contactsMerged = await mergeCandidateContacts(accountId, existing.id, c);
        outcomes.push({
          name,
          status: added > 0 ? 'updated' : 'duplicate',
          business_id: existing.id,
          new_evidence: added,
          contacts_merged: contactsMerged,
        });
        continue;
      }

      const businessId = await persistCandidate(accountId, c, { userId, social });
      outcomes.push({ name, status: 'created', business_id: businessId, new_evidence: countEvidence(c), needs_manual_follow_up: !contactVerifiedCandidate(c) });
    } catch (err) {
      outcomes.push({ name: c.name || '(unnamed)', status: 'error', error: String(err.message || err) });
    }
  }
  return outcomes;
}

/**
 * Real-time lead ingestion (webhooks / live feeds). Same normalization + dedup
 * as importCandidates, but a business that already exists is UPDATED with any
 * new evidence from this batch (e.g. a fresh social post) instead of skipped —
 * that is what turns "they posted again" into a freshly re-evaluated lead.
 */
export async function ingestLeads(accountId, candidates, { userId }) {
  const outcomes = [];
  for (const c of candidates) {
    try {
      const name = String(c.name || '').trim().slice(0, 200);
      if (!name) throw new Error('missing name');

      const social = normalizeSocialHandle(c.socialUrl, c.platform);
      const existing = await businessesRepo.findBusinessByMatch(accountId, {
        name, website: c.website, phone: c.phone, socialUrl: c.socialUrl,
        externalId: c.source?.external_identifier || null,
      });
      if (existing) {
        const added = await appendCandidateEvidence(accountId, existing.id, c, { userId, social });
        outcomes.push({
          name, status: added > 0 ? 'updated' : 'duplicate',
          business_id: existing.id, new_evidence: added,
        });
        continue;
      }

      const businessId = await persistCandidate(accountId, c, { userId, social });
      outcomes.push({ name, status: 'created', business_id: businessId, new_evidence: countEvidence(c), needs_manual_follow_up: !contactVerifiedCandidate(c) });
    } catch (err) {
      outcomes.push({ name: c.name || '(unnamed)', status: 'error', error: String(err.message || err) });
    }
  }
  return outcomes;
}

/** Whether a candidate carries a usable public contact (phone/website/contact row). */
function contactVerifiedCandidate(c) {
  if (c.contact_verified != null) return Boolean(c.contact_verified);
  return Boolean(c.phone || c.website || (c.contacts || []).some((ct) => ct && ct.contact_value));
}

function countEvidence(c) {
  return (c.evidence || []).filter((ev) => ev && ev.text).length;
}

/**
 * Upsert a candidate's contacts onto an existing business. Idempotent: addContact
 * updates in place when the same contact already exists, so repeated re-scans
 * never accumulate rows.
 */
async function mergeCandidateContacts(accountId, businessId, c) {
  let merged = 0;
  const contacts = await manualContactProvider.extract({ ...c, contacts: c.contacts || [] });
  for (const ct of contacts) {
    try {
      await businessesRepo.addContact({
        account_id: accountId,
        business_id: businessId,
        contact_type: ct.contactType,
        contact_value: ct.contactValue,
        verification_status: ct.verificationStatus,
        confidence_score: ct.confidenceScore,
        source_id: null,
      });
      merged += 1;
    } catch { /* invalid contact — never invent */ }
  }
  return merged;
}

/** Persist a brand-new candidate: business + source + contacts + evidence. */
async function persistCandidate(accountId, c, { userId, social }) {
  const contactVerified = c.contact_verified != null
    ? Boolean(c.contact_verified)
    : Boolean(c.phone || c.website || (c.contacts || []).some((ct) => ct && ct.contact_value));

  const businessId = await businessesRepo.createBusiness({
    account_id: accountId,
    name: String(c.name || '').trim().slice(0, 200),
    industry: c.industry ? String(c.industry).slice(0, 120) : null,
    description: c.description ? String(c.description).slice(0, 4000) : null,
    location: c.location ? String(c.location).slice(0, 160) : null,
    country: c.country ? String(c.country).slice(0, 120) : null,
    website: c.website || null,
    phone: c.phone || null,
    primary_social_platform: social?.platform || c.platform || null,
    data_origin: 'provider',
    contact_verified: contactVerified,
    created_by: userId,
  });

  const src = c.source || {};
  const sourceId = await businessesRepo.addSource({
    account_id: accountId,
    business_id: businessId,
    source_type: social ? 'social_media'
      : src.source_type === 'manual_entry' ? 'manual_entry'
      : 'provider_api',
    source_name: src.source_name || (social ? `${social.platform} profile` : 'Discovery provider'),
    source_url: isUrl(src.source_url || '') ? src.source_url : (isUrl(c.socialUrl || '') ? c.socialUrl : null),
    external_identifier: src.external_identifier || social?.normalized || null,
  });

  // Contacts via ContactProvider (WhatsApp rules enforced there)
  const contacts = await manualContactProvider.extract({ ...c, contacts: c.contacts || [] });
  for (const ct of contacts) {
    try {
      await businessesRepo.addContact({
        account_id: accountId,
        business_id: businessId,
        contact_type: ct.contactType,
        contact_value: ct.contactValue,
        verification_status: ct.verificationStatus,
        confidence_score: ct.confidenceScore,
        source_id: sourceId,
      });
    } catch { /* invalid contact — never invent */ }
  }

  await appendCandidateEvidence(accountId, businessId, c, { userId, social, sourceId });

  if (!contactVerified) {
    // No public contact on the source listing — never simulate one. Record a
    // traceable, low-confidence HYPOTHESIS so the business is visible for
    // manual follow-up while staying out of automatic detection (signalsForBusiness
    // excludes HYPOTHESIS claims entirely).
    const { addEvidence } = await import('@/lib/repositories/evidence.js');
    const sourceLabel = social ? `${social.platform} profile` : (src.source_name || 'the source listing');
    await addEvidence({
      account_id: accountId,
      business_id: businessId,
      source_id: sourceId,
      evidence_type: 'observation',
      claim_type: 'HYPOTHESIS',
      signal_key: null,
      evidence_text: `Listed by ${sourceLabel} but no public phone, website or social contact was published — manual follow-up required.`,
      source_excerpt_summary: 'No public contact details found',
      confidence_score: 0.2,
      captured_by: userId,
    }).catch(() => {});
  }
  return businessId;
}

/** Attach candidate evidence (deduped by text) to a business; returns count added. */
async function appendCandidateEvidence(accountId, businessId, c, { userId, social, sourceId }) {
  const evs = (c.evidence || []).filter((ev) => ev && ev.text);
  if (!evs.length) return 0;
  const { addEvidence, getTextsForBusiness } = await import('@/lib/repositories/evidence.js');
  const existing = new Set(await getTextsForBusiness(accountId, businessId));
  let added = 0;
  for (const ev of evs) {
    const text = String(ev.text).slice(0, 5000);
    if (existing.has(text)) continue;
    // Reuse the existing social source when there is one; otherwise add a fresh one.
    const srcId = sourceId ?? await sourceFor(accountId, businessId, c, social);
    const claimTypeRaw = String(ev.claimType || ev.claim_type || '').toUpperCase();
    const eid = await addEvidence({
      account_id: accountId,
      business_id: businessId,
      source_id: srcId,
      evidence_type: 'observation',
      claim_type: ['FACT', 'INFERENCE', 'HYPOTHESIS'].includes(claimTypeRaw) ? claimTypeRaw : 'HYPOTHESIS',
      signal_key: ev.signal_key || ev.signalKey || null,
      evidence_text: text,
      source_excerpt_summary: null,
      confidence_score: Number(ev.confidence ?? 0.5),
      captured_by: userId,
    });
    if (eid) added += 1;
  }
  return added;
}

/** Find (or create) a source row attachable to this business for evidence provenance. */
async function sourceFor(accountId, businessId, c, social) {
  const src = c.source || {};
  return businessesRepo.addSource({
    account_id: accountId,
    business_id: businessId,
    source_type: social ? 'social_media'
      : src.source_type === 'manual_entry' ? 'manual_entry'
      : 'provider_api',
    source_name: src.source_name || (social ? `${social.platform} profile` : 'Discovery provider'),
    source_url: isUrl(src.source_url || '') ? src.source_url : (isUrl(c.socialUrl || '') ? c.socialUrl : null),
    external_identifier: src.external_identifier || social?.normalized || null,
  });
}
