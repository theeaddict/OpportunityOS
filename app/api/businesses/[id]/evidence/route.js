import * as businessesRepo from '@/lib/repositories/businesses';
import * as evidenceRepo from '@/lib/repositories/evidence';
import { audit } from '@/lib/audit';
import { requireAccount, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { SIGNAL_KEYS } from '@/lib/constants';

const CLAIM_TYPES = ['FACT', 'INFERENCE', 'HYPOTHESIS'];
const EVIDENCE_TYPES = ['observation','public_stat','customer_review','listing_detail','news','interview_note','ai_interpretation','other'];

export async function POST(request, { params }) {
  try {
    const user = await requireAccount();
    const { id } = await params;
    const businessId = Number(id);
    const business = await businessesRepo.findBusiness(user.account_id, businessId);
    if (!business) return Response.json({ ok: false, error: 'Business not found' }, { status: 404 });
    const body = await readJson(request);

    const evidenceText = String(body.evidence_text || body.summary || body.title || '').trim();
    if (!evidenceText) return Response.json({ ok: false, error: 'Evidence text is required' }, { status: 400 });
    const sourceName = String(body.source_name || '').trim();
    if (!sourceName) return Response.json({ ok: false, error: 'Source is required — every claim needs provenance' }, { status: 400 });

    // Optional provenance source row so evidence can point at it.
    let sourceId = null;
    if (body.source_url) {
      const { addSource } = await import('@/lib/repositories/businesses');
      sourceId = await addSource({
        account_id: user.account_id,
        business_id: businessId,
        source_type: 'web_directory',
        source_name: sourceName,
        source_url: String(body.source_url).trim(),
      });
    }

    const claimType = CLAIM_TYPES.includes(String(body.claim_type || '').toUpperCase())
      ? String(body.claim_type).toUpperCase() : 'FACT';

    const evidenceId = await evidenceRepo.addEvidence({
      account_id: user.account_id,
      business_id: businessId,
      source_id: sourceId,
      evidence_type: EVIDENCE_TYPES.includes(body.evidence_type) ? body.evidence_type : 'observation',
      claim_type: claimType,
      signal_key: Object.keys(SIGNAL_KEYS).includes(body.signal_key) ? body.signal_key : null,
      evidence_text: evidenceText.slice(0, 5000),
      source_excerpt_summary: body.source_excerpt_summary ? String(body.source_excerpt_summary).slice(0, 1000) : null,
      confidence_score: body.confidence_score ?? body.confidence ?? 0.5,
      captured_by: user.id,
    });

    await audit('evidence.created', {
      entity_type: 'business', entity_id: businessId,
      metadata: { evidence_id: evidenceId, claim_type: claimType, signal_key: body.signal_key || null },
      user_id: user.id, account_id: user.account_id,
    });

    // New signals can unlock candidate problems.
    const { detectOpportunities } = await import('@/lib/services/analysis');
    let detected = [];
    try {
      detected = (await detectOpportunities(user.account_id, businessId, user.id)).created;
    } catch { /* detection is best-effort here */ }

    return jsonOk({ id: evidenceId, detected_opportunities: detected });
  } catch (err) {
    return handleRouteError(err);
  }
}
