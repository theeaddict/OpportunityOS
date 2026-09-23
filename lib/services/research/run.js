import * as evidenceRepo from '@/lib/repositories/evidence';
import * as businessesRepo from '@/lib/repositories/businesses';
import { getRawProvider } from './index.js';
import { computeResearchCoverage, RESEARCH_ASPECTS } from './coverage.js';
import { audit } from '@/lib/audit';
import { incrementUsage } from '@/lib/accounts/usage';
import { HttpError } from '@/lib/api-helpers';

/**
 * Run automated research for a business via the active BusinessResearchProvider.
 *
 * Findings become business_evidence rows with full provenance (source name/URL,
 * text, claim type, confidence, timestamp). A WhatsApp number is stored ONLY if
 * the provider found it explicitly published (verified_public_whatsapp); phones
 * without that confirmation stay phone_only. Missing topics remain uncovered —
 * the UI shows "Research incomplete", never invented content.
 */
export async function runAutomatedResearch(accountId, businessId, userId, { trackUsage = true } = {}) {
  const business = await businessesRepo.findBusiness(accountId, businessId);
  if (!business) throw new HttpError(404, 'Business not found');
  const provider = getRawProvider();

  let result;
  try {
    result = await provider.research({ business });
  } catch (err) {
    throw new Error(`Research provider failed: ${String(err.message || err).slice(0, 200)}`);
  }

  // Provenance source rows for this run.
  const sourceIds = new Map();
  async function sourceIdFor(finding) {
    const key = `${finding.sourceName}|${finding.sourceUrl || ''}`;
    if (!sourceIds.has(key)) {
      sourceIds.set(key, await businessesRepo.addSource({
        account_id: accountId,
        business_id: businessId,
        source_type: /website/i.test(finding.sourceName) ? 'web_directory' : 'other',
        source_name: finding.sourceName,
        source_url: finding.sourceUrl || null,
        external_identifier: null,
      }));
    }
    return sourceIds.get(key);
  }

  const saved = [];
  for (const f of result.findings || []) {
    if (!f.text) continue;
    const sid = await sourceIdFor(f);
    saved.push(await evidenceRepo.addEvidence({
      account_id: accountId,
      business_id: businessId,
      source_id: sid,
      evidence_type: ['observation','public_stat','customer_review','listing_detail','news','interview_note','ai_interpretation','other'].includes(f.evidenceType) ? f.evidenceType : 'observation',
      claim_type: f.claimType || 'FACT',
      signal_key: f.signalKey || null,
      evidence_text: String(f.text).slice(0, 5000),
      source_excerpt_summary: f.excerptSummary ? String(f.excerptSummary).slice(0, 1000) : null,
      confidence_score: Number(f.confidence ?? 0.5),
      captured_by: userId,
    }));

    // CONTACT RULES: only an explicitly published WhatsApp becomes verified;
    // it is stored as its own contact_type — phones are never converted.
    if (f.whatsappNumber) {
      await businessesRepo.addContact({
        account_id: accountId,
        business_id: businessId,
        contact_type: 'whatsapp',
        contact_value: f.whatsappNumber,
        verification_status: 'verified_public_whatsapp',
        confidence_score: f.confidence ?? 0.9,
        source_id: sid,
      }).catch(() => {}); // duplicate or rejected → skip silently; evidence remains
    }
  }

  // Update maturity snapshot columns from derived signals (transparency note).
  const signals = await evidenceRepo.signalsForBusiness(accountId, businessId);
  const maturityScore = Math.min(100, Object.keys(signals).length * 12);
  await businessesRepo.updateBusiness(accountId, businessId, {
    ...business,
    business_maturity_score: maturityScore,
    business_maturity_notes: `Auto-derived from ${Object.keys(signals).length} evidence-backed signals after automated research run.`,
  });

  const coverage = await getCoverage(accountId, businessId);
  // Usage tracking: one business researched this period (clamped; the request
  // boundary asserts the plan limit before expensive work is enqueued).
  if (trackUsage) await incrementUsage(accountId, 'researches', 1).catch(() => {});
  await audit('research.run', {
    account_id: accountId,
    entity_type: 'businesses', entity_id: businessId,
    metadata: { provider: provider.id, findings: saved.length, pages: result.pagesFetched?.length || 0 },
    user_id: userId,
  });

  return {
    provider: provider.id,
    findings_saved: saved.length,
    pages_fetched: result.pagesFetched || [],
    skipped: result.skipped || [],
    note: result.note || null,
    coverage,
  };
}

export async function getCoverage(accountId, businessId) {
  const [evidenceRows, profileRow] = await Promise.all([
    evidenceRepo.listForBusiness(accountId, businessId),
    import('@/lib/db').then(({ query }) => query(
      `SELECT output_json FROM ai_jobs WHERE job_type='research_interpretation'
        AND business_id=? AND account_id=? AND status='completed' ORDER BY id DESC LIMIT 1`,
      [Number(businessId), Number(accountId)]
    )),
  ]);
  let profile = null;
  const raw = profileRow[0]?.output_json;
  if (raw) {
    try { profile = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { /* ignore */ }
  }
  const coverage = computeResearchCoverage(evidenceRows, profile);
  return { ...coverage, aspects: RESEARCH_ASPECTS.map((a) => a.label) };
}
