import * as evidenceRepo from '@/lib/repositories/evidence';
import { audit } from '@/lib/audit';
import { requireAccount, requireRole, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { SIGNAL_KEYS } from '@/lib/constants';

export async function PATCH(request, { params }) {
  try {
    const user = await requireAccount();
    requireRole(user, 'admin'); // evidence edits are account-wide data
    const { id } = await params;
    const existing = await evidenceRepo.findById(user.account_id, Number(id));
    if (!existing) return Response.json({ ok: false, error: 'Evidence not found' }, { status: 404 });

    const body = await readJson(request);
    const evidenceText = String(body.evidence_text || existing.evidence_text).trim();
    if (!evidenceText) return Response.json({ ok: false, error: 'Evidence text is required' }, { status: 400 });

    await evidenceRepo.updateEvidence(user.account_id, existing.id, {
      evidence_type: body.evidence_type || existing.evidence_type,
      claim_type: String(body.claim_type || existing.claim_type).toUpperCase(),
      signal_key: Object.keys(SIGNAL_KEYS).includes(body.signal_key || '') ? body.signal_key : existing.signal_key,
      evidence_text: evidenceText.slice(0, 5000),
      source_excerpt_summary: body.source_excerpt_summary ?? existing.source_excerpt_summary,
      confidence_score: body.confidence_score ?? existing.confidence_score,
    });
    await audit('evidence.updated', { entity_type: 'business_evidence', entity_id: existing.id, metadata: {}, user_id: user.id, account_id: user.account_id });
    return jsonOk({ id: existing.id });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(request, { params }) {
  try {
    const user = await requireAccount();
    requireRole(user, 'admin'); // evidence deletions are account-wide data
    const { id } = await params;
    await evidenceRepo.removeEvidence(user.account_id, Number(id));
    await audit('evidence.deleted', { entity_type: 'business_evidence', entity_id: Number(id), user_id: user.id, account_id: user.account_id });
    return jsonOk({ id: Number(id) });
  } catch (err) {
    return handleRouteError(err);
  }
}
